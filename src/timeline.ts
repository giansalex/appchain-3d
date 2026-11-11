// Time travel: scrub the Block Helix back through the chain's history.
// The helix normally grows at the head. Dragging the scrubber (or opening an old block from search or a link)
// swaps it for a window of past blocks fetched by height; "Live" returns to the present.

import { $, fmt } from './dom';
import type { ChainFeed } from './data';
import type { Interior } from './interior';
import type { Block } from './types';

export interface TimelineDeps {
  feed: () => ChainFeed | null;
  interior: () => Interior | null;
  /** Point the camera at the helix when the visitor starts scrubbing. */
  lookAtHelix: () => void;
}

export interface Timeline {
  /** Make sure a block is on screen: already there, part of the live helix, or loaded as a history window. */
  reveal: (height: number) => Promise<void>;
  /** Return the helix to the present. */
  live: () => void;
  /** Call when the feed's mode or latest height changes. */
  refresh: () => void;
  /** Forget everything (entering or leaving a planet). */
  reset: () => void;
}

const WINDOW = 12;        // blocks per history window: one request each, so keep it small for public nodes
const AHEAD = 5;          // blocks shown after the centre one
const PARALLEL = 4;
const STEPS = 1000;       // slider resolution
const MAX_AGO = 1e6;      // the far end of the scrubber, in blocks before the head

// The scrubber is logarithmic in "blocks ago": fine control near the present, big jumps further back.
const agoOf = (v: number) => Math.round(10 ** (((STEPS - v) / STEPS) * Math.log10(MAX_AGO + 1))) - 1;
const sliderOf = (ago: number) => Math.round(STEPS - (Math.log10(Math.min(MAX_AGO, Math.max(0, ago)) + 1) / Math.log10(MAX_AGO + 1)) * STEPS);

function duration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 129600) return `${(seconds / 3600).toFixed(1)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

export function initTimeline({ feed, interior, lookAtHelix }: TimelineDeps): Timeline {
  const bar = $('#timeline');
  const range = $<HTMLInputElement>('#tl-range');
  const label = $('#tl-label');
  const liveBtn = $<HTMLButtonElement>('#tl-live');
  const older = $<HTMLButtonElement>('#tl-older');
  const newer = $<HTMLButtonElement>('#tl-newer');

  let centre: number | null = null; // the height the history window is built around; null = live
  let seq = 0;                      // bumps on every request so late windows are dropped
  let dragging = false;

  function paintLive(): void {
    const f = feed();
    bar.classList.remove('history', 'loading');
    liveBtn.hidden = true;
    newer.disabled = true;
    if (!dragging) range.value = String(STEPS);
    label.textContent = f?.height ? `Live · #${fmt(f.height)}` : 'Live';
  }

  function paintWindow(blocks: Block[]): void {
    const lo = blocks[0], hi = blocks[blocks.length - 1];
    const when = new Date(hi.time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    // "#33,818,702–713": only the digits that differ are repeated
    const a = fmt(lo.height), z = fmt(hi.height);
    let same = 0;
    while (same < a.length && a.length === z.length && a[same] === z[same]) same++;
    const span = lo === hi ? `#${a}` : `#${a}–${z.slice(Math.min(same, z.length - 2))}`;
    bar.classList.remove('loading');
    bar.classList.add('history');
    liveBtn.hidden = false;
    newer.disabled = false;
    label.textContent = `${span} · ${when}`;
    label.title = `Blocks #${a} to #${z}`;
  }

  async function show(target: number, fromUser = false): Promise<void> {
    const f = feed(), inside = interior();
    if (!f || !inside || f.mode !== 'live' || !f.height) return;
    const c = Math.min(f.height, Math.max(1, Math.round(target)));
    const hi = Math.min(f.height, c + AHEAD);
    const lo = Math.max(1, hi - WINDOW + 1);
    const mine = ++seq;
    if (fromUser && !inside.inHistory) lookAtHelix();
    bar.classList.add('loading');
    label.textContent = `Loading #${fmt(c)}…`;
    if (!dragging) range.value = String(sliderOf(f.height - c));

    const heights = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const blocks: Block[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      while (next < heights.length && mine === seq) {
        const h = heights[next++];
        try { blocks.push(await f.fetchBlock(h)); } catch { /* pruned or unreachable: leave a gap */ }
      }
    }));
    if (mine !== seq || feed() !== f || interior() !== inside) return;
    if (!blocks.length) {
      // Nothing came back: stay where we were and say why.
      bar.classList.remove('loading');
      label.textContent = `#${fmt(c)} is not kept by ${f.chain.name}'s public nodes`;
      if (centre == null) range.value = String(STEPS); else range.value = String(sliderOf(f.height - centre));
      return;
    }
    blocks.sort((a, b) => a.height - b.height);
    centre = c;
    inside.showHistory(blocks);
    paintWindow(blocks);
  }

  function live(): void {
    seq++;
    centre = null;
    interior()?.showLive();
    paintLive();
  }

  async function reveal(height: number): Promise<void> {
    const f = feed(), inside = interior();
    if (!f || !inside || inside.findBlock(height)) return;
    if (inside.isRecent(height)) { live(); return; }
    if (height <= f.height) await show(height);
  }

  function refresh(): void {
    const f = feed();
    bar.hidden = !f || f.mode !== 'live'; // a simulated chain has no past to fetch
    if (centre == null && !bar.classList.contains('loading')) paintLive();
  }

  function reset(): void {
    seq++;
    centre = null;
    dragging = false;
    bar.hidden = true;
    paintLive();
  }

  // While dragging, only describe where the scrubber points; load once it is released.
  range.addEventListener('input', () => {
    const f = feed();
    if (!f) return;
    dragging = true;
    const ago = agoOf(Number(range.value));
    label.textContent = ago <= 0 ? `Live · #${fmt(f.height)}`
      : `#${fmt(Math.max(1, f.height - ago))} · about ${duration(ago * f.avgBlockTime)} ago`;
  });
  range.addEventListener('change', () => {
    const f = feed();
    dragging = false;
    if (!f) return;
    const ago = agoOf(Number(range.value));
    if (ago <= 0) live(); else void show(f.height - ago, true);
  });
  older.addEventListener('click', () => {
    const f = feed();
    if (f) void show((centre ?? f.height - AHEAD) - WINDOW, true);
  });
  newer.addEventListener('click', () => {
    const f = feed();
    if (!f || centre == null) return;
    if (centre + WINDOW + AHEAD >= f.height) live(); else void show(centre + WINDOW, true);
  });
  liveBtn.addEventListener('click', live);

  return { reveal, live, refresh, reset };
}
