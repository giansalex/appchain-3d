// Hash routes, so every chain and everything looked up on it has a shareable URL:
//   #/                          home (space)
//   #/juno                      inside a planet
//   #/juno/block/43000000
//   #/juno/tx/<HASH>
//   #/juno/validator/<junovaloper1…>
//   #/juno/account/<juno1…>
//   #/juno/proposal/<id>
// Hash routing needs no server rewrites, so it works on GitHub Pages and from file paths.

export type Entity =
  | { kind: 'block'; height: number }
  | { kind: 'tx'; hash: string }
  | { kind: 'validator'; operator: string }
  | { kind: 'account'; address: string }
  | { kind: 'proposal'; id: string };

export interface Route {
  /** planet key, null at home */
  chain: string | null;
  entity: Entity | null;
}

export const HOME: Route = { chain: null, entity: null };

const TX_HASH = /^(?:0x)?([0-9a-f]{64})$/i;
/** Canonical (upper-case, no 0x) form of a tx hash, or null if it is not one. */
export const normalizeHash = (s: string): string | null => s.trim().match(TX_HASH)?.[1].toUpperCase() ?? null;

function parseEntity(kind: string | undefined, value: string | undefined): Entity | null {
  if (!kind || !value) return null;
  switch (kind) {
    case 'block': return /^[1-9]\d{0,15}$/.test(value) ? { kind, height: Number(value) } : null;
    case 'tx': { const hash = normalizeHash(value); return hash ? { kind, hash } : null; }
    case 'validator': return /^[a-z0-9]{8,120}$/.test(value) ? { kind, operator: value } : null;
    case 'account': return /^[a-z0-9]{8,120}$/.test(value) ? { kind, address: value } : null;
    case 'proposal': return /^\d{1,12}$/.test(value) ? { kind, id: value } : null;
    default: return null;
  }
}

export function parseRoute(hash: string): Route {
  const [chain, kind, value] = hash.replace(/^#\/?/, '').split('/').map((s) => {
    try { return decodeURIComponent(s); } catch { return ''; }
  });
  if (!chain) return HOME;
  return { chain: chain.toLowerCase(), entity: parseEntity(kind, value) };
}

export function formatRoute({ chain, entity }: Route): string {
  if (!chain) return '#/';
  if (!entity) return `#/${chain}`;
  const value = entity.kind === 'block' ? entity.height
    : entity.kind === 'tx' ? entity.hash
      : entity.kind === 'validator' ? entity.operator
        : entity.kind === 'account' ? entity.address
          : entity.id;
  return `#/${chain}/${entity.kind}/${value}`;
}
