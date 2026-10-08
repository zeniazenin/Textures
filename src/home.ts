// Home: hero with live kaleidoscope, Spectrum ribbon (fisheye), material filters, Index grid.
import type { Manifest, Photo } from './types';
import { filterPhotos, heroPhoto, imageUrl, label, tagChips, tagline, altText } from './data';
import { Kaleido } from './kaleido';
import { h, svg, icons, picture, blurhashUrl } from './ui';
import { homeHref, studioHref, replaceUrl, onLeave, savedState } from './router';

const BATCH = 48;
const pad3 = (n: number) => String(n).padStart(3, '0');

export interface View { destroy(): void; mounted(): void; el: HTMLElement }

export function renderHome(m: Manifest, routeTag: string | null, restore: boolean): View {
  const saved = restore ? savedState() : {};
  let tag: string | null = routeTag && m.tags[routeTag] !== undefined ? routeTag : (routeTag ? findTag(m, routeTag) : null);
  let list = filterPhotos(m, tag);
  let hover = -1;
  let shown = typeof saved.shown === 'number' ? saved.shown : BATCH;
  const hero = heroPhoto(m);
  let lastPointerType = 'mouse';
  let focusIdx = 0;

  // ---------------------------------------------------------------- hero
  const heroK = new Kaleido({ label: `Live kaleidoscope made from ${altText(hero)}` });
  heroK.set({ mirrors: 10, zoom: 1.7, speed: 7, seed: hero.seed });
  heroK.setImage(imageUrl(hero, 'tex')).catch(() => {});
  const heroSection = h('section.hero.wrap', { 'aria-labelledby': 'hero-title' },
    h('div.hero-copy', {},
      h('p.mono-up', { style: 'font-size:13px' }, `${m.count} surfaces · ${m.site.heroEyebrowTags}`),
      h('h1', { id: 'hero-title' }, 'Look closer at every surface.'),
      h('p.lead', {}, 'Fractured rock and lichen, peeling enamel, crazed paint and drip tags — whatever time and weather leave behind. Scan the archive by colour, filter by material, and fold any photograph into a living kaleidoscope.'),
      h('div.hero-actions', {},
        h('a.pill.pill-accent', { href: studioHref(hero.id, { tag }) }, 'Make a kaleidoscope'),
        h('a.pill.pill-outline', { href: '#spectrum', onclick: (e: Event) => { e.preventDefault(); scrollToId('spectrum'); } }, 'Browse by colour'),
      ),
    ),
    h('div.hero-visual', {},
      heroK.el,
      h('p.mono', {}, `LIVE · ${hero.title || label(hero)} · move the cursor to steer`),
    ),
  );

  // ---------------------------------------------------------------- spectrum
  const chips = tagChips(m);
  const chipRow = h('div.chips', { role: 'group', 'aria-label': 'Filter by material' });
  const chipButtons: HTMLButtonElement[] = [];
  const makeChip = (t: string | null, labelText: string, count: number) => {
    const b = h('button.chip', { type: 'button', 'aria-pressed': String((t || null) === tag), onclick: () => setTag(t) }, labelText, h('span', {}, String(count))) as HTMLButtonElement;
    (b as any)._tag = t;
    chipButtons.push(b);
    return b;
  };
  if (chips.length) {
    chipRow.append(makeChip(null, 'All', m.count));
    for (const c of chips) chipRow.append(makeChip(c.tag, c.tag, c.count));
  }

  const peekImg = h('div.peek-img');
  const peekMeta = h('p.mono');
  const peekTitle = h('p.peek-title');
  const peek = h('aside.peek', { 'aria-live': 'polite', 'aria-label': 'Hovered photograph' }, peekImg, peekMeta, peekTitle);

  const ribbon = h('div.ribbon', { role: 'group', 'aria-label': 'Spectrum: every photograph sorted by hue' });
  const axis = h('div.axis', { 'aria-hidden': 'true' });
  const ribbonScroll = h('div.ribbon-scroll', {}, ribbon);
  const ribbonWrap = h('div.ribbon-wrap', {}, ribbonScroll, axis,
    h('p.hint-touch', {}, 'Tap a sliver to preview it, tap again to open it in the Studio.'));

  const spectrumSection = h('section.section.wrap', { id: 'spectrum', 'aria-labelledby': 'spectrum-title' },
    h('div.section-head', {},
      h('div', {}, h('h2', { id: 'spectrum-title' }, 'Spectrum'), h('p.sub', {}, 'Every photograph as one sliver, sorted by its dominant hue. Sweep across to scan, click to open.')),
      chips.length ? chipRow : null,
    ),
    h('div.spectrum-body', {}, peek, ribbonWrap),
  );

  let slivers: HTMLButtonElement[] = [];
  function buildRibbon(): void {
    ribbon.replaceChildren();
    slivers = list.map((p, k) => {
      const img = document.createElement('img');
      img.src = imageUrl(p, 'sliver', 'webp');
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
      img.style.backgroundColor = p.color;
      const b = h('button.sliver', {
        type: 'button', tabindex: k === 0 ? '0' : '-1',
        'aria-label': `${label(p)}${p.title ? ', ' + p.title : ''}`,
        style: `background:${p.color}`,
        onpointerenter: (e: PointerEvent) => { if (e.pointerType !== 'touch') setHover(k); },
        onpointerdown: (e: PointerEvent) => { lastPointerType = e.pointerType; },
        onfocus: () => { focusIdx = k; setHover(k); },
        onclick: () => {
          if (lastPointerType === 'touch' && hover !== k) { setHover(k); return; }
          openStudio(p);
        },
      }, img) as HTMLButtonElement;
      return b;
    });
    ribbon.append(...slivers);
    ribbon.style.minWidth = `max(100%, ${list.length * 3}px)`;
    applyFisheye();
    buildAxis();
  }
  // Hide axis labels that would overlap their left neighbour (narrow screens / small bands).
  function declutterAxis(): void {
    const labels = [...axis.children] as HTMLElement[];
    let prevRight = -Infinity;
    for (const l of labels) {
      l.style.visibility = '';
      const r = l.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.left < prevRight + 8) l.style.visibility = 'hidden';
      else prevRight = r.right;
    }
  }
  function buildAxis(): void {
    axis.replaceChildren();
    queueMicrotask(declutterAxis);
    if (!tag) {
      for (const b of m.bands) {
        const s = h('span', {}, b.label);
        const pct = b.start * 100;
        if (pct > 88) s.style.right = '0'; else s.style.left = `${pct.toFixed(2)}%`;
        axis.append(s);
      }
    } else {
      // Filtered list: recompute band positions from the photos actually shown.
      const bandOf = (p: Photo) => p.neutral ? 'Neutrals' : bandLabel(m, p);
      let prev = '';
      list.forEach((p, i) => {
        const bl = bandOf(p);
        if (bl !== prev) { const s = h('span', {}, bl); const pct = (i / list.length) * 100; if (pct > 88) s.style.right = '0'; else s.style.left = `${pct.toFixed(2)}%`; axis.append(s); prev = bl; }
      });
    }
  }
  function applyFisheye(): void {
    const n = list.length;
    const sigma = Math.max(1.6, n / 60), boost = n > 40 ? 18 : 1.5;
    for (let k = 0; k < n; k++) {
      let g = 1;
      if (hover >= 0) { const d = k - hover; g = 1 + boost * Math.exp(-(d * d) / (2 * sigma * sigma)); }
      slivers[k].style.flexGrow = g.toFixed(3);
      slivers[k].classList.toggle('is-active', k === hover);
    }
    ribbon.classList.toggle('is-hovered', hover >= 0);
  }
  function setHover(k: number): void {
    if (k === hover) return;
    hover = k;
    applyFisheye();
    updatePeek(k >= 0 ? list[k] : hero);
  }
  function updatePeek(p: Photo): void {
    peekImg.replaceChildren(picture(p, 'thumb', { lazy: false, alt: altText(p) }));
    peekImg.style.backgroundImage = `url(${blurhashUrl(p)})`;
    peekImg.style.backgroundColor = p.color;
    peekMeta.textContent = `${label(p)} · ${tagline(p)}`;
    peekTitle.textContent = p.title || '';
  }
  const onResize = () => declutterAxis();
  window.addEventListener('resize', onResize);
  ribbon.addEventListener('pointerleave', () => setHover(-1));
  ribbon.addEventListener('keydown', (e: KeyboardEvent) => {
    const n = list.length; if (!n) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = Math.min(n - 1, focusIdx + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, focusIdx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'PageDown') next = Math.min(n - 1, focusIdx + 10);
    else if (e.key === 'PageUp') next = Math.max(0, focusIdx - 10);
    if (next < 0) return;
    e.preventDefault();
    slivers[focusIdx].tabIndex = -1; slivers[next].tabIndex = 0; slivers[next].focus();
  });
  ribbon.addEventListener('focusout', (e: FocusEvent) => { if (!ribbon.contains(e.relatedTarget as Node)) setHover(-1); });

  // ---------------------------------------------------------------- index
  const countEl = h('p.mono', { style: 'font-size:13px' });
  const grid = h('div.grid', { role: 'list' });
  const moreRow = h('div.more-row');
  const indexSection = h('section.section.wrap', { id: 'index', 'aria-labelledby': 'index-title' },
    h('div.section-head', {}, h('h2', { id: 'index-title' }, 'Index'), countEl),
    grid, moreRow,
  );
  function card(p: Photo): HTMLElement {
    const ph = h('div.ph', { style: `background:${p.color}` }, picture(p, 'thumb', { alt: '' }),
      h('div.ov', { 'aria-hidden': 'true' }, svg(icons.hexagon, 16, 1.6), 'Kaleidoscope'));
    const a = h('a.card', { href: studioHref(p.id, { tag }), role: 'listitem', 'aria-label': `Open ${label(p)}${p.title ? ', ' + p.title : ''}, in the kaleidoscope studio` },
      ph, h('div.card-meta', {}, h('span.mono', {}, `${label(p)} · ${tagline(p)}`), p.title ? h('span.card-title', {}, p.title) : null));
    return a;
  }
  function buildGrid(): void {
    grid.replaceChildren(...list.slice(0, shown).map(card));
    const remaining = list.length - Math.min(shown, list.length);
    countEl.textContent = `${tag || 'All materials'} · showing ${Math.min(shown, list.length)} of ${list.length}`;
    moreRow.replaceChildren();
    if (remaining > 0) {
      const nb = Math.min(BATCH, remaining);
      moreRow.append(h('button.pill.pill-outline', { type: 'button', style: 'font-size:15px', onclick: () => { const first = grid.children.length; shown += BATCH; buildGrid(); (grid.children[first] as HTMLElement)?.querySelector('a, [tabindex]'); (grid.children[first] as HTMLElement)?.focus?.(); } }, `Show ${nb} more`));
    }
  }

  function setTag(t: string | null): void {
    tag = t;
    list = filterPhotos(m, tag);
    hover = -1; shown = BATCH; focusIdx = 0;
    for (const b of chipButtons) b.setAttribute('aria-pressed', String(((b as any)._tag || null) === tag));
    replaceUrl(homeHref(tag));
    buildRibbon(); buildGrid(); updatePeek(hero);
    heroSection.querySelector('a.pill-accent')?.setAttribute('href', studioHref(hero.id, { tag }));
  }
  function openStudio(p: Photo): void {
    const a = document.createElement('a'); a.href = studioHref(p.id, { tag }); a.hidden = true;
    document.body.append(a); a.click(); a.remove();
  }

  // ---------------------------------------------------------------- footer
  const f = m.site.footer;
  const footer = h('footer.site-footer.wrap', {},
    h('span', {}, f.copyright),
    f.contactUrl ? h('a', { href: f.contactUrl, rel: 'me noopener', target: '_blank' }, f.contact) : h('span', {}, f.contact),
  );

  const el = h('main', { id: 'main', tabindex: '-1' }, heroSection, spectrumSection, indexSection, footer);
  buildRibbon(); buildGrid(); updatePeek(hero);
  document.title = `${m.site.name} — ${m.site.tagline}`;

  // Remember scroll + paging when leaving so Back restores them.
  const leave = () => ({ scrollY: window.scrollY, shown });
  onLeave(leave);
  const place = () => {
    if (restore && typeof saved.scrollY === 'number') window.scrollTo(0, saved.scrollY);
    else if (location.hash) scrollToId(location.hash.slice(1), 'auto');
    else window.scrollTo(0, 0);
  };

  return {
    el,
    mounted() { place(); requestAnimationFrame(place); },
    destroy() { heroK.destroy(); window.removeEventListener('resize', onResize); el.remove(); },
  };
}

function findTag(m: Manifest, t: string): string | null {
  const k = Object.keys(m.tags).find((x) => x.toLowerCase() === t.toLowerCase());
  return k || null;
}
function bandLabel(m: Manifest, p: Photo): string {
  // Bands in the manifest are positions in the full list; map via the photo's position.
  const idx = m.photos.indexOf(p) / m.photos.length;
  let lbl = m.bands[0]?.label || '';
  for (const b of m.bands) if (idx >= b.start) lbl = b.label;
  return lbl;
}
export function scrollToId(id: string, behavior: ScrollBehavior = 'smooth'): void {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior, block: 'start' });
}
export { pad3 };
