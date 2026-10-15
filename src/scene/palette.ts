// Scene colors for day and night, as ramps from dark to light.
// Each material is shaded with only the colors in its ramp (plus dithering),
// so changing a ramp changes the whole look. PLACEHOLDER values: tune freely.
import { ramp, smoothRamp, type Ramp } from './pixel';

export interface ScenePalette {
  night: boolean;
  sky: Ramp; // top of the sky (index 0) to the horizon
  cloud: Ramp; // 0 deepest shadow, 1 shadow, 2 soft shade, 3 white, 4 warm highlight
  moonGlow: string; // the halo around the moon, painted over the clouds
  far: Ramp;
  mid: Ramp;
  near: Ramp; // the ground of our hillside, under the grass
  bush: Ramp;
  rock: Ramp;
  grass: Ramp; // blade base to tip; the lightest colors show where the wind bends it
  flowers: Ramp;
}

export const DAY: ScenePalette = {
  night: false,
  sky: smoothRamp(14, '#2462c4', '#3f86dc', '#79b3ec', '#b9daf3', '#e4f2f6'),
  cloud: ramp('#b3c3dc', '#cfdbeb', '#e6edf6', '#ffffff', '#fffcf1'),
  moonGlow: '',
  far: ramp('#58829f', '#6894ae', '#7ba6bd', '#91b8ca', '#acccd7'),
  mid: ramp('#2c6638', '#3a7a3f', '#4d9046', '#66a64e', '#84bc5b', '#a6d26b'),
  near: ramp('#3b772b', '#4c8c32', '#61a23a', '#7ab844', '#97cb55', '#badc70', '#d9ea96'),
  bush: ramp('#1d4724', '#295c2b', '#387332', '#4f8d3c', '#6ca748', '#8cc05a'),
  rock: ramp('#66665f', '#84837a', '#a3a295', '#c4c3b4', '#dddccd'),
  grass: ramp('#22501d', '#2d6425', '#3c7c2b', '#519434', '#6cac3e', '#8cc34c', '#b1d965', '#d5ec90'),
  flowers: ramp('#ffffff', '#fff1a3', '#f6b8c6'),
};

export const NIGHT: ScenePalette = {
  night: true,
  sky: smoothRamp(12, '#050a1d', '#0c1837', '#192d56', '#2d4875'),
  cloud: ramp('#16234a', '#1d2c56', '#253563', '#304272', '#5b6c95'),
  moonGlow: 'rgba(255, 244, 200, 0.32)',
  far: ramp('#122138', '#182a44', '#1f344f', '#283f5b'),
  mid: ramp('#0b1d16', '#10261b', '#163021', '#1d3b29', '#254731'),
  near: ramp('#0e2418', '#132d1d', '#183723', '#1f422a', '#284f32', '#335c3b'),
  bush: ramp('#06120c', '#0b1b12', '#112518', '#183020'),
  rock: ramp('#232a35', '#2f3744', '#3e4756', '#525c6c'),
  grass: ramp('#07180f', '#0c2215', '#122c1b', '#183722', '#20442a', '#2a5234', '#3a6646', '#58866c'),
  flowers: ramp('#9fb0c8', '#b9b48a', '#a68f9f'),
};
