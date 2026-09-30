/**
 * One perceptual colormap shared by the 2D heat map and the 3D surface, so that heights have
 * the same colour in every view (a visual link between representations).
 */

// viridis-like stops, slightly brightened for dark backgrounds
const STOPS: [number, number, number][] = [
  [0.19, 0.07, 0.36],
  [0.23, 0.2, 0.55],
  [0.17, 0.35, 0.6],
  [0.12, 0.5, 0.6],
  [0.13, 0.63, 0.55],
  [0.3, 0.75, 0.43],
  [0.58, 0.84, 0.28],
  [0.87, 0.89, 0.2],
  [0.99, 0.93, 0.45],
];

const LUT_SIZE = 256;
const LUT = new Float32Array(LUT_SIZE * 3);
for (let i = 0; i < LUT_SIZE; i++) {
  const t = (i / (LUT_SIZE - 1)) * (STOPS.length - 1);
  const k = Math.min(STOPS.length - 2, Math.floor(t));
  const f = t - k;
  for (let c = 0; c < 3; c++) LUT[i * 3 + c] = STOPS[k][c] * (1 - f) + STOPS[k + 1][c] * f;
}

/** Colour for t ∈ [0, 1] as [r, g, b] in [0, 1]. */
export function colormap(t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const i = Math.max(0, Math.min(LUT_SIZE - 1, Math.round((Number.isFinite(t) ? t : 0) * (LUT_SIZE - 1))));
  out[0] = LUT[i * 3];
  out[1] = LUT[i * 3 + 1];
  out[2] = LUT[i * 3 + 2];
  return out;
}

export function colormapCss(t: number, alpha = 1): string {
  const [r, g, b] = colormap(t);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}
