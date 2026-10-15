// Scene colors for day and night. PLACEHOLDER values: change freely.

export type RGB = [number, number, number];

export interface ScenePalette {
  night: boolean;
  skyTop: string;
  skyHorizon: string;
  sunGlow: string; // '' for none
  cloudLight: string;
  cloudShadow: string;
  cloudAlpha: number;
  far: [string, string]; // top, base
  mid: [string, string];
  near: [string, string];
  haze: string; // mist at the foot of the far hills
  tree: [string, string]; // shadow, light
  rock: [string, string];
  grassBase: RGB;
  grassTip: RGB;
  grassGust: RGB; // color where the wind bends the grass
  grassFar: RGB; // distant grass fades toward this
}

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const DAY: ScenePalette = {
  night: false,
  skyTop: '#2f7fd6',
  skyHorizon: '#d4ecf7',
  sunGlow: 'rgba(255, 248, 220, 0.55)',
  cloudLight: '#ffffff',
  cloudShadow: '#b7cbe2',
  cloudAlpha: 1,
  far: ['#8bb6c9', '#6f9fb2'],
  mid: ['#6fae5a', '#3f7d43'],
  near: ['#9ccd5c', '#5c9636'],
  haze: 'rgba(225, 240, 245, 0.55)',
  tree: ['#2e5a2c', '#5a9445'],
  rock: ['#8d8f86', '#c9c8bb'],
  grassBase: hex('#2f6524'),
  grassTip: hex('#a6d65e'),
  grassGust: hex('#e2f29a'),
  grassFar: hex('#8fc25a'),
};

export const NIGHT: ScenePalette = {
  night: true,
  skyTop: '#081130',
  skyHorizon: '#24406e',
  sunGlow: '',
  cloudLight: '#5a6a92',
  cloudShadow: '#2b3758',
  cloudAlpha: 0.8,
  far: ['#24405e', '#1d3550'],
  mid: ['#1d3d2c', '#132a1f'],
  near: ['#24492c', '#16321d'],
  haze: 'rgba(70, 95, 140, 0.35)',
  tree: ['#0d1f16', '#1f3d29'],
  rock: ['#3a4250', '#5c6678'],
  grassBase: hex('#0c2214'),
  grassTip: hex('#2d5a3c'),
  grassGust: hex('#56786f'),
  grassFar: hex('#1f4030'),
};
