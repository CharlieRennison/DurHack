import type { RepoNode } from '../types';

/**
 * Language colours: a house's walls are painted in the colour of its file type. Pure (no rendering), so it can be tested.
 */
export interface Language {
  id: string;
  label: string;
  /** The wall colour (0xRRGGBB) of a house of this language, as lit; the shaded side is derived from it. */
  color: number;
}

export const OTHER: Language = { id: 'other', label: 'Other', color: 0xa47fd8 };

const LANGS: (Language & { exts: string[] })[] = [
  { id: 'javascript', label: 'JavaScript', color: 0xe8862b, exts: ['js', 'jsx', 'mjs', 'cjs'] },
  { id: 'docs', label: 'Docs', color: 0xe2c44b, exts: ['md', 'rst', 'txt', 'adoc'] },
  { id: 'typescript', label: 'TypeScript', color: 0x1f9d94, exts: ['ts', 'tsx', 'mts', 'cts'] },
  { id: 'web', label: 'HTML / CSS', color: 0xd4527f, exts: ['html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte'] },
  { id: 'rust', label: 'Rust', color: 0x9b4a2f, exts: ['rs'] },
  // not in the given palette yet: keep their earlier colours
  { id: 'python', label: 'Python', color: 0x3f5fbf, exts: ['py', 'pyi', 'ipynb'] },
  { id: 'go', label: 'Go', color: 0x8fe3c8, exts: ['go'] },
  { id: 'jvm', label: 'Java / Kotlin', color: 0xff8f8f, exts: ['java', 'kt', 'scala', 'groovy'] },
  { id: 'c', label: 'C / C++', color: 0x454a5a, exts: ['c', 'h', 'cc', 'cpp', 'hpp', 'cs'] },
  { id: 'config', label: 'Config / data', color: 0xc9c9c9, exts: ['json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'xml', 'lock', 'csv'] },
];

const BY_EXT = new Map<string, Language>();
for (const { exts, ...l } of LANGS) for (const e of exts) BY_EXT.set(e, l);

/** The language of a file name (by extension, case-insensitive); anything unknown is OTHER. */
export function languageOf(name: string): Language {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return OTHER;
  return BY_EXT.get(name.slice(i + 1).toLowerCase()) ?? OTHER;
}

/** How many files of each language are under `root`, most common first (for the legend). */
export function languageCounts(root: RepoNode): { lang: Language; count: number }[] {
  const counts = new Map<string, { lang: Language; count: number }>();
  const walk = (n: RepoNode) => {
    if (n.kind === 'file') {
      const lang = languageOf(n.name);
      const e = counts.get(lang.id) ?? { lang, count: 0 };
      e.count++;
      counts.set(lang.id, e);
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return [...counts.values()].sort((a, b) => b.count - a.count || a.lang.label.localeCompare(b.lang.label));
}

/** The languages the key always lists, in order (even when a repo has none of that type). */
export const KEY_IDS = ['javascript', 'typescript', 'python', 'web', 'rust', 'c', 'docs', 'other'];

/**
 * The rows of the colour key: the fixed languages (with 0 when the repo has none), then any other language the repo
 * does have (Go, Java, config...) so every house colour on the map is explained.
 */
export function keyRows(root: RepoNode): { lang: Language; count: number }[] {
  const found = new Map(languageCounts(root).map((e) => [e.lang.id, e]));
  const all = new Map<string, Language>([...LANGS.map((l) => [l.id, l] as [string, Language]), [OTHER.id, OTHER]]);
  const fixed = KEY_IDS.map((id) => ({ lang: all.get(id)!, count: found.get(id)?.count ?? 0 }));
  const extra = [...found.values()].filter((e) => !KEY_IDS.includes(e.lang.id));
  return [...fixed, ...extra];
}

/** Legend swatch colour (#rrggbb). */
export const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');

const toHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
};

const fromHsl = (h: number, s: number, l: number): [number, number, number] => {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
};

/** The hue (0..1) of an 0xRRGGBB colour. */
export const hueOf = (c: number): number => toHsl((c >> 16) & 255, (c >> 8) & 255, c & 255)[0];

/**
 * The three house art styles' walls: [lit, shaded] as 0xRRGGBB (gold, cream, grey-brown). Roofs, chimneys, windows,
 * doors and plants use other colours, so recolouring only these paints the walls.
 */
const WALL_STYLES: [number, number][] = [
  [0xb4922a, 0x87690b],
  [0xded2b2, 0xaa9e7c],
  [0xa0988a, 0x766e60],
];

const lightnessOf = (c: number): number => toHsl((c >> 16) & 255, (c >> 8) & 255, c & 255)[2];

/** Wall pixel colour -> how dark it is compared with its style's lit wall (1 for the lit wall). */
const WALL_SHADE = new Map<number, number>();
for (const [lit, shade] of WALL_STYLES) {
  WALL_SHADE.set(lit, 1);
  WALL_SHADE.set(shade, lightnessOf(shade) / lightnessOf(lit));
}

/**
 * Paint the walls in RGBA pixels, in place, with `colour`: the lit wall becomes exactly that colour and the shaded wall
 * the same hue and saturation, darker by the same proportion the art had, so the shading follows the colour. Roofs,
 * windows and everything else, and transparent pixels, are left alone. Pure, so it can be tested.
 */
export function recolourPixels(data: Uint8ClampedArray, colour: number): void {
  const [h, s, l] = toHsl((colour >> 16) & 255, (colour >> 8) & 255, colour & 255);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const k = WALL_SHADE.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    if (k === undefined) continue;
    const [r, g, b] = fromHsl(h, s, l * k);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}
