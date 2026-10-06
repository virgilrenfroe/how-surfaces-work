# How Surfaces Work

A materials lab for art, design, and intro materials science — by Virgil Renfroe.

**Live preview:** https://how-surfaces-work-production.up.railway.app/

GitHub Pages (same source): https://virgilrenfroe.github.io/how-surfaces-work/  
Repo: https://github.com/virgilrenfroe/how-surfaces-work

Lesson 01 at `/`. Lesson 03 at `/sheen/`. Single-page three.js exhibits. One shared WebGL context; specimens render via scissor/viewport into DOM regions (three.js multiple-elements pattern).

## Specimens

1. **MatCap** — procedural chrome / satin / clay lookups
2. **PBR MeshStandardMaterial** — RoomEnvironment + PMREM; roughness/metalness
3. **MeshPhysicalMaterial** — clearcoat car paint + anisotropic brushed metal
4. **Centerpiece** — MatCap vs PBR under a shared orbiting light

## Local

```bash
python3 -m http.server 8877
```

## Stack

- three.js `0.170.0` (CDN import map)
- Google Fonts: Bricolage Grotesque, Instrument Sans, Space Mono
- No backend, no HDR downloads
- Hosted on Railway (Caddy static) with GitHub Pages as the matching virgilrenfroe pattern when available

## Technical notes (moved out of the learner UI)

These used to appear as on-page copy. The page now speaks only to students and teachers. The details live here.

- **Stack:** three.js 0.170 via CDN import map. Static `index.html` + `main.js`.
- **One shared WebGL canvas** (`canvas#c`, fixed, full viewport). Each specimen, plus the hero, is a scissor/viewport region aligned to a DOM `.view[data-scene]` box (three.js multiple-elements pattern). There is no second canvas or context.
- **Hero:** Chrome PBR torus knot. Rendered into a small render target (320 px wide, sized to the hero aspect), then drawn into the hero scissor region with a fullscreen-quad glyph/halftone shader tinted coral #ff5a1f. A reveal edge (slow sweep, or pointer drag/hover) shows the true PBR render. The post pass disables tone mapping, so ACES runs only once.
- **DPR cap:** about 1.5 on mobile/coarse pointers and about 2 on desktop.
- **Offscreen skip:** a region whose DOM box is outside the viewport is not drawn. This includes the hero once you scroll past it.
- **Visibility:** the animation loop pauses while the tab is hidden.
- **Reduced motion:** a live `prefers-reduced-motion` listener stops auto-rotation and orbit lights, freezes the hero sweep at a static frame, and pauses the CSS ticker.
- **Colour:** ACES Filmic tone mapping with sRGB output. Sliders listen to both `input` and `change`.
- Specimen 02 lights with a procedural three.js `RoomEnvironment` prefiltered via PMREM; no HDR file is downloaded.
- **QA hooks:** `window.__HSW` (and `window.__HTW` on Textures) exposes renderer, scenes, shared state, frameCount, heroPost, and webglContexts() for `qa.mjs` (Playwright). Run it with `HSW_URL=<url> node qa.mjs`. It checks a single canvas, a non-blank hero, specimen rendering, controls, scissor alignment, anchors, fonts, offscreen skip, reduced motion, and visibility.
- **Hosting:** Railway (Caddy static Dockerfile + Caddyfile + railway.toml), project `how-surfaces-work`.
- **Workflow (from now on):** new lesson work goes on a branch with a GitHub PR and a separate preview deploy, not straight to `main`/production.

## Lesson 03 — How Soft Surfaces Shimmer (`/sheen/`)

Same static hosting pattern. Accent: violet `#b388ff` + cyan `#5ce1e6`.

### Specimens
1. **Sheen** — cushion + sphere; `sheen`, `sheenRoughness`, `sheenColor`
2. **Iridescence** — thin-film sphere; `iridescence`, `iridescenceIOR`, `iridescenceThicknessRange`
3. **Soft transmission** — wax/jade/milky plastic; `transmission`, `thickness`, `attenuationColor` / `attenuationDistance` (not clear glass)
4. **Centerpiece** — sheen vs iridescence vs plain satin under a shared view-angle slider / auto-orbit

### Technical notes (learner UI stays clean)
- One shared canvas (`#c`); scissor/viewport regions; hero glyph reveal tinted violet.
- DPR cap ~1.5 mobile / ~2 desktop; offscreen skip; pause when tab hidden; live `prefers-reduced-motion`.
- ACES + sRGB; RoomEnvironment via PMREM; no HDR downloads.
- Sliders bind both `input` and `change`. Specimens use `scroll-margin-top`.
- QA hooks: `window.__HSW` on `/sheen/` (same shape as Lesson 01).
- Preview workflow: branch + PR + separate Railway preview service — do not merge straight to production.



## Lesson 09 — How Soft Bodies Glow Inside (`/scatter/`)

Accent: warm peach `#ff8f6b` + amber `#ffc49a`.

### Specimens
1. **Scatter distance** — wax vs opaque plastic under backlight
2. **Thin vs thick** — torus rim vs ball; thin parts glow more
3. **Warm tint** — attenuation color from white toward red-orange

### Notes
- MeshPhysicalMaterial transmission + attenuationDistance / attenuationColor.
- QA: `HSW_URL=<url> PW_ROOT=/workspace/materials-demo node qa-scatter.mjs`
- Preview: Railway `how-surfaces-work-l09-preview` on `lesson-09-scatter`.
