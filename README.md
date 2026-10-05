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
