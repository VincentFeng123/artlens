import type { PanoramaInput, PanoramaResult } from './index.ts'

/**
 * Pollinations — keyless image generation (no API key / signup). Returns a URL
 * that, when fetched, generates and returns the image; `scan` re-hosts it into
 * the panoramas bucket. Text-only (it cannot condition on the source artwork) and
 * not a perfectly seamless equirectangular skybox (expect a faint left/right seam
 * and pole stretching) — Blockade is the higher-quality, artwork-faithful option
 * when a key is available. No depth map; the client computes depth in-browser.
 */
export function generateWithPollinations({
  prompt,
  negative,
}: PanoramaInput): Promise<PanoramaResult> {
  // Keep it compact — Pollinations is keyless/low-res and degrades with long URLs.
  const scene = prompt.length > 600 ? prompt.slice(0, 600) : prompt
  const avoid = negative ? ` Avoid: ${negative.slice(0, 200)}.` : ''
  const full =
    `equirectangular 360 degree panorama, seamless horizontally tileable, ` +
    `2:1 aspect ratio, painterly (not a photograph), no text or watermark, ` +
    `no seam at the wrap, no distortion at the poles. ${scene}${avoid}`
  const seed = djb2(full) % 1_000_000
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}` +
    `?width=2048&height=1024&nologo=true&model=flux&seed=${seed}`
  return Promise.resolve({ equirectPngUrl: url })
}

function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}
