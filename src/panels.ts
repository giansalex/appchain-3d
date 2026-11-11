// What the detail panel shows for each thing that has an address: validator, block, transaction,
// account, proposal. Each builder returns nodes; main.ts decides when to show them.

import { KINDS, classify, formatAmount, shortType } from './data';
import { compact, dateTime, dl, el, fmt, ilink, link, safeUrl, shortAddr, shortHash, type Child, type Nested } from './dom';
import { statusStyle } from './interior';
import type { AccountDetail, TxDetail } from './lookup';
import type { Block, Kind, Msg, Planet, Proposal, Validator } from './types';

export interface PanelCtx {
  chain: Planet;
  /** false while the chain is simulated: no in-app lookups or explorer links */
  live: boolean;
  validators: Validator[];
  /** latest known height */
  height: number;
}

const LIST = 25;
const kindDot = (k: Kind) => el('span', { class: 'dot', style: `background:${KINDS[k].color}` });
const tag = (text: string, color = '') => el('span', color ? { class: 'tag', style: `color:${color}` } : { class: 'tag' }, text);
const heading = (text: string) => el('p', {}, el('strong', {}, text));
const explorer = ({ chain, live }: PanelCtx, path: string, text = 'Open in explorer ↗') => (live ? link(`${chain.explorer}/${path}`, text) : null);

/** The first `LIST` rows, with the rest folded away. */
function folded(rows: HTMLElement[]): Nested[] {
  if (rows.length <= LIST) return [el('ul', {}, rows)];
  return [el('ul', {}, rows.slice(0, LIST)), el('details', {}, el('summary', {}, `${rows.length - LIST} more`), el('ul', {}, rows.slice(LIST)))];
}

/** A validator by operator address: its name linked to its tower, or the shortened address if it is not bonded. */
function validatorRef(operator: string, ctx: PanelCtx): HTMLElement {
  const v = ctx.validators.find((x) => x.operator === operator);
  return ilink({ chain: ctx.chain.key, entity: { kind: 'validator', operator } }, v ? v.moniker : shortAddr(operator), operator);
}
const accountRef = (address: string, ctx: PanelCtx) =>
  ilink({ chain: ctx.chain.key, entity: { kind: 'account', address } }, shortAddr(address), address);

export function validatorPanel(v: Validator, ctx: PanelCtx): Nested[] {
  const site = safeUrl(v.website);
  return [
    tag(`Validator · rank #${v.index + 1}`),
    el('h2', {}, v.moniker),
    el('p', { class: 'mono' }, v.operator),
    v.details ? el('p', {}, v.details.slice(0, 220)) : null,
    dl([
      ['Voting power', `${(v.power * 100).toFixed(2)}%`],
      !ctx.chain.poa && ['Staked', `${fmt(v.tokens)} ${ctx.chain.symbol}`],
      ['Commission', `${(v.commission * 100).toFixed(1)}%`],
      site && ['Website', link(site, new URL(site).hostname)],
    ]),
    explorer(ctx, `staking/${v.operator}`),
  ];
}

export function blockPanel(b: Block, ctx: PanelCtx): Nested[] {
  const chain = ctx.chain.key;
  const counts: Partial<Record<Kind, number>> = {};
  b.txs.forEach((t) => { counts[t.kind] = (counts[t.kind] || 0) + 1; });
  const txRows = b.txs.map((t) => el('li', {},
    el('span', {}, kindDot(t.kind), t.label),
    el('span', { class: 'mono' }, ctx.live && t.hash ? ilink({ chain, entity: { kind: 'tx', hash: t.hash } }, shortHash(t.hash)) : t.hash ? shortHash(t.hash) : '')));
  return [
    tag('Block'),
    el('h2', {}, `#${fmt(b.height)}`),
    b.hash ? el('p', { class: 'mono' }, b.hash) : null,
    dl([
      ['Time', dateTime(b.time)],
      ['Proposer', b.proposer ? validatorRef(b.proposer.operator, ctx) : 'unknown'],
      ['Transactions', b.undecoded ? 'not decoded by the node' : String(b.txs.length)],
      ['Commit signatures', `${b.signers.size}/${ctx.validators.length}`],
    ]),
    Object.keys(counts).length > 1 ? el('p', { class: 'chips' }, (Object.entries(counts) as [Kind, number][]).map(([k, n]) =>
      el('span', {}, kindDot(k), `${KINDS[k].label} × ${n}`))) : null,
    b.txs.length ? heading('Transactions') : null,
    b.txs.length ? folded(txRows) : null,
    ctx.live ? el('div', { class: 'pager' },
      b.height > 1 ? ilink({ chain, entity: { kind: 'block', height: b.height - 1 } }, `‹ #${fmt(b.height - 1)}`) : el('span'),
      b.height < ctx.height ? ilink({ chain, entity: { kind: 'block', height: b.height + 1 } }, `#${fmt(b.height + 1)} ›`) : el('span')) : null,
    explorer(ctx, `block/${b.height}`),
  ];
}

// ---------- transaction ----------
const isCoin = (v: any): v is { denom: string; amount: string } =>
  !!v && typeof v === 'object' && typeof v.denom === 'string' && (typeof v.amount === 'string' || typeof v.amount === 'number');
const coins = (v: unknown): string | null => {
  if (isCoin(v)) return formatAmount(v.amount, v.denom);
  if (Array.isArray(v) && v.length && v.every(isCoin)) return v.map((c) => formatAmount(c.amount, c.denom)).join(' + ');
  return null;
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const label = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** A message or event value: addresses become links, coins are formatted, anything nested is shown as JSON. */
function value(v: unknown, ctx: PanelCtx): Node | string {
  if (typeof v === 'string') {
    const { prefix } = ctx.chain;
    if (new RegExp(`^${prefix}valoper1[0-9a-z]{20,}$`).test(v)) return validatorRef(v, ctx);
    if (new RegExp(`^${prefix}1[0-9a-z]{20,}$`).test(v)) return accountRef(v, ctx);
    return clip(v, 140) || '—';
  }
  if (v == null) return '—';
  if (typeof v !== 'object') return String(v);
  return coins(v) ?? el('code', {}, clip(JSON.stringify(v), 260));
}

/** One line that says what a message does, for the common types. */
function brief(m: Msg, ctx: PanelCtx): Child[] {
  const type = shortType(m['@type']);
  const val = (op: unknown) => (typeof op === 'string' ? validatorRef(op, ctx) : null);
  const acc = (a: unknown) => (typeof a === 'string' ? value(a, ctx) : null);
  switch (type) {
    case 'Send': return [coins(m.amount), ' → ', acc(m.to_address)];
    case 'Delegate': return [coins(m.amount), ' → ', val(m.validator_address)];
    case 'Undelegate': return [coins(m.amount), ' ← ', val(m.validator_address)];
    case 'BeginRedelegate': return [coins(m.amount), ' · ', val(m.validator_src_address), ' → ', val(m.validator_dst_address)];
    case 'WithdrawDelegatorReward': return ['from ', val(m.validator_address)];
    case 'Vote': return [`proposal #${m.proposal_id} · ${String(m.option ?? '').replace('VOTE_OPTION_', '').toLowerCase()}`];
    case 'Transfer': return [coins(m.token), ` → ${m.receiver ? shortAddr(String(m.receiver)) : ''} via ${m.source_channel ?? ''}`];
    case 'ExecuteContract': {
      const call = m.msg && typeof m.msg === 'object' ? Object.keys(m.msg)[0] : '';
      return [call ? `${call} on ` : '', acc(m.contract)];
    }
    default: return [];
  }
}

function message(m: Msg, i: number, open: boolean, ctx: PanelCtx): HTMLElement {
  const fields = Object.entries(m).filter(([k]) => k !== '@type');
  const line = brief(m, ctx).filter((x) => x != null && x !== false && x !== '');
  return el('details', open ? { open: '' } : {},
    el('summary', {}, el('span', { class: 'num' }, `#${i + 1}`), kindDot(classify(m['@type'])), shortType(m['@type']) || 'Message'),
    line.length ? el('p', { class: 'brief' }, line) : null,
    dl(fields.map(([k, v]) => [label(k), value(v, ctx)])),
    el('p', { class: 'mono' }, m['@type'] ?? ''));
}

const EVENT_LIMIT = 40;

export function txPanel(tx: TxDetail, ctx: PanelCtx): Nested[] {
  const chain = ctx.chain.key;
  const used = tx.gasWanted ? ` (${Math.round((tx.gasUsed / tx.gasWanted) * 100)}%)` : '';
  return [
    tag('Transaction'),
    el('h2', {}, shortHash(tx.hash)),
    el('p', { class: 'mono' }, tx.hash),
    dl([
      ['Status', el('span', { class: tx.ok ? 'ok' : 'fail' }, tx.ok ? 'Success' : `Failed · ${tx.codespace || 'code'} ${tx.code}`)],
      ['Block', ilink({ chain, entity: { kind: 'block', height: tx.height } }, `#${fmt(tx.height)}`)],
      dateTime(tx.time) && ['Time', dateTime(tx.time)],
      tx.signer && ['Signer', value(tx.signer, ctx)],
      ['Fee', tx.fee || 'none'],
      ['Gas used', `${fmt(tx.gasUsed)} of ${fmt(tx.gasWanted)}${used}`],
      tx.memo && ['Memo', clip(tx.memo, 200)],
    ]),
    tx.log ? el('p', { class: 'fail' }, clip(tx.log, 320)) : null,
    heading(`${tx.msgs.length} message${tx.msgs.length === 1 ? '' : 's'}`),
    tx.msgs.slice(0, LIST).map((m, i) => message(m, i, tx.msgs.length === 1, ctx)),
    tx.msgs.length > LIST ? el('p', { class: 'mono' }, `+ ${tx.msgs.length - LIST} more messages`) : null,
    tx.events.length ? el('details', { class: 'events' },
      el('summary', {}, `${tx.events.length} event${tx.events.length === 1 ? '' : 's'}`),
      tx.events.slice(0, EVENT_LIMIT).map((e) => el('div', { class: 'event' },
        el('b', {}, e.type),
        dl(e.attrs.map(([k, v]) => [k, value(v, ctx)])))),
      tx.events.length > EVENT_LIMIT ? el('p', { class: 'mono' }, `+ ${tx.events.length - EVENT_LIMIT} more events`) : null) : null,
    explorer(ctx, `tx/${tx.hash}`),
  ];
}

// ---------- account ----------
export function accountPanel(a: AccountDetail, ctx: PanelCtx): Nested[] {
  const s = a.staking;
  const when = (t: string) => { const d = new Date(t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { dateStyle: 'medium' }); };
  return [
    tag(a.type),
    el('h2', {}, shortAddr(a.address)),
    el('p', { class: 'mono' }, a.address),
    dl([
      ['Available', a.balances.find((b) => b.native)?.amount ?? `0 ${ctx.chain.symbol}`],
      s && ['Staked', s.staked],
      s && ['Pending rewards', s.rewards],
      s && s.unbondings.length > 0 && ['Unbonding', s.unbonding],
      a.sequence != null && ['Transactions signed', fmt(a.sequence)],
    ]),
    s && s.delegations.length ? [
      heading(`Delegations · ${s.delegations.length}`),
      el('p', { class: 'mono' }, 'The towers this account stakes with are lit in the Validator Ring.'),
      folded(s.delegations.map((d) => el('li', {},
        el('span', {}, validatorRef(d.operator, ctx), el('small', {}, ` ${(d.share * 100).toFixed(d.share < 0.1 ? 1 : 0)}%`)),
        el('span', { title: `Pending rewards: ${d.reward}` }, d.amount)))),
    ] : null,
    s && s.unbondings.length ? [
      heading(`Unbonding · ${s.unbondings.length}`),
      folded(s.unbondings.map((u) => el('li', {},
        el('span', {}, validatorRef(u.operator, ctx), el('small', {}, ` free ${when(u.completes)}`)),
        el('span', {}, u.amount)))),
    ] : null,
    heading(`Balances · ${a.balances.length}`),
    a.balances.length
      ? folded(a.balances.map((b) => el('li', {}, el('span', {}, b.amount), el('span', {}, b.native ? 'native' : ''))))
      : el('p', {}, 'This address holds no tokens.'),
    explorer(ctx, `account/${a.address}`),
  ];
}

export function proposalPanel(p: Proposal, ctx: PanelCtx): Nested[] {
  const st = statusStyle(p.status);
  const { yes, no, abstain, veto } = p.tally;
  const total = yes + no + abstain + veto;
  const pct = (v: number) => (total ? `${((v / total) * 100).toFixed(1)}%` : '—');
  const parts: [number, string][] = [[yes, '#4ade80'], [no, '#f87171'], [veto, '#b91c1c'], [abstain, '#94a3b8']];
  const end = p.votingEnd ? new Date(p.votingEnd) : null;
  return [
    tag(`Proposal #${p.id} · ${st.label}`, st.color),
    el('h2', {}, p.title),
    el('div', { class: 'bar' }, parts.map(([v, c]) => el('i', { style: `width:${total ? (v / total) * 100 : 0}%;background:${c}` }))),
    dl([
      ['Yes', pct(yes)], ['No', pct(no)], ['No with veto', pct(veto)], ['Abstain', pct(abstain)],
      ['Votes cast', `${compact(total)} ${ctx.chain.symbol}`],
      end && [p.status === 'VOTING_PERIOD' ? 'Voting ends' : 'Voting ended', end.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })],
    ]),
    el('p', {}, p.summary.length > 420 ? `${p.summary.slice(0, 420)}…` : p.summary),
    explorer(ctx, `gov/${p.id}`, 'Read & vote in explorer ↗'),
  ];
}
