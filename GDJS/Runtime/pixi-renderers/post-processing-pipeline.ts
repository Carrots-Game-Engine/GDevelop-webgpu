/*
 * GDevelop JS Platform
 * Copyright 2013-present Florian Rival (Florian.Rival@gmail.com). All rights reserved.
 * This project is released under the MIT License.
 */

namespace gdjs {
  const postProcessingLogger = new gdjs.Logger(
    'Post-processing pipeline'
  );

  /**
   * A post-processing pass that builds a TSL node chain for the WebGPU
   * backend.
   *
   * The WebGPU pipeline (`THREE.RenderPipeline`) has no concept of a list of
   * GLSL passes: effects compose nodes instead. An effect that supports WebGPU
   * implements this interface and registers it with
   * `addPostProcessingPass`. `getOutputNode` receives the node produced by
   * the previous pass (or the scene texture for the first pass) and returns
   * the node to feed the next pass.
   */
  export interface WebGPUPostProcessingPass {
    getOutputNode(inputNode: any): any;
    setSize?(width: number, height: number): void;
    dispose?(): void;
  }

  /**
   * Any pass object accepted by `addPostProcessingPass`, whatever the backend:
   * a `THREE_ADDONS.Pass` (WebGL) or a `WebGPUPostProcessingPass` (WebGPU).
   * The active pipeline keeps the one matching its backend and ignores the
   * others, so effects can register both without knowing which backend runs.
   */
  export type AnyPostProcessingPass =
    | THREE_ADDONS.Pass
    | WebGPUPostProcessingPass;

  /**
   * Backend-agnostic interface of the Three.js post-processing pipeline.
   *
   * Two implementations exist:
   * - `WebGLPostProcessingPipeline` wraps `THREE_ADDONS.EffectComposer`;
   * - `WebGPUPostProcessingPipeline` wraps `THREE.RenderPipeline` + TSL nodes.
   *
   * Both expose the same methods, so callers (the layer renderer, the scene
   * renderer and the effects) don't branch on the backend.
   */
  export interface IPostProcessingPipeline {
    getBackendType(): 'webgl' | 'webgpu';

    addPass(pass: AnyPostProcessingPass, effectName: string): void;
    removePass(pass: AnyPostProcessingPass): void;
    /** Reorder the passes to match the order of the effects of the layer. */
    setPassesOrder(effectNames: string[]): void;
    hasPasses(): boolean;

    /**
     * Replace the pass rendering the scene (used by N8AO). Pass `null` to
     * restore the default scene pass.
     */
    setCustomRenderPass(pass: AnyPostProcessingPass | null): void;
    /** Declare that an effect reads the depth of the scene, or doesn't anymore. */
    setSceneDepthTextureNeeded(isNeeded: boolean): void;
    /**
     * The depth texture of the scene rendered this frame, when the WebGL
     * backend is used and an effect requested it. `null` on WebGPU (depth is
     * read through a node instead, see `WebGPUPostProcessingPipeline`).
     */
    getSceneDepthTexture(): THREE.DepthTexture | null;

    render(): void;
    setSize(width: number, height: number): void;
    setPixelRatio(pixelRatio: number): void;
    dispose(): void;

    /** The underlying `EffectComposer` (WebGL) or `RenderPipeline` (WebGPU). */
    getUnderlyingPipeline(): any;
  }

  /**
   * @returns 4 if the canvas is antialiased and the GPU can multisample
   * half-float render targets 4 times (some can't), 0 otherwise.
   */
  const getHalfFloatRenderTargetSamples = (
    threeRenderer: THREE.WebGLRenderer
  ): integer => {
    const gl = threeRenderer.getContext();
    const contextAttributes = gl.getContextAttributes();
    if (
      !contextAttributes ||
      !contextAttributes.antialias ||
      typeof WebGL2RenderingContext === 'undefined' ||
      !(gl instanceof WebGL2RenderingContext)
    ) {
      return 0;
    }
    const supportedSamples: Int32Array | null = gl.getInternalformatParameter(
      gl.RENDERBUFFER,
      gl.RGBA16F,
      gl.SAMPLES
    );
    return supportedSamples && supportedSamples.includes(4) ? 4 : 0;
  };

  type WebGLPostProcessingPipelineOptions = {
    threeRenderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.Camera;
    antialiasingMode: string;
  };

  /**
   * WebGL implementation of `IPostProcessingPipeline`, wrapping
   * `THREE_ADDONS.EffectComposer` and its GLSL passes.
   */
  export class WebGLPostProcessingPipeline
    implements IPostProcessingPipeline
  {
    private _threeRenderer: THREE.WebGLRenderer;
    private _scene: THREE.Scene;
    private _camera: THREE.Camera;
    private _composer: THREE_ADDONS.EffectComposer;
    private _renderPass: THREE_ADDONS.RenderPass;
    private _customRenderPass: THREE_ADDONS.N8AOPass | null = null;
    private _sceneDepthRenderPass: THREE_ADDONS.SceneDepthRenderPass | null =
      null;
    private _sceneDepthTextureUsersCount = 0;
    private _postProcessingPasses: Array<{
      pass: THREE_ADDONS.Pass;
      effectName: string;
    }> = [];
    // The antialiasing (if any) and output passes, after the effects.
    private _finalPasses: THREE_ADDONS.Pass[] = [];
    // The multisampling of the render target in which the scene is rendered
    // with post-processing, like the canvas, so that effects keep its antialiasing.
    private _renderTargetSamples = 0;

    constructor(options: WebGLPostProcessingPipelineOptions) {
      const { threeRenderer, scene, camera, antialiasingMode } = options;
      this._threeRenderer = threeRenderer;
      this._scene = scene;
      this._camera = camera;

      // Keep a stencil buffer when the layer is rendered through
      // post-processing passes, like when it's rendered on the canvas.
      const drawingBufferSize = threeRenderer.getDrawingBufferSize(
        new THREE.Vector2()
      );
      this._renderTargetSamples = getHalfFloatRenderTargetSamples(
        threeRenderer
      );
      this._composer = new THREE_ADDONS.EffectComposer(
        threeRenderer,
        new THREE.WebGLRenderTarget(
          drawingBufferSize.x,
          drawingBufferSize.y,
          { type: THREE.HalfFloatType, stencilBuffer: true }
        )
      );
      this._renderPass = new THREE_ADDONS.RenderPass(scene, camera);
      this._composer.addPass(this._renderPass);

      // SMAA can't smooth thin details (like grass): it's only used
      // when the canvas is not multisampled (on mobile, if disabled).
      if (antialiasingMode !== 'none' && this._renderTargetSamples === 0) {
        this._finalPasses.push(new THREE_ADDONS.SMAAPass());
      }

      const outputPass = new THREE_ADDONS.OutputPass();
      // The composer result is drawn on top of the layers already rendered
      // on the canvas: blend it (the buffers hold premultiplied colors)
      // instead of overwriting everything.
      outputPass.material.transparent = true;
      outputPass.material.depthTest = false;
      outputPass.material.depthWrite = false;
      outputPass.material.blending = THREE.CustomBlending;
      outputPass.material.blendEquation = THREE.AddEquation;
      outputPass.material.blendSrc = THREE.OneFactor;
      outputPass.material.blendDst = THREE.OneMinusSrcAlphaFactor;
      // TODO: the composer blends transparency in linear space, unlike
      // rendering without post-processing (in sRGB space), and the output
      // pass converts premultiplied colors to sRGB. So semi-transparent
      // pixels can be brighter than without effects, especially over
      // the layers below. Fixing this needs a decision on which blending
      // to match, keeping the light added by a bloom on transparent pixels.
      this._finalPasses.push(outputPass);
      for (const pass of this._finalPasses) {
        this._composer.addPass(pass);
      }
    }

    getBackendType(): 'webgl' {
      return 'webgl';
    }

    private static _isWebGLPass(
      pass: AnyPostProcessingPass | null
    ): pass is THREE_ADDONS.Pass {
      return (
        !!pass &&
        typeof (pass as any).setSize === 'function' &&
        !(pass as any).getOutputNode
      );
    }

    addPass(pass: AnyPostProcessingPass, effectName: string) {
      if (!WebGLPostProcessingPipeline._isWebGLPass(pass)) {
        return;
      }
      const renderTarget = this._composer.renderTarget1;
      pass.setSize(renderTarget.width, renderTarget.height);
      this._postProcessingPasses.push({ pass, effectName });
      this._updatePassOrderInternal();
      this._updateSceneRenderPass();
    }

    removePass(pass: AnyPostProcessingPass) {
      if (!WebGLPostProcessingPipeline._isWebGLPass(pass)) {
        return;
      }
      this._postProcessingPasses = this._postProcessingPasses.filter(
        (postProcessingPass) => postProcessingPass.pass !== pass
      );
      this._updatePassOrderInternal();
      this._updateSceneRenderPass();
    }

    setPassesOrder(effectNames: string[]) {
      this._postProcessingPasses.sort(
        (a, b) =>
          effectNames.indexOf(a.effectName) - effectNames.indexOf(b.effectName)
      );
      this._updatePassOrderInternal();
    }

    private _updatePassOrderInternal() {
      const passes = this._composer.passes;
      passes.splice(
        1,
        passes.length - 1,
        ...this._postProcessingPasses.map(({ pass }) => pass),
        ...this._finalPasses
      );
    }

    hasPasses(): boolean {
      return (
        this._composer.passes[0] !== this._renderPass ||
        this._postProcessingPasses.length > 0
      );
    }

    setCustomRenderPass(pass: AnyPostProcessingPass | null) {
      this._customRenderPass = WebGLPostProcessingPipeline._isWebGLPass(pass)
        ? (pass as THREE_ADDONS.N8AOPass)
        : null;
      this._updateSceneRenderPass();
    }

    setSceneDepthTextureNeeded(isNeeded: boolean) {
      this._sceneDepthTextureUsersCount = Math.max(
        0,
        this._sceneDepthTextureUsersCount + (isNeeded ? 1 : -1)
      );
      this._updateSceneRenderPass();
    }

    getSceneDepthTexture(): THREE.DepthTexture | null {
      if (this._customRenderPass) {
        return this._customRenderPass.beautyRenderTarget.depthTexture;
      }
      if (
        this._sceneDepthTextureUsersCount > 0 &&
        this._sceneDepthRenderPass
      ) {
        return this._sceneDepthRenderPass.depthTexture;
      }
      return null;
    }

    private _updateSceneRenderPass() {
      let sceneRenderPass: THREE_ADDONS.Pass = this._renderPass;
      // To keep the antialiasing of the canvas, the scene is rendered in a
      // multisampled render target owned by a pass. The render targets of the
      // composer are only written by full-screen passes: multisampling them
      // would resolve them after each effect.
      if (this._customRenderPass) {
        sceneRenderPass = this._customRenderPass;
        this._setRenderTargetSamples(
          this._customRenderPass.beautyRenderTarget
        );
      } else if (
        this._sceneDepthTextureUsersCount > 0 ||
        (this._renderTargetSamples > 0 &&
          this._postProcessingPasses.length > 0)
      ) {
        if (!this._sceneDepthRenderPass) {
          this._sceneDepthRenderPass = new THREE_ADDONS.SceneDepthRenderPass(
            this._scene,
            this._camera
          );
        }
        sceneRenderPass = this._sceneDepthRenderPass;
        this._setRenderTargetSamples(this._sceneDepthRenderPass.renderTarget);
        // The depth is only copied from the samples when an effect reads it.
        this._sceneDepthRenderPass.renderTarget.resolveDepthBuffer =
          this._sceneDepthTextureUsersCount > 0;
      }
      const previousSceneRenderPass = this._composer.passes[0];
      if (previousSceneRenderPass === sceneRenderPass) {
        return;
      }
      if (previousSceneRenderPass === this._sceneDepthRenderPass) {
        // Free the render target until the pass is used again.
        this._sceneDepthRenderPass.renderTarget.dispose();
      }
      // The pass was not resized with the composer while it was not in it.
      const renderTarget = this._composer.renderTarget1;
      sceneRenderPass.setSize(renderTarget.width, renderTarget.height);
      this._composer.passes[0] = sceneRenderPass;
    }

    private _setRenderTargetSamples(renderTarget: THREE.WebGLRenderTarget) {
      if (renderTarget.samples === this._renderTargetSamples) {
        return;
      }
      renderTarget.samples = this._renderTargetSamples;
      // Recreate the WebGL buffers with the new number of samples.
      renderTarget.dispose();
    }

    render() {
      // The composer result is drawn on top of the layers already rendered on
      // the canvas: clear the color with a null alpha so that the layers below
      // remain visible (the output pass blends the result).
      const clearAlpha = this._threeRenderer.getClearAlpha();
      this._threeRenderer.setClearAlpha(0);
      this._composer.render();
      this._threeRenderer.setClearAlpha(clearAlpha);
    }

    setSize(width: number, height: number) {
      this._composer.setSize(width, height);
    }

    setPixelRatio(pixelRatio: number) {
      this._composer.setPixelRatio(pixelRatio);
    }

    dispose() {
      this._composer.dispose();
    }

    getUnderlyingPipeline(): THREE_ADDONS.EffectComposer {
      return this._composer;
    }
  }

  type WebGPUPostProcessingPipelineOptions = {
    renderer: any; // THREE.WebGPURenderer
    scene: THREE.Scene;
    camera: THREE.Camera;
  };

  /**
   * WebGPU implementation of `IPostProcessingPipeline`, wrapping
   * `THREE.RenderPipeline` and composing TSL nodes.
   *
   * Unlike the WebGL composer, this pipeline has no list of GLSL passes: the
   * effects register `WebGPUPostProcessingPass` objects whose `getOutputNode`
   * builds the node chain from the scene texture.
   *
   * Effects that only provide a WebGL `ShaderPass` are ignored here until they
   * are ported to TSL; the scene itself is still rendered through the pipeline.
   */
  export class WebGPUPostProcessingPipeline
    implements IPostProcessingPipeline
  {
    private _pipeline: any = null;
    private _scenePass: any = null;
    private _postProcessingPasses: Array<{
      pass: WebGPUPostProcessingPass;
      effectName: string;
    }> = [];
    private _customRenderPass: WebGPUPostProcessingPass | null = null;
    private _sceneDepthTextureUsersCount = 0;
    private _available: boolean;

    constructor(options: WebGPUPostProcessingPipelineOptions) {
      const { renderer, scene, camera } = options;
      const threeApi = THREE as any;
      this._available =
        typeof threeApi.RenderPipeline === 'function' &&
        !!threeApi.TSL &&
        typeof threeApi.TSL.pass === 'function';
      if (!this._available) {
        postProcessingLogger.warn(
          'THREE.RenderPipeline/TSL are not available: WebGPU post-processing is disabled.'
        );
        return;
      }
      this._pipeline = new threeApi.RenderPipeline(renderer);
      this._scenePass = threeApi.TSL.pass(scene, camera);
      this._rebuildOutputNode();
    }

    getBackendType(): 'webgpu' {
      return 'webgpu';
    }

    private static _isWebGPUPass(
      pass: AnyPostProcessingPass | null
    ): pass is WebGPUPostProcessingPass {
      return !!pass && typeof (pass as any).getOutputNode === 'function';
    }

    private _rebuildOutputNode() {
      if (!this._available || !this._pipeline) {
        return;
      }
      // The scene render pass is always the root of the node graph.
      let node = this._customRenderPass
        ? this._customRenderPass.getOutputNode(this._scenePass)
        : this._scenePass.getTextureNode();
      for (const { pass } of this._postProcessingPasses) {
        node = pass.getOutputNode(node);
      }
      // `RenderPipeline` applies the output tone mapping/color space transform
      // itself (see `outputColorTransform`), so the raw node is used here.
      this._pipeline.outputNode = node;
    }

    addPass(pass: AnyPostProcessingPass, effectName: string) {
      if (!WebGPUPostProcessingPipeline._isWebGPUPass(pass)) {
        return;
      }
      this._postProcessingPasses.push({ pass, effectName });
      this._rebuildOutputNode();
    }

    removePass(pass: AnyPostProcessingPass) {
      if (!WebGPUPostProcessingPipeline._isWebGPUPass(pass)) {
        return;
      }
      this._postProcessingPasses = this._postProcessingPasses.filter(
        (postProcessingPass) => postProcessingPass.pass !== pass
      );
      this._rebuildOutputNode();
    }

    setPassesOrder(effectNames: string[]) {
      this._postProcessingPasses.sort(
        (a, b) =>
          effectNames.indexOf(a.effectName) - effectNames.indexOf(b.effectName)
      );
      this._rebuildOutputNode();
    }

    hasPasses(): boolean {
      return (
        !!this._customRenderPass || this._postProcessingPasses.length > 0
      );
    }

    setCustomRenderPass(pass: AnyPostProcessingPass | null) {
      this._customRenderPass = WebGPUPostProcessingPipeline._isWebGPUPass(pass)
        ? pass
        : null;
      this._rebuildOutputNode();
    }

    setSceneDepthTextureNeeded(isNeeded: boolean) {
      this._sceneDepthTextureUsersCount = Math.max(
        0,
        this._sceneDepthTextureUsersCount + (isNeeded ? 1 : -1)
      );
    }

    getSceneDepthTexture(): THREE.DepthTexture | null {
      // WebGPU effects read the depth through a TSL node
      // (`getSceneDepthNode`), not a Three.js texture.
      return null;
    }

    /**
     * The TSL node giving the depth of the scene, for WebGPU effects that
     * declared it needed it with `setSceneDepthTextureNeeded`.
     */
    getSceneDepthNode(): any {
      if (!this._available || !this._scenePass) {
        return null;
      }
      return this._scenePass.getTextureNode('depth');
    }

    isSceneDepthTextureNeeded(): boolean {
      return this._sceneDepthTextureUsersCount > 0;
    }

    render() {
      if (!this._available || !this._pipeline) {
        return;
      }
      this._pipeline.render();
    }

    setSize(width: number, height: number) {
      // `RenderPipeline`/`PassNode` read the size from the renderer, which the
      // game renderer already resizes. Nothing to do here.
    }

    setPixelRatio(pixelRatio: number) {
      // Same as `setSize`: the renderer owns the pixel ratio.
    }

    dispose() {
      if (this._pipeline && typeof this._pipeline.dispose === 'function') {
        this._pipeline.dispose();
      }
      for (const { pass } of this._postProcessingPasses) {
        if (pass.dispose) pass.dispose();
      }
      this._postProcessingPasses = [];
    }

    getUnderlyingPipeline(): any {
      return this._pipeline;
    }
  }
}
