import type { Planet } from './types';

export class HttpError extends Error {
  constructor(public status: number) { super(`HTTP ${status}`); }
}

/** True when the node answered and said the thing does not exist (as opposed to being unreachable). */
export const isNotFound = (e: unknown): boolean => e instanceof HttpError && (e.status === 404 || e.status === 400);

// REST (LCD) client for one chain. Endpoints are tried in order starting from the last one that worked.
export class Lcd {
  private ep = 0;

  constructor(private endpoints: string[]) {}

  /**
   * GET a path as JSON. Any failure moves on to the next endpoint (public nodes are often pruned or
   * rate-limited, so a 404 on one is not proof). With `firstAnswer`, a 4xx from a reachable node is final.
   */
  async get(path: string, { firstAnswer = false } = {}): Promise<any> {
    let lastErr: unknown;
    for (let i = 0; i < this.endpoints.length; i++) {
      const idx = (this.ep + i) % this.endpoints.length;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 9000);
      try {
        const res = await fetch(this.endpoints[idx] + path, { signal: ctl.signal });
        if (!res.ok) throw new HttpError(res.status);
        const json = await res.json();
        this.ep = idx;
        return json;
      } catch (e) {
        lastErr = e;
        if (firstAnswer && isNotFound(e)) break;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }
}

const clients = new Map<string, Lcd>();
/** One shared client per chain, so the feed and one-off lookups reuse the endpoint that works. */
export function lcdFor(chain: Planet): Lcd {
  let c = clients.get(chain.key);
  if (!c) clients.set(chain.key, c = new Lcd(chain.endpoints));
  return c;
}
