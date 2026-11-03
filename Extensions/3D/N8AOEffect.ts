namespace gdjs {
  interface N8AOFilterNetworkSyncData {
    r: number;
    d: number;
    i: number;
    c: number;
    q?: string;
  }
  gdjs.PixiFiltersTools.registerFilterCreator(
    'Scene3D::N8AO',
    new (class implements gdjs.PixiFiltersTools.FilterCreator {
      makeFilter(
        target: EffectsTarget,
        effectData: EffectData
      ): gdjs.PixiFiltersTools.Filter {
        if (typeof THREE === 'undefined') {
          return new gdjs.PixiFiltersTools.EmptyFilter();
        }
        return new (class implements gdjs.PixiFiltersTools.Filter {
          shaderPass: THREE_ADDONS.N8AOPass;
          _isEnabled: boolean;
          _webGPUPass: gdjs.WebGPUPostProcessingPass | null = null;
          _webGPUAONode: any = null;
          _webGPUDenoiseNode: any = null;
          _webGPUColor: any = null;
          _layerRenderer: gdjs.LayerRenderer | null = null;
          _quality:
            | 'Performance'
            | 'Low'
            | 'Medium'
            | 'High'
            | 'Ultra' = 'Performance';
          // In scene units: converted to the Three.js world units before each
          // rendering, as the world scale can change in the editor.
          _radius: float = 50;

          constructor() {
            const layer = target.getRuntimeLayer!()!;
            const scene = layer.get3DRendererObject()!;
            const camera = layer.getRenderer().getThreeCamera()!;
            this.shaderPass = new THREE_ADDONS.N8AOPass(
              scene,
              camera,
              layer.getWidth(),
              layer.getHeight()
            );
            this.shaderPass.configuration.halfRes = true;
            this.shaderPass.configuration.gammaCorrection = false;
            this.shaderPass.configuration.accumulate = false;
            this.shaderPass.configuration.transparencyAware = false;
            this.shaderPass.autoDetectTransparency = false;
            // The pass renders the scene itself: keep a stencil buffer, like
            // the render targets of the composer.
            this.shaderPass.configuration.stencil = true;
            this.shaderPass.setQualityMode(this._quality);
            this._isEnabled = false;

            const threeApi = THREE as any;
            const tsl = threeApi.TSL;
            const layerRenderer = layer.getRenderer();
            const webGPUCamera = layerRenderer.getThreeCamera();
            this._layerRenderer = layerRenderer;
            if (
              tsl &&
              webGPUCamera &&
              typeof threeApi.ao === 'function' &&
              typeof tsl.uniform === 'function'
            ) {
              this._webGPUColor = tsl.uniform(new THREE.Color(0, 0, 0));
              this._webGPUPass = {
                getOutputNode: (inputNode: any) => {
                  const activeLayerRenderer = this._layerRenderer;
                  const activeCamera = activeLayerRenderer?.getThreeCamera();
                  const depthNode = activeLayerRenderer?.getSceneDepthNode();
                  if (!activeCamera || !depthNode) return inputNode;
                  if (!this._webGPUAONode) {
                    this._webGPUAONode = threeApi.ao(
                      depthNode,
                      null,
                      activeCamera
                    );
                    // Match N8AO's half-resolution default. GTAO reconstructs
                    // normals from depth when no normal MRT is supplied.
                    this._webGPUAONode.resolutionScale = 0.5;
                    this._updateWebGPUParameters();
                    if (typeof threeApi.denoise === 'function') {
                      this._webGPUDenoiseNode = threeApi.denoise(
                        this._webGPUAONode.getTextureNode(),
                        depthNode,
                        null,
                        activeCamera
                      );
                      this._updateWebGPUParameters();
                    }
                  }

                  const aoTexture =
                    this._webGPUDenoiseNode ||
                    this._webGPUAONode.getTextureNode();
                  const visibility = tsl.pow(
                    aoTexture.r,
                    tsl.max(this.shaderPass.configuration.intensity, 0)
                  );
                  const aoColor = this._webGPUColor.mul(inputNode.rgb);
                  const outputColor = tsl.mix(
                    inputNode.rgb,
                    aoColor,
                    tsl.float(1).sub(visibility)
                  );
                  return tsl.vec4(outputColor, inputNode.a);
                },
                dispose: () => {
                  this._webGPUDenoiseNode?.dispose?.();
                  this._webGPUAONode?.dispose?.();
                  this._webGPUDenoiseNode = null;
                  this._webGPUAONode = null;
                },
              };
            }
          }

          isEnabled(target: EffectsTarget): boolean {
            return this._isEnabled;
          }
          setEnabled(target: EffectsTarget, enabled: boolean): boolean {
            if (this._isEnabled === enabled) {
              return true;
            }
            if (enabled) {
              return this.applyEffect(target);
            } else {
              return this.removeEffect(target);
            }
          }
          applyEffect(target: EffectsTarget): boolean {
            if (!(target instanceof gdjs.Layer)) {
              return false;
            }
            const layerRenderer = target.getRenderer();
            this._layerRenderer = layerRenderer;
            layerRenderer.setSceneDepthTextureNeeded(true);
            layerRenderer.setCustomRenderPass(this.shaderPass);
            if (this._webGPUPass) {
              layerRenderer.addPostProcessingPass(
                this._webGPUPass,
                effectData.name
              );
            }
            this._isEnabled = true;
            return true;
          }
          removeEffect(target: EffectsTarget): boolean {
            if (!(target instanceof gdjs.Layer)) {
              return false;
            }
            const layerRenderer = target.getRenderer();
            layerRenderer.setCustomRenderPass(null);
            if (this._webGPUPass) {
              layerRenderer.removePostProcessingPass(this._webGPUPass);
            }
            layerRenderer.setSceneDepthTextureNeeded(false);
            this._layerRenderer = null;
            this._isEnabled = false;
            return true;
          }
          updatePreRender(target: gdjs.EffectsTarget): any {
            this._updateRadius();
            this._updateWebGPUParameters();
          }
          _updateRadius(): void {
            const aoRadius =
              this._radius *
              target
                .getRuntimeScene()
                .getScene()
                .getRenderer3DInverseWorldScale();
            if (this.shaderPass.configuration.aoRadius !== aoRadius) {
              this.shaderPass.configuration.aoRadius = aoRadius;
            }
          }
          _updateWebGPUParameters(): void {
            if (!this._webGPUAONode) return;
            const inverseWorldScale = target
              .getRuntimeScene()
              .getScene()
              .getRenderer3DInverseWorldScale();
            const qualitySettings: Record<
              string,
              { samples: number; denoiseRadius: number }
            > = {
              Performance: { samples: 8, denoiseRadius: 12 },
              Low: { samples: 16, denoiseRadius: 12 },
              Medium: { samples: 16, denoiseRadius: 12 },
              High: { samples: 64, denoiseRadius: 6 },
              Ultra: { samples: 64, denoiseRadius: 6 },
            };
            const settings =
              qualitySettings[this._quality] || qualitySettings.Performance;
            this._webGPUAONode.radius.value = this._radius * inverseWorldScale;
            this._webGPUAONode.samples.value = settings.samples;
            // Apply the N8AO intensity in the compositor below, not in the
            // GTAO node, so it is applied exactly once.
            this._webGPUAONode.scale.value = 1;
            this._webGPUAONode.distanceFallOff.value = Math.max(
              0,
              Math.min(1, this.shaderPass.configuration.distanceFalloff)
            );
            if (this._webGPUDenoiseNode) {
              this._webGPUDenoiseNode.radius.value = settings.denoiseRadius;
            }
            if (this._webGPUColor) {
              this._webGPUColor.value.copy(this.shaderPass.configuration.color);
            }
          }
          updateDoubleParameter(parameterName: string, value: number): void {
            if (parameterName === 'radius') {
              this._radius = value;
              this._updateRadius();
            }
            if (parameterName === 'distanceFalloff') {
              this.shaderPass.configuration.distanceFalloff = value;
            }
            if (parameterName === 'intensity') {
              this.shaderPass.configuration.intensity = value;
            }
            this._updateWebGPUParameters();
          }
          getDoubleParameter(parameterName: string): number {
            if (parameterName === 'radius') {
              return this._radius;
            }
            if (parameterName === 'distanceFalloff') {
              return this.shaderPass.configuration.distanceFalloff;
            }
            if (parameterName === 'intensity') {
              return this.shaderPass.configuration.intensity;
            }
            return 0;
          }
          updateStringParameter(parameterName: string, value: string): void {
            if (parameterName === 'quality') {
              if (
                value === 'Performance' ||
                value === 'Low' ||
                value === 'Medium' ||
                value === 'High' ||
                value === 'Ultra'
              ) {
                this._quality = value;
                this.shaderPass.setQualityMode(value);
              }
            }
            if (parameterName === 'color') {
              this.shaderPass.configuration.color = new THREE.Color(
                gdjs.rgbOrHexStringToNumber(value)
              );
            }
            this._updateWebGPUParameters();
          }
          updateColorParameter(parameterName: string, value: number): void {
            if (parameterName === 'color') {
              this.shaderPass.configuration.color.setHex(value);
              this._updateWebGPUParameters();
            }
          }
          getColorParameter(parameterName: string): number {
            if (parameterName === 'color') {
              return this.shaderPass.configuration.color.getHex();
            }
            return 0;
          }
          updateBooleanParameter(parameterName: string, value: boolean): void {}
          getNetworkSyncData(): N8AOFilterNetworkSyncData {
            return {
              r: this._radius,
              d: this.shaderPass.configuration.distanceFalloff,
              i: this.shaderPass.configuration.intensity,
              c: this.shaderPass.configuration.color.getHex(),
              q: this._quality,
            };
          }
          updateFromNetworkSyncData(data: N8AOFilterNetworkSyncData) {
            this._radius = data.r;
            this._updateRadius();
            this.shaderPass.configuration.distanceFalloff = data.d;
            this.shaderPass.configuration.intensity = data.i;
            this.shaderPass.configuration.color.setHex(data.c);
            if (data.q) this.updateStringParameter('quality', data.q);
            this._updateWebGPUParameters();
          }
        })();
      }
    })()
  );
}
