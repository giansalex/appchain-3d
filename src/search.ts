// Search palette: type a block height, tx hash, address, validator name or chain and jump to it.
// Opened with the Search button, "/" or Ctrl/⌘+K.

import { PLANETS } from './chains';
import { findTxChain } from './lookup';
import { normalizeHash, type Route } from './router';
import type { Planet, Validator } from './types';

export interface SearchDeps {
  /** the planet being visited, null at home */
  current: () => Planet | null;
  /** a chain's validators (may hit the network; resolve to [] when unavailable) */
  validators: (chain: Planet) => Promise<Validator[]>;
  go: (route: Route) => void;
}

interface Suggestion {
  title: string;
  sub: string;
  color: string;
  /** Navigate. Return a message to keep the palette open and show it instead (e.g. nothing found). */
  run: () => void | string | Promise<void | string>;
}

const MAX_RESULTS = 9;
const short = (s: string, head = 10, tail = 6) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);
const fmt = (n: number) => n.toLocaleString('en-US');

export function initSearch({ current, validators, go }: SearchDeps): { open: () => void; close: () => void; isOpen: () => boolean } {
  const root = document.querySelector<HTMLElement>('#search')!;
  const input = document.querySelector<HTMLInputElement>('#search-input')!;
  const list = document.querySelector<HTMLElement>('#search-results')!;
  const status = document.querySelector<HTMLElement>('#search-status')!;
  const IDLE = 'Block height · transaction hash · address · validator name · chain';

  let items: Suggestion[] = [];
  let selected = 0;
  let seq = 0; // bumps on every keystroke so late async results are dropped
  let busy = false;

  /** The chains, with the one being visited first. */
  const chains = (): Planet[] => {
    const cur = current();
    return cur ? [cur, ...PLANETS.filter((p) => p !== cur)] : PLANETS;
  };

  /** Everything that can be suggested without the network. */
  function instant(q: string): Suggestion[] {
    const cur = current();
    const out: Suggestion[] = [];
    if (!q) {
      return PLANETS.map((p) => ({ title: p.name, sub: `Planet · ${p.chainId}`, color: p.color, run: () => go({ chain: p.key, entity: null }) }));
    }

    if (/^[1-9]\d{0,15}$/.test(q)) {
      const n = Number(q);
      // The visited chain's block is the likeliest intent, then a proposal there, then the other chains.
      chains().forEach((p, i) => {
        out.push({ title: `Block #${fmt(n)}`, sub: `Block · ${p.name}`, color: p.color, run: () => go({ chain: p.key, entity: { kind: 'block', height: n } }) });
        if (i === 0 && cur && cur.gov !== false && n < 1e6) {
          out.push({ title: `Proposal #${q}`, sub: `Governance · ${cur.name}`, color: cur.color, run: () => go({ chain: cur.key, entity: { kind: 'proposal', id: q } }) });
        }
      });
      return out;
    }

    const hash = normalizeHash(q);
    if (hash) {
      if (cur) out.push({ title: `Transaction ${short(hash, 8, 6)}`, sub: `Transaction · ${cur.name}`, color: cur.color, run: () => go({ chain: cur.key, entity: { kind: 'tx', hash } }) });
      out.push({
        title: `Transaction ${short(hash, 8, 6)}`, sub: `Find it on any of the ${PLANETS.length} chains`, color: '#8b93ff',
        run: async () => {
          const chain = await findTxChain(hash);
          if (!chain) return `No chain here has a transaction with that hash (public nodes only keep recent history).`;
          go({ chain: chain.key, entity: { kind: 'tx', hash } });
        },
      });
      return out;
    }

    const lower = q.toLowerCase();
    // bech32: <prefix>1<data>. Operator addresses first, since "cosmosvaloper1…" also starts with "cosmos".
    const bech = lower.match(/^([a-z]+)1[02-9ac-hj-np-z]{20,}$/);
    if (bech) {
      for (const p of PLANETS) {
        if (bech[1] === `${p.prefix}valoper`) {
          out.push({ title: short(lower, 16, 8), sub: `Validator · ${p.name}`, color: p.color, run: () => go({ chain: p.key, entity: { kind: 'validator', operator: lower } }) });
        } else if (bech[1] === p.prefix) {
          out.push({ title: short(lower, 14, 8), sub: `Account · ${p.name}`, color: p.color, run: () => go({ chain: p.key, entity: { kind: 'account', address: lower } }) });
        }
      }
      return out;
    }

    for (const p of chains()) {
      if ([p.name, p.key, p.chainId, p.symbol].some((s) => s.toLowerCase().includes(lower))) {
        out.push({ title: p.name, sub: `Planet · ${p.chainId}`, color: p.color, run: () => go({ chain: p.key, entity: null }) });
      }
    }
    return out;
  }

  /** Validators whose name matches, across all chains (the visited chain first, then by rank). */
  async function byMoniker(q: string): Promise<Suggestion[]> {
    const lower = q.toLowerCase();
    if (lower.length < 2 || /^\d+$/.test(lower) || normalizeHash(q)) return [];
    const perChain = await Promise.all(chains().map(async (p) => (await validators(p))
      .filter((v) => v.moniker.toLowerCase().includes(lower))
      // names that start with the query beat names that merely contain it
      .sort((a, b) => Number(b.moniker.toLowerCase().startsWith(lower)) - Number(a.moniker.toLowerCase().startsWith(lower)) || a.index - b.index)
      .slice(0, 4)
      .map((v): Suggestion => ({
        title: v.moniker, sub: `Validator · ${p.name} · rank #${v.index + 1}`, color: p.color,
        run: () => go({ chain: p.key, entity: { kind: 'validator', operator: v.operator } }),
      }))));
    return perChain.flat();
  }

  function render(): void {
    list.replaceChildren(...items.map((s, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === selected));
      li.id = `search-opt-${i}`;
      const dot = document.createElement('i');
      dot.style.background = s.color;
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = s.title; // chain data (monikers) is untrusted: text only
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = s.sub;
      li.append(dot, title, sub);
      li.addEventListener('pointerenter', () => { if (selected !== i) { selected = i; mark(); } });
      li.addEventListener('click', () => { selected = i; choose(); });
      return li;
    }));
    mark();
  }

  function mark(): void {
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === selected)));
    if (items.length) input.setAttribute('aria-activedescendant', `search-opt-${selected}`);
    else input.removeAttribute('aria-activedescendant');
    list.children[selected]?.scrollIntoView({ block: 'nearest' });
  }

  function update(): void {
    const q = input.value.trim();
    const mine = ++seq;
    items = instant(q).slice(0, MAX_RESULTS);
    selected = 0;
    status.textContent = q && !items.length ? 'Searching validators…' : IDLE;
    render();
    byMoniker(q).then((more) => {
      if (mine !== seq) return;
      items = [...items, ...more].slice(0, MAX_RESULTS);
      if (q && !items.length) status.textContent = 'Nothing matches. Try a block height, a 64-character tx hash, an address or a validator name.';
      else status.textContent = IDLE;
      render();
    });
  }

  async function choose(): Promise<void> {
    const s = items[selected];
    if (!s || busy) return;
    const mine = seq;
    busy = true;
    status.textContent = 'Searching…';
    let message: string | void;
    try {
      message = await s.run();
    } catch {
      message = 'The lookup failed — the chain’s public nodes may be unreachable. Try again.';
    }
    busy = false;
    if (mine !== seq) return; // the query changed while we were looking
    if (message) status.textContent = message; else close();
  }

  function open(): void {
    root.hidden = false;
    input.value = '';
    update();
    input.focus();
  }
  function close(): void {
    if (root.hidden) return;
    seq++;
    root.hidden = true;
    input.blur();
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) { selected = (selected + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; mark(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // do not also close the detail panel or leave the planet
      close();
    }
  });
  // click on the backdrop (outside the card) closes
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  document.querySelector('#search-open')!.addEventListener('click', open);

  return { open, close, isOpen: () => !root.hidden };
}
