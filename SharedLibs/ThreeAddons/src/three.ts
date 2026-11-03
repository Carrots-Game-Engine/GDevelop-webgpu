/**
 * @packageDocumentation
 * @module Three
 *
 * Re-export the whole Three.js library, so it can be bundled as a single
 * classic script exposing the global `THREE` namespace - as expected by the
 * game engine ("Runtime") scripts, ThreeAddons.js and extensions.
 * (Three.js stopped providing a UMD/global build after r160.)
 *
 * This bundle is a no-op when `three-webgpu.js` was loaded first by the
 * backend-selection snippet in `index.html`. The rollup config emits the
 * bundle with `extend: true` (so the UMD wrapper keeps the existing
 * `window.THREE` object instead of replacing it) and wraps the bundle body
 * in a guard checking `window.THREE.WebGPURenderer`.
 *
 * Never load any other Three.js build alongside this one: two module
 * instances would break `instanceof` checks (isMesh, isObject3D, ...).
 */

export * from "three";
