/**
 * @packageDocumentation
 * @module ThreeWebGPUTslDisplay
 *
 * Re-export the Three.js TSL "display" post-processing nodes (the node-based
 * equivalent of the WebGL `examples/jsm/postprocessing` passes) so they are
 * bundled into `three-webgpu.js` and exposed on the global `THREE` namespace.
 *
 * These nodes are the WebGPU way to build post-processing: instead of a
 * `EffectComposer` + `ShaderPass` (GLSL), WebGPU uses `THREE.RenderPipeline`
 * (also exported as the deprecated `THREE.PostProcessing`) with TSL nodes
 * such as `bloom()`, `dof()`, `ao()`, `smaa()`…
 *
 * They require the TSL/nodes system that ships with `three/webgpu`, which is
 * why they live in this bundle (and not in `ThreeAddons.js`, which is loaded
 * for both backends and only externalizes the plain `three` global).
 *
 * ## Usage
 *
 * The non-display TSL helpers (`pass`, `mrt`, `renderOutput`, `uniform`, …)
 * are reachable through the `THREE.TSL` namespace; the display nodes listed
 * here are exported at the top level of `THREE`:
 *
 * ```js
 * const pipeline = new THREE.RenderPipeline(renderer);
 * const scenePass = THREE.TSL.pass(scene, camera);
 * const color = scenePass.getTextureNode();
 * pipeline.outputNode = THREE.TSL.renderOutput(
 *   color.add(THREE.bloom(color, 0.8, 0.4))
 * );
 * pipeline.render();
 * ```
 *
 * Note: these named exports (`THREE.bloom`, `THREE.dof`, …) only exist when
 * the WebGPU bundle was loaded. Code that also runs on the WebGL backend must
 * guard with `typeof THREE.bloom === 'function'`.
 */

export * from 'three/addons/tsl/display/AfterImageNode.js';
export * from 'three/addons/tsl/display/AnaglyphPassNode.js';
export * from 'three/addons/tsl/display/BilateralBlurNode.js';
export * from 'three/addons/tsl/display/BleachBypass.js';
export * from 'three/addons/tsl/display/BloomNode.js';
export * from 'three/addons/tsl/display/ChromaticAberrationNode.js';
export * from 'three/addons/tsl/display/CRT.js';
export * from 'three/addons/tsl/display/DenoiseNode.js';
export * from 'three/addons/tsl/display/DepthOfFieldNode.js';
export * from 'three/addons/tsl/display/DotScreenNode.js';
export * from 'three/addons/tsl/display/FilmNode.js';
export * from 'three/addons/tsl/display/FSR1Node.js';
export * from 'three/addons/tsl/display/FXAANode.js';
export * from 'three/addons/tsl/display/GaussianBlurNode.js';
export * from 'three/addons/tsl/display/GodraysNode.js';
export * from 'three/addons/tsl/display/GTAONode.js';
export * from 'three/addons/tsl/display/ImportanceSampledEnvironment.js';
export * from 'three/addons/tsl/display/LensflareNode.js';
export * from 'three/addons/tsl/display/Lut3DNode.js';
export * from 'three/addons/tsl/display/MotionBlur.js';
export * from 'three/addons/tsl/display/OutlineNode.js';
export * from 'three/addons/tsl/display/ParallaxBarrierPassNode.js';
export * from 'three/addons/tsl/display/PixelationPassNode.js';
export * from 'three/addons/tsl/display/RecurrentDenoiseNode.js';
export * from 'three/addons/tsl/display/RetroPassNode.js';
export * from 'three/addons/tsl/display/RGBShiftNode.js';
export * from 'three/addons/tsl/display/Sepia.js';
export * from 'three/addons/tsl/display/Shape.js';
export * from 'three/addons/tsl/display/SharpenNode.js';
export * from 'three/addons/tsl/display/SMAANode.js';
export * from 'three/addons/tsl/display/SobelOperatorNode.js';
export * from 'three/addons/tsl/display/SSAAPassNode.js';
export * from 'three/addons/tsl/display/SSGINode.js';
export * from 'three/addons/tsl/display/SSRNode.js';
export * from 'three/addons/tsl/display/SSSNode.js';
export * from 'three/addons/tsl/display/StereoCompositePassNode.js';
export * from 'three/addons/tsl/display/StereoPassNode.js';
export * from 'three/addons/tsl/display/TAAUNode.js';
export * from 'three/addons/tsl/display/TemporalReprojectNode.js';
export * from 'three/addons/tsl/display/TRAANode.js';
export * from 'three/addons/tsl/display/TransitionNode.js';
export * from 'three/addons/tsl/display/boxBlur.js';
export * from 'three/addons/tsl/display/depthAwareBlend.js';
export * from 'three/addons/tsl/display/hashBlur.js';
export * from 'three/addons/tsl/display/radialBlur.js';
