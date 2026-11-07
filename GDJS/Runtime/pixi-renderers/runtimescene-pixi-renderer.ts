namespace gdjs {
  /**
   * The renderer for a gdjs.RuntimeScene using Pixi.js.
   * @category Renderers > Scene
   */
  export class RuntimeScenePixiRenderer
    implements gdjs.RuntimeInstanceContainerPixiRenderer
  {
    private _runtimeGameRenderer: gdjs.RuntimeGamePixiRenderer | null;
    private _runtimeScene: gdjs.RuntimeScene;
    private _pixiContainer: PIXI.Container;
    private _profilerText: PIXI.Text | null = null;
    private _showCursorAtNextRender: boolean = false;
    private _threeRenderer: THREE.WebGLRenderer | null = null;
    private _layerRenderingMetrics: {
      rendered2DLayersCount: number;
      rendered3DLayersCount: number;
    } = {
      rendered2DLayersCount: 0,
      rendered3DLayersCount: 0,
    };
    private _backgroundColor: THREE.Color | null = null;

    constructor(
      runtimeScene: gdjs.RuntimeScene,
      runtimeGameRenderer: gdjs.RuntimeGamePixiRenderer | null
    ) {
      this._runtimeGameRenderer = runtimeGameRenderer;
      this._runtimeScene = runtimeScene;
      this._pixiContainer = new PIXI.Container();

      // Contains the layers of the scene (and, optionally, debug PIXI objects).
      this._pixiContainer.sortableChildren = true;

      this._threeRenderer = this._runtimeGameRenderer
        ? this._runtimeGameRenderer.getThreeRenderer()
        : null;
    }

    onGameResolutionResized() {
      const pixiRenderer = this._runtimeGameRenderer
        ? this._runtimeGameRenderer.getPIXIRenderer()
        : null;
      if (!pixiRenderer) {
        return;
      }
      const runtimeGame = this._runtimeScene.getGame();

      // TODO (3D): should this be done for each individual layer?
      // Especially if we remove _pixiContainer entirely.
      this._pixiContainer.scale.x =
        pixiRenderer.width / runtimeGame.getGameResolutionWidth();
      this._pixiContainer.scale.y =
        pixiRenderer.height / runtimeGame.getGameResolutionHeight();

      for (const runtimeLayer of this._runtimeScene._orderedLayers) {
        runtimeLayer.getRenderer().onGameResolutionResized();
      }
    }

    onSceneUnloaded() {
      // TODO (3D): call the method with the same name on RuntimeLayers so they can dispose?
    }

    /**
     * Draw the scene.
     * @param options See `gdjs.RuntimeScene.render`.
     */
    render(options?: gdjs.RuntimeSceneRenderOptions) {
      const runtimeGameRenderer = this._runtimeGameRenderer;
      if (!runtimeGameRenderer) return;

      const pixiRenderer = runtimeGameRenderer.getPIXIRenderer();
      if (!pixiRenderer) return;

      const threeRenderer = this._threeRenderer;
      const isBackgroundColorForced =
        !!options && options.backgroundColor !== undefined;
      const backgroundColor =
        options && options.backgroundColor !== undefined
          ? options.backgroundColor
          : this._runtimeScene.getBackgroundColor();
      const shouldClearCanvas =
        isBackgroundColorForced || this._runtimeScene.getClearCanvas();

      // If we are in VR, we cannot render like this: we must use the special VR
      // rendering method to not display a black screen.
      //
      // We cannot call it here either - the headset will request a frame to be rendered
      // whenever it wants and we must oblige, however this will  be called whenever
      // we do a step - and we may step multiple times or none at all depending on the
      // min/max FPS and possibly other factors, and the headset will not allow that.
      //
      // It is therefore left to the VR extension to call the VR rendering method whenever
      // the headset require a new image, we'll just disable rendering when stepping to
      // not interfere with the headset's rendering.
      if (threeRenderer && threeRenderer.xr.isPresenting) return;

      this._layerRenderingMetrics.rendered2DLayersCount = 0;
      this._layerRenderingMetrics.rendered3DLayersCount = 0;

      if (threeRenderer) {
        // Layered 2D, 3D or 2D+3D rendering.
        threeRenderer.info.autoReset = false;
        threeRenderer.info.reset();

        /** Useful to render the background color. */
        let isFirstRender = true;

        /**
         * true if the last layer rendered 3D objects using Three.js, false otherwise.
         * Useful to avoid needlessly resetting the WebGL states between layers (which can be expensive).
         */
        let lastRenderWas3D = true;

        // Even if no rendering at all has been made already, setting up the Three.js/PixiJS renderers
        // might have changed some WebGL states already. Reset the state for the very first frame.
        // And, out of caution, keep doing it for every frame.
        // TODO (3D): optimization - check if this can be done only on the very first frame.
        threeRenderer.resetState();

        // Render each layer one by one.
        for (let i = 0; i < this._runtimeScene._orderedLayers.length; ++i) {
          const runtimeLayer = this._runtimeScene._orderedLayers[i];
          if (!runtimeLayer.isVisible()) continue;

          const runtimeLayerRenderer = runtimeLayer.getRenderer();
          const runtimeLayerRenderingType = runtimeLayer.getRenderingType();
          const camerasToRender = this._getCamerasToRender(runtimeLayer);
          const isMultiCamera = camerasToRender.length > 1;
          const activeCameraIndex = runtimeLayer.getActiveCameraIndex();

          if (!this._shouldRenderLayerIn3D(runtimeLayer)) {
            // Render a layer with 2D rendering (PixiJS).

            if (lastRenderWas3D) {
              // Ensure the state is clean for PixiJS to render.
              threeRenderer.resetState();
              pixiRenderer.reset();
            }

            if (isFirstRender) {
              // Render the background color.
              pixiRenderer.background.color = backgroundColor;
              pixiRenderer.background.alpha = 1;
              if (shouldClearCanvas) pixiRenderer.clear();

              isFirstRender = false;
            }

            if (runtimeLayer.isLightingLayer()) {
              // Render the lights on the render texture used then by the lighting Sprite.
              runtimeLayerRenderer.renderOnPixiRenderTexture(pixiRenderer);
            }

            // TODO (2d lights): refactor to remove the need for `getLightingSprite`.
            const pixiContainer =
              (runtimeLayer.isLightingLayer() &&
                runtimeLayerRenderer.getLightingSprite()) ||
              runtimeLayerRenderer.getRendererObject();

            if (isMultiCamera) {
              for (const { cameraIndex, viewport } of camerasToRender) {
                if (viewport.width <= 0 || viewport.height <= 0) continue;
                if (runtimeLayer.getActiveCameraIndex() !== cameraIndex) {
                  runtimeLayer.setActiveCamera(cameraIndex);
                } else {
                  runtimeLayerRenderer.updatePosition();
                }
                this._renderPixiContainerInViewport(
                  pixiRenderer,
                  pixiContainer,
                  viewport
                );
              }
              // Restore the whole canvas for the next layers.
              pixiRenderer.renderTexture.bind(undefined);
              if (runtimeLayer.getActiveCameraIndex() !== activeCameraIndex) {
                runtimeLayer.setActiveCamera(activeCameraIndex);
              }
            } else {
              pixiRenderer.render(pixiContainer, { clear: false });
            }
            this._layerRenderingMetrics.rendered2DLayersCount++;

            lastRenderWas3D = false;
          } else {
            // Render a layer with 3D rendering, and possibly some 2D rendering too.
            const threeScene = runtimeLayerRenderer.getThreeScene();
            const threeCamera = runtimeLayerRenderer.getThreeCamera();
            const threeEffectComposer =
              runtimeLayerRenderer.getThreeEffectComposer();

            // Render the 3D objects of this layer.
            if (threeScene && threeCamera && threeEffectComposer) {
              if (isMultiCamera) {
                const layerHas2DObjectsToRender =
                  runtimeLayerRenderingType ===
                    gdjs.RuntimeLayerRenderingType.TWO_D_PLUS_THREE_D &&
                  runtimeLayerRenderer.has2DObjects();
                this._render3DLayerWithMultipleCameras(
                  runtimeLayer,
                  runtimeLayerRenderer,
                  threeRenderer,
                  pixiRenderer,
                  threeScene,
                  threeEffectComposer,
                  camerasToRender,
                  activeCameraIndex,
                  backgroundColor,
                  isBackgroundColorForced,
                  shouldClearCanvas,
                  isFirstRender,
                  lastRenderWas3D
                );
                if (layerHas2DObjectsToRender) {
                  this._layerRenderingMetrics.rendered2DLayersCount++;
                }
                this._layerRenderingMetrics.rendered3DLayersCount++;
                isFirstRender = false;
                lastRenderWas3D = true;
              } else {
                // TODO (3D) - optimization: do this at the beginning for all layers that are 2d+3d?
                // So the second pass is clearer (just rendering 2d or 3d layers without doing PixiJS renders in between).
                if (
                  runtimeLayerRenderingType ===
                  gdjs.RuntimeLayerRenderingType.TWO_D_PLUS_THREE_D
                ) {
                  const layerHas2DObjectsToRender =
                    runtimeLayerRenderer.has2DObjects();

                  if (layerHas2DObjectsToRender) {
                    if (lastRenderWas3D) {
                      // Ensure the state is clean for PixiJS to render.
                      threeRenderer.resetState();
                      pixiRenderer.reset();
                    }

                    // Do the rendering of the PixiJS objects of the layer on the render texture.
                    // Then, update the texture of the plane showing the PixiJS rendering,
                    // so that the 2D rendering made by PixiJS can be shown in the 3D world.
                    runtimeLayerRenderer.renderOnPixiRenderTexture(
                      pixiRenderer
                    );
                    runtimeLayerRenderer.updateThreePlaneTextureFromPixiRenderTexture(
                      // The renderers are needed to find the internal WebGL texture.
                      threeRenderer,
                      pixiRenderer
                    );
                    this._layerRenderingMetrics.rendered2DLayersCount++;

                    lastRenderWas3D = false;
                  }
                  runtimeLayerRenderer.show2DRenderingPlane(
                    layerHas2DObjectsToRender
                  );
                }

                if (!lastRenderWas3D) {
                  // It's important to reset the internal WebGL state of PixiJS, then Three.js
                  // to ensure the 3D rendering is made properly by Three.js
                  pixiRenderer.reset();
                  threeRenderer.resetState();
                }

                // The background shown by an effect (a skybox), replaced by
                // the forced background color while this layer is drawn.
                let replacedThreeSceneBackground:
                  | THREE.Color
                  | THREE.Texture
                  | null = null;
                if (isFirstRender) {
                  // Render the background color.
                  threeRenderer.setClearColor(backgroundColor);
                  threeRenderer.resetState();
                  if (shouldClearCanvas) threeRenderer.clear();
                  if (!this._backgroundColor) {
                    this._backgroundColor = new THREE.Color();
                  }
                  this._backgroundColor.set(backgroundColor);
                  if (
                    isBackgroundColorForced &&
                    threeScene.background &&
                    threeScene.background !== this._backgroundColor
                  ) {
                    replacedThreeSceneBackground = threeScene.background;
                    threeScene.background = this._backgroundColor;
                  }
                  if (!threeScene.background) {
                    threeScene.background = this._backgroundColor;
                  }

                  isFirstRender = false;
                } else {
                  // It's important to set the background to null, as maybe the first rendered
                  // layer has changed and so the Three.js scene background must be reset.
                  if (threeScene.background === this._backgroundColor) {
                    threeScene.background = null;
                  }
                }

                // Clear the depth as each layer is independent and display on top of the previous one,
                // even 3D objects.
                threeRenderer.clearDepth();
                if (runtimeLayerRenderer.hasPostProcessingPass()) {
                  // Whatever the pass rendering the scene is, it must clear the
                  // composer buffers with a transparent color, so that the parts
                  // of the layer where nothing is rendered stay transparent (the
                  // layers rendered before this one must remain visible).
                  const clearAlpha = threeRenderer.getClearAlpha();
                  threeRenderer.setClearAlpha(0);
                  threeEffectComposer.render();
                  threeRenderer.setClearAlpha(clearAlpha);
                } else {
                  threeRenderer.render(threeScene, threeCamera);
                }
                if (replacedThreeSceneBackground) {
                  threeScene.background = replacedThreeSceneBackground;
                }

                this._layerRenderingMetrics.rendered3DLayersCount++;

                lastRenderWas3D = true;
              }
            }
          }
        }

        const debugContainer = this._runtimeScene
          .getDebuggerRenderer()
          .getRendererObject();

        if (debugContainer) {
          threeRenderer.resetState();
          pixiRenderer.reset();
          pixiRenderer.render(debugContainer);
          lastRenderWas3D = false;
        }

        if (!lastRenderWas3D) {
          // Out of caution, reset the WebGL states from PixiJS to start again
          // with a 3D rendering on the next frame.
          pixiRenderer.reset();
        }

        // Uncomment to display some debug metrics from Three.js.
        // console.log(threeRenderer.info);
      } else {
        // 2D only rendering.

        // Render lights in render textures first.
        for (const runtimeLayer of this._runtimeScene._orderedLayers) {
          if (runtimeLayer.isLightingLayer()) {
            // Render the lights on the render texture used then by the lighting Sprite.
            const runtimeLayerRenderer = runtimeLayer.getRenderer();
            runtimeLayerRenderer.renderOnPixiRenderTexture(pixiRenderer);
          }
        }

        // this._renderProfileText(); //Uncomment to display profiling times

        // Render all the layers then.
        // TODO: replace by a loop like in 3D?
        pixiRenderer.background.color = backgroundColor;
        pixiRenderer.render(this._pixiContainer, {
          clear: shouldClearCanvas,
        });
        this._layerRenderingMetrics.rendered2DLayersCount++;
      }

      // synchronize showing the cursor with rendering (useful to reduce
      // blinking while switching from in-game cursor)
      if (this._showCursorAtNextRender) {
        const canvas = runtimeGameRenderer.getCanvas();
        if (canvas) canvas.style.cursor = '';
        this._showCursorAtNextRender = false;
      }

      // Uncomment to check the number of 2D&3D rendering done
      // console.log(this._layerRenderingMetrics);
    }

    /**
     * Return the cameras of a layer that must be rendered, with the area of
     * the screen where they are displayed.
     *
     * The active camera is always rendered. The other cameras are rendered
     * when they have an explicit viewport: this is what makes a split-screen.
     */
    private _getCamerasToRender(runtimeLayer: gdjs.RuntimeLayer): Array<{
      cameraIndex: integer;
      viewport: { x: float; y: float; width: float; height: float };
    }> {
      const viewportWidth = this._runtimeScene.getViewportWidth();
      const viewportHeight = this._runtimeScene.getViewportHeight();
      const activeCameraIndex = runtimeLayer.getActiveCameraIndex();
      const cameraCount = runtimeLayer.getCameraCount();

      const camerasToRender: Array<{
        cameraIndex: integer;
        viewport: { x: float; y: float; width: float; height: float };
      }> = [];
      for (let cameraIndex = 0; cameraIndex < cameraCount; cameraIndex++) {
        const camera = runtimeLayer.getCameraAtIndex(cameraIndex);
        const isActiveCamera = cameraIndex === activeCameraIndex;
        if (!isActiveCamera && camera.useDefaultViewport) continue;

        const left = camera.useDefaultViewport
          ? 0
          : Math.min(Math.max(camera.viewportLeft, 0), 1);
        const top = camera.useDefaultViewport
          ? 0
          : Math.min(Math.max(camera.viewportTop, 0), 1);
        const right = camera.useDefaultViewport
          ? 1
          : Math.min(Math.max(camera.viewportRight, 0), 1);
        const bottom = camera.useDefaultViewport
          ? 1
          : Math.min(Math.max(camera.viewportBottom, 0), 1);

        camerasToRender.push({
          cameraIndex,
          viewport: {
            x: left * viewportWidth,
            y: top * viewportHeight,
            width: Math.max((right - left) * viewportWidth, 0),
            height: Math.max((bottom - top) * viewportHeight, 0),
          },
        });
      }

      // A layer always has at least one camera to render.
      if (camerasToRender.length === 0) {
        camerasToRender.push({
          cameraIndex: activeCameraIndex,
          viewport: {
            x: 0,
            y: 0,
            width: viewportWidth,
            height: viewportHeight,
          },
        });
      }
      return camerasToRender;
    }

    /**
     * Render a PixiJS container in a part of the screen.
     *
     * `pixiRenderer.render` always resets the viewport to the whole canvas,
     * so the render texture is bound manually with a destination frame.
     */
    private _renderPixiContainerInViewport(
      pixiRenderer: PIXI.Renderer,
      container: PIXI.DisplayObject,
      viewport: { x: float; y: float; width: float; height: float }
    ) {
      const screen = pixiRenderer.screen;
      const sourceFrame = new PIXI.Rectangle(0, 0, screen.width, screen.height);
      const destinationFrame = new PIXI.Rectangle(
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height
      );

      // Same steps as `PIXI.Renderer.render`, but the render texture is bound
      // with a destination frame instead of being reset to the whole canvas.
      pixiRenderer.runners.prerender.emit();
      pixiRenderer.emit('prerender');

      pixiRenderer.renderTexture.bind(undefined, sourceFrame, destinationFrame);

      // The batch renderer can be replaced while rendering (when the first
      // sprite is encountered), so it must be read again to be flushed.
      const batch = (pixiRenderer as any).batch;
      batch.currentRenderer.start();
      const displayObject: any = container;
      const cacheParent = displayObject.enableTempParent();
      displayObject.updateTransform();
      displayObject.disableTempParent(cacheParent);
      displayObject.render(pixiRenderer);
      batch.currentRenderer.flush();

      pixiRenderer.runners.postrender.emit();
      pixiRenderer.emit('postrender');
    }

    /**
     * Render a 3D layer with several cameras, each one in its own viewport.
     */
    private _render3DLayerWithMultipleCameras(
      runtimeLayer: gdjs.RuntimeLayer,
      runtimeLayerRenderer: gdjs.LayerRenderer,
      threeRenderer: THREE.WebGLRenderer,
      pixiRenderer: PIXI.Renderer,
      threeScene: THREE.Scene,
      threeEffectComposer: THREE_ADDONS.EffectComposer,
      camerasToRender: Array<{
        cameraIndex: integer;
        viewport: { x: float; y: float; width: float; height: float };
      }>,
      activeCameraIndex: integer,
      backgroundColor: number,
      isBackgroundColorForced: boolean,
      shouldClearCanvas: boolean,
      isFirstRender: boolean,
      lastRenderWas3D: boolean
    ) {
      const canvasWidth = this._runtimeScene.getViewportWidth();
      const canvasHeight = this._runtimeScene.getViewportHeight();
      const runtimeLayerRenderingType = runtimeLayer.getRenderingType();
      const layerHas2DObjectsToRender =
        runtimeLayerRenderingType ===
          gdjs.RuntimeLayerRenderingType.TWO_D_PLUS_THREE_D &&
        runtimeLayerRenderer.has2DObjects();

      // Background of the first rendered layer.
      let replacedThreeSceneBackground: THREE.Color | THREE.Texture | null =
        null;
      if (isFirstRender) {
        threeRenderer.setClearColor(backgroundColor);
        threeRenderer.resetState();
        threeRenderer.setScissorTest(false);
        threeRenderer.setViewport(0, 0, canvasWidth, canvasHeight);
        if (shouldClearCanvas) threeRenderer.clear();
        if (!this._backgroundColor) {
          this._backgroundColor = new THREE.Color();
        }
        this._backgroundColor.set(backgroundColor);
        if (
          isBackgroundColorForced &&
          threeScene.background &&
          threeScene.background !== this._backgroundColor
        ) {
          threeScene.background = this._backgroundColor;
        }
        if (!threeScene.background) {
          threeScene.background = this._backgroundColor;
        }
      } else if (threeScene.background === this._backgroundColor) {
        threeScene.background = null;
      }

      if (!lastRenderWas3D) {
        // It's important to reset the internal WebGL state of PixiJS, then
        // Three.js, to ensure the 3D rendering is made properly by Three.js.
        pixiRenderer.reset();
        threeRenderer.resetState();
      }

      let lastCameraRenderWas3D = true;
      for (const { cameraIndex, viewport } of camerasToRender) {
        if (viewport.width <= 0 || viewport.height <= 0) continue;

        if (runtimeLayer.getActiveCameraIndex() !== cameraIndex) {
          runtimeLayer.setActiveCamera(cameraIndex);
        } else {
          runtimeLayerRenderer.updatePosition();
        }

        if (layerHas2DObjectsToRender) {
          if (lastCameraRenderWas3D) {
            threeRenderer.resetState();
            pixiRenderer.reset();
          }
          runtimeLayerRenderer.renderOnPixiRenderTexture(pixiRenderer);
          runtimeLayerRenderer.updateThreePlaneTextureFromPixiRenderTexture(
            threeRenderer,
            pixiRenderer
          );
          runtimeLayerRenderer.show2DRenderingPlane(true);
          pixiRenderer.reset();
          threeRenderer.resetState();
          lastCameraRenderWas3D = false;
        } else if (
          runtimeLayerRenderingType ===
          gdjs.RuntimeLayerRenderingType.TWO_D_PLUS_THREE_D
        ) {
          runtimeLayerRenderer.show2DRenderingPlane(false);
        }

        const x = Math.round(viewport.x);
        const y = Math.round(viewport.y);
        const width = Math.max(Math.round(viewport.width), 0);
        const height = Math.max(Math.round(viewport.height), 0);
        // Three.js uses a bottom-left origin.
        threeRenderer.setViewport(x, canvasHeight - y - height, width, height);
        threeRenderer.setScissor(x, canvasHeight - y - height, width, height);
        threeRenderer.setScissorTest(true);

        const threeCamera = runtimeLayerRenderer.getThreeCamera();
        if (!threeCamera) continue;

        threeRenderer.clearDepth();
        if (runtimeLayerRenderer.hasPostProcessingPass()) {
          const clearAlpha = threeRenderer.getClearAlpha();
          threeRenderer.setClearAlpha(0);
          threeEffectComposer.render();
          threeRenderer.setClearAlpha(clearAlpha);
        } else {
          threeRenderer.render(threeScene, threeCamera);
        }
        lastCameraRenderWas3D = true;
      }

      threeRenderer.setScissorTest(false);
      threeRenderer.setViewport(0, 0, canvasWidth, canvasHeight);
      if (replacedThreeSceneBackground) {
        threeScene.background = replacedThreeSceneBackground;
      }
      if (runtimeLayer.getActiveCameraIndex() !== activeCameraIndex) {
        runtimeLayer.setActiveCamera(activeCameraIndex);
      }
    }

    /**
     * Determine if a layer will actually render in 3D mode.
     * Keep in sync with: `shouldRenderLayerIn3D` in `layer-pixi-renderer.ts`.
     */
    private _shouldRenderLayerIn3D(runtimeLayer: gdjs.RuntimeLayer): boolean {
      return (
        this._runtimeScene.getGame().isInGameEdition() ||
        (runtimeLayer.getRenderingType() !==
          gdjs.RuntimeLayerRenderingType.TWO_D &&
          runtimeLayer.getRenderer().has3DObjects())
      );
    }

    /**
     * Do what `render` does that the game logic can depend on, without
     * drawing anything: update the world matrices of the 3D scenes and of
     * their cameras, as Three.js does at the beginning of a render. Raycasts
     * against 3D objects and their bounding boxes read them.
     *
     * Only the layers that `render` would draw in 3D are updated, so that
     * the game logic reads the same matrices whether frames are drawn or not.
     */
    updateWithoutDrawing() {
      const threeRenderer = this._threeRenderer;
      if (!threeRenderer || threeRenderer.xr.isPresenting) return;

      for (const runtimeLayer of this._runtimeScene._orderedLayers) {
        if (!runtimeLayer.isVisible()) continue;
        if (!this._shouldRenderLayerIn3D(runtimeLayer)) continue;

        const runtimeLayerRenderer = runtimeLayer.getRenderer();
        const threeScene = runtimeLayerRenderer.getThreeScene();
        const threeCamera = runtimeLayerRenderer.getThreeCamera();
        if (
          !threeScene ||
          !threeCamera ||
          !runtimeLayerRenderer.getThreeEffectComposer()
        ) {
          continue;
        }
        if (threeScene.matrixWorldAutoUpdate) threeScene.updateMatrixWorld();
        if (!threeCamera.parent && threeCamera.matrixWorldAutoUpdate) {
          threeCamera.updateMatrixWorld();
        }
      }
    }

    /**
     * Unless you know what you are doing, use the VR extension instead of this function directly.
     *
     * In VR, only 3D elements can be rendered, 2D cannot.
     * This rendering method skips over all 2D layers and elements, and simply renders the 3D content.
     * This method is to be called by the XRSession's `requestAnimationFrame` for rendering to
     * the headset whenever the headset requests the screen to be drawn. Note that while an XRSession
     * is in progress, the regular `requestAnimationFrame` will be disabled. Make sure that whenever you
     * enter an XRSession, you:
     * - Call this function first and foremost when the XRSession's requestAnimationFrame fires,
     *   as it is necessary to draw asap as the headset will eventually stop waiting and just draw the
     *   framebuffer as it is to maintain a constant screen refresh rate, which can be in the middle of
     *   or even before rendering if we aren't fast enough, leading to screen flashes and bugs.
     * - Call GDevelop's step function to give the scene a chance to step after having drawn to the screen
     *   to allow the game to actually progress, since GDevelop will no longer step by itself with
     *   `requestAnimationFrame` disabled.
     *
     * Note to engine developers: `threeRenderer.resetState()` may NOT be called in this function,
     * as WebXR modifies the WebGL state in a way that resetting it will cause an improper render
     * that will lead to a black screen being displayed in VR mode.
     */
    renderForVR() {
      const runtimeGameRenderer = this._runtimeGameRenderer;
      if (!runtimeGameRenderer) return;

      const threeRenderer = this._threeRenderer;
      // VR rendering relies on ThreeJS
      if (!threeRenderer)
        throw new Error('Cannot render a scene with no 3D elements in VR!');

      // Render each layer one by one.
      let isFirstRender = true;
      for (let i = 0; i < this._runtimeScene._orderedLayers.length; ++i) {
        const runtimeLayer = this._runtimeScene._orderedLayers[i];
        if (!runtimeLayer.isVisible()) continue;

        const runtimeLayerRenderer = runtimeLayer.getRenderer();
        const runtimeLayerRenderingType = runtimeLayer.getRenderingType();
        if (
          runtimeLayerRenderingType === gdjs.RuntimeLayerRenderingType.TWO_D ||
          !runtimeLayerRenderer.has3DObjects()
        )
          continue;

        // Render a layer with 3D rendering, and no 2D rendering at all for VR.
        const threeScene = runtimeLayerRenderer.getThreeScene();
        const threeCamera = runtimeLayerRenderer.getThreeCamera();
        if (!threeScene || !threeCamera) continue;

        if (isFirstRender) {
          // Render the background color.
          threeRenderer.setClearColor(this._runtimeScene.getBackgroundColor());
          if (this._runtimeScene.getClearCanvas()) threeRenderer.clear();
          threeScene.background = new THREE.Color(
            this._runtimeScene.getBackgroundColor()
          );

          isFirstRender = false;
        } else {
          // It's important to set the background to null, as maybe the first rendered
          // layer has changed and so the Three.js scene background must be reset.
          threeScene.background = null;
        }

        // Clear the depth as each layer is independent and display on top of the previous one,
        // even 3D objects.
        threeRenderer.clearDepth();
        threeRenderer.render(threeScene, threeCamera);
      }
    }

    _renderProfileText() {
      const profiler = this._runtimeScene.getProfiler();
      if (!profiler) {
        return;
      }
      if (!this._profilerText) {
        this._profilerText = new PIXI.Text(' ', {
          align: 'left',
          stroke: '#FFF',
          strokeThickness: 1,
        });

        // Add on top of all layers:
        this._pixiContainer.addChild(this._profilerText);
      }
      const average = profiler.getFramesAverageMeasures();
      const outputs = [];
      gdjs.Profiler.getProfilerSectionTexts('All', average, outputs);
      this._profilerText.text = outputs.join('\n');
    }

    hideCursor(): void {
      this._showCursorAtNextRender = false;

      const canvas = this._runtimeGameRenderer
        ? this._runtimeGameRenderer.getCanvas()
        : null;
      if (canvas) canvas.style.cursor = 'none';
    }

    showCursor(): void {
      this._showCursorAtNextRender = true;
    }

    getPIXIContainer() {
      return this._pixiContainer;
    }

    getRendererObject() {
      return this._pixiContainer;
    }

    get3DRendererObject() {
      // There is no notion of a container for all 3D objects. Each 3D object is
      // added to their layer container.
      return null;
    }

    /** @deprecated use `runtimeGame.getRenderer().getPIXIRenderer()` instead */
    getPIXIRenderer() {
      return this._runtimeGameRenderer
        ? this._runtimeGameRenderer.getPIXIRenderer()
        : null;
    }

    setLayerIndex(layer: gdjs.RuntimeLayer, index: float): void {
      const layerPixiRenderer: gdjs.LayerPixiRenderer = layer.getRenderer();
      let layerPixiObject: PIXI.Container | PIXI.Sprite | null =
        layerPixiRenderer.getRendererObject();
      if (layer.isLightingLayer()) {
        // TODO (2d lights): refactor to remove the need for `getLightingSprite`.
        layerPixiObject = layerPixiRenderer.getLightingSprite();
      }
      if (!layerPixiObject) {
        return;
      }
      if (this._pixiContainer.children.indexOf(layerPixiObject) === index) {
        return;
      }
      this._pixiContainer.removeChild(layerPixiObject);
      this._pixiContainer.addChildAt(layerPixiObject, index);
    }
  }

  // Register the class to let the engine use it.
  /** @category Renderers > Scene */
  export type RuntimeSceneRenderer = gdjs.RuntimeScenePixiRenderer;
  /** @category Renderers > Scene */
  export const RuntimeSceneRenderer = gdjs.RuntimeScenePixiRenderer;
}
