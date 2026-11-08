import { Color } from 'three';

/** Art-directed colours derived from style/palette.json and the original gameplay image (sRGB hex). */
export const PAL = {
  skyTop: '#1d63d0',
  skyMid: '#3f8fe6',
  skyHorizon: '#a9d8f2',
  cloud: '#fff4dc',
  cloudShade: '#e9c9a3',
  waterDeep: '#08697a',
  waterMid: '#118d99',
  waterShallow: '#36adae',
  foam: '#f4fbfb',
  cliffRed: '#c13539',
  cliffWarm: '#d65a3a',
  cliffLit: '#ec7e4c',
  cliffShadow: '#7e2a2e',
  sand: '#f29e30',
  bank: '#cf7a45',
  boulder: '#5d5c63',
  boulderLight: '#7a7880',
  foliage: '#729a38',
  foliageDark: '#3f6e26',
  foliageLight: '#a9c64c',
  flower: '#ef5aa0',
  flowerCenter: '#ffd447',
  hull: '#d05e20',
  vest: '#f6c240',
  sun: '#ffc531',
  wood: '#8a5a32',
  woodLight: '#b07a46',
  navy: '#12283a',
  cyan: '#34e0e6',
  fog: '#e9d9c4',
};

export const col = (k: keyof typeof PAL) => new Color(PAL[k]);
