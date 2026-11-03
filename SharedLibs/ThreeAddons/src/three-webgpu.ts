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
 */

export * from "three/webgpu";
