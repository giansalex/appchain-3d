// One-off lookups for search and deep links. Unlike the feed these work for any chain at any time,
// whether or not its planet is being visited.

import { PLANETS } from './chains';
import { VALIDATORS_PATH, formatToken, shortType, toValidators, txKind } from './data';
import { isNotFound, lcdFor } from './lcd';
import type { Kind, Msg, Planet, Validator } from './types';

export interface TxDetail {
  hash: string;
  height: number;
  time: string;
  ok: boolean;
  code: number;
  /** the node's error text for a failed tx */
  log: string;
  gasUsed: number;
  gasWanted: number;
  fee: string;
  memo: string;
  kind: Kind;
  msgs: string[];
}

export interface AccountDetail {
  address: string;
  balances: { amount: string; native: boolean }[];
  /** how many more balances exist beyond the ones listed */
  more: number;
  /** total delegated, formatted; null when the chain has no staking or the query failed */
  staked: string | null;
  delegations: number;
}

export class NotFound extends Error {}

const txCache = new Map<string, TxDetail>();

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
  const types = msgs.map((m) => m['@type'] || '');
  const fee: { amount: string; denom: string }[] = d.tx?.auth_info?.fee?.amount || [];
  const tx: TxDetail = {
    hash: r.txhash,
    height: Number(r.height),
    time: r.timestamp,
    ok: !r.code,
    code: Number(r.code || 0),
    log: r.code ? String(r.raw_log || '') : '',
    gasUsed: Number(r.gas_used),
    gasWanted: Number(r.gas_wanted),
    fee: fee.map((c) => formatAmount(c.amount, c.denom)).join(' + '),
    memo: d.tx?.body?.memo || '',
    kind: txKind(types),
    msgs: types.map((t) => shortType(t)),
  };
  txCache.set(key, tx);
  return tx;
}

/** The first chain that knows this tx hash, asking all of them at once. */
export async function findTxChain(hash: string): Promise<Planet | null> {
  const hits = await Promise.all(PLANETS.map((p) => fetchTx(p, hash, { firstAnswer: true }).then(() => p, () => null)));
  return hits.find((p) => p) ?? null;
}

/** Like formatToken, but never drops the number: unknown denoms are shown shortened. */
function formatAmount(amount: string, denom: string): string {
  const nice = formatToken(amount, denom);
  if (nice && nice !== 'IBC asset' && /\d/.test(nice)) return nice;
  const short = denom.length > 18 ? `${denom.slice(0, 10)}…${denom.slice(-4)}` : denom;
  return `${Number(amount).toLocaleString('en-US')} ${short}`;
}

export async function fetchAccount(chain: Planet, address: string): Promise<AccountDetail> {
  const lcd = lcdFor(chain);
  const native = `u${chain.symbol.toLowerCase()}`;
  let bank: any;
  try {
    bank = await lcd.get(`/cosmos/bank/v1beta1/balances/${address}?pagination.limit=200`);
  } catch (e) {
    throw isNotFound(e) ? new NotFound(`“${address}” is not a valid ${chain.name} address.`) : e;
  }
  const coins: { denom: string; amount: string }[] = bank.balances || [];
  coins.sort((a, b) => Number(b.denom === native) - Number(a.denom === native) || Number(a.denom.startsWith('ibc/')) - Number(b.denom.startsWith('ibc/')));
  let staked: string | null = null, delegations = 0;
  if (!chain.poa) {
    try {
      const d = await lcd.get(`/cosmos/staking/v1beta1/delegations/${address}?pagination.limit=200`);
      const rows: any[] = d.delegation_responses || [];
      delegations = rows.length;
      staked = formatAmount(String(rows.reduce((s, x) => s + Number(x.balance?.amount || 0), 0)), native);
    } catch { /* staking query unavailable: show balances only */ }
  }
  const shown = coins.slice(0, 8);
  return {
    address,
    balances: shown.map((c) => ({ amount: formatAmount(c.amount, c.denom), native: c.denom === native })),
    more: coins.length - shown.length,
    staked,
    delegations,
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
