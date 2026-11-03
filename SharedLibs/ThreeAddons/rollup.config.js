//import pkg from "./package.json";
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';

export default [
  {
    // Bundle the whole Three.js library as a classic script exposing the
    // global `THREE` namespace (Three.js stopped providing such a build
    // after r160). The bundle is written directly to the game engine
    // ("Runtime") files, where it's expected to be a plain script setting
    // a global - like pixi.js and ThreeAddons.js.
    input: './src/three.ts',
    output: [
      {
        name: 'THREE',
        format: 'umd',
        file: './dist/three.js',
        sourcemap: true,
      },
      {
        name: 'THREE',
        format: 'umd',
        file: '../../GDJS/Runtime/pixi-renderers/three.js',
        sourcemap: false,
      },
    ],
    plugins: [
      resolve({
        extensions: ['.js'],
      }),
      terser(),
      json(),
    ],
  },
  {
    // Bundle the Three.js *WebGPU* flavour as a classic UMD script that also
    // exposes `window.THREE`.  Loaded *instead of* (never alongside) three.js
    // when the project sets `threeBackend = "webgpu"`.
    //
    // `three/webgpu` re-exports the full Three.js core PLUS WebGPURenderer,
    // WebGPUBackend, WebGLBackend and the TSL node-material system — all from
    // a single module instance, so instanceof checks and isMesh() keep working.
    input: './src/three-webgpu.ts',
    output: [
      {
        name: 'THREE',
        format: 'umd',
        file: './dist/three-webgpu.js',
        sourcemap: true,
      },
      {
        name: 'THREE',
        format: 'umd',
        file: '../../GDJS/Runtime/pixi-renderers/three-webgpu.js',
        sourcemap: false,
      },
    ],
    plugins: [
      resolve({
        extensions: ['.js', '.ts'],
      }),
      terser(),
      json(),
    ],
  },
  {
  	input: './src/index.ts',
  	output: [
      {
        name: 'THREE_ADDONS',
        format: 'umd',
        file: './dist/ThreeAddons.js',
        sourcemap: true,
        plugins: [],
        globals: {
          'three': 'THREE',
        },
      },
      {
        name: 'THREE_ADDONS',
        format: 'umd',
        file: '../../GDJS/Runtime/pixi-renderers/ThreeAddons.js',
        sourcemap: false,
        plugins: [],
        globals: {
          'three': 'THREE',
        },
      },
    ],
  	external: ['three'],
    plugins: [
      resolve({
          extensions: ['.js'],
      }),
			terser(),
      json(),
    ],
  },
];
