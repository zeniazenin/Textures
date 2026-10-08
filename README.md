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
scripts/upload-r2-api  sync generated/ to the R2 bucket via the wrangler session (npm run upload)
scripts/upload-r2      same via the S3 API with an R2 token (npm run upload:s3)
generated/             git-ignored output: sliver/ thumb/ medium/ tex/ + manifest.json
src/                   the site (Vite + TypeScript, no framework)
wrangler.jsonc         Cloudflare Worker (static assets) config: SPA fallback + custom domain
infra/r2-cors.json     CORS policy for the R2 image bucket
.github/workflows/     deploy on push to main
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

Everything below is driven by the `wrangler` CLI (no dashboard clicking except enabling R2 and
creating two tokens). One-time: `npx wrangler login`.

### 1. Site → Cloudflare Worker (static assets) at textures.lttl.info

The site is deployed as a Worker with static assets (`wrangler.jsonc`): SPA fallback for
`/studio/*` and the custom domain `textures.lttl.info` are declared there, and Cloudflare creates
the DNS record for the custom domain itself.

```powershell
$env:VITE_IMAGE_BASE = "https://img.textures.lttl.info"; npm run build; npx wrangler deploy
```

Automatic deploys from GitHub: `.github/workflows/deploy.yml` runs the same build + deploy on every
push to `main`. It needs two repository secrets, `CLOUDFLARE_API_TOKEN` (dashboard → My Profile →
API Tokens → "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`. Until those are set,
deploy manually with the command above.

### 2. Images → Cloudflare R2 at img.textures.lttl.info

R2 must be enabled once in the dashboard (R2 → Get started; the free tier needs a payment method on
file but is not charged under 10 GB). Then:

```powershell
npx wrangler r2 bucket create surfaces-images
npx wrangler r2 bucket cors set surfaces-images --file infra/r2-cors.json
npx wrangler r2 bucket domain add surfaces-images --domain img.textures.lttl.info --zone-id f03789c947d4af3d85f8fbe3c1205f8e
```

The CORS policy matters: the WebGL kaleidoscope reads pixels from the image host, which browsers
only allow for CORS-enabled responses.

Uploading goes through the Cloudflare API using the `wrangler login` session, so no extra token
is needed. It is parallel and incremental (compares MD5 against the bucket) and never deletes:

```powershell
npm run upload -- --dry-run
npm run upload
```

If the session has expired, run `npx wrangler whoami` once to refresh it. Alternative: `npm run
upload:s3` uses the S3 API with an R2 API token from `.env` (see `.env.example`), handy for CI.

Images are sent with a one-year immutable cache header; `manifest.json` with five minutes.
Repeat `npm run images` + `npm run upload` whenever you add photos or edit `content/`. Image
changes never need a site deploy.

Why R2 and not the git repo: the derivatives are ~900 MB, Workers static assets are capped at
25 MiB per file and 20k files, and R2 has free egress with 10 GB of free storage.

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
