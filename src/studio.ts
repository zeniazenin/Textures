// Studio: WebGL kaleidoscope of one photo with controls, prev/next, filmstrip, export and share link.
import type { Manifest, Photo } from './types';
import { filterPhotos, imageUrl, label, tagline, altText, clampMirrors, clampZoom, clampSpeed } from './data';
import { Kaleido } from './kaleido';
import { h, svg, icons, picture, blurhashUrl } from './ui';
import { homeHref, studioHref, navigate, replaceUrl, back, type Route } from './router';
import type { View } from './home';

const SEGS = [6, 8, 10, 12, 16, 24];

export interface StudioView extends View { update(route: Extract<Route, { name: 'studio' }>): void }

export function renderStudio(m: Manifest, route: Extract<Route, { name: 'studio' }>): StudioView {
  let tag: string | null = route.tag && Object.keys(m.tags).some((t) => t.toLowerCase() === route.tag!.toLowerCase()) ? route.tag : null;
  let list = filterPhotos(m, tag);
  let cur: Photo = m.photos.find((p) => p.id === route.id) || list[0];
  let mirrors = clampMirrors(route.m ?? 12);
  let zoom = clampZoom(route.z ?? 1.8);
  let speed = clampSpeed(route.s ?? 12);
  let paused = false;

  const k = new Kaleido({ label: '' });
  k.set({ mirrors, zoom, speed, paused, seed: cur.seed });

  // ---------------------------------------------------------------- top bar
  const posEl = h('p.pos');
  const bar = h('div.studio-bar', {},
    h('button.pill.pill-outline.pill-sm', { type: 'button', style: 'padding-left:14px', onclick: () => back(homeHref(tag)) }, svg(icons.back, 18, 1.8), 'Archive'),
    posEl,
    h('div.studio-nav', {},
      h('button.round', { type: 'button', 'aria-label': 'Previous photograph', onclick: () => step(-1) }, svg(icons.prev, 18, 1.8)),
      h('button.round', { type: 'button', 'aria-label': 'Next photograph', onclick: () => step(1) }, svg(icons.next, 18, 1.8)),
    ),
  );

  // ---------------------------------------------------------------- stage
  const bg = document.createElement('img');
  bg.className = 'stage-bg'; bg.alt = ''; bg.setAttribute('aria-hidden', 'true'); bg.decoding = 'async';
  const stage = h('div.stage', {}, bg, k.el);
  if (!k.isWebGL) stage.append(h('p.stage-fallback', { style: 'pointer-events:none; align-self:end' }, 'WebGL is unavailable, using a slower fallback renderer.'));

  // ---------------------------------------------------------------- controls
  const srcThumb = h('div.source-thumb');
  const srcNo = h('span.mono');
  const srcTitle = h('h2');
  const srcTags = h('span.tags');
  const segButtons = SEGS.map((n) => h('button', { type: 'button', 'aria-pressed': String(n === mirrors), onclick: () => setMirrors(n) }, String(n)));
  const zoomOut = h('output', { for: 'kz' }, fmtZoom(zoom));
  const zoomIn = h('input', { id: 'kz', type: 'range', min: '1.2', max: '4', step: '0.05', value: String(zoom), oninput: (e: Event) => setZoom(parseFloat((e.target as HTMLInputElement).value)) }) as HTMLInputElement;
  const speedOut = h('output', { for: 'ks' }, fmtSpeed(speed));
  const speedIn = h('input', { id: 'ks', type: 'range', min: '0', max: '60', step: '1', value: String(speed), oninput: (e: Event) => setSpeed(parseInt((e.target as HTMLInputElement).value, 10)) }) as HTMLInputElement;
  const pauseBtn = h('button.pill.pill-outline', { type: 'button', 'aria-pressed': 'false', onclick: () => setPaused(!paused) });
  const status = h('p.status', { role: 'status', 'aria-live': 'polite' });
  const sizeSel = h('select', { 'aria-label': 'Export size' }, h('option', { value: '2048' }, '2048 px'), h('option', { value: '4096' }, '4096 px')) as HTMLSelectElement;
  const saveBtn = h('button.pill.pill-outline', { type: 'button', style: 'font-size:15px', onclick: () => save() }, svg(icons.download, 16, 1.8), 'Save image');
  const copyBtn = h('button.pill.pill-outline', { type: 'button', style: 'font-size:15px', onclick: () => copyLink() }, svg(icons.link, 16, 1.8), 'Copy link');

  const controls = h('aside.controls', { 'aria-label': 'Kaleidoscope controls' },
    h('div.source', {}, srcThumb, h('div.source-meta', {}, srcNo, srcTitle, srcTags)),
    h('fieldset', {}, h('legend.mono-up', {}, 'Mirrors'), h('div.seg', {}, ...segButtons)),
    h('div.range', {}, h('label.mono-up', { for: 'kz' }, h('span', {}, 'Magnify'), zoomOut), zoomIn),
    h('div.range', {}, h('label.mono-up', { for: 'ks' }, h('span', {}, 'Turn speed'), speedOut), speedIn),
    h('div.btn-row', {}, pauseBtn, h('button.pill.pill-accent', { type: 'button', onclick: () => surprise() }, svg(icons.shuffle, 16, 1.8), 'Surprise me')),
    h('p.help', {}, 'Move across the kaleidoscope to slide the photograph beneath the mirrors.'),
    h('div.export-row', {}, saveBtn, sizeSel, copyBtn),
    status,
  );

  // ---------------------------------------------------------------- filmstrip
  const film = h('div.film', { role: 'list' });
  const filmWrap = h('div.film-wrap', {}, h('span.mono-up', {}, 'Neighbours on the spectrum'), film);

  const el = h('main.studio.wrap', { id: 'main', tabindex: '-1' }, bar, h('div.studio-body', {}, stage, controls), filmWrap);

  // ---------------------------------------------------------------- behaviour
  function fmtZoom(z: number): string { return `${z.toFixed(2)}×`; }
  function fmtSpeed(s: number): string { return s === 0 ? 'still' : `${s}°/s`; }
  function pos(): number { const i = list.findIndex((p) => p.id === cur.id); return i < 0 ? 0 : i; }
  function syncUrl(): void { replaceUrl(studioHref(cur.id, { tag, m: mirrors, z: zoom, s: speed })); }
  function shareUrl(): string { return location.origin + studioHref(cur.id, { tag, m: mirrors, z: zoom, s: speed }); }

  function setMirrors(n: number): void { mirrors = clampMirrors(n); segButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(SEGS[i] === mirrors))); k.set({ mirrors }); syncUrl(); }
  function setZoom(z: number): void { zoom = clampZoom(z); zoomIn.value = zoom.toFixed(2); zoomOut.textContent = fmtZoom(zoom); k.set({ zoom }); syncUrl(); }
  function setSpeed(s: number): void { speed = clampSpeed(s); speedIn.value = String(speed); speedOut.textContent = fmtSpeed(speed); k.set({ speed }); syncUrl(); }
  function setPaused(p: boolean): void {
    paused = p; k.set({ paused });
    pauseBtn.replaceChildren(svg(paused ? icons.play : icons.pause, 16, 1.8), paused ? 'Play' : 'Pause');
    pauseBtn.setAttribute('aria-pressed', String(paused));
  }
  function step(d: number): void {
    const n = list.length; if (!n) return;
    const next = list[(pos() + d + n) % n];
    navigate(studioHref(next.id, { tag, m: mirrors, z: zoom, s: speed }), 'replace');
  }
  function surprise(): void {
    const p = m.photos[Math.floor(Math.random() * m.photos.length)];
    tag = null; list = m.photos;
    setMirrors(SEGS[1 + Math.floor(Math.random() * (SEGS.length - 1))]);
    setZoom(+(1.4 + Math.random() * 1.8).toFixed(2));
    setSpeed(4 + Math.floor(Math.random() * 20));
    setPaused(false);
    navigate(studioHref(p.id, { m: mirrors, z: zoom, s: speed }), 'replace');
  }
  async function save(): Promise<void> {
    const size = parseInt(sizeSel.value, 10) || 2048;
    status.textContent = `Rendering ${size} px…`;
    (saveBtn as HTMLButtonElement).disabled = true;
    try {
      const blob = await k.exportPNG(size);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `surfaces-${String(cur.no).padStart(3, '0')}-${mirrors}m.png`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      status.textContent = `Saved ${a.download}`;
    } catch (err) {
      status.textContent = `Could not export: ${(err as Error).message}`;
    } finally { (saveBtn as HTMLButtonElement).disabled = false; }
  }
  async function copyLink(): Promise<void> {
    const url = shareUrl();
    try { await navigator.clipboard.writeText(url); status.textContent = 'Link copied to clipboard'; }
    catch { status.textContent = url; }
  }

  function showPhoto(): void {
    const n = list.length, i = pos();
    posEl.textContent = `${label(cur)} — ${i + 1} of ${n} · ${tag || 'All materials'}`;
    k.el.setAttribute('aria-label', `Kaleidoscope made from ${altText(cur)}, ${mirrors} mirrors`);
    k.set({ seed: cur.seed });
    k.setImage(imageUrl(cur, 'tex')).catch((err) => { status.textContent = (err as Error).message; });
    bg.src = imageUrl(cur, 'medium');
    srcThumb.style.backgroundImage = `url(${blurhashUrl(cur)})`;
    srcThumb.style.backgroundColor = cur.color;
    srcThumb.replaceChildren(picture(cur, 'thumb', { lazy: false, alt: `Source photograph: ${altText(cur)}` }));
    srcNo.textContent = `SOURCE · ${label(cur)}`;
    srcTitle.textContent = cur.title || label(cur);
    srcTags.textContent = tagline(cur);
    document.title = `${cur.title ? cur.title + ' · ' : ''}${label(cur)} — ${m.site.name} Studio`;
    buildFilm();
  }
  function buildFilm(): void {
    film.replaceChildren();
    const n = list.length, span = Math.min(n, 13), i = pos();
    for (let j = 0; j < span; j++) {
      const p = list[(i - Math.floor(span / 2) + j + n * 2) % n];
      const isCur = p.id === cur.id;
      const b = h('button', { type: 'button', role: 'listitem', 'aria-current': isCur ? 'true' : 'false', 'aria-label': `${label(p)}${p.title ? ', ' + p.title : ''}`, style: `background:${p.color}`,
        onclick: () => { if (!isCur) navigate(studioHref(p.id, { tag, m: mirrors, z: zoom, s: speed }), 'replace'); } },
        picture(p, 'thumb', { alt: '' }));
      film.append(b);
      if (isCur) requestAnimationFrame(() => b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }));
    }
  }

  el.addEventListener('keydown', (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });

  setPaused(false);
  showPhoto();

  return {
    el,
    mounted() { window.scrollTo(0, 0); },
    update(r) {
      tag = r.tag && Object.keys(m.tags).some((t) => t.toLowerCase() === r.tag!.toLowerCase()) ? r.tag : null;
      list = filterPhotos(m, tag);
      const next = m.photos.find((p) => p.id === r.id);
      const changed = !!next && next.id !== cur.id;
      if (next) cur = next;
      if (r.m != null) setMirrors(r.m);
      if (r.z != null) setZoom(r.z);
      if (r.s != null) setSpeed(r.s);
      if (changed) showPhoto();
      else { posEl.textContent = `${label(cur)} — ${pos() + 1} of ${list.length} · ${tag || 'All materials'}`; buildFilm(); }
      syncUrl();
    },
    destroy() { k.destroy(); el.remove(); },
  };
}
