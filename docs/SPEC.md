# Surfaces — texture gallery + kaleidoscope: implementation spec

Status: design approved as a clickable prototype (see `prototype/`). This document is the build brief.
Working title: **Surfaces** (placeholder — owner may rename).

---

## 1. What we are building

A public, image-first website that showcases ~320 close-up photographs of textures — weathered paint, rust, graffiti, signage, **and natural surfaces** (rock, lichen, etc.; not everything is urban). Two jobs:

1. **Navigate a large library in an engaging way** — primarily by colour (a "Spectrum" ribbon), secondarily by material filter and a paged grid.
2. **Turn any photo into a live, interactive kaleidoscope** ("Studio"), with controls and export.

Non-goals for v1: user accounts, uploads by visitors, comments, CMS UI, e-commerce.

## 2. The source library (already in this repo)

`Textures/` is the **read-only source of truth**. Never modify, rename, move or delete anything in it. All derived output goes to a generated, git-ignored directory.

Facts as of handoff (re-scan; the owner may add photos):

| | |
|---|---|
| Files | 321 (281 `.JPG/.jpg`, 9 `.jpeg`, 30 `.CR2` Canon RAW, 1 `.xmp` sidecar) |
| Total size | ~2.4 GB; typical JPG 3–8 MB, one JPG is ~30 MB (`20221011_150228.jpg`), CR2s 1–40 MB |
| Orientation | Many phone shots are stored landscape with an EXIF rotation tag — **apply EXIF orientation** before anything else |
| RAW | CR2 files need decoding (e.g. libraw / rawpy / dcraw, or extract the embedded full-size JPEG preview). `IMG_2569.xmp` is a Lightroom sidecar for `IMG_2569.CR2` — honouring its edits is optional; at minimum don't treat it as a photo |
| Variants / duplicates | Exact pairs where both versions exist: `20221017_143414` + `_Original`, `20231002_191536` + `-EDIT`, `OI000030` + `-01`, `P2190417` + `-01`. Default rule: when a base file and a variant of the same stem exist, publish **one** — prefer the edited version (`-EDIT`, `-01`, the non-`_Original` file). Files that only exist as `_Original` / `-01` / `(n)` are standalone photos. Make this overridable in the metadata file |
| Privacy | Phone photos carry GPS EXIF. **Strip all EXIF (esp. GPS) from published derivatives.** Keep capture date in the manifest only |

## 3. Architecture (stack is Claude Code's call)

Constraints that should drive the choice:
- Must be deployable as a **static site** (no server needed at runtime). Build-time image processing is fine and expected.
- The only heavy runtime piece is the kaleidoscope renderer (WebGL recommended, §6).
- Runs on Windows for local development (owner's machine). Prefer cross-platform tooling; document setup commands for PowerShell.
- Keep dependencies modest; no UI framework is required by the design.

Suggested shape (adapt freely):
```
/Textures                 # source photos (read-only)
/content/photos.yaml      # human-edited metadata overrides (titles, tags, hidden, featured, variant choices)
/scripts/build-images.*   # pipeline: Textures -> generated derivatives + manifest
/generated/               # git-ignored: images + manifest.json
/src/…                    # site
/prototype/               # design reference (do not ship)
```

## 4. Image pipeline (build step)

Idempotent and incremental (cache by source path + mtime + size; only reprocess changed files). For each published photo:

1. Decode (JPEG or RAW), apply EXIF orientation, convert to sRGB.
2. Derivatives (sizes are long-edge targets; tune as needed):
   - `thumb` ~400 px (grid cards, ribbon slivers, filmstrip)
   - `medium` ~1200 px (preview panel, studio source thumbnail, blurred studio backdrop)
   - `tex` ~2048 px **square centre crop** (kaleidoscope texture; power-of-two friendly)
   - `large` ~2400 px (optional full-view / export source)
   - Formats: AVIF or WebP with JPEG fallback. Strip metadata.
3. Analysis, stored in the manifest:
   - `color`: mean RGB hex (placeholder background while images load).
   - `hue`: **saturation-weighted circular mean hue** — for each pixel of a ~64×64 downsample, convert to HSL, weight = S·(1−|2L−1|) (i.e. chroma), accumulate weight·cos(h), weight·sin(h); hue = atan2. This is what makes stone with a red tag sort near reds instead of grey.
   - `chroma`: total weight / pixel count. Photos below a threshold (tune, start ~0.06) are **neutral** and sort into a separate "Neutrals" band at the end of the spectrum, ordered by lightness.
   - `lightness`, `aspect`, `width`, `height`, `takenAt` (EXIF date, else from filename `YYYYMMDD_HHMMSS`), a tiny LQIP/blurhash.
4. Write `manifest.json`: array of photos with stable `id` (slug of the source stem), `no` (1-based index in spectrum order, displayed as `No. 042`), derived URLs, analysis fields, merged metadata.

Metadata overrides (`content/photos.yaml`, keyed by source stem): `title`, `tags[]`, `hidden`, `featured`, `hue` (manual override), `prefer` (variant choice). Missing title → leave empty in data, UI shows `No. 042` only. **Never invent titles** in data.

Material tags: the taxonomy is an open question for the owner (§10). Until set, filter chips render only for tags that actually occur; with zero tags, hide the filter row. Suggested starting set mixing urban and natural: Paint, Rust, Graffiti, Signage, Paper, Stone, Wood & bark, Lichen & plant, Water & ice, Earth & sand.

## 5. Site: screens and behaviour

The prototype (`prototype/Main.dc.html`) is the reference for layout, copy and interaction. Everything below should match it unless noted.

### 5.1 Global
- Dark gallery look; header with wordmark "SURFACES" + "A texture archive", nav: Spectrum, Index (scroll links on home) and a pill **Studio** button (accent).
- Routes (suggested): `/` home (hero + spectrum + index), `/studio/:id` (+ query `?m=12&z=1.8&s=12` for mirrors/zoom/speed so a kaleidoscope is shareable). Back from studio returns to the previous scroll position and filter.
- Filter state lives in the URL (`?tag=rust`) so it survives navigation and is linkable.

### 5.2 Hero
- Eyebrow (mono): `{count} surfaces · stone · rust · paint · paper` — count from the manifest.
- H1: "Look closer at every surface." Body: "Fractured rock and lichen, peeling enamel, crazed paint and drip tags — whatever time and weather leave behind. Scan the archive by colour, filter by material, and fold any photograph into a living kaleidoscope."
- Buttons: **Make a kaleidoscope** (opens Studio with the featured photo) and **Browse by colour** (scroll to Spectrum).
- Right: a live kaleidoscope (10 mirrors, zoom 1.7, 7°/s) of the `featured` photo (or a random one per visit), caption `LIVE · {title or No.} · move the cursor to steer`. Must not hog the CPU: pause rendering when off-screen (IntersectionObserver) or the tab is hidden.

### 5.3 Spectrum ribbon (signature navigation)
- Every photo (after filter) is one vertical sliver, 360 px tall, 1 px gaps, ordered by hue (reds → ochres → greens/teals → blues → violets → then neutrals).
- **Fisheye on hover**: slivers have `flex-grow` = `1 + B·exp(−d²/2σ²)` where d = distance in items from the hovered index, σ = max(1.6, n/60), B = 18 when n > 40 else 1.5. Animate flex-grow ~280 ms ease-out. Non-hovered slivers desaturate/darken slightly while the ribbon is hovered.
- Left panel (≈220 px) shows the hovered photo (3:4), `No. ### · tags`, title; defaults to the featured photo. `aria-live="polite"`.
- Click a sliver → Studio for that photo.
- Axis labels under the ribbon (mono, uppercase): Reds · Ochres · Teals · Blues · Violets (+ Neutrals if present). Ideally positioned at the actual hue boundaries.
- Touch / narrow screens: ribbon gets `min-width: max(100%, n×3px)` inside a horizontal scroller; tap opens Studio (consider tap-to-preview, second tap to open). Keyboard: slivers are buttons; consider a roving tabindex so the ribbon is a single tab stop with ←/→ to move.
- Use `thumb` derivatives; each sliver shows a vertical slice of the photo (object-fit cover).

### 5.4 Filters
- Pill chips with counts: `All 321`, then one per tag. Active chip = accent fill with dark text. Selecting a filter resets the hover and the grid paging. Filters apply to both ribbon and index.

### 5.5 Index grid
- Responsive grid `repeat(auto-fill, minmax(min(200px,100%),1fr))`, gap 28/20 px, cards 3:4 with 4 px radius, lazy-loaded thumbs, colour placeholder.
- Caption: mono `No. 042 · Rust / Paint` + title (if any).
- Hover: image scales 1.06 over 700 ms; a "Kaleidoscope" pill with a hexagon icon fades in bottom-left.
- Paging: first 48, "Show 48 more" button (or infinite scroll with a sentinel — either is fine). Header right shows `{filter} · showing X of Y`.

### 5.6 Studio
- Top bar: back button "← Archive", centre mono `No. 042 — 17 of 96 · {filter}`, prev/next round buttons (also ←/→ keys while focus is within the studio; no global key handlers that hijack typing).
- Stage (left, flexible): dark panel, min-height 640 px, the photo blurred (70 px, saturate 1.3, 38% opacity) behind; kaleidoscope disc up to 680 px.
- Controls (right, 300–420 px):
  - Source thumbnail + `SOURCE · No. 042` + title + tags.
  - **Mirrors**: 6 / 8 / 10 / 12 / 16 / 24 segmented buttons (default 12).
  - **Magnify** range 1.2–4.0 step 0.05 (default 1.8), value shown as `1.80×`.
  - **Turn speed** range 0–60 °/s (default 12), `still` at 0.
  - **Pause/Play** toggle and **Surprise me** (random photo, mirrors from 8–24, zoom 1.4–3.2, speed 4–24).
  - Helper text: "Move across the kaleidoscope to slide the photograph beneath the mirrors."
  - **New vs prototype — add:** **Save image** (PNG export at 2048 px, optionally 4096) and **Copy link** (URL with params).
- Below: "Neighbours on the spectrum" filmstrip — the 13 photos around the current one in the current (filtered) order, current one outlined in accent, others at 60% opacity.

## 6. Kaleidoscope engine

Reference implementation: `prototype/Kaleido.dc.html` (CSS clip-path wedges — correct visually but too heavy for production; re-implement as a WebGL fragment shader with a Canvas2D fallback).

Inputs: `texture` (the `tex` derivative), `mirrors` N (even, 4–32), `zoom` z (1.2–4), `speed` (°/s), `paused`, `seed` (per photo, varies the idle drift).

Model (must be preserved so the look matches):
- The disc is split into N wedges of angle 2π/N. Wedge i is the base wedge rotated by i·2π/N; **odd wedges are mirrored** across the wedge centre line, so neighbours reflect each other at shared edges (true kaleidoscope, seamless).
- Inside the base wedge, the photo is centred on the disc centre, scaled so its width = z × disc diameter, rotated by θ(t) = speed·t, and translated by an offset (ox, oy) expressed in image-width units.
- Coverage guarantee (no black gaps): |offset| ≤ lim = (0.5 − 0.5/z)·0.94.
- Offset = clamp(0.45·drift + 0.8·pointer, −1, 1) × lim per axis, where drift = (sin(t/4700 ms + 0.9·seed), cos(t/6100 ms + 1.3·seed)) and pointer ∈ [−1,1]² is the cursor position over the disc, eased toward its target with factor 0.07 per frame. Pointer keeps its last position when the cursor leaves (feels like steering).
- Circular mask; inner vignette `inset 0 0 90px rgba(0,0,0,.55)` and 1 px 10%-white rim.
- `prefers-reduced-motion: reduce` → no rotation or drift (pointer steering still works).

Shader sketch (per fragment, p = position relative to centre in disc-radius units):
```
r = length(p); if (r > 1) discard
a = atan(p.y, p.x) - (π/2)           // wedge 0 points up
w = 2π / N
k = floor((a + w/2) / w)             // wedge index
a = a - k*w                          // fold into base wedge [-w/2, w/2)
if (mod(k, 2) == 1) a = -a           // mirror odd wedges
q = r * vec2(cos(a+π/2), sin(a+π/2)) // back to cartesian in base wedge
q = rotate(q, -θ)                    // spin the source under the mirrors
uv = 0.5 + (q * 0.5 / z) - offset    // scale & pan into texture space (check signs vs prototype)
color = texture(tex, uv) * vignette(r)
```
Render at devicePixelRatio (cap at 2); stop the RAF loop when paused-and-settled, off-screen, or the tab is hidden. Export: render the same shader into an offscreen framebuffer at the export size and download as PNG named `surfaces-{no}-{N}m.png`.

## 7. Visual design tokens

| Token | Value |
|---|---|
| Background | `#131211` (stage panel `#0B0A0A`) |
| Text | `#ECE7DF`; secondary `#CFC8BE`; muted `#A39C92` |
| Lines | `rgba(236,231,223,.12)` dividers; `.22–.28` outline buttons |
| Accent | `#FF5A36` (signal orange-red); text on accent `#131211`. Alternates considered: `#4FC3B4`, `#F2C14E` |
| Display font | Big Shoulders Display 800/900, uppercase, tight leading (0.86–1.0) |
| Body font | Instrument Sans 400/500/600 |
| Meta / labels | IBM Plex Mono 400/500, 12–13 px, letter-spacing .04–.08em, often uppercase |
| Radii | 4 px images, 6 px stage & segment buttons, 999 px pills |
| Layout | max-width 1440, side padding clamp(16px, 4vw, 56px) |
| Type scale | H1 clamp(56px, 8.4vw, 132px); H2 48 px; body 16; lead 19 |

Self-host the fonts (or Google Fonts with `display=swap`). No emoji in UI; icons are 1.6–1.8 px stroke inline SVG.

## 8. Quality bars

- Accessibility: real buttons/links/labels; visible focus ring (2 px `#ECE7DF`, 3 px offset); all targets ≥ 44 px; text contrast ≥ 4.5:1; meaningful `alt` (title or "Texture photograph No. 042"); the kaleidoscope has `role="img"` + label.
- Performance: home LCP < 2.5 s on 4G; total initial image weight < 1.5 MB (thumbs only, lazy below the fold); never load `large` derivatives on the home page. 60 fps kaleidoscope on a mid-range laptop at 680 px.
- Responsive down to 360 px: hero stacks, ribbon scrolls horizontally, studio controls stack under the stage.

## 9. Acceptance checklist

- [ ] Pipeline processes every JPG/JPEG/CR2 in `Textures/`, applies orientation, dedupes variant pairs, strips EXIF, and is incremental.
- [ ] Manifest contains hue/chroma/colour for every photo; neutrals sort last.
- [ ] Spectrum fisheye, preview panel and click-through work with mouse, keyboard and touch.
- [ ] Filters + paging + URL state work.
- [ ] Studio: all controls, prev/next, filmstrip, steering, reduced motion, PNG export, shareable URL.
- [ ] Lighthouse a11y ≥ 95; no console errors; works in latest Chrome, Safari, Firefox, Edge.
- [ ] README with setup (Windows PowerShell), build, dev, deploy instructions.

## 10. Open questions for the owner (ask before deciding)

1. Final site name (currently "Surfaces") and footer: name / contact / Instagram.
2. Material tag taxonomy, and whether to auto-suggest tags (e.g. a vision-model pass at build time) for human review — owner then edits `content/photos.yaml`.
3. Titles: write them by hand, leave untitled (`No. ###` only), or generate suggestions for review?
4. Hosting target (Netlify / GitHub Pages / Cloudflare Pages / S3) and domain.
5. Should CR2 files use Lightroom edits from `.xmp` where present, or the embedded camera JPEG?
6. Featured / hero photo: fixed choice or random per visit.

## 11. About the prototype files

`prototype/*.dc.html` are in a design-tool component format: `{{name}}` holes are filled from the `renderVals()` method in the `<script type="text/x-dc">` block; `<sc-for>` / `<sc-if>` are loops/conditionals; `<dc-import name="Kaleido">` mounts `Kaleido.dc.html` as a child. They will not run standalone (they need the design tool's runtime) — read them as precise references for markup, styles, copy and interaction logic. Image URLs of the form `/_blob/<id>` point to eight sample photos hosted in the design tool; the photos themselves are among those in `Textures/`. The prototype fakes a 312-photo library by repeating those eight with different crops — the real build uses the actual library.
