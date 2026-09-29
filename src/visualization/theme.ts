/** Visual theme shared by canvas/WebGL renderers (the React UI uses matching CSS variables). */

export interface Theme {
  name: 'dark' | 'light';
  bg: string;
  grid: string;
  gridStrong: string;
  axis: string;
  text: string;
  textDim: string;
  contour: string;
  contourStrong: string;
  floor: string;
  box: string;
  labelBg: string;
}

export const DARK: Theme = {
  name: 'dark',
  bg: '#0f1117',
  grid: 'rgba(255,255,255,0.05)',
  gridStrong: 'rgba(255,255,255,0.10)',
  axis: 'rgba(255,255,255,0.38)',
  text: '#e6e8ef',
  textDim: 'rgba(230,232,239,0.55)',
  contour: 'rgba(255,255,255,0.28)',
  contourStrong: 'rgba(255,255,255,0.5)',
  floor: '#141824',
  box: 'rgba(255,255,255,0.14)',
  labelBg: 'rgba(15,17,23,0.78)',
};

export const LIGHT: Theme = {
  name: 'light',
  bg: '#fbfbfd',
  grid: 'rgba(20,24,40,0.05)',
  gridStrong: 'rgba(20,24,40,0.10)',
  axis: 'rgba(20,24,40,0.45)',
  text: '#1b1e28',
  textDim: 'rgba(27,30,40,0.55)',
  contour: 'rgba(20,24,40,0.30)',
  contourStrong: 'rgba(20,24,40,0.55)',
  floor: '#eef0f5',
  box: 'rgba(20,24,40,0.16)',
  labelBg: 'rgba(251,251,253,0.85)',
};

let current: Theme = DARK;
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return current;
}
export function setTheme(name: 'dark' | 'light') {
  current = name === 'dark' ? DARK : LIGHT;
  listeners.forEach((l) => l());
}
export function onThemeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const MATH_FONT = '"KaTeX_Math", "Cambria Math", "Times New Roman", serif';
export const UI_FONT = '"Inter", "Segoe UI", system-ui, sans-serif';
