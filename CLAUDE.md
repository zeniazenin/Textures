# TexturesGallery — "Surfaces"

A static website that showcases ~320 texture photographs (urban **and** natural) with colour-based navigation and an interactive kaleidoscope studio.

## Start here
1. Read `docs/SPEC.md` in full — it is the build brief (features, pipeline, kaleidoscope math, design tokens, acceptance checklist).
2. Look at `prototype/Main.dc.html` and `prototype/Kaleido.dc.html` — the approved interactive design. They are reference only (design-tool format, not runnable here); match their layout, copy and behaviour.
3. Before making taxonomy, naming, titling or hosting decisions, ask the owner the open questions in SPEC §10. The stack is your call — propose it briefly, then proceed.

## Hard rules
- `Textures/` is the read-only source library. Never modify, rename, move or delete anything in it.
- Derived images and the manifest go to a git-ignored output folder; never commit generated images.
- Strip EXIF (especially GPS) from every published image.
- Don't invent photo titles or facts in data; leave fields empty for the owner to fill.
- Dev machine is Windows: give PowerShell commands, keep tooling cross-platform, watch path separators.

## Suggested milestones
1. Image pipeline + `manifest.json` (incl. CR2 decoding, orientation, de-duplication, hue analysis). Show the owner the hue-sorted contact sheet before building UI.
2. Home: hero, Spectrum ribbon, filters, Index grid.
3. Studio with WebGL kaleidoscope, controls, filmstrip, deep links, PNG export.
4. Accessibility/performance pass against SPEC §8–9, README, deploy.
