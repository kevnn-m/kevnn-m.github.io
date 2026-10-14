// Pixel sprites and colors for the home-page scene.
//
// Each sprite is a list of rows; each character is one pixel.
// "." is transparent. Every other character is a color key from the
// palette below. Rows may have different lengths.

export type Sprite = string[];

// Lying on my back in the grass, head on the left, one knee up.
// h hair · s skin · k glasses · t shirt · p pants · b shoes
export const PERSON: Sprite = [
  '....................pp........',
  '..ss...............pppp.......',
  '.sksk.............pp..pp......',
  'hssss............pp....pp.....',
  'hhsss..tttttt...pp......pp....',
  'hhhs..tttttttttpp........pp...',
  'hhhh.ttttttttttpppppp.....pp..',
  '.hh..tttttttttttppppppp...bbbb',
];

// A stack of papers: the top page has lines of text, the side shows the sheets.
// w paper · l text line · d sheet edge
export const PAPERS: Sprite = [
  '..wwwwwwww...',
  '.wllwlllww...',
  '.wlllwllwww..',
  '.wwwwwwwwww..',
  'dddddddddddd.',
  'wwwwwwwwwwww.',
  'dddddddddddd.',
];

// A camera sitting in the grass.
// c body · g label · r shutter button · L lens rim · n lens glass
export const CAMERA: Sprite = [
  '...ccc..r..',
  'ccccccccccc',
  'cggcccccccc',
  'cccLLLLcccc',
  'ccLnnnnLccc',
  'cccLLLLcccc',
  'ccccccccccc',
];

// W cloud · V cloud shadow
export const CLOUD: Sprite = [
  '.....WWWW.......',
  '...WWWWWWWW.WW..',
  '.WWWWWWWWWWWWWW.',
  'VWWWWWWWWWWWWWWV',
  '.VVVVVVVVVVVVVV.',
];

export const SPRITES: Record<string, Sprite> = { person: PERSON, papers: PAPERS, camera: CAMERA };

export interface Palette {
  sky: string[]; // top to bottom
  grassBack: string[];
  grassFront: string[];
  ground: string;
  highlight: string; // outline of the hovered object
  stars: boolean;
  moon?: string;
  sprite: Record<string, string>;
}

// PLACEHOLDER colors. Change freely.
const DAY_SPRITE: Record<string, string> = {
  h: '#2b2420', s: '#e8b896', k: '#1d1d1d', t: '#3f6fb5', p: '#3b3f4a', b: '#f2f2f2',
  w: '#fbfbf6', l: '#9aa3b0', d: '#cfd3d8',
  c: '#2a2d33', g: '#8a8f99', r: '#d64545', L: '#4b5059', n: '#6fa8dc',
  W: '#ffffff', V: '#dbe9f7',
};

// Darken a color for the night palette.
const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number, tint: number) => Math.round(Math.min(255, v * f + tint));
  const r = ch((n >> 16) & 255, 4), g = ch((n >> 8) & 255, 8), b = ch(n & 255, 24);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};

export const PALETTES: Record<'day' | 'night', Palette> = {
  day: {
    sky: ['#8ec5ee', '#a3d1f2', '#b9ddf5', '#d2eaf9'],
    grassBack: ['#4f8f3a', '#5a9c41', '#468235'],
    grassFront: ['#79b84f', '#6aa845', '#8cc85a'],
    ground: '#3d6e2c',
    highlight: '#fff3a3',
    stars: false,
    sprite: DAY_SPRITE,
  },
  night: {
    sky: ['#0d1630', '#121e3e', '#18284c', '#1f325a'],
    grassBack: ['#1f3d24', '#244529', '#1b3620'],
    grassFront: ['#2f5a2f', '#2a5229', '#356336'],
    ground: '#16301b',
    highlight: '#ffe98a',
    stars: true,
    moon: '#f4f1d0',
    sprite: Object.fromEntries(Object.entries(DAY_SPRITE).map(([k, v]) => [k, shade(v, 0.55)])),
  },
};
