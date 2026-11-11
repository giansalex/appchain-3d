// Small DOM helpers shared by the HUD and the detail panels.

import { formatRoute, type Route } from './router';

export type Child = Node | string | null | undefined | false;
/** Children may be nested to any depth; they are flattened and empty values dropped. */
export type Nested = Child | Nested[];
export type Children = Nested[];
export const flatKids = (kids: Children): (Node | string)[] =>
  (kids.flat(Infinity as 1) as Child[]).filter((k): k is Node | string => k != null && k !== false);

export const $ = <T extends HTMLElement = HTMLElement>(s: string): T => {
  const e = document.querySelector<T>(s);
  if (!e) throw new Error(`missing element ${s}`);
  return e;
};

export const fmt = (n: number, d = 0): string => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
export const compact = (n: number): string => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const shortHash = (h: string): string => `${h.slice(0, 6)}…${h.slice(-4)}`;
export const shortAddr = (a: string): string => (a.length > 22 ? `${a.slice(0, 12)}…${a.slice(-6)}` : a);
export const dateTime = (t: number | string): string => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
};

// Chain data (monikers, proposal text, memos…) is untrusted: always build DOM with text nodes.
export function el(tag: string, props: Record<string, string> = {}, ...kids: Children): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') e.style.cssText = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v);
  }
  e.append(...flatKids(kids));
  return e;
}

/** In-app link: changing the hash is what navigates. */
export const ilink = (route: Route, text: string, title = ''): HTMLElement =>
  el('a', title ? { href: formatRoute(route), title } : { href: formatRoute(route) }, text);
export const link = (href: string, text: string): HTMLElement => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
export const safeUrl = (u: string): string | null => {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
};

export type Row = [string, Node | string] | null | undefined | false | '';
export const dl = (rows: Row[]): HTMLElement => el('dl', {}, rows.filter((r): r is [string, Node | string] => !!r)
  .flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
