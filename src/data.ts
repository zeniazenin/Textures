import type { Manifest, Photo, Size } from './types';

export const IMAGE_BASE = ((import.meta.env.VITE_IMAGE_BASE as string | undefined) || '/generated').replace(/\/+$/, '');

export function imageUrl(p: Photo, size: Size, fmt: 'webp' | 'jpg' = 'webp'): string {
  return `${IMAGE_BASE}/${size}/${p.id}.${fmt}`;
}

export function label(p: Photo): string {
  return `No. ${String(p.no).padStart(3, '0')}`;
}
export function altText(p: Photo): string {
  return p.title || `Texture photograph ${label(p)}`;
}
export function tagline(p: Photo): string {
  return p.tags.length ? p.tags.join(' / ') : 'Untagged';
}

let cached: Promise<Manifest> | null = null;
export function loadManifest(): Promise<Manifest> {
  if (!cached) {
    cached = fetch(`${IMAGE_BASE}/manifest.json`).then(async (r) => {
      if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status} from ${IMAGE_BASE}`);
      return (await r.json()) as Manifest;
    });
  }
  return cached;
}

/** Photos matching a tag filter (null = all), in spectrum order. */
export function filterPhotos(m: Manifest, tag: string | null): Photo[] {
  if (!tag) return m.photos;
  const t = tag.toLowerCase();
  const out = m.photos.filter((p) => p.tags.some((x) => x.toLowerCase() === t));
  return out.length ? out : m.photos;
}

/** Tag list that actually occurs, with counts, most common first. */
export function tagChips(m: Manifest): { tag: string; count: number }[] {
  return Object.entries(m.tags)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

let heroPick: Photo | null = null;
/** The hero/featured photo: site.featured id, else first `featured`, else a random one per visit. */
export function heroPhoto(m: Manifest): Photo {
  if (heroPick) return heroPick;
  const byId = m.site.featured ? m.photos.find((p) => p.id === m.site.featured) : undefined;
  heroPick = byId || m.photos.find((p) => p.featured) || m.photos[Math.floor(Math.random() * m.photos.length)];
  return heroPick;
}

export function clampMirrors(n: number): number {
  n = Math.round(Number.isFinite(n) ? n : 12);
  n = Math.max(4, Math.min(32, n));
  return n % 2 ? n + 1 : n;
}
export const clampZoom = (z: number): number => Math.max(1.2, Math.min(4, Number.isFinite(z) ? z : 1.8));
export const clampSpeed = (s: number): number => Math.max(0, Math.min(60, Number.isFinite(s) ? s : 12));
