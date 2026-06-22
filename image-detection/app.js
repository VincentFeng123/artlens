// app.js — orchestrates the upload → adjust → export flow.
import { CornerEditor } from "./cornerEditor.js";
import * as cvp from "./cvPipeline.js";

const MAX_SOURCE_DIM = 3000; // cap working resolution (memory / speed)
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);

const views = {
  upload: $("view-upload"),
  edit: $("view-edit"),
  result: $("view-result"),
};
const stepEls = [...document.querySelectorAll(".step")];

let sourceCanvas = null; // full-res (capped) source image, holds all detection coords
let editor = null;
let lastResult = null; // { width, height }

function showView(name) {
  for (const [k, el] of Object.entries(views)) {
    el.classList.toggle("is-active", k === name);
  }
  stepEls.forEach((s) => s.classList.toggle("is-current", s.dataset.step === name));
}

function setVeil(on, text, sub) {
  const veil = $("veil");
  if (text !== undefined) $("veil-text").textContent = text;
  if (sub !== undefined) $("veil-sub").textContent = sub || "";
  veil.classList.toggle("is-active", on);
}

// ---------- image loading ----------
async function bitmapFromFile(file) {
  // Respect EXIF orientation so phone photos aren't sideways.
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (_) {
    try {
      return await createImageBitmap(file);
    } catch (__) {
      return await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = URL.createObjectURL(file);
      });
    }
  }
}

function drawToSource(bitmap) {
  const bw = bitmap.width || bitmap.naturalWidth;
  const bh = bitmap.height || bitmap.naturalHeight;
  const scl = Math.min(1, MAX_SOURCE_DIM / Math.max(bw, bh));
  const w = Math.round(bw * scl);
  const h = Math.round(bh * scl);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  setVeil(true, "Reading photo…", "");
  try {
    const bmp = await bitmapFromFile(file);
    sourceCanvas = drawToSource(bmp);
    if (bmp.close) bmp.close();
    showView("edit");
    setVeil(true, "Detecting edges…", "");
    await delay(20); // let the veil paint before the synchronous CV work
    const corners = cvp.detect(sourceCanvas);
    editor.setImage(sourceCanvas, corners);
  } catch (e) {
    console.error(e);
    alert("Could not read that image. Try another photo.");
    showView("upload");
  } finally {
    setVeil(false);
  }
}

// ---------- actions ----------
function reDetect() {
  if (!sourceCanvas) return;
  editor.setImage(sourceCanvas, cvp.detect(sourceCanvas));
}

function rotate90() {
  if (!sourceCanvas) return;
  const w = sourceCanvas.height;
  const h = sourceCanvas.width;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.translate(w, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(sourceCanvas, 0, 0);
  sourceCanvas = out;
  editor.setImage(sourceCanvas, cvp.detect(sourceCanvas));
}

function flatten() {
  if (!sourceCanvas || !editor) return;
  setVeil(true, "Rectifying…", "");
  // Defer so the veil paints before the synchronous warp.
  setTimeout(() => {
    try {
      lastResult = cvp.warp(sourceCanvas, editor.getCorners(), $("result-canvas"));
      $("result-caption").textContent =
        `Rectified · ${lastResult.width} × ${lastResult.height} px`;
      showView("result");
    } catch (e) {
      console.error(e);
      alert("Rectification failed. Try adjusting the corners and retry.");
    } finally {
      setVeil(false);
    }
  }, 30);
}

function download() {
  $("result-canvas").toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `artwork-rectified-${lastResult ? lastResult.width + "x" + lastResult.height : "output"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

function newPhoto() {
  sourceCanvas = null;
  lastResult = null;
  $("file-input").value = "";
  showView("upload");
}

// ---------- wiring ----------
function wire() {
  $("file-input").addEventListener("change", (e) => handleFile(e.target.files[0]));

  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("is-over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
    })
  );
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  $("btn-redetect").addEventListener("click", reDetect);
  $("btn-rotate").addEventListener("click", rotate90);
  $("btn-restart").addEventListener("click", newPhoto);
  $("btn-flatten").addEventListener("click", flatten);
  $("btn-adjust").addEventListener("click", () => showView("edit"));
  $("btn-new").addEventListener("click", newPhoto);
  $("btn-download").addEventListener("click", download);
}

// ---------- boot ----------
async function whenCvReady() {
  // IMPORTANT: never `await cv`. The OpenCV.js Module is a self-referential
  // "thenable" (it has a `.then`), and awaiting it hangs the microtask queue.
  // Just poll until the runtime has initialized its API.
  while (!(window.cv && window.cv.Mat && typeof window.cv.imread === "function")) {
    await delay(50);
  }
}

(async function boot() {
  editor = new CornerEditor($("editor-canvas"));
  wire();
  showView("upload");
  setVeil(true, "Loading the rectifier engine…", "First load fetches ~8 MB of OpenCV — hang tight.");
  await whenCvReady();
  setVeil(false);
})();
