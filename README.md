# Freya

**A small workshop on the web — software, hardware, and a little calm.**
Auckland, New Zealand.

### → [freya.co.nz](https://freya.co.nz)

A single static site, deployed to Cloudflare Pages, that acts as a home for a
handful of things I'm building. The root is an index; each project lives at its
own path.

---

## Projects

| Path | Project | What it is |
| --- | --- | --- |
| [`/`](https://freya.co.nz) | **Index** | The front page — a contents list linking everything below. |
| [`/freyacad`](https://freya.co.nz/freyacad) | **FreyaCAD** | Parametric solid modelling in the browser — sketch, extrude, and boolean geometry, powered by [Manifold](https://github.com/elalish/manifold) and three.js. |
| [`/stars`](https://freya.co.nz/stars) | **Star Guide** | An interactive map of the night sky — constellations, their figures, and the planets overhead. |
| [`/nextround`](https://freya.co.nz/nextround) | **NextRound** | A one-press service button for every table — guests tap, the bar knows in 84 ms. No app, no venue Wi-Fi. *(Private — access code required.)* |
| [`/zen`](https://freya.co.nz/zen) | **Æther** | A living daily companion — a generative sky that shifts with the hour, a focus timer, a breathing guide, and a private on-device journal. |
| [`/flow`](https://freya.co.nz/flow) | **Flow** | A tiny hand-typed p5.js generative-art sketch, rebuilt for the web. Original piece by [@yuruyurau](https://x.com/yuruyurau?s=11). |
| [`/sentinel`](https://freya.co.nz/sentinel) | **Shitehawk Sentinel** | An autonomous pan-tilt gull-deterrence turret — ESP32-CAM motion tracking, below-horizon laser lock, 0% AI. |

*Also deployed from this repo: [`/vpas`](https://freya.co.nz/vpas) — VPAS, precision rotary valve remanufacture.*

---

## Stack

- Static HTML / CSS / vanilla JavaScript — no build step, no framework.
- [three.js](https://threejs.org/) for 3D, [Manifold](https://github.com/elalish/manifold) (WASM) for solid geometry.
- Hosted on **Cloudflare Pages**.

## Deploy

```bash
npm install          # wrangler (dev dependency)
npm run deploy       # wrangler pages deploy . --project-name=cad
```

Each sub-page is a folder with its own `index.html` (e.g. `stars/index.html` → `/stars`),
so adding a project is just adding a folder.

---

<sub>© 2026 Freya · Auckland, New Zealand</sub>
