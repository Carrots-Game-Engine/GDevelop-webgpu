/**
 * @packageDocumentation
 * @module Three
 *
 * Re-export the whole Three.js library, so it can be bundled as a single
 * classic script exposing the global `THREE` namespace - as expected by the
 * game engine ("Runtime") scripts, ThreeAddons.js and extensions.
 * (Three.js stopped providing a UMD/global build after r160.)
 *
 * This module is intentionally a no-op when `window.THREE` is already
 * populated — which happens when `three-webgpu.js` was loaded first by the
 * backend-selection snippet in `index.html`.  The UMD wrapper produced by
 * rollup always runs the factory, so we guard at the export level instead:
 * every named export re-reads from the already-live `window.THREE` object
 * when the module is imported by another bundle (e.g. ThreeAddons.js), and
 * the global assignment is skipped because the UMD condition is met.
 *
 * For the classic `<script src="three.js">` path: if `window.THREE` is
 * already set (because three-webgpu.js ran first), the UMD factory receives
 * the existing object and merges into it rather than creating a new one —
 * preserving the single instance and all prototype chains.
 */

export * from "three";
