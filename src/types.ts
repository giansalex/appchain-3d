// Shared data shapes: chain config, what the feed emits and what the scenes attach to pickable objects.

export interface Planet {
  key: string;
  chainId: string;
  name: string;
  symbol: string;
  /** bech32 account prefix */
  prefix: string;
  color: string;
  explorer: string;
  simHeight: number;
  simBlockTime: number;
  endpoints: string[];
  hub?: boolean;
  /** proof-of-authority: no staking token */
  poa?: boolean;
  /** false when the chain has no gov module */
  gov?: boolean;
}

export type Kind = 'send' | 'stake' | 'reward' | 'wasm' | 'swap' | 'gov' | 'ibc' | 'other';

export interface Validator {
  operator: string;
  moniker: string;
  website: string;
  details: string;
  tokens: number;
  commission: number;
  /** rank by stake, 0 = largest */
  index: number;
  /** share of bonded stake, 0..1 */
  power: number;
  pubkey?: string;
  consAddr?: string;
}

export interface Tally { yes: number; no: number; abstain: number; veto: number }

export interface Proposal {
  id: string;
  title: string;
  summary: string;
  status: string;
  votingEnd?: string;
  expedited: boolean;
  tally: Tally;
}

export interface BlockTx { hash: string; kind: Kind; label: string }

export interface Block {
  height: number;
  time: number;
  proposer: Validator | null;
  /** validator indices that signed the commit */
  signers: Set<number>;
  absent: number;
  txs: BlockTx[];
  undecoded?: boolean;
}

export interface IbcTransfer {
  dir: 'in' | 'out';
  channel: string;
  amount: string;
  chainId: string;
  chainName: string;
  color: string;
  hash?: string;
  height?: number;
  time?: string;
}

export type FeedMode = 'connecting' | 'live' | 'sim';

export interface FeedEvents {
  status: { mode: FeedMode; reconnecting?: boolean };
  validators: Validator[];
  proposals: Proposal[];
  block: Block;
  ibc: IbcTransfer;
  ibcHistory: IbcTransfer[];
}

/** What a pickable 3D object carries in `userData`. */
export type PickData =
  | { type: 'planet'; chain: Planet }
  | { type: 'validator'; v: Validator }
  | { type: 'block'; b: Block }
  | { type: 'proposal'; p: Proposal }
  | { type: 'core' }
  | { type: 'port' };

/** Decoded Cosmos SDK message: `@type` plus arbitrary fields. */
export type Msg = { '@type'?: string } & Record<string, any>;
