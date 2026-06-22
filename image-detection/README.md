# ⌐ RECTO — Artwork Rectifier

Upload a photo of an artwork shot at an angle, drag the four corners onto the
artwork's edges, and RECTO flattens it into a clean, straight-on, correctly
proportioned image you can download. Everything runs **in your browser** — no
server, no upload, fully private.

![flow](https://img.shields.io/badge/flow-capture%20%E2%86%92%20adjust%20%E2%86%92%20export-cc3b1f)

## Run it

No build step, no `npm install`. You just need a static file server.

```bash
bash serve.sh           # serves on port 8000, prints your phone URL
# or pick a port:
bash serve.sh 5050
```

Then open the printed URL:

- **On this Mac:** `http://localhost:8000`
- **On your phone (same Wi-Fi):** `http://<your-mac-ip>:8000`

`serve.sh` auto-detects your Mac's LAN IP. To find it manually:

```bash
ipconfig getifaddr en0   # Wi-Fi on most Macs (try en1 if blank)
```

> First load downloads ~8 MB of OpenCV **from your Mac** (it's vendored in
> `vendor/`), so the phone doesn't need its own internet connection — just the
> same Wi-Fi.

## How to use

1. **Capture** — tap the upload area. On a phone you'll get *Take Photo* or
   *Photo Library*. On desktop you can also drag-and-drop a file.
2. **Adjust corners** — RECTO auto-detects the artwork's edges. Drag any of the
   four corner handles onto the real corners; a magnifier loupe appears for
   precision. Use **Re-detect**, **Rotate 90°**, or **New photo** as needed.
3. **Export** — hit **Flatten →**, review the result, and **Download** (PNG).

## How it works

A classic "document scanner" pipeline applied to artwork:

1. The photo is loaded respecting EXIF orientation, capped to 3000 px.
2. `cvPipeline.js` finds the artwork quadrilateral — primary detector is
   OpenCV.js (`Canny` → `findContours` → `approxPolyDP`, largest convex quad);
   fallback is [jscanify](https://github.com/puffinsoft/jscanify); final
   fallback is an inset rectangle you adjust by hand.
3. `cornerEditor.js` draws the draggable corner overlay (Pointer Events, so
   touch and mouse behave the same) with a dimmed mask and magnifier loupe.
4. On **Flatten**, `cv.getPerspectiveTransform` + `cv.warpPerspective` map your
   four corners to a flat rectangle. Output dimensions come from the corner
   geometry (`max` of opposite edge lengths) so the result isn't stretched.

```
index.html        markup + loads vendored CV engines
styles.css        gallery / conservation styling
app.js            flow orchestration (upload, EXIF, state, buttons)
cornerEditor.js   draggable 4-corner canvas overlay + loupe
cvPipeline.js     OpenCV.js detection + perspective warp
vendor/           opencv.js, jscanify.js (served locally)
samples/          a couple of test artwork photos
serve.sh          prints LAN URL + starts the static server
```

## Optional: access it over HTTPS / off-network (cloudflared)

The file-upload flow works fine over plain LAN HTTP. You only need HTTPS if you
later want a **live in-browser camera** (mobile browsers block the camera on
non-secure origins) or to reach the page when **not** on the same Wi-Fi.

```bash
brew install cloudflared
# in one terminal:
bash serve.sh 8000
# in another:
cloudflared tunnel --url http://localhost:8000
```

cloudflared prints a public `https://….trycloudflare.com` URL (no account
needed). Open that on the phone.

## Troubleshooting

- **Phone can't reach the URL** — confirm both devices are on the same Wi-Fi and
  the IP is right (`ipconfig getifaddr en0`). A VPN or "client isolation" on the
  router can block LAN access.
- **Photo comes in rotated** — most modern phones are handled automatically; if
  not, use **Rotate 90°** in the editor.
- **Auto-detect missed the artwork** — that's expected on frames/glare/low
  contrast. Just drag the corners; manual placement always wins.
- **Slow first load** — that's the one-time ~8 MB OpenCV download; it's cached
  afterward.
