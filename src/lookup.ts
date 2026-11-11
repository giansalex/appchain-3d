// One-off lookups for search and deep links. Unlike the feed these work for any chain at any time,
// whether or not its planet is being visited.

import { PLANETS } from './chains';
import { VALIDATORS_PATH, formatAmount, toValidators, txKind } from './data';
import { isNotFound, lcdFor } from './lcd';
import type { Kind, Msg, Planet, Validator } from './types';

export interface TxEvent { type: string; attrs: [string, string][] }

export interface TxDetail {
  hash: string;
  height: number;
  time: string;
  ok: boolean;
  code: number;
  codespace: string;
  /** the node's error text for a failed tx */
  log: string;
  gasUsed: number;
  gasWanted: number;
  fee: string;
  memo: string;
  /** the account that signed and paid, when the node reports it */
  signer: string;
  kind: Kind;
  msgs: Msg[];
  events: TxEvent[];
}

export interface Delegation { operator: string; amount: string; share: number; reward: string }
export interface Unbonding { operator: string; amount: string; completes: string }

export interface AccountDetail {
  address: string;
  /** e.g. "Account", "Module account · bonded_tokens_pool", "Vesting account" */
  type: string;
  /** number of transactions signed so far; null when unknown or never used */
  sequence: number | null;
  balances: { amount: string; native: boolean }[];
  /** null when the chain has no staking or the node could not answer */
  staking: {
    staked: string;
    rewards: string;
    unbonding: string;
    delegations: Delegation[];
    unbondings: Unbonding[];
  } | null;
}

export class NotFound extends Error {}

const txCache = new Map<string, TxDetail>();

/** The signer is not in the tx body in a readable form, but the ante handler emits it as an event. */
function signerOf(events: TxEvent[]): string {
  const attr = (type: string, key: string) => events.find((e) => e.type === type && e.attrs.some(([k]) => k === key))
    ?.attrs.find(([k]) => k === key)?.[1] ?? '';
  return attr('tx', 'fee_payer') || attr('tx', 'acc_seq').split('/')[0] || attr('message', 'sender');
}

export async function fetchTx(chain: Planet, hash: string, { firstAnswer = false } = {}): Promise<TxDetail> {
  const key = `${chain.key}:${hash}`;
  const hit = txCache.get(key);
  if (hit) return hit;
  let d: any;
  try {
    d = await lcdFor(chain).get(`/cosmos/tx/v1beta1/txs/${hash}`, { firstAnswer });
  } catch (e) {
    throw isNotFound(e) ? new NotFound(`No transaction with this hash on ${chain.name}.`) : e;
  }
  const r = d.tx_response;
  const msgs: Msg[] = d.tx?.body?.messages || [];
  const fee: { amount: string; denom: string }[] = d.tx?.auth_info?.fee?.amount || [];
  const events: TxEvent[] = ((r.events || []) as any[]).map((e) => ({
    type: String(e.type),
    attrs: ((e.attributes || []) as any[]).map((a): [string, string] => [String(a.key ?? ''), String(a.value ?? '')]),
  }));
  const tx: TxDetail = {
    hash: r.txhash,
    height: Number(r.height),
    time: r.timestamp,
    ok: !r.code,
    code: Number(r.code || 0),
    codespace: r.codespace || '',
    log: r.code ? String(r.raw_log || '') : '',
    gasUsed: Number(r.gas_used),
    gasWanted: Number(r.gas_wanted),
    fee: fee.map((c) => formatAmount(c.amount, c.denom)).join(' + '),
    memo: d.tx?.body?.memo || '',
    signer: signerOf(events),
    kind: txKind(msgs.map((m) => m['@type'] || '')),
    msgs,
    events,
  };
  txCache.set(key, tx);
  return tx;
}

/** The first chain that knows this tx hash, asking all of them at once. */
export async function findTxChain(hash: string): Promise<Planet | null> {
  const hits = await Promise.all(PLANETS.map((p) => fetchTx(p, hash, { firstAnswer: true }).then(() => p, () => null)));
  return hits.find((p) => p) ?? null;
}

function accountType(acc: any): string {
  const t = String(acc?.['@type'] || '').split('.').pop() || '';
  if (t === 'ModuleAccount') return `Module account · ${acc.name}`;
  if (/Vesting/.test(t)) return 'Vesting account';
  if (t === 'BaseAccount' || !t) return 'Account';
  return t.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Balances, plus where the account's stake is: delegations with pending rewards, and unbonding entries. */
export async function fetchAccount(chain: Planet, address: string): Promise<AccountDetail> {
  const lcd = lcdFor(chain);
  const native = `u${chain.symbol.toLowerCase()}`;
  const optional = (path: string) => lcd.get(path).catch(() => null);
  const [bankR, auth, del, rew, unb] = await Promise.all([
    lcd.get(`/cosmos/bank/v1beta1/balances/${address}?pagination.limit=200`).catch((e: unknown) => e),
    optional(`/cosmos/auth/v1beta1/accounts/${address}`),
    chain.poa ? null : optional(`/cosmos/staking/v1beta1/delegations/${address}?pagination.limit=200`),
    chain.poa ? null : optional(`/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    chain.poa ? null : optional(`/cosmos/staking/v1beta1/delegators/${address}/unbonding_delegations?pagination.limit=100`),
  ]);
  if (bankR instanceof Error || !bankR?.balances) {
    throw isNotFound(bankR) ? new NotFound(`“${address}” is not a valid ${chain.name} address.`) : bankR;
  }
  const coins: { denom: string; amount: string }[] = bankR.balances;
  coins.sort((a, b) => Number(b.denom === native) - Number(a.denom === native) || Number(a.denom.startsWith('ibc/')) - Number(b.denom.startsWith('ibc/')));

  let staking: AccountDetail['staking'] = null;
  if (del) {
    const nativeOf = (list: any[] | undefined) => Number(list?.find((c) => c.denom === native)?.amount || 0);
    const rewardBy = new Map<string, number>(((rew?.rewards || []) as any[]).map((r) => [r.validator_address, nativeOf(r.reward)]));
    const rows = ((del.delegation_responses || []) as any[])
      .map((x) => ({ operator: String(x.delegation?.validator_address), n: Number(x.balance?.amount || 0) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    const total = rows.reduce((s, x) => s + x.n, 0);
    const unbondings = ((unb?.unbonding_responses || []) as any[]).flatMap((u) => ((u.entries || []) as any[]).map((e) => ({
      operator: String(u.validator_address), n: Number(e.balance || 0), completes: String(e.completion_time || ''),
    }))).sort((a, b) => a.completes.localeCompare(b.completes));
    staking = {
      staked: formatAmount(total, native),
      rewards: formatAmount(nativeOf(rew?.total), native),
      unbonding: formatAmount(unbondings.reduce((s, u) => s + u.n, 0), native),
      delegations: rows.map((x) => ({
        operator: x.operator, amount: formatAmount(x.n, native), share: total ? x.n / total : 0,
        reward: formatAmount(rewardBy.get(x.operator) || 0, native),
      })),
      unbondings: unbondings.map((u) => ({ operator: u.operator, amount: formatAmount(u.n, native), completes: u.completes })),
    };
  }
  const base = auth?.account?.base_account ?? auth?.account?.base_vesting_account?.base_account ?? auth?.account;
  return {
    address,
    type: accountType(auth?.account),
    sequence: base?.sequence != null ? Number(base.sequence) : null,
    balances: coins.map((c) => ({ amount: formatAmount(c.amount, c.denom), native: c.denom === native })),
    staking,
  };
}

const validatorCache = new Map<string, Promise<Validator[]>>();
/** A chain's bonded validators, loaded once, for searching by name without visiting the planet. */
export function validatorIndex(chain: Planet): Promise<Validator[]> {
  let p = validatorCache.get(chain.key);
  if (!p) {
    p = lcdFor(chain).get(VALIDATORS_PATH).then(toValidators).catch(() => {
      validatorCache.delete(chain.key); // let a later search retry
      return [];
    });
    validatorCache.set(chain.key, p);
  }
  return p;
}
