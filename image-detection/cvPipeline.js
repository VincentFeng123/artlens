// cvPipeline.js
// OpenCV.js-based artwork detection + perspective rectification.
// Relies on the global `cv` (OpenCV.js) and optionally `jscanify`.
// All corner arrays are ordered [TL, TR, BR, BL] in SOURCE image pixels.

let _scanner = null;
function scanner() {
  if (!_scanner && typeof jscanify !== "undefined") {
    try { _scanner = new jscanify(); } catch (_) { _scanner = null; }
  }
  return _scanner;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Order 4 arbitrary points into [TL, TR, BR, BL].
function orderQuad(pts) {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]]; // TL, TR, BR, BL
}

// Polygon area via shoelace.
function quadArea(q) {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

// True if the quad is essentially the whole image frame (not a useful crop).
function nearImageBorder(q, w, h, tol) {
  const c = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  return q.every((p, i) => dist(p, c[i]) < tol);
}

// Primary detector: Canny edges → contours → approxPolyDP, keep the largest
// convex quadrilateral. Precise when the artwork has clean edges.
function detectByPolygon(srcCanvas) {
  const src = cv.imread(srcCanvas);
  const gray = new cv.Mat(), blur = new cv.Mat(), edges = new cv.Mat();
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  let result = null;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blur, edges, 60, 180);
    const k = cv.Mat.ones(5, 5, cv.CV_8U);
    cv.dilate(edges, edges, k);
    k.delete();
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const imgArea = src.cols * src.rows;
    let bestArea = 0, best = null;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const peri = cv.arcLength(c, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(c, approx, 0.02 * peri, true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts = [];
        for (let j = 0; j < 4; j++) {
          pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
        }
        const area = quadArea(pts);
        if (area > bestArea && area > imgArea * 0.12 && area < imgArea * 0.999) {
          bestArea = area;
          best = pts;
        }
      }
      approx.delete();
      c.delete();
    }
    if (best) result = orderQuad(best);
  } catch (_) {
    result = null;
  } finally {
    src.delete(); gray.delete(); blur.delete(); edges.delete();
    contours.delete(); hierarchy.delete();
  }
  return result;
}

// Fallback detector: jscanify (largest contour → extreme point per quadrant).
// More forgiving of broken edges, but can latch onto the whole frame.
function detectByJscanify(srcCanvas) {
  const s = scanner();
  if (!s) return null;
  const src = cv.imread(srcCanvas);
  let result = null;
  try {
    const contour = s.findPaperContour(src);
    if (contour) {
      const c = s.getCornerPoints(contour);
      if (c && c.topLeftCorner && c.topRightCorner && c.bottomRightCorner && c.bottomLeftCorner) {
        result = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner]
          .map((p) => ({ x: p.x, y: p.y }));
      }
    }
  } catch (_) {
    result = null;
  } finally {
    src.delete();
  }
  return result;
}

// A sensible inset rectangle, used when auto-detection finds nothing useful.
export function defaultQuad(w, h) {
  const ix = w * 0.12, iy = h * 0.12;
  return [
    { x: ix, y: iy },
    { x: w - ix, y: iy },
    { x: w - ix, y: h - iy },
    { x: ix, y: h - iy },
  ];
}

// Public: best quad in source coords, or a sensible inset default.
export function detect(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const tol = Math.max(w, h) * 0.02;
  let q = detectByPolygon(srcCanvas);
  if (q && nearImageBorder(q, w, h, tol)) q = null; // ignore "whole frame" hits
  if (!q) {
    const j = detectByJscanify(srcCanvas);
    if (j && !nearImageBorder(j, w, h, tol) && quadArea(j) > w * h * 0.1) q = j;
  }
  return q || defaultQuad(w, h);
}

// Public: warp `corners` ([TL,TR,BR,BL] in source coords) into `outCanvas`.
// Output size is derived from the corner geometry so the result isn't stretched.
export function warp(srcCanvas, corners, outCanvas, maxDim = 4000) {
  const [tl, tr, br, bl] = corners;
  let outW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  let outH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  outW = Math.max(1, outW);
  outH = Math.max(1, outH);
  const scl = Math.min(1, maxDim / Math.max(outW, outH));
  outW = Math.max(1, Math.round(outW * scl));
  outH = Math.max(1, Math.round(outH * scl));

  const src = cv.imread(srcCanvas);
  const dst = new cv.Mat();
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0, outW, 0, outW, outH, 0, outH,
  ]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  try {
    cv.warpPerspective(
      src, dst, M, new cv.Size(outW, outH),
      cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar()
    );
    cv.imshow(outCanvas, dst);
  } finally {
    src.delete(); dst.delete(); srcTri.delete(); dstTri.delete(); M.delete();
  }
  return { width: outW, height: outH };
}
