/*
 * GDevelop JS Platform
 * Copyright 2013-present Florian Rival (Florian.Rival@gmail.com). All rights reserved.
 * This project is released under the MIT License.
 */
namespace gdjs {
  const logger = new gdjs.Logger('ThreeRendererAdapter');

  // ───────────────────────────────────────────────────────────────────────────
  // Shared options — passed to every backend at init time.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Options forwarded to the active {@link IThreeBackend} at init time.
   * All optional fields have GDevelop-appropriate defaults.
   */
  export interface ThreeRendererAdapterOptions {
    /** The HTMLCanvasElement that the backend (and the shared PixiJS context) will draw on. */
    canvas: HTMLCanvasElement;
    /** Enable the stencil buffer (required for several post-processing passes). Default: true. */
    stencil?: boolean;
    /** Enable hardware MSAA anti-aliasing on the main framebuffer. Default: false. */
    antialias?: boolean;
    /**
     * Keep the drawing buffer between frames so that screenshots work.
     * Must be true when sharing the canvas with PixiJS.  Default: true.
     */
    preserveDrawingBuffer?: boolean;
    /** GPU power preference hint. Default: 'high-performance'. */
    powerPreference?: 'default' | 'high-performance' | 'low-power';
    /** Initial rendering width in pixels. */
    width: integer;
    /** Initial rendering height in pixels. */
    height: integer;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Backend interface — one implementation per GPU API (WebGL, WebGPU, …)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Contract that every rendering backend must satisfy.
   *
   * A backend owns **one** `THREE.WebGLRenderer` (or its future WebGPU
   * equivalent) and exposes the five operations that the GDevelop runtime
   * pipeline needs:
   *
   * | Method | When called |
   * |---|---|
   * | `init` | Once, before any rendering. |
   * | `render` | Every frame, once per 3-D layer. |
   * | `resize` | When the game resolution changes. |
   * | `resetState` | Before switching between Three.js and PixiJS. |
   * | `dispose` | On game teardown. |
   *
   * @category Renderers
   */
  export interface IThreeBackend {
    /**
     * Create the underlying GPU renderer and set the GDevelop-required
     * default state (shadow maps, `autoClear = false`, initial size …).
     *
     * @returns `true` on success, `false` if the API is unavailable or the
     *          context could not be obtained (engine falls back to 2-D only).
     */
    init(options: ThreeRendererAdapterOptions): boolean;

    /**
     * Render `scene` from the perspective of `camera`.
     *
     * Does **not** call `resetState()` or `clear()` — the caller owns that
     * responsibility (mirroring `RuntimeScenePixiRenderer.render()`).
     */
    render(scene: THREE.Scene, camera: THREE.Camera): void;

    /**
     * Update the drawing-buffer dimensions.
     * Call whenever the game resolution changes.
     */
    resize(width: integer, height: integer): void;

    /**
     * Restore the GPU state to a neutral baseline so that Three.js and PixiJS
     * can safely interleave on the same context.
     *
     * **Do not call in VR mode** (`xr.isPresenting === true`) — WebXR leaves
     * the context in a state that must not be reset.
     */
    resetState(): void;

    /**
     * Release all GPU resources.  After this call `getThreeRenderer()` returns
     * `null` and `init()` may be called again.
     */
    dispose(): void;

    /**
     * Return the underlying `THREE.WebGLRenderer`, or `null` when the backend
     * is not initialised / has been disposed.
     *
     * Parts of the engine that still need the raw renderer (e.g.
     * `EffectComposer`, `layer-pixi-renderer.ts`) use this accessor.
     */
    getThreeRenderer(): THREE.WebGLRenderer | null;

    /**
     * Return the raw WebGL context shared with PixiJS, or `null`.
     */
    getContext(): WebGL2RenderingContext | WebGLRenderingContext | null;

    /** `true` while the backend holds a live renderer. */
    isInitialized(): boolean;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // WebGL backend — the production implementation (Three.js WebGLRenderer)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The WebGL backend: wraps `THREE.WebGLRenderer`.
   *
   * This is the first (and currently only) concrete {@link IThreeBackend}.
   * A WebGPU backend will implement the same interface when ready.
   *
   * @category Renderers
   */
  export class WebGLBackend implements IThreeBackend {
    private _renderer: THREE.WebGLRenderer | null = null;

    init(options: ThreeRendererAdapterOptions): boolean {
      if (this._renderer) {
        logger.error(
          'WebGLBackend.init() called while a renderer already exists. ' +
            'Call dispose() first.'
        );
        return false;
      }

      if (typeof THREE === 'undefined') {
        logger.warn(
          'Three.js is not available; WebGLBackend will not be initialised.'
        );
        return false;
      }

      try {
        this._renderer = new THREE.WebGLRenderer({
          canvas: options.canvas,
          stencil: options.stencil !== undefined ? options.stencil : true,
          antialias: options.antialias !== undefined ? options.antialias : false,
          preserveDrawingBuffer:
            options.preserveDrawingBuffer !== undefined
              ? options.preserveDrawingBuffer
              : true,
          powerPreference: options.powerPreference || 'high-performance',
        });
      } catch (error) {
        logger.error(
          'THREE.WebGLRenderer constructor threw; falling back to 2-D only rendering:',
          error
        );
        this._renderer = null;
        return false;
      }

      // ── GDevelop-required default state ──────────────────────────────────
      this._renderer.shadowMap.enabled = true;
      // PCFSoftShadowMap is deprecated since Three.js r180 and replaced by
      // PCFShadowMap (with a warning) when rendering.
      this._renderer.shadowMap.type = THREE.PCFShadowMap;

      // GDevelop clears manually (per-layer); disable the automatic clear.
      this._renderer.autoClear = false;

      this._renderer.setSize(options.width, options.height);

      return true;
    }

    render(scene: THREE.Scene, camera: THREE.Camera): void {
      if (!this._renderer) return;
      this._renderer.render(scene, camera);
    }

    resize(width: integer, height: integer): void {
      if (!this._renderer) return;
      this._renderer.setSize(width, height);
    }

    resetState(): void {
      if (!this._renderer) return;
      this._renderer.resetState();
    }

    dispose(): void {
      if (!this._renderer) return;
      this._renderer.dispose();
      this._renderer = null;
    }

    getThreeRenderer(): THREE.WebGLRenderer | null {
      return this._renderer;
    }

    getContext(): WebGL2RenderingContext | WebGLRenderingContext | null {
      return this._renderer ? this._renderer.getContext() : null;
    }

    isInitialized(): boolean {
      return this._renderer !== null;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ThreeRendererAdapter — public facade used by the rest of the engine
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Public facade that owns one {@link IThreeBackend} and delegates every
   * rendering call to it.
   *
   * Callers (e.g. `RuntimeGamePixiRenderer`) interact only with this class and
   * never with a concrete backend directly.  Swapping the GPU API (WebGL →
   * WebGPU) is therefore a one-line change inside `createBackend()`.
   *
   * ### Typical lifecycle
   * ```ts
   * const adapter = new gdjs.ThreeRendererAdapter('webgl');
   * const ok = adapter.init({ canvas, width, height, ... });
   * if (ok) {
   *   const gl = adapter.getContext();   // share with PixiJS
   *   const three = adapter.getThreeRenderer(); // pass to EffectComposer etc.
   * }
   * // … per frame …
   * adapter.resetState();
   * adapter.render(scene, camera);
   * // … on teardown …
   * adapter.dispose();
   * ```
   *
   * @category Renderers
   */
  export class ThreeRendererAdapter {
    private readonly _backend: IThreeBackend;

    /**
     * @param backendType  Which GPU API to use.  Pass the value returned by
     *                     `gdjs.RuntimeGame.getThreeBackend()`.
     */
    constructor(backendType: 'webgl' | 'webgpu') {
      this._backend = ThreeRendererAdapter.createBackend(backendType);
    }

    /**
     * Factory: instantiate the right {@link IThreeBackend} for `backendType`.
     *
     * Adding a new backend means adding a branch here — no other file needs to
     * change.
     */
    static createBackend(backendType: 'webgl' | 'webgpu'): IThreeBackend {
      switch (backendType) {
        case 'webgpu':
          // WebGPU backend is not yet implemented; fall through with a warning.
          logger.warn(
            "WebGPU backend requested but not yet implemented; falling back to 'webgl'."
          );
        // fall through
        case 'webgl':
        default:
          return new gdjs.WebGLBackend();
      }
    }

    // ── Delegated lifecycle ──────────────────────────────────────────────────

    /**
     * Initialise the backend.  Must be called once before `render()` /
     * `resize()`.
     *
     * @returns `true` on success, `false` when the GPU API is unavailable
     *          (the engine will fall back to 2-D only rendering).
     */
    init(options: ThreeRendererAdapterOptions): boolean {
      return this._backend.init(options);
    }

    /**
     * Render `scene` from the perspective of `camera`.
     *
     * Does **not** call `resetState()` or `clear()` — the caller is
     * responsible for those (as `RuntimeScenePixiRenderer.render()` does
     * today).  No-ops silently when not initialised.
     */
    render(scene: THREE.Scene, camera: THREE.Camera): void {
      this._backend.render(scene, camera);
    }

    /**
     * Update the drawing-buffer dimensions.  Call whenever the game
     * resolution changes.  No-ops silently when not initialised.
     */
    resize(width: integer, height: integer): void {
      this._backend.resize(width, height);
    }

    /**
     * Reset the GPU state to a neutral baseline.
     *
     * Call before switching between Three.js and PixiJS rendering within the
     * same frame.  **Do not call in VR mode** (`xr.isPresenting === true`).
     * No-ops silently when not initialised.
     */
    resetState(): void {
      this._backend.resetState();
    }

    /**
     * Release all GPU resources held by the backend.
     * Calling `dispose()` on an already-disposed adapter is a no-op.
     */
    dispose(): void {
      this._backend.dispose();
    }

    // ── Accessors ────────────────────────────────────────────────────────────

    /**
     * Return the underlying `THREE.WebGLRenderer`, or `null` when the adapter
     * is not initialised or has been disposed.
     *
     * Use this to pass the renderer to engine parts that still need the raw
     * object (e.g. `EffectComposer` construction, `getContext()` in
     * `layer-pixi-renderer.ts`).
     */
    getThreeRenderer(): THREE.WebGLRenderer | null {
      return this._backend.getThreeRenderer();
    }

    /**
     * Return the raw WebGL context shared with PixiJS, or `null`.
     *
     * This context is shared between Three.js and PixiJS, enabling 2-D and
     * 3-D rendering to interleave on the same canvas.
     */
    getContext(): WebGL2RenderingContext | WebGLRenderingContext | null {
      return this._backend.getContext();
    }

    /**
     * `true` while the adapter holds a live, initialised backend.
     */
    isInitialized(): boolean {
      return this._backend.isInitialized();
    }

    /**
     * Return the name of the active backend type ('webgl' or 'webgpu').
     */
    getBackendType(): 'webgl' | 'webgpu' {
      // Derived from the concrete type, avoids storing a redundant field.
      return this._backend instanceof gdjs.WebGLBackend ? 'webgl' : 'webgpu';
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Top-level helper — reads the backend from game data
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Return the Three.js rendering backend requested by `game`'s project data.
   *
   * This is the single call site that reads `threeBackend` from the project
   * properties so that every other part of the engine just calls this function
   * without caring about how the setting is stored.
   *
   * ```ts
   * const backend = gdjs.getThreeBackend(runtimeGame);
   * // → 'webgl' | 'webgpu'
   * const adapter = new gdjs.ThreeRendererAdapter(backend);
   * ```
   */
  export function getThreeBackend(
    game: gdjs.RuntimeGame
  ): 'webgl' | 'webgpu' {
    return game.getThreeBackend();
  }
}
