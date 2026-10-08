# Surfaces — a texture archive

A static site that showcases ~320 close-up texture photographs with colour-based navigation
(the **Spectrum** ribbon), material filters, a paged **Index** grid, and a WebGL **Studio** that
folds any photograph into a live kaleidoscope with PNG export and shareable links.

Design brief: [`docs/SPEC.md`](docs/SPEC.md). Reference prototype: [`prototype/`](prototype/) (not shipped).

## How it fits together

```
Textures/              source photos (read-only; never modified, never committed)
content/site.json      site name, footer, accent, spectrum bands + neutral threshold
content/photos.yaml    per-photo overrides: title, tags, hidden, featured, hue, prefer
scripts/build-images   Textures -> generated/ (derivatives + manifest.json + report.md)
scripts/contact-sheet  generated/contact-sheet.jpg to eyeball the hue sort
scripts/upload-r2      sync generated/ to a Cloudflare R2 bucket (the image host)
generated/             git-ignored output: sliver/ thumb/ medium/ tex/ + manifest.json
src/                   the site (Vite + TypeScript, no framework)
public/_redirects      Cloudflare Pages SPA fallback for /studio/*
```

The site is fully static. At runtime it fetches `manifest.json` and images from `VITE_IMAGE_BASE`
(the R2 bucket's custom domain in production, `/generated` served by Vite locally). Nothing is
converted on the fly: all derivatives are prepared once on your machine and uploaded.

Derivatives per photo (WebP + JPEG fallback, EXIF/GPS stripped, EXIF orientation applied, sRGB):

| name     | long edge | used for                                          |
|----------|-----------|---------------------------------------------------|
| `sliver` | 160 px    | Spectrum ribbon slivers                           |
| `thumb`  | 400 px    | grid cards, preview panel, filmstrip, source thumb |
| `medium` | 1200 px   | blurred studio backdrop                           |
| `tex`    | 2048² crop| kaleidoscope texture (power of two)               |
| `large`  | 2400 px   | optional (`--large`)                               |

## Setup (Windows PowerShell)

Requires Node 20+ (tested on Node 24). No ImageMagick, Python or RAW tools needed: CR2 files are
read via their full-size embedded JPEG.

```powershell
cd C:\Projects\TexturesGallery
npm install
```

## Build the images

```powershell
npm run images            # incremental: only new/changed source files are reprocessed
npm run images:force      # rebuild everything
npm run contact-sheet     # writes generated/contact-sheet.jpg (hue-sorted overview)
```

Afterwards read `generated/report.md`: it lists collapsed variant groups (`_Original`, `-EDIT`,
`-01`), possible near-duplicates, decode errors and the spectrum band sizes. To change a decision,
edit `content/photos.yaml` (documented inline) and rerun `npm run images` (fast: only the manifest
is rewritten).

Flags: `--large` (extra 2400 px derivative), `--avif` (AVIF alongside WebP; slow).

## Run locally

```powershell
npm run dev               # http://localhost:5173, images served from ./generated
npm run build             # production build in dist/
npm run preview           # serve dist/ locally (still uses ./generated for images)
npm run typecheck
```

## Deploy

### 1. Images → Cloudflare R2

1. Cloudflare dashboard → **R2** → *Create bucket* (e.g. `surfaces-images`), location automatic.
2. Bucket → **Settings** → *Custom domains* → add `img.textures.lttl.info` (the `lttl.info` zone must
   be on Cloudflare; the DNS record is created for you). Public access via the custom domain is
   enough; the `r2.dev` URL can stay disabled.
3. Bucket → **Settings** → *CORS policy* → paste (the kaleidoscope reads pixels from a different
   origin, so WebGL needs CORS):
   ```json
   [{ "AllowedOrigins": ["https://textures.lttl.info", "http://localhost:5173", "http://localhost:4173"],
      "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400 }]
   ```
4. R2 → *Manage R2 API tokens* → create a token with **Object Read & Write** on this bucket.
   Copy `.env.example` to `.env` and fill in `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
5. Upload (incremental, compares MD5 so re-runs only send changed files):
   ```powershell
   npm run upload -- --dry-run
   npm run upload
   ```
   Images are sent with a one-year immutable cache header; `manifest.json` with five minutes.
   Repeat `npm run images` + `npm run upload` whenever you add photos or edit `content/`.

Why R2 and not the git repo: the derivatives are ~1 GB, Cloudflare Pages has a 25 MB per-file
limit and no Git LFS, and R2 has free egress with 10 GB of free storage.

### 2. Site → Cloudflare Pages (from GitHub)

1. Push this repo to GitHub (`generated/`, `.env` and `node_modules/` are git-ignored).
2. Cloudflare → **Workers & Pages** → *Create* → *Pages* → connect the repo.
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `VITE_IMAGE_BASE = https://img.textures.lttl.info`
   - Node version: set `NODE_VERSION = 20` (or newer) if the default is older.
3. Project → **Custom domains** → add `textures.lttl.info`.
4. `public/_redirects` makes `/studio/<id>` resolve to the app (SPA fallback).

Every push to the production branch redeploys the site. Image changes never need a deploy, only
`npm run upload`.

## Editing content

`content/site.json`: site name/tagline, footer lines, accent colour, hero eyebrow tags, fixed
featured photo id (else a random one per visit), neutral-chroma threshold and spectrum bands.

`content/photos.yaml` (keyed by source file stem):

```yaml
20221017_143414:
  title: Crazed paint over rust
  tags: [Paint, Rust]
  featured: true
20221012_171612:
  hidden: true            # near-duplicate of 20221012_171623
IMG_2569:
  hue: neutral            # force into the Neutrals band
```

Filter chips appear only for tags that occur; with no tags the filter row is hidden.
Untitled photos show as `No. 042`; titles are never invented by the pipeline.

## Studio URL parameters

`/studio/<id>?m=12&z=1.80&s=12&tag=rust` — mirrors, magnify, turn speed (°/s), and the active
filter (which drives prev/next and the filmstrip). **Copy link** produces this URL; **Save image**
renders the current frame at 2048 or 4096 px to `surfaces-<no>-<mirrors>m.png`.

## Accessibility and performance notes

- All controls are real buttons/links with labels; visible focus ring; targets ≥ 44 px.
- The ribbon is one tab stop; ←/→, Home/End, PageUp/PageDown move between slivers; Enter opens.
- Touch: first tap previews a sliver, second tap opens it.
- `prefers-reduced-motion`: no rotation or drift (pointer steering still works).
- Kaleidoscopes stop rendering when off-screen, when the tab is hidden, or when paused and settled.
- Home loads only slivers (≈1 MB for the whole ribbon) and lazy thumbs; `tex` is loaded only for the
  hero kaleidoscope and in the Studio.
