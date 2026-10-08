import '@fontsource/big-shoulders-display/800';
import '@fontsource/big-shoulders-display/900';
import '@fontsource/instrument-sans/400';
import '@fontsource/instrument-sans/500';
import '@fontsource/instrument-sans/600';
import '@fontsource/ibm-plex-mono/400';
import '@fontsource/ibm-plex-mono/500';
import './styles.css';
import type { Manifest } from './types';
import { loadManifest, heroPhoto, IMAGE_BASE } from './data';
import { h } from './ui';
import { renderHome, scrollToId, type View } from './home';
import { renderStudio, type StudioView } from './studio';
import * as router from './router';

const app = document.getElementById('app')!;
app.append(h('p.loading', {}, 'Loading the archive…'));

function header(m: Manifest): HTMLElement {
  const hero = heroPhoto(m);
  const goto = (id: string) => (e: Event) => {
    e.preventDefault();
    if (router.parse().name === 'home') scrollToId(id);
    else router.navigate(`/#${id}`);
  };
  return h('header.site-header.wrap', {},
    h('div.brand', {}, h('a.wordmark', { href: '/', 'aria-label': `${m.site.name} home` }, m.site.name), h('span.mono-up', {}, m.site.tagline)),
    h('nav.site-nav', { 'aria-label': 'Main' },
      h('a', { href: '/#spectrum', onclick: goto('spectrum') }, 'Spectrum'),
      h('a', { href: '/#index', onclick: goto('index') }, 'Index'),
      h('a.nav-studio', { href: router.studioHref(hero.id) }, 'Studio'),
    ),
  );
}

loadManifest().then((m) => {
  app.replaceChildren(header(m));
  const slot = h('div');
  app.append(slot);
  let view: View | StudioView | null = null;
  let viewName = '';

  router.onRoute((route, nav) => {
    if (route.name === 'studio') {
      if (viewName === 'studio' && view) { (view as StudioView).update(route); return; }
      view?.destroy();
      view = renderStudio(m, route); viewName = 'studio';
      slot.append(view.el);
      view.mounted();
      if (nav === 'push') (view.el as HTMLElement).focus({ preventScroll: true });
    } else {
      if (viewName === 'home' && view) {
        // Same view: only the hash/query changed (nav link or Back to a different filter)
        if (location.hash) scrollToId(location.hash.slice(1));
        return;
      }
      view?.destroy();
      view = renderHome(m, route.tag, nav === 'pop'); viewName = 'home';
      slot.append(view.el);
      view.mounted();
    }
  });
  router.interceptLinks(app);
  router.start();
}).catch((err: Error) => {
  app.replaceChildren(h('div.error', {},
    h('h2', { style: 'font-size:40px; margin-bottom:16px' }, 'Archive unavailable'),
    h('p', {}, `The manifest could not be loaded from `, h('code', {}, IMAGE_BASE), '.'),
    h('p', { style: 'margin-top:12px; color:var(--muted); font-size:14px' }, 'Run the image pipeline (npm run images) for local development, or set VITE_IMAGE_BASE to the image host for production builds.'),
    h('p', { style: 'margin-top:12px; font-family:var(--mono); font-size:12px; color:var(--muted)' }, err.message),
  ));
});
