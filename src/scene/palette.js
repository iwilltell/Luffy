/* night and day palettes; the engine blends between them as the theme changes */
export const NIGHT = {
  skyTop: '#060a22',
  skyMid: '#141d4d',
  skyLow: '#3a2f6e',
  glow: '#f08a5d',
  seaTop: '#1a2a63',
  seaBottom: '#04081a',
  seaFront: '#0b1638',
  seaFrontDeep: '#030614',
  swell: '#8fb2ff',
  foam: '#d6e4ff',
  shine: '#e8eeff',
  cloud: '#2b3570',
  cloudLight: '#56609c',
  bird: '#c9d2f5',
  wood: '#8a5a32',
  woodDark: '#4a2c16',
  woodLight: '#c08752',
  ink: '#140c06',
  fx: '#ffffff',
};

export const DAY = {
  skyTop: '#2f7fd6',
  skyMid: '#7cc0f0',
  skyLow: '#ffe2ae',
  glow: '#ffd27a',
  seaTop: '#38a8cf',
  seaBottom: '#0b4f86',
  seaFront: '#1478a8',
  seaFrontDeep: '#063a66',
  swell: '#ffffff',
  foam: '#ffffff',
  shine: '#fff1c4',
  cloud: '#ffffff',
  cloudLight: '#ffffff',
  bird: '#2a3348',
  wood: '#a86b38',
  woodDark: '#5b351a',
  woodLight: '#e0a465',
  ink: '#1b1009',
  fx: '#ffffff',
};

const cache = new Map();
function rgb(hex) {
  let v = cache.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    cache.set(hex, v);
  }
  return v;
}

/** blended colour as an [r,g,b] triple */
export function mix(key, t) {
  const a = rgb(NIGHT[key]);
  const b = rgb(DAY[key]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function css(c, alpha = 1) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
}
