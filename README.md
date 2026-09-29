# Anima Vena AR

Web AR for the painting: 8th Wall engine (self-hosted, free) + three.js.
Point a phone at the painting → the eye and sparks appear on top of it.

## Files
- `index.html`, `app.js` – the page and AR logic
- `full-window-canvas.js` – keeps the camera feed full-screen and sharp (ported from 8th Wall XRExtras, MIT)
- `models/eye.glb`, `models/sparks.glb` – compressed models (meshopt + WebP textures)
- `targets/` – image target generated from the painting photo with `npx @8thwall/image-target-cli`
- `vendor/` – 8th Wall engine binary + three.js r160 (self-hosted, no CDN)

## Test locally
Camera needs HTTPS or localhost. From this folder: `npx serve .` then open on the computer,
or deploy (below) and open on the phone.

## Deploy (GitHub Pages + subdomain)
1. Create a repo, e.g. `LakeNichts/animavena-ar`, push the contents of this folder to `main`.
2. Repo → Settings → Pages → Source: *Deploy from a branch*, `main` / root.
3. At your domain's DNS provider add: `CNAME  ar  →  lakenichts.github.io`
4. Back in Settings → Pages: custom domain `ar.animavenastudio.com`, tick *Enforce HTTPS* (after the certificate is issued, can take up to ~1 h).
The `CNAME` file here already contains the subdomain; change it if you pick another name.

## Tuning placement
Add URL params to move/scale the eye+sparks live (units: painting height = 1):
`https://ar.animavenastudio.com/?debug=1&x=0.03&y=-0.165&z=0.02&s=0.38`
`debug=1` draws the tracked area (green) and full painting (yellow). When happy, copy the
numbers into `PLACE` in `app.js`.

## Updating models
Replace the GLB and recompress:
`npx @gltf-transform/cli optimize in.glb models/eye.glb --texture-compress webp --texture-size 1024 --compress meshopt --simplify false`
(for the sparks add `--join false --flatten false --instance false` so each spark keeps its own animation).

## License notes
8th Wall engine binary: see `vendor/8thwall/LICENSE` (the copyright notice is logged to the console as required).
three.js: MIT, `vendor/three/LICENSE`.

## Link from Shopify
`<a href="https://ar.animavenastudio.com" target="_blank" rel="noopener">View in AR</a>`
