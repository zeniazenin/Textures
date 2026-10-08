// Tiny History-API router: "/" (home) and "/studio/:id" (studio). Query strings
// carry state (?tag=… on home; ?m=&z=&s=&tag= on studio) so every view is linkable.

export type Route =
  | { name: 'home'; tag: string | null }
  | { name: 'studio'; id: string; tag: string | null; m?: number; z?: number; s?: number };

export function parse(url: URL = new URL(location.href)): Route {
  const tag = url.searchParams.get('tag');
  const m = url.pathname.match(/^\/studio\/([^/]+)\/?$/);
  if (m) {
    const num = (k: string) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : undefined);
    return { name: 'studio', id: decodeURIComponent(m[1]), tag, m: num('m'), z: num('z'), s: num('s') };
  }
  return { name: 'home', tag };
}

export function homeHref(tag: string | null, hash?: string): string {
  const q = tag ? `?tag=${encodeURIComponent(tag)}` : '';
  return `/${q}${hash ? `#${hash}` : ''}`;
}

export function studioHref(id: string, opts: { tag?: string | null; m?: number; z?: number; s?: number } = {}): string {
  const q = new URLSearchParams();
  if (opts.m != null) q.set('m', String(opts.m));
  if (opts.z != null) q.set('z', opts.z.toFixed(2));
  if (opts.s != null) q.set('s', String(opts.s));
  if (opts.tag) q.set('tag', opts.tag);
  const s = q.toString();
  return `/studio/${encodeURIComponent(id)}${s ? `?${s}` : ''}`;
}

type Listener = (route: Route, nav: 'push' | 'replace' | 'pop') => void;
const listeners: Listener[] = [];
const leaveHooks: (() => Record<string, unknown> | void)[] = [];

/** Called right before a push navigation; return data to merge into the current history entry (scroll position etc.). */
export function onLeave(fn: () => Record<string, unknown> | void): void { leaveHooks.push(fn); }
export function savedState(): Record<string, any> { return history.state || {}; }

export function onRoute(fn: Listener): void { listeners.push(fn); }

export function navigate(href: string, mode: 'push' | 'replace' = 'push'): void {
  if (mode === 'push') {
    let extra: Record<string, unknown> = {};
    for (const fn of leaveHooks) extra = { ...extra, ...(fn() || {}) };
    history.replaceState({ ...(history.state || {}), ...extra }, '', location.href);
    history.pushState({ depth: depth() + 1 }, '', href);
  }
  else history.replaceState(history.state, '', href);
  const r = parse();
  for (const fn of listeners) fn(r, mode);
}

/** Update the current URL's query/hash without re-rendering (filter changes, studio params). */
export function replaceUrl(href: string): void {
  history.replaceState(history.state, '', href);
}

export function depth(): number { return (history.state && history.state.depth) || 0; }

/** Go back if we have in-app history, otherwise navigate to the given fallback. */
export function back(fallback: string): void {
  if (depth() > 0) history.back();
  else navigate(fallback, 'replace');
}

export function start(): void {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (!history.state) history.replaceState({ depth: 0 }, '', location.href);
  window.addEventListener('popstate', () => { const r = parse(); for (const fn of listeners) fn(r, 'pop'); });
  const r = parse();
  for (const fn of listeners) fn(r, 'replace');
}

/** Intercept same-origin <a> clicks so the app handles them without a reload. */
export function interceptLinks(root: HTMLElement): void {
  root.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.origin !== location.origin) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) return;
    e.preventDefault();
    navigate(a.pathname + a.search + a.hash);
  });
}
