// Turn an artwork's plain-language colour name ("deep ultramarine", "burnt
// sienna", "pale gold") into a display hex so the info card can render real
// swatches. A small dictionary of art/colour terms is modulated by adjectives
// (deep/pale/muted/bright/burnt); unknown names fall back to a stable
// hash-derived hue — always pleasant, never a broken swatch.

const BASE: Record<string, string> = {
  white: '#f3f3f6', ivory: '#efe9d8', cream: '#efe6cf', bone: '#e6e0d2',
  black: '#16161b', ink: '#15151c', jet: '#1b1b20', charcoal: '#363640',
  grey: '#8a8a92', gray: '#8a8a92', silver: '#c6c6d0', ash: '#9a9aa2',
  slate: '#5b6878', steel: '#5a7088', pewter: '#7a7a84',

  red: '#c0392b', crimson: '#a51d2d', scarlet: '#d3331f', vermilion: '#e34234',
  ruby: '#9b111e', cherry: '#b81d2c', cardinal: '#9e1b2f',
  maroon: '#5e1a1a', burgundy: '#5b1a2b', wine: '#4a1626', oxblood: '#4a1a1c',

  orange: '#e0822b', tangerine: '#e8801a', coral: '#e2735b', apricot: '#e8a87c',
  peach: '#f0b48a', salmon: '#e89b87', rust: '#9a4a2e', terracotta: '#b3603f',
  amber: '#e0a32b',

  gold: '#d4af37', golden: '#d4af37', ochre: '#c0892e', mustard: '#c9a227',
  honey: '#d9a441', saffron: '#d9a441', brass: '#b59a4a', bronze: '#8a6a3a',
  sand: '#d9c39a', tan: '#c8a878', beige: '#d9cbb3', wheat: '#e0cda0',

  yellow: '#e6c84a', lemon: '#e6dd57', citron: '#c8c84a', flax: '#dcc77a',

  chartreuse: '#a6c34a', lime: '#9ccb3b', olive: '#6b6b2e', sage: '#9aa888',
  moss: '#6b7a4a', fern: '#5a8a4a',

  green: '#3f8f56', emerald: '#1f7a4d', viridian: '#2c7a5a', jade: '#3aa17e',
  forest: '#234a32', pine: '#1f3d2e', mint: '#9fe0c0', malachite: '#2f7a5a',
  seafoam: '#93e0c8', verdigris: '#3f9a86',

  teal: '#1f7a7a', turquoise: '#2bb6b0', aqua: '#4fc8c8', cyan: '#2bb6c8',

  blue: '#2b59c8', cobalt: '#1f3fb0', ultramarine: '#2233a8', sapphire: '#1f3f8f',
  cerulean: '#2b8fd0', azure: '#2b78c8', sky: '#7bb6e0', cornflower: '#6a8fd8',
  navy: '#1b2747', prussian: '#1b3a5c', denim: '#4a6a9c', powder: '#bcd0e8',
  midnight: '#15203a', indigo: '#3b2f8f', periwinkle: '#8a8fe0',

  purple: '#6a3fa0', violet: '#7a4fc0', amethyst: '#8a5fc0', lavender: '#b9a8e0',
  lilac: '#c3a8e0', mauve: '#9a6f8f', plum: '#6a2f5a', orchid: '#b35fb0',
  aubergine: '#3a2238',

  magenta: '#c0398f', fuchsia: '#d03f9c', pink: '#e08aa8', rose: '#d86a86',
  blush: '#ecb1bd', cerise: '#c52a6e',

  brown: '#6b4a32', sienna: '#8a4a2e', umber: '#5b3a26', sepia: '#5e4636',
  chocolate: '#4a2f22', chestnut: '#6b3a26', mahogany: '#5a2a22', clay: '#b07a5a',
  taupe: '#8a7a6a', copper: '#b06a3a', earth: '#6b5238', khaki: '#9a8a5a',
}

const DARKEN = new Set(['deep', 'dark', 'darkened', 'midnight', 'shadowed', 'inky', 'shadowy'])
const LIGHTEN = new Set(['pale', 'light', 'soft', 'pastel', 'faint', 'washed', 'baby', 'frosted', 'milky'])
const MUTE = new Set(['muted', 'dusty', 'dull', 'smoky', 'smoke', 'faded', 'weathered', 'greyed', 'grayed', 'ashen', 'misty'])
const BOOST = new Set(['bright', 'vivid', 'electric', 'vibrant', 'intense', 'neon', 'rich', 'saturated', 'glowing'])
const BURNT = new Set(['burnt', 'scorched', 'roasted'])

export function paletteColor(name: string): string {
  const tokens = String(name)
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)

  const hits: string[] = []
  for (const t of tokens) if (BASE[t]) hits.push(BASE[t])

  let [h, s, l] = hexToHsl(hits.length ? mixHexes(hits) : hashColor(name))

  for (const t of tokens) {
    if (DARKEN.has(t)) l *= 0.7
    else if (LIGHTEN.has(t)) { l += (1 - l) * 0.42; s *= 0.9 }
    else if (MUTE.has(t)) s *= 0.5
    else if (BOOST.has(t)) s = Math.min(1, s * 1.3)
    else if (BURNT.has(t)) { l *= 0.78; s = Math.min(1, s * 1.05) }
  }

  return hslToHex(h, clamp(s, 0, 1), clamp(l, 0.1, 0.93))
}

function mixHexes(hexes: string[]): string {
  let r = 0, g = 0, b = 0
  for (const hex of hexes) {
    const [hr, hg, hb] = hexToRgb(hex)
    r += hr; g += hg; b += hb
  }
  const n = hexes.length
  return rgbToHex(r / n, g / n, b / n)
}

function hashColor(name: string): string {
  let h = 5381
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0
  return hslToHex((h % 360) / 360, 0.48, 0.56)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '')
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

function hexToHsl(hex: string): [number, number, number] {
  const [r8, g8, b8] = hexToRgb(hex)
  const r = r8 / 255, g = g8 / 255, b = b8 / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  const d = max - min
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
    if (h < 0) h += 1
  }
  return [h, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  const seg = Math.floor(h * 6) % 6
  if (seg === 0) [r, g, b] = [c, x, 0]
  else if (seg === 1) [r, g, b] = [x, c, 0]
  else if (seg === 2) [r, g, b] = [0, c, x]
  else if (seg === 3) [r, g, b] = [0, x, c]
  else if (seg === 4) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

/** Precompute display hex for each palette colour name (index-aligned). */
export function buildPaletteHex(palette: string[]): string[] {
  return (palette ?? []).map((name) => paletteColor(name))
}
