# How Surfaces Work

A materials lab for art, design, and intro materials science — by Virgil Renfroe.

**Live preview:** https://how-surfaces-work-production.up.railway.app/

GitHub Pages (same source): https://virgilrenfroe.github.io/how-surfaces-work/  
Repo: https://github.com/virgilrenfroe/how-surfaces-work

Single-page three.js exhibit. One shared WebGL context; specimens render via scissor/viewport into DOM regions (three.js multiple-elements pattern).

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
