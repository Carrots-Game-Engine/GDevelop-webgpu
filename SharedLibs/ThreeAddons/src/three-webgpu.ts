/**
 * @packageDocumentation
 * @module ThreeWebGPU
 *
 * Re-export the whole Three.js WebGPU bundle so it can be built as a single
 * classic script exposing the global `THREE` namespace - identical shape to
 * `three.ts` / `dist/three.js` but including `WebGPURenderer`, `WebGPUBackend`,
 * TSL node materials and the new renderer architecture.
 *
 * Loading this file replaces `three.js` entirely: the same `window.THREE`
 * global is populated, so every `THREE.Mesh`, `THREE.Scene`, etc. created by
 * the game engine and extensions comes from the same module instance.
 *
 * **Never load both `three.js` and `three-webgpu.js` in the same page.** The
 * choice is made once, before any script runs, by a small inline snippet in
 * `index.html` that reads the game's `threeBackend` setting. When this bundle
 * runs first, `three.js` (still listed in GDJS_CODE_FILES) detects
 * `THREE.WebGPURenderer` and skips its own body.
 *
 * The TSL display post-processing nodes (`THREE.bloom`, `THREE.dof`,
 * `THREE.ao`, `THREE.smaa`, ...) are bundled too: see `./tsl-display`.
 */

export * from "three/webgpu";
export * from './tsl-display';

// `three/webgpu` does not re-export the WebGL-only shader helpers that the
// GDevelop Three.js addons (`THREE_ADDONS`) still import, and use at
// construction time - for example `ShaderPass` clones its uniforms with
// `UniformsUtils.clone`. Without them, building any addon (a post-processing
// pass, N8AO, ...) throws on the WebGPU backend.
//
// They come from the WebGL build (`three.module.js`) but the class/object
// definitions themselves live in `three.core.js`, which `three/webgpu` already
// imports too: Rollup deduplicates that shared module, so there is no second
// Three.js core and `instanceof` checks stay valid.
export { UniformsUtils, UniformsLib } from 'three';
