// Live data feed for one Cosmos chain (public LCD endpoints) with an offline simulation fallback.
// Emits: status, validators, proposals, block, ibc, ibcHistory
// A feed only runs while its planet is being visited: start() on entry, stop() on exit.

export const KINDS = {
  send: { label: 'Send', color: '#7dd3fc' },
  stake: { label: 'Staking', color: '#a78bfa' },
  reward: { label: 'Rewards', color: '#fde68a' },
  wasm: { label: 'Contract', color: '#f0827d' },
  swap: { label: 'Swap', color: '#f9a8d4' },
  gov: { label: 'Gov vote', color: '#86efac' },
  ibc: { label: 'IBC', color: '#5eead4' },
  other: { label: 'Other', color: '#cbd5e1' },
};

export const CHAINS = {
  'juno-1': { name: 'Juno', color: '#f0827d' },
  'osmosis-1': { name: 'Osmosis', color: '#b565f5' },
  'cosmoshub-4': { name: 'Cosmos Hub', color: '#6f7bf7' },
  'stargaze-1': { name: 'Stargaze', color: '#f472b6' },
  'noble-1': { name: 'Noble', color: '#60a5fa' },
  'neutron-1': { name: 'Neutron', color: '#6cc4f5' },
  'akashnet-2': { name: 'Akash', color: '#ff4f5a' },
  'secret-4': { name: 'Secret', color: '#94a3b8' },
  'axelar-dojo-1': { name: 'Axelar', color: '#38bdf8' },
  'kaiyo-1': { name: 'Kujira', color: '#fb7185' },
  'phoenix-1': { name: 'Terra', color: '#facc15' },
  'stride-1': { name: 'Stride', color: '#e11d74' },
  'injective-1': { name: 'Injective', color: '#22d3ee' },
  'celestia': { name: 'Celestia', color: '#c084fc' },
  'dydx-mainnet-1': { name: 'dYdX', color: '#818cf8' },
};

export function chainInfo(chainId) {
  return CHAINS[chainId] || { name: chainId, color: '#9ca3af' };
}

export function classify(type = '') {
  if (type.startsWith('/ibc.')) return 'ibc';
  if (type.includes('.bank.')) return 'send';
  if (type.includes('.staking.')) return 'stake';
  if (type.includes('.distribution.')) return 'reward';
  if (type.includes('cosmwasm')) return 'wasm';
  if (/poolmanager|\.gamm\.|concentratedliquidity|\.dex\./.test(type)) return 'swap';
  if (type.includes('.gov.')) return 'gov';
  return 'other';
}

const shortType = (t = '') => t.split('.').pop().replace(/^Msg/, '');
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

function formatToken(amount, denom = '') {
  const n = Number(amount);
  if (!denom) return '';
  if (/^u[a-z]+$/.test(denom)) {
    return `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${denom.slice(1).toUpperCase()}`;
  }
  const base = denom.split('/').pop();
  if (/^u[a-z]+$/.test(base)) {
    return `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${base.slice(1).toUpperCase()}`;
  }
  return denom.startsWith('ibc/') ? 'IBC asset' : base.slice(0, 14);
}

export class ChainFeed {
  constructor(chain, { forceSim = false } = {}) {
    this.chain = chain;
    this.endpoints = chain.endpoints;
    this.listeners = {};
    this.timers = new Set();
    this.stopped = false;
    this.forceSim = forceSim;
    this.mode = 'connecting'; // live | sim
    this.ep = 0;
    this.height = 0;
    this.validators = [];
    this.byConsAddr = new Map();
    this.proposals = [];
    this.blockTimes = [];
    this.avgBlockTime = chain.simBlockTime;
    this.lastBlockTime = 0;
    this.channelCache = new Map();
    this.fails = 0;
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); return this; }
  emit(evt, data) { if (!this.stopped) (this.listeners[evt] || []).forEach((fn) => fn(data)); }

  // Timers are tracked so stop() can silence the feed when the visitor leaves the planet.
  after(ms, fn) {
    const id = setTimeout(() => { this.timers.delete(id); if (!this.stopped) fn(); }, ms);
    this.timers.add(id);
  }
  every(ms, fn) { this.timers.add(setInterval(() => { if (!this.stopped) fn(); }, ms)); }
  stop() {
    this.stopped = true;
    // clearTimeout and clearInterval share one id pool, so either clears both kinds.
    this.timers.forEach((id) => clearTimeout(id));
    this.timers.clear();
    this.listeners = {};
  }

  async get(path) {
    let lastErr;
    for (let i = 0; i < this.endpoints.length; i++) {
      const idx = (this.ep + i) % this.endpoints.length;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 9000);
        const res = await fetch(this.endpoints[idx] + path, { signal: ctl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        this.ep = idx;
        return json;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  async start() {
    if (!this.forceSim) {
      try {
        await this.loadValidators();
        if (this.stopped) return;
        this.mode = 'live';
        this.emit('status', { mode: 'live' });
        this.loadProposals().catch(() => {});
        this.loadIbcHistory().catch(() => {});
        this.every(5 * 60e3, () => this.loadValidators().catch(() => {}));
        this.every(60e3, () => this.loadProposals().catch(() => {}));
        this.pollLoop();
        return;
      } catch (e) {
        if (this.stopped) return;
        console.warn(`${this.chain.name} endpoints unreachable, falling back to simulation`, e);
      }
    }
    this.mode = 'sim';
    this.emit('status', { mode: 'sim' });
    this.startSimulation();
  }

  // ---------- live ----------
  async loadValidators() {
    const d = await this.get('/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=300');
    const list = d.validators.map((v) => ({
      operator: v.operator_address,
      moniker: v.description?.moniker || 'unknown',
      website: v.description?.website || '',
      details: v.description?.details || '',
      tokens: Number(v.tokens) / 1e6,
      commission: Number(v.commission?.commission_rates?.rate || 0),
      pubkey: v.consensus_pubkey?.key,
    })).sort((a, b) => b.tokens - a.tokens);
    const total = list.reduce((s, v) => s + v.tokens, 0);
    this.byConsAddr = new Map();
    await Promise.all(list.map(async (v, i) => {
      v.index = i;
      v.power = v.tokens / total;
      try {
        if (v.pubkey) {
          v.consAddr = toB64((await sha256(b64(v.pubkey))).slice(0, 20));
          this.byConsAddr.set(v.consAddr, v);
        }
      } catch { /* crypto.subtle unavailable (non-secure context) */ }
    }));
    this.validators = list;
    this.bonded = total;
    this.emit('validators', list);
  }

  async loadProposals() {
    const d = await this.get('/cosmos/gov/v1/proposals?pagination.reverse=true&pagination.limit=8');
    const list = await Promise.all(d.proposals.map(async (p) => {
      let t = p.final_tally_result || {};
      const status = p.status.replace('PROPOSAL_STATUS_', '');
      if (status === 'VOTING_PERIOD') {
        try { t = (await this.get(`/cosmos/gov/v1/proposals/${p.id}/tally`)).tally; } catch { /* keep */ }
      }
      return {
        id: p.id,
        title: p.title || `Proposal #${p.id}`,
        summary: p.summary || '',
        status,
        votingEnd: p.voting_end_time,
        expedited: !!p.expedited,
        tally: {
          yes: Number(t.yes_count || 0) / 1e6,
          no: Number(t.no_count || 0) / 1e6,
          abstain: Number(t.abstain_count || 0) / 1e6,
          veto: Number(t.no_with_veto_count || 0) / 1e6,
        },
      };
    }));
    this.proposals = list;
    this.emit('proposals', list);
  }

  async resolveChannel(channel) {
    if (!this.channelCache.has(channel)) {
      this.channelCache.set(channel, (async () => {
        try {
          const d = await this.get(`/ibc/core/channel/v1/channels/${channel}/ports/transfer/client_state`);
          return d.identified_client_state.client_state.chain_id;
        } catch { return null; }
      })());
    }
    return this.channelCache.get(channel);
  }

  async ibcFromMsg(m) {
    const type = m['@type'] || '';
    let out = null;
    if (type.endsWith('MsgTransfer')) {
      out = { dir: 'out', channel: m.source_channel, amount: formatToken(m.token?.amount, m.token?.denom) };
    } else if (type.endsWith('MsgRecvPacket') && m.packet?.destination_port === 'transfer') {
      let amount = '';
      try {
        const data = JSON.parse(atob(m.packet.data));
        amount = formatToken(data.amount, data.denom);
      } catch { /* non-JSON packet */ }
      out = { dir: 'in', channel: m.packet.destination_channel, amount };
    }
    if (!out || !out.channel) return null;
    const chainId = await this.resolveChannel(out.channel);
    out.chainId = chainId || out.channel;
    out.chainName = chainId ? chainInfo(chainId).name : out.channel;
    out.color = chainInfo(chainId).color;
    return out;
  }

  async loadIbcHistory() {
    const q = encodeURIComponent("message.action='/ibc.applications.transfer.v1.MsgTransfer'");
    const d = await this.get(`/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&pagination.limit=15`);
    const rows = (d.tx_responses || []).map((r, i) => ({ r, tx: d.txs[i] }))
      .sort((a, b) => Number(b.r.height) - Number(a.r.height)).slice(0, 12);
    const items = [];
    for (const { r, tx } of rows) {
      for (const m of tx.body.messages) {
        const ibc = await this.ibcFromMsg(m);
        if (ibc) items.push({ ...ibc, height: Number(r.height), hash: r.txhash, time: r.timestamp });
      }
    }
    this.ibcHistory = items;
    this.emit('ibcHistory', items);
  }

  async pollLoop() {
    if (this.stopped) return;
    try {
      const latest = await this.get('/cosmos/base/tendermint/v1beta1/blocks/latest');
      const h = Number(latest.block.header.height);
      if (h > this.height) {
        const from = this.height ? Math.max(this.height + 1, h - 2) : h;
        for (let n = from; n <= h; n++) {
          let data = null;
          if (n === h && !(latest.block.data?.txs || []).length) data = { block: latest.block, txs: [] };
          else {
            try { data = await this.get(`/cosmos/tx/v1beta1/txs/block/${n}`); } catch {
              if (n === h) data = { block: latest.block, txs: [], undecoded: true };
            }
          }
          if (this.stopped) return;
          if (data) await this.handleBlock(data);
        }
        this.height = h;
      }
      if (this.fails) this.emit('status', { mode: 'live' });
      this.fails = 0;
    } catch (e) {
      if (++this.fails === 3) this.emit('status', { mode: 'live', reconnecting: true });
    }
    this.after(1300, () => this.pollLoop());
  }

  async handleBlock({ block, txs, undecoded }) {
    const header = block.header;
    const all = block.data?.txs || [];
    // Some chains inject non-transaction payloads at the top of each block (e.g. Neutron's oracle
    // vote extensions). The LCD decoder drops them, so skip them to keep raw bytes and decoded txs aligned.
    // (A full page of 100 means the gap is pagination, not injected data.)
    const skip = !undecoded && txs.length < 100 ? Math.max(0, all.length - txs.length) : 0;
    const raw = all.slice(skip);
    const outTxs = [];
    const ibcs = [];
    for (let i = 0; i < raw.length; i++) {
      const tx = txs[i];
      let hash = '';
      try { hash = toHex(await sha256(b64(raw[i]))); } catch { /* ignore */ }
      const msgs = tx?.body?.messages || [];
      const types = msgs.map((m) => m['@type']);
      // IBC wins the tx colour if any message is a transfer; otherwise first message decides.
      const kind = types.some((t) => classify(t) === 'ibc') ? 'ibc' : classify(types[0]);
      outTxs.push({ hash, kind, label: types.length ? shortType(types[0]) + (types.length > 1 ? ` +${types.length - 1}` : '') : 'Tx' });
      for (const m of msgs) {
        const ibc = await this.ibcFromMsg(m).catch(() => null);
        if (ibc) ibcs.push({ ...ibc, hash, height: Number(header.height) });
      }
    }
    const signers = new Set();
    let absent = 0;
    for (const s of block.last_commit?.signatures || []) {
      const v = this.byConsAddr.get(s.validator_address);
      if (s.block_id_flag === 'BLOCK_ID_FLAG_COMMIT' && v) signers.add(v.index);
      else if (s.block_id_flag === 'BLOCK_ID_FLAG_ABSENT') absent++;
    }
    const time = Date.parse(header.time);
    this.trackTime(time);
    this.emit('block', {
      height: Number(header.height),
      time,
      proposer: this.byConsAddr.get(header.proposer_address) || null,
      signers,
      absent,
      txs: outTxs,
      undecoded: !!undecoded,
    });
    ibcs.forEach((i) => this.emit('ibc', i));
  }

  trackTime(time) {
    if (this.lastBlockTime && time > this.lastBlockTime) {
      this.blockTimes.push((time - this.lastBlockTime) / 1000);
      if (this.blockTimes.length > 12) this.blockTimes.shift();
      this.avgBlockTime = this.blockTimes.reduce((a, b) => a + b, 0) / this.blockTimes.length;
    }
    this.lastBlockTime = time;
  }

  // ---------- simulation ----------
  startSimulation() {
    const { name, symbol, prefix, chainId, simHeight, simBlockTime } = this.chain;
    const names = ['Nebula Nodes', 'Coral Stake', 'Deep Field', 'Lunar Labs', 'Orbit One', 'Quasar', 'Helios', 'Pulsar Ops',
      'Andromeda', 'StakeWave', 'Kepler', 'Voyager', 'Zenith', 'Photon', 'Aurora', 'Meridian', 'Halo', 'Apogee', 'Sol Guard',
      'Ion Works', 'Parallax', 'Umbra', 'Tidal', 'Perigee', 'Vega'];
    const list = names.map((moniker, i) => ({
      operator: `${prefix}valoper1sim${i}`, moniker, website: '', details: 'Simulated validator',
      tokens: 2.4e6 * Math.pow(0.9, i) + 2e5, commission: 0.05, index: i,
    }));
    const total = list.reduce((s, v) => s + v.tokens, 0);
    list.forEach((v) => { v.power = v.tokens / total; });
    this.validators = list;
    this.bonded = total;
    this.emit('validators', list);

    const mk = (id, title, status, yes, no, abstain, veto, days) => ({
      id: String(id), title, summary: 'Simulated proposal — live chain data is unavailable.', status,
      votingEnd: new Date(Date.now() + days * 864e5).toISOString(), expedited: false,
      tally: { yes, no, abstain, veto },
    });
    this.proposals = [
      mk(104, `Upgrade ${name} to "Callisto"`, 'VOTING_PERIOD', 9.1e6, 1.2e6, 6e5, 1e5, 3),
      mk(103, `Fund the ${name} tooling guild`, 'VOTING_PERIOD', 4.2e6, 3.9e6, 9e5, 4e5, 1),
      mk(102, 'Lower minimum gas price', 'PASSED', 1.5e7, 2e6, 1e6, 0, -4),
      mk(101, 'Recover expired IBC client', 'PASSED', 1.8e7, 0, 7e5, 0, -9),
      mk(100, 'Increase validator set to 150', 'REJECTED', 5e6, 1.1e7, 2e6, 9e5, -15),
      mk(99, 'Community pool spend: hackathon', 'PASSED', 1.2e7, 3e6, 1e6, 2e5, -22),
    ];
    this.emit('proposals', this.proposals);

    let h = simHeight + Math.floor(Math.random() * 1e5);
    const kinds = ['send', 'send', 'wasm', 'wasm', 'wasm', 'reward', 'reward', 'stake', 'gov', 'other'];
    const labels = { send: 'Send', wasm: 'ExecuteContract', reward: 'WithdrawDelegatorReward', stake: 'Delegate', gov: 'Vote', other: 'Exec', ibc: 'Transfer' };
    const dests = ['juno-1', 'osmosis-1', 'cosmoshub-4', 'neutron-1', 'akashnet-2', 'noble-1', 'stargaze-1'].filter((id) => id !== chainId);
    const rndHash = () => [...Array(64)].map(() => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
    const tick = () => {
      h++;
      const n = Math.random() < 0.15 ? 0 : Math.floor(Math.random() * Math.random() * 14) + 1;
      const txs = [];
      const ibcs = [];
      for (let i = 0; i < n; i++) {
        const isIbc = Math.random() < 0.12;
        const kind = isIbc ? 'ibc' : kinds[Math.floor(Math.random() * kinds.length)];
        const hash = rndHash();
        txs.push({ hash, kind, label: labels[kind] });
        if (isIbc) {
          const chainId = dests[Math.floor(Math.random() * dests.length)];
          ibcs.push({
            dir: Math.random() < 0.7 ? 'out' : 'in', channel: 'channel-sim', chainId, chainName: chainInfo(chainId).name,
            color: chainInfo(chainId).color, amount: `${(Math.random() * 500).toFixed(1)} ${symbol}`, hash, height: h,
          });
        }
      }
      const signers = new Set(list.filter(() => Math.random() > 0.03).map((v) => v.index));
      // Weighted proposer pick, like Tendermint's power-proportional rotation.
      let r = Math.random(), proposer = list[0];
      for (const v of list) { r -= v.power; if (r <= 0) { proposer = v; break; } }
      const time = Date.now();
      this.trackTime(time);
      this.height = h;
      this.emit('block', { height: h, time, proposer, signers, absent: list.length - signers.size, txs });
      ibcs.forEach((i) => this.emit('ibc', i));
      this.after(simBlockTime * 1000 * (0.85 + Math.random() * 0.3), tick);
    };
    this.after(800, tick);
  }
}
