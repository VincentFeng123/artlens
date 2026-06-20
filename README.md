# Artlens — scan an artwork, step into its world

Point your phone at a painting. Artlens recognizes it, generates the 360° world
the painting depicts, and wraps that world around you — you look around by
physically moving your phone (3DoF). Repeat scans of the same artwork load
instantly from cache.

It runs **end-to-end with zero configuration** in demo mode (a bundled,
procedurally-generated panorama), so you can try the whole loop before wiring up
any APIs.

---

## The loop

```
Enter ─▶ Scanner ─▶ capture (downscaled JPEG) ─▶ Loading ─▶ World (skybox)
  │         │                    │                              ▲
  └ camera + orientation         └─────────── scan ────────────┘
    permission on this tap          recognize → cache? → generate (async)
```

- **Frontend:** Vite + React + TypeScript + Three.js. The skybox is an inverted
  sphere with the camera at its center; an equirectangular panorama renders on
  the inside. Look-around is driven by `deviceorientation`, with automatic
  pointer-drag fallback on desktop / when motion is denied.
- **Backend:** Supabase — Postgres (+ optional pgvector), Storage, and Deno Edge
  Functions (`scan`, `job-status`). Generation is async (job + poll) and cached.
- **Recognition:** a vision LLM behind a swappable interface — **Claude**
  (default), **Gemini**, or **OpenAI**, selected by env.
- **Panorama:** **Blockade Labs Skybox AI** behind a swappable interface
  (the artwork is passed as the structure reference so the world stays faithful).

All third-party keys live **server-side only** in Edge Function secrets. The
client bundle only ever contains `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

---

## Quick start (demo mode — no keys, no backend)

```bash
npm install
npm run dev
```

The dev server is HTTPS (required for camera + gyro). Open it **on your phone**:

1. Run `npm run dev`; note the **Network** URL it prints, e.g.
   `https://192.168.0.37:5173/` (your Mac and phone must be on the same Wi-Fi).
2. Open that URL on the phone and **accept the self-signed certificate warning**
   (Advanced → Proceed). This is expected with local HTTPS.
3. Tap **Enter** → allow camera + motion → frame anything → **capture**. After a
   short "Building your world…" you'll be standing inside the bundled demo world.
   Move the phone to look around (drag on desktop).

> Desktop also works (drag-to-look) but you can't feel the gyroscope — the
> "anchored world, move your phone" effect must be felt on a real device.

The demo panorama is generated procedurally (no network) by
`scripts/gen-demo-panorama.mjs` into `public/demo-panorama.png`, and runs
automatically on `predev` / `prebuild`. Regenerate anytime with `npm run gen:demo`.

---

## Enabling the real pipeline (Supabase + providers)

Demo mode covers the full UX. To recognize real artworks and generate worlds
from them, stand up the backend.

### Prerequisites
- A [Supabase](https://supabase.com) project.
- The [Supabase CLI](https://supabase.com/docs/guides/cli) (`supabase`) and
  [Deno](https://deno.land) (the Edge Function runtime).

### 1. Point the client at Supabase
Copy `.env.example` to `.env` and fill in the **frontend** values (Project
Settings → API):

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

When these are set, the client calls the `scan` Edge Function instead of the
local demo path. (Leave them blank to stay in demo mode.)

### 2. Apply the schema (tables + Storage buckets)
```bash
supabase link --project-ref YOUR-PROJECT-REF
supabase db push        # runs supabase/migrations/0001_init.sql
```
This creates the `artworks` and `jobs` tables and the public `reference-images`
and `panoramas` Storage buckets. Public Supabase Storage URLs are
CORS-permissive by default, so panoramas load as WebGL textures with
`crossOrigin="anonymous"` — no extra CORS config needed.

> If `supabase start` complains about `config.toml` on your CLI version, run
> `supabase init` to regenerate a full config, then re-add the `[functions.*]`
> blocks from the committed `config.toml`.

### 3. Set the server-side secrets
```bash
supabase secrets set \
  RECOGNITION_PROVIDER=claude \
  ANTHROPIC_API_KEY=sk-ant-... \
  ANTHROPIC_MODEL=claude-opus-4-8 \
  PANORAMA_PROVIDER=blockade \
  BLOCKADE_LABS_API_KEY=... \
  SUPABASE_SERVICE_ROLE_KEY=eyJ...   # Project Settings → API → service_role
```
Add `GEMINI_API_KEY` / `OPENAI_API_KEY` (and `GEMINI_MODEL` / `OPENAI_MODEL`) if
you want to switch `RECOGNITION_PROVIDER` to `gemini` or `openai`. See
`.env.example` for the full list. `SUPABASE_URL` is injected automatically by the
runtime — you don't set it.

### 4. Deploy the functions
```bash
supabase functions deploy scan
supabase functions deploy job-status
```
Both are configured `verify_jwt = false` (public, called with the anon key).

### Graceful degradation
- **No recognition key** → `scan` returns the demo panorama immediately.
- **Recognition key but no panorama key** → it recognizes the artwork but still
  serves the demo world.
- **Both keys** → full recognize → generate → cache path.

---

## How recognition + generation work

`scan` (POST `{ image: base64, mime }`):
1. Recognize the artwork via the selected provider → strict JSON
   `{ recognized, title, artist, confidence, scene_description, palette, style, mood }`.
2. Cache lookup by `(title, artist)` — if a stored `panorama_url` exists, return
   `{ status: 'ready', ... }` instantly.
3. Otherwise upload the reference frame, insert the artwork + a `pending` job,
   and kick off generation in the background (`EdgeRuntime.waitUntil`), returning
   `{ status: 'generating', job_id }`.

Generation: build the prompt — *"Extend this artwork into a seamless 360°
equirectangular environment…"* — call Blockade Labs with the artwork as
`control_image` (`control_model: "remix"`), poll until complete, re-host the PNG
into the `panoramas` bucket, and mark the job `ready`.

The client polls `job-status` every ~1.5s until `ready` / `error` / timeout.

---

## Swapping providers (the abstraction)

Two clean interfaces live in `supabase/functions/_shared/`:

```ts
interface RecognitionProvider { recognize(i): Promise<RecognitionResult> }
interface PanoramaProvider    { generate(i): Promise<{ equirectPngUrl: string }> }
```

- **Recognition** — `recognition/{claude,gemini,openai}.ts`, chosen by
  `RECOGNITION_PROVIDER` in `recognition/index.ts`. Claude uses the official
  Anthropic SDK with structured outputs; Gemini/OpenAI use their JSON-forcing
  REST endpoints. To add a provider: add an adapter + a case in the factory.
- **Panorama** — `panorama/blockade.ts`, chosen by `PANORAMA_PROVIDER` in
  `panorama/index.ts`. To add Imagen / Flux / `gpt-image`: implement
  `PanoramaProvider` and add a case.

---

## Pre-seeding artworks

To make a known collection resolve instantly, insert rows into `artworks` with a
ready `panorama_url`. See `supabase/seed.sql` for a template, then:

```bash
supabase db execute --file supabase/seed.sql
```

---

## Deploying the frontend

Any static host with HTTPS works (Vercel, Netlify, Cloudflare Pages):

```bash
npm run build      # outputs dist/
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's environment.
HTTPS is mandatory in production too (camera + gyro). Verify no secrets leaked:

```bash
grep -rE "ANTHROPIC|BLOCKADE|OPENAI|GEMINI|SERVICE_ROLE" dist/ && echo LEAK || echo clean
```

---

## Scripts

| Script              | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run dev`       | HTTPS dev server (regenerates the demo panorama first)  |
| `npm run build`     | Typecheck + production build to `dist/`                 |
| `npm run preview`   | Preview the production build (also HTTPS, LAN-exposed)  |
| `npm run typecheck` | `tsc --noEmit`                                          |
| `npm run gen:demo`  | Regenerate `public/demo-panorama.png`                  |

---

## v1 scope & notes

- **3DoF only** — you look around from a fixed point; you don't walk through the
  scene (6DoF would need Gaussian-splat / mesh reconstruction).
- **Equirectangular fidelity** — minor seam/pole artifacts at zenith/nadir are
  acceptable for v1.
- **Mobile GPU** — the camera frame is downscaled to ~1024px before upload, and
  the panorama texture is capped at ~4K.
- **Dev-only advisory** — `npm audit` flags the esbuild dev-server advisory via
  Vite 5; it affects the local dev server only (not the production build). Vite 5
  is pinned for plugin compatibility (`@vitejs/plugin-basic-ssl`).
- **Env vars** — see `.env.example`. `.env` is gitignored; never commit real keys.
