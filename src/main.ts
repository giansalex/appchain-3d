import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './style.css';
import { ChainFeed, KINDS } from './data';
import { PLANETS, planetByKey } from './chains';
import { Space } from './space';
import { Interior, VIEWS, statusStyle, type ViewName } from './interior';
import { ease, stepTweens, tween, type Easing, type Tween } from './util';
import type { Block, IbcTransfer, Kind, PickData, Planet, Proposal, Validator } from './types';

type Vec3 = [number, number, number];
type Child = Node | string | null | undefined | false;

const $ = <T extends HTMLElement = HTMLElement>(s: string): T => {
  const e = document.querySelector<T>(s);
  if (!e) throw new Error(`missing element ${s}`);
  return e;
};
const HOME_ACCENT = '#8b93ff';
const HOME_POS: Vec3 = [0, 36, 110];
const fmt = (n: number, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

// Chain data (monikers, proposal text…) is untrusted: always build DOM with text nodes.
function el(tag: string, props: Record<string, string> = {}, ...kids: (Child | Child[])[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') e.style.cssText = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v);
  }
  kids.flat().forEach((k) => { if (k != null && k !== false) e.append(k); });
  return e;
}
const link = (href: string, text: string) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
const safeUrl = (u: string): string | null => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

// ---------- renderer ----------
const canvas = $<HTMLCanvasElement>('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
camera.position.set(...HOME_POS);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
controls.autoRotateSpeed = 0.35;

const space = new Space(PLANETS);
let interior: Interior | null = null; // built on entering a planet, disposed on leaving
let current: Planet | null = null;    // the chain being visited, null at home
let feed: ChainFeed | null = null;
let active: Space | Interior = space;
let mode: 'space' | 'inside' | 'transition' = 'space';

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(space.scene, camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.5, 0.55);
composer.addPass(renderPass);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  // Keep the whole scene in frame on tall/narrow screens.
  camera.fov = w / h < 0.8 ? 72 : 55;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function setLimits() {
  if (active === space) { controls.minDistance = 30; controls.maxDistance = 260; }
  else { controls.minDistance = 10; controls.maxDistance = 340; }
}
setLimits();

// ---------- camera travel ----------
let flight: Tween | null = null;
function flyTo(pos: Vec3, target: Vec3, dur = 1.8, easing: Easing = ease.inOut, done?: () => void): void {
  if (flight) flight.dead = true;
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const p1 = new THREE.Vector3(...pos), t1 = new THREE.Vector3(...target);
  flight = tween({
    dur, easing,
    update: (k) => { camera.position.lerpVectors(p0, p1, k); controls.target.lerpVectors(t0, t1, k); },
    done: () => { flight = null; done?.(); },
  });
}

const veil = $('#veil');
function setAccent(hex: string): void {
  const n = parseInt(hex.slice(1), 16);
  document.documentElement.style.setProperty('--coral', hex);
  document.documentElement.style.setProperty('--rgb', `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`);
}

function enterPlanet(chain: Planet | null): void {
  const body = chain && space.planet(chain.key);
  if (mode !== 'space' || !chain || !body) return;
  mode = 'transition';
  controls.enabled = false;
  $('#intro').classList.add('gone');
  tooltip.hidden = true;
  space.setHover(null);
  closeDetail();
  current = chain;
  const inside = interior = new Interior(chain);
  resetHud(chain);
  stopHomeFeeds();
  startFeed(chain);
  const { pos, r } = body;
  const dir = camera.position.clone().sub(pos).normalize();
  flyTo(pos.clone().addScaledVector(dir, r * 1.12).toArray(), pos.toArray(), 1.9, ease.in, () => {
    active = inside;
    space.clearShips();
    renderPass.scene = inside.scene;
    document.body.className = 'mode-inside';
    setLimits();
    camera.position.set(0, 250, 300);
    controls.target.set(0, 16, 0);
    tween({ dur: 1.4, update: (k) => { veil.style.opacity = String(1 - k); } });
    goView('overview', 2.6, ease.out);
    setTimeout(() => { mode = 'inside'; controls.enabled = true; }, 900);
  });
  tween({ dur: 0.9, delay: 1.0, easing: ease.in, update: (k) => { veil.style.opacity = String(k); } });
}

function leavePlanet(): void {
  if (mode !== 'inside' || !current) return;
  const { pos, r } = space.planet(current.key)!;
  mode = 'transition';
  stopTour();
  controls.enabled = false;
  closeDetail();
  flyTo([0, 300, 120], [0, 60, 0], 1.3, ease.in);
  tween({
    dur: 0.9, delay: 0.4, easing: ease.in, update: (k) => { veil.style.opacity = String(k); },
    done: () => {
      feed?.stop();
      feed = null;
      active = space;
      renderPass.scene = space.scene;
      startHomeFeeds();
      interior?.dispose();
      interior = null;
      current = null;
      lastBlock = null;
      document.body.className = 'mode-space';
      resetHud(null);
      setLimits();
      if (flight) flight.dead = true;
      // Emerge from the planet we were in, then drift back to the home view.
      const out = new THREE.Vector3(...HOME_POS).sub(pos).normalize();
      camera.position.copy(pos).addScaledVector(out, r * 1.4);
      controls.target.copy(pos);
      tween({ dur: 1.2, update: (k) => { veil.style.opacity = String(1 - k); } });
      flyTo(HOME_POS, [0, 0, 0], 2.4, ease.out, () => { mode = 'space'; controls.enabled = true; });
    },
  });
}

// ---------- districts ----------
const districtInfo = ({ name, symbol, poa, gov }: Planet): Record<ViewName, [string, string]> => ({
  overview: [`Inside ${name}`, 'You are inside the planet. The core at the centre runs consensus; validators ring it as towers; committed blocks spiral upward; proposals float in the Governance Hall and IBC ships launch from the Spaceport.'],
  core: ['Consensus Core', `${name} uses CometBFT. Each height a proposer broadcasts a block, validators prevote, then precommit. When more than ⅔ of voting power precommits, the block is final — the core fires and a new block is born. No forks, instant finality.`],
  validators: ['Validator Ring', `${poa ? `${name} is a proof-of-authority chain: a small permissioned set of validators with equal voting power, and no staking token.` : `Each tower is a bonded validator; height reflects voting power (staked ${symbol}).`} A golden beam marks the proposer of the block. Sparks flying to the core are commit signatures; a tower that glows red missed the last commit.`],
  blocks: ['Block Helix', 'Every committed block joins the helix, newest at the bottom. Bigger, brighter cubes carry more transactions. Coloured sparks streaming into the core are the block\'s transactions leaving the mempool.'],
  gov: ['Governance Hall', gov === false
    ? `${name} has no on-chain governance module, so this hall is empty. Upgrades and parameters are decided by its authority rather than by token-holder votes.`
    : `${symbol} stakers govern the chain. Each hologram is an on-chain proposal with its live tally. Pulsing frames are open for voting right now.`],
  ibc: ['IBC Spaceport', `The Inter-Blockchain Communication protocol links ${name} with the rest of the Cosmos. Each ship is a token transfer: outbound ships climb through the gate rings and leave the planet; inbound ships land on the pad.`],
});

function goView(name: ViewName, dur = 1.8, easing: Easing = ease.inOut): void {
  const v = VIEWS[name];
  flyTo(v.pos, v.target, dur, easing);
  document.querySelectorAll<HTMLElement>('#districts button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'ibc') showPort(); else showInfo(name);
}

let tourTimer: number | null = null;
function stopTour(): void {
  if (!tourTimer) return;
  clearInterval(tourTimer); tourTimer = null;
  $('#tour').textContent = '▶ Guided tour';
}
function startTour(): void {
  const order: ViewName[] = ['core', 'validators', 'blocks', 'gov', 'ibc', 'overview'];
  let i = 0;
  goView(order[0], 2.6);
  $('#tour').textContent = '■ Stop tour';
  tourTimer = window.setInterval(() => {
    i++;
    if (i >= order.length) { stopTour(); return; }
    goView(order[i], 2.6);
  }, 9000);
}

// ---------- detail panel ----------
const detail = $('#detail'), detailBody = $('#detail-body');
function openDetail(...nodes: (Child | Child[])[]): void {
  detailBody.replaceChildren(...nodes.flat().filter((n): n is Node | string => n != null && n !== false));
  detail.hidden = false; detail.scrollTop = 0;
}
function closeDetail(): void { detail.hidden = true; }
type Row = [string, Node | string] | null | undefined | false | '';
const dl = (rows: Row[]) => el('dl', {}, rows.filter((r): r is [string, Node | string] => !!r)
  .flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));

function showInfo(name: ViewName): void {
  if (!current) return;
  const [title, text] = districtInfo(current)[name];
  openDetail(el('span', { class: 'tag' }, 'District'), el('h2', {}, title), el('p', {}, text));
}

function showValidator(v: Validator): void {
  if (!current || !feed) return;
  const site = safeUrl(v.website);
  openDetail(
    el('span', { class: 'tag' }, `Validator · rank #${v.index + 1}`),
    el('h2', {}, v.moniker),
    v.details ? el('p', {}, v.details.slice(0, 220)) : null,
    dl([
      ['Voting power', `${(v.power * 100).toFixed(2)}%`],
      !current.poa && ['Staked', `${fmt(v.tokens)} ${current.symbol}`],
      ['Commission', `${(v.commission * 100).toFixed(1)}%`],
      site && ['Website', link(site, new URL(site).hostname)],
    ]),
    feed.mode === 'live' ? link(`${current.explorer}/staking/${v.operator}`, 'Open in explorer ↗') : null,
  );
}

function showBlock(b: Block): void {
  if (!current || !feed) return;
  const counts: Partial<Record<Kind, number>> = {};
  b.txs.forEach((t) => { counts[t.kind] = (counts[t.kind] || 0) + 1; });
  openDetail(
    el('span', { class: 'tag' }, 'Block'),
    el('h2', {}, `#${fmt(b.height)}`),
    dl([
      ['Time', new Date(b.time).toLocaleTimeString()],
      ['Proposer', b.proposer?.moniker || 'unknown'],
      ['Transactions', String(b.txs.length)],
      ['Commit signatures', `${b.signers.size}/${feed.validators.length}`],
    ]),
    el('ul', {}, (Object.entries(counts) as [Kind, number][]).map(([k, n]) => el('li', {},
      el('span', {}, el('span', { class: 'dot', style: `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;background:${KINDS[k].color}` }), KINDS[k].label),
      el('span', {}, `× ${n}`)))),
    feed.mode === 'live' ? link(`${current.explorer}/block/${b.height}`, 'Open in explorer ↗') : null,
  );
}

function showProposal(p: Proposal): void {
  if (!current || !feed) return;
  const st = statusStyle(p.status);
  const { yes, no, abstain, veto } = p.tally;
  const total = yes + no + abstain + veto;
  const pct = (v: number) => (total ? `${((v / total) * 100).toFixed(1)}%` : '—');
  const parts: [number, string][] = [[yes, '#4ade80'], [no, '#f87171'], [veto, '#b91c1c'], [abstain, '#94a3b8']];
  const end = p.votingEnd ? new Date(p.votingEnd) : null;
  openDetail(
    el('span', { class: 'tag', style: `color:${st.color}` }, `Proposal #${p.id} · ${st.label}`),
    el('h2', {}, p.title),
    el('div', { class: 'bar' }, parts.map(([v, c]) => el('i', { style: `width:${total ? (v / total) * 100 : 0}%;background:${c}` }))),
    dl([
      ['Yes', pct(yes)], ['No', pct(no)], ['No with veto', pct(veto)], ['Abstain', pct(abstain)],
      ['Votes cast', `${compact(total)} ${current.symbol}`],
      end && [p.status === 'VOTING_PERIOD' ? 'Voting ends' : 'Voting ended', end.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })],
    ]),
    el('p', {}, p.summary.length > 420 ? p.summary.slice(0, 420) + '…' : p.summary),
    feed.mode === 'live' ? link(`${current.explorer}/gov/${p.id}`, 'Read & vote in explorer ↗') : null,
  );
}

function showPort(): void {
  if (!current || !feed) return;
  const [title, text] = districtInfo(current).ibc;
  const hist = feed.ibcHistory;
  openDetail(
    el('span', { class: 'tag', style: 'color:#5eead4' }, 'District'),
    el('h2', {}, title),
    el('p', {}, text),
    hist.length ? el('p', {}, el('strong', {}, 'Recent departures'), ' — replayed as ships labelled “replay” while the port is quiet.') : null,
    el('ul', {}, hist.slice(0, 8).map((i) => el('li', {},
      el('span', {}, `→ ${i.chainName}${i.amount ? ' · ' + i.amount : ''}`),
      el('span', {}, i.height ? `#${fmt(i.height)}` : '')))),
  );
}

// ---------- picking ----------
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const tooltip = $('#tooltip');
let down: [number, number] | null = null;
function pick(e: PointerEvent): PickData | null {
  const r = canvas.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  return (ray.intersectObjects(active.pickables, false)[0]?.object.userData as PickData | undefined) ?? null;
}
function tipFor(u: PickData): [string, string] | null {
  switch (u.type) {
    case 'planet': return [u.chain.name, `${u.chain.chainId} · click to enter`];
    case 'validator': return [u.v.moniker, `${(u.v.power * 100).toFixed(2)}% voting power`];
    case 'block': return [`Block #${fmt(u.b.height)}`, `${u.b.txs.length} txs`];
    case 'proposal': return [`#${u.p.id} ${u.p.title.slice(0, 40)}`, statusStyle(u.p.status).label.toLowerCase()];
    case 'core': return ['Consensus core', 'CometBFT'];
    case 'port': return ['IBC Spaceport', 'recent transfers'];
    default: return null;
  }
}
canvas.addEventListener('pointermove', (e) => {
  if (mode === 'transition' || e.buttons) { tooltip.hidden = true; return; }
  const u = pick(e);
  const tip = u && tipFor(u);
  if (active === space) space.setHover(u?.type === 'planet' ? u.chain.key : null);
  canvas.style.cursor = tip ? 'pointer' : 'grab';
  tooltip.hidden = !tip;
  if (tip) {
    tooltip.replaceChildren(tip[0], ' ', el('small', {}, `· ${tip[1]}`));
    tooltip.style.left = `${Math.min(e.clientX, window.innerWidth - 240)}px`;
    tooltip.style.top = `${e.clientY}px`;
  }
});
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; stopTour(); });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6 || mode === 'transition') return;
  const u = pick(e);
  if (!u) return;
  if (u.type === 'planet') enterPlanet(u.chain);
  else if (u.type === 'validator') showValidator(u.v);
  else if (u.type === 'block') showBlock(u.b);
  else if (u.type === 'proposal') showProposal(u.p);
  else if (u.type === 'core') showInfo('core');
  else if (u.type === 'port') showPort();
});

// ---------- UI wiring ----------
const planetNav = $('#planets');
PLANETS.forEach((c, i) => {
  const b = el('button', { style: `--c:${c.color}`, title: `${c.chainId} — key ${i + 1}` }, el('i'), c.name);
  b.addEventListener('click', () => enterPlanet(c));
  b.addEventListener('pointerenter', () => { if (mode === 'space') space.setHover(c.key); });
  b.addEventListener('pointerleave', () => space.setHover(null));
  planetNav.append(b);
});
$('#s-chains').textContent = String(PLANETS.length);
$('#intro-status').textContent = `${PLANETS.length} chains: ${PLANETS.map((c) => c.name).join(' · ')}`;
$('#leave').addEventListener('click', leavePlanet);
$('#detail-close').addEventListener('click', closeDetail);
$('#tour').addEventListener('click', () => (tourTimer ? stopTour() : startTour()));
$('#districts').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.view as ViewName | undefined;
  if (v && mode === 'inside') { stopTour(); goView(v); }
});
$('#intro-go').addEventListener('click', () => $('#intro').classList.add('gone'));
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (mode === 'space' && PLANETS[Number(e.key) - 1]) enterPlanet(PLANETS[Number(e.key) - 1]);
  else if (e.key === 'Escape') { if (!detail.hidden) closeDetail(); else leavePlanet(); }
  else if (mode === 'inside' && /^[1-6]$/.test(e.key)) { stopTour(); goView((Object.keys(VIEWS) as ViewName[])[Number(e.key) - 1]); }
});

function setStat(id: string, text: string, bump = false): void {
  const b = $(id);
  if (b.textContent === text) return;
  b.textContent = text;
  const box = b.parentElement;
  if (bump && box) { box.classList.remove('bump'); void b.offsetWidth; box.classList.add('bump'); }
}

const feedList = $('#feed-list');
function pushFeed(node: HTMLElement): void {
  feedList.prepend(node);
  while (feedList.children.length > 60) feedList.lastElementChild?.remove();
}

// ---------- data ----------
// Entering a planet starts that chain's full feed; leaving stops it.
// At home only IBC transfers are watched, and only on the two busiest routes' ends.
const params = new URLSearchParams(location.search);
const HOME_IBC = ['cosmoshub', 'osmosis'];
const planetByChainId = new Map(PLANETS.map((p) => [p.chainId, p]));
let homeFeeds: ChainFeed[] = [], lastHomeIbcAt = 0, homeReplayIdx = 0;

function homeTransfer(chain: Planet, ibc: IbcTransfer, replay = false): void {
  const other = planetByChainId.get(ibc.chainId);
  if (!other || mode === 'inside' || document.hidden) return;
  // A transfer between two watched chains is seen twice (sent here, received there): draw the send only.
  if (ibc.dir === 'in' && HOME_IBC.includes(other.key)) return;
  const [from, to] = ibc.dir === 'out' ? [chain, other] : [other, chain];
  const label = `${ibc.amount || 'IBC transfer'}${replay ? ' · replay' : ''}`;
  if (space.launchTransfer(from.key, to.key, { label }) && !replay) lastHomeIbcAt = performance.now();
}

function startHomeFeeds(): void {
  stopHomeFeeds();
  lastHomeIbcAt = performance.now();
  homeFeeds = HOME_IBC.map((key) => {
    const chain = planetByKey(key)!;
    const f = new ChainFeed(chain, { forceSim: params.has('sim'), pollMs: 5000 });
    f.on('ibc', (ibc) => homeTransfer(chain, ibc));
    f.startIbcWatch();
    return f;
  });
}

function stopHomeFeeds(): void {
  homeFeeds.forEach((f) => f.stop());
  homeFeeds = [];
}

// When the lanes are quiet, replay real recent transfers (clearly labelled) so there is always traffic to watch.
setInterval(() => {
  if (mode !== 'space' || document.hidden || performance.now() - lastHomeIbcAt < 12000) return;
  const pool = homeFeeds.flatMap((f) => f.ibcHistory
    .filter((i) => planetByChainId.has(i.chainId)).map((i): [Planet, IbcTransfer] => [f.chain, i]));
  if (!pool.length) return;
  const [chain, ibc] = pool[homeReplayIdx++ % pool.length];
  homeTransfer(chain, ibc, true);
}, 7000);
let lastBlock: Block | null = null, lastBlockAt = 0, witnessed = 0, lastIbcAt = 0, replayIdx = 0;

function resetHud(chain: Planet | null): void {
  setAccent(chain ? chain.color : HOME_ACCENT);
  $('#brand-title').textContent = chain ? `PLANET ${chain.name.toUpperCase()}` : 'COSMOS SPACE';
  $('#chain-id').textContent = chain ? chain.chainId : '';
  const badge = $('#net-badge');
  badge.className = 'badge';
  badge.textContent = 'connecting…';
  ['#s-height', '#s-time', '#s-txs', '#s-vals', '#s-bonded', '#s-gov'].forEach((id) => { $(id).textContent = '—'; });
  feedList.replaceChildren();
  $('#witnessed').textContent = '';
  caption.textContent = 'Waiting for the next block…';
  stepEls.forEach((e) => e.classList.remove('on', 'done'));
  lastBlock = null; witnessed = 0; lastIbcAt = 0; replayIdx = 0; shownStep = -2;
}

function startFeed(chain: Planet): void {
  const f = feed = new ChainFeed(chain, { forceSim: params.has('sim') });
  const inside = interior!;

  feed.on('status', ({ mode: m, reconnecting }) => {
    const badge = $('#net-badge');
    badge.className = `badge ${reconnecting ? 'warn' : m}`;
    badge.textContent = reconnecting ? 'reconnecting…' : m === 'live' ? 'LIVE' : 'SIMULATED';
  });

  feed.on('validators', (list) => {
    inside.setValidators(list);
    setStat('#s-vals', String(list.length));
    setStat('#s-bonded', chain.poa ? 'PoA' : `${compact(f.bonded)} ${chain.symbol}`);
  });

  feed.on('proposals', (list) => {
    inside.setProposals(list);
    setStat('#s-gov', chain.gov === false ? 'n/a' : String(list.filter((p) => p.status === 'VOTING_PERIOD').length));
  });

  feed.on('block', (b) => {
    lastBlock = b;
    lastBlockAt = performance.now();
    witnessed++;
    inside.onBlock(b);
    setStat('#s-height', fmt(b.height), true);
    setStat('#s-time', `${f.avgBlockTime.toFixed(2)} s`);
    setStat('#s-txs', String(b.txs.length), true);
    $('#witnessed').textContent = `${witnessed} block${witnessed > 1 ? 's' : ''} witnessed`;

    b.txs.slice(0, 5).reverse().forEach((tx) => {
      const main = el('span', { class: 'main' }, tx.label);
      const short = tx.hash ? `${tx.hash.slice(0, 6)}…${tx.hash.slice(-4)}` : '';
      pushFeed(el('li', {},
        el('span', { class: 'dot', style: `background:${KINDS[tx.kind].color}` }), main,
        el('span', { class: 'meta' }, f.mode === 'live' && tx.hash ? link(`${chain.explorer}/tx/${tx.hash}`, short) : short)));
    });
    if (b.txs.length > 5) pushFeed(el('li', {}, el('span', { class: 'main', style: 'color:var(--muted)' }, `+ ${b.txs.length - 5} more transactions`)));
    pushFeed(el('li', { class: 'block' },
      el('span', { class: 'main' }, `◆ #${fmt(b.height)} · ${b.proposer?.moniker || 'proposer unknown'}`),
      el('span', { class: 'meta' }, `${b.txs.length} tx`)));
  });

  feed.on('ibc', (ibc) => handleIbc(ibc));
  feed.start();
}

function handleIbc(ibc: IbcTransfer, replay = false): void {
  interior?.launchShip(ibc, { replay });
  if (!replay) {
    lastIbcAt = performance.now();
    pushFeed(el('li', { class: 'ibc' },
      el('span', { class: 'dot', style: `background:${ibc.color}` }),
      el('span', { class: 'main' }, `${ibc.dir === 'out' ? '🚀 IBC →' : '🛬 IBC ←'} ${ibc.chainName}`),
      el('span', { class: 'meta' }, ibc.amount || '')));
  }
}

// When the port is quiet, replay real recent transfers (clearly labelled) so there is always traffic to watch.
setInterval(() => {
  const hist = feed?.ibcHistory;
  if (!hist?.length || mode !== 'inside' || document.hidden || performance.now() - lastIbcAt < 20000) return;
  handleIbc(hist[replayIdx++ % hist.length], true);
}, 16000);

// ---------- consensus HUD ----------
// The round is replayed as each block arrives: proposer → votes → commit, in step with the 3D choreography.
const stepEls = [...document.querySelectorAll<HTMLElement>('.steps span')];
const caption = $('#consensus-caption');
let shownStep = -2, shownHeight = 0;
function updateConsensus(): void {
  if (!lastBlock || !interior || !feed) return;
  const vals = feed.validators;
  const s = (performance.now() - lastBlockAt) / 1000;
  const step = s < 0.3 ? 0 : s < 0.65 ? 1 : s < 1.0 ? 2 : s < 1.7 ? 3 : -1;
  if (step === shownStep && shownHeight === lastBlock.height) return;
  shownStep = step; shownHeight = lastBlock.height;
  interior.setStep(step);
  stepEls.forEach((e, i) => { e.classList.toggle('on', i === step); e.classList.toggle('done', step > i); });
  const b = lastBlock, h = `Height ${fmt(b.height)}`;
  const power = [...b.signers].reduce((sum, i) => sum + (vals[i]?.power || 0), 0);
  caption.textContent = [
    `${h} · ${b.proposer?.moniker || 'the proposer'} proposes a block`,
    `${h} · validators prevote on the proposal`,
    `${h} · ${b.signers.size}/${vals.length} validators signed the last commit (${(power * 100).toFixed(1)}% of power)`,
    `${h} committed ✓ · ${b.txs.length} transaction${b.txs.length === 1 ? '' : 's'} finalised`,
  ][step] ?? `Height ${fmt(b.height + 1)} · collecting transactions for the next round…`;
}

// ---------- loop ----------
const clock = new THREE.Clock();
function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  stepTweens(dt);
  updateConsensus();
  active.update(dt, t);
  // Built at the start of the fly-in; keep its effects ticking until it is on screen.
  if (interior && active !== interior) interior.update(dt, t);
  controls.update();
  composer.render();
  requestAnimationFrame(frame);
}

// Wait briefly for the display font so canvas-drawn labels match the HUD.
Promise.race([document.fonts?.load('600 56px "Space Grotesk"') ?? Promise.resolve(), new Promise<void>((r) => { setTimeout(r, 1500); })])
  .finally(() => {
    frame();
    if (!params.has('enter')) startHomeFeeds();
    if (params.has('enter')) setTimeout(() => enterPlanet(planetByKey(params.get('enter')) || PLANETS[0]), 600);
  });

if (params.has('enter')) $('#intro').classList.add('gone');
// Handy from the console.
(window as unknown as { __cosmos: unknown }).__cosmos = { space, camera, controls, goView, enterPlanet, leavePlanet, get feed() { return feed; }, get interior() { return interior; }, get mode() { return mode; } };
