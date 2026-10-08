import { decode } from 'blurhash';
import type { Photo, Size } from './types';
import { imageUrl, altText } from './data';

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener | ((e: any) => void)>;
type Child = Node | string | null | undefined | false | Child[];

/** Small DOM builder: h('button.pill', { onclick }, 'Label') */
export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style' && typeof v === 'string') el.setAttribute('style', v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}
function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

export function svg(path: string, size = 16, stroke = 1.6): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('width', String(size)); s.setAttribute('height', String(size));
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', String(stroke));
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  for (const d of path.split('|')) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.appendChild(p); }
  return s;
}
export const icons = {
  hexagon: 'M12 2 20.7 7v10L12 22 3.3 17V7Z|M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17',
  back: 'M19 12H5M11 6l-6 6 6 6',
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  play: 'M7 4.5v15l12-7.5Z',
  pause: 'M8 5v14M16 5v14',
  shuffle: 'M3 7h3.5c4 0 7 10 11 10H21M3 17h3.5c1.6 0 3-1.6 4.2-3.6M13.3 9.6C14.5 8.1 15.8 7 17.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3',
  download: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5',
};

/** <picture> with WebP + JPEG fallback. */
export function picture(p: Photo, size: Size, opts: { lazy?: boolean; alt?: string; sizes?: string; class?: string; decoding?: 'async' | 'sync' } = {}): HTMLElement {
  const pic = document.createElement('picture');
  if (opts.class) pic.className = opts.class;
  const src = document.createElement('source');
  src.type = 'image/webp'; src.srcset = imageUrl(p, size, 'webp');
  const img = document.createElement('img');
  img.src = imageUrl(p, size, 'jpg');
  img.alt = opts.alt ?? altText(p);
  img.width = p.sizes[size]?.w || 0; img.height = p.sizes[size]?.h || 0;
  if (opts.lazy !== false) img.loading = 'lazy';
  img.decoding = opts.decoding || 'async';
  img.draggable = false;
  pic.append(src, img);
  return pic;
}

const bhCache = new Map<string, string>();
/** Blurhash → tiny data-URL (cached). */
export function blurhashUrl(p: Photo, w = 32, h = 32): string {
  const key = p.blurhash + w + 'x' + h;
  let url = bhCache.get(key);
  if (url) return url;
  try {
    const px = decode(p.blurhash, w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    const im = ctx.createImageData(w, h); im.data.set(px); ctx.putImageData(im, 0, 0);
    url = c.toDataURL();
  } catch { url = ''; }
  bhCache.set(key, url);
  return url;
}

export function supportsWebGL(): boolean {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export const reducedMotion = (): boolean => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
