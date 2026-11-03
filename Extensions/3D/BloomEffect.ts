namespace gdjs {
  interface BloomFilterNetworkSyncData {
    s: number;
    r: number;
    t: number;
  }
  gdjs.PixiFiltersTools.registerFilterCreator(
    'Scene3D::Bloom',
    new (class implements gdjs.PixiFiltersTools.FilterCreator {
      makeFilter(
        target: EffectsTarget,
        effectData: EffectData
      ): gdjs.PixiFiltersTools.Filter {
        if (typeof THREE === 'undefined') {
          return new gdjs.PixiFiltersTools.EmptyFilter();
        }
        return new (class implements gdjs.PixiFiltersTools.Filter {
          shaderPass: THREE_ADDONS.LowResolutionBloomPass;
          _isEnabled: boolean;
          _webGPUPass: gdjs.WebGPUPostProcessingPass | null = null;
          _webGPUBloomNode: any = null;
          _webGPUStrength: any = null;
          _webGPURadius: any = null;
          _webGPUThreshold: any = null;
          _webGPUWidth: number = Math.max(1, target.getWidth());
          _webGPUHeight: number = Math.max(1, target.getHeight());

          constructor() {
            this.shaderPass = new THREE_ADDONS.LowResolutionBloomPass(
              new THREE.Vector2(256, 256),
              0.5,
              0.4,
              0.85
            );
            // The bloom is added on the rendered layer, but it must not make
            // the transparent parts of the layer opaque (the layers rendered
            // before this one must remain visible).
            const blendMaterial = this.shaderPass.blendMaterial;
            blendMaterial.blending = THREE.CustomBlending;
            blendMaterial.blendEquation = THREE.AddEquation;
            blendMaterial.blendSrc = THREE.OneFactor;
            blendMaterial.blendDst = THREE.OneFactor;
            blendMaterial.blendEquationAlpha = THREE.AddEquation;
            blendMaterial.blendSrcAlpha = THREE.ZeroFactor;
            blendMaterial.blendDstAlpha = THREE.OneFactor;
            this._isEnabled = false;

            const threeApi = THREE as any;
            const tsl = threeApi.TSL;
            if (
              tsl &&
              typeof threeApi.bloom === 'function' &&
              typeof tsl.uniform === 'function'
            ) {
              this._webGPUStrength = tsl.uniform(this.shaderPass.strength);
              this._webGPURadius = tsl.uniform(this.shaderPass.radius);
              this._webGPUThreshold = tsl.uniform(this.shaderPass.threshold);
              this._webGPUPass = {
                getOutputNode: (inputNode: any) => {
                  // Three.js' BloomNode uses the input texture's image size to
                  // size its internal mip chain. For a composed TSL expression
                  // there is no TextureNode.value, so provide that metadata.
                  if (!inputNode.value?.image) {
                    inputNode.value = {
                      image: {
                        width: this._webGPUWidth,
                        height: this._webGPUHeight,
                      },
                    };
                  }
                  if (!this._webGPUBloomNode) {
                    this._webGPUBloomNode = threeApi.bloom(
                      inputNode,
                      this._webGPUStrength,
                      this._webGPURadius,
                      this._webGPUThreshold
                    );
                  } else {
                    this._webGPUBloomNode.inputNode = inputNode;
                  }
                  // The WebGL pass additively blends bloom into the layer but
                  // preserves the layer alpha so lower layers stay visible.
                  return tsl.vec4(
                    inputNode.rgb.add(this._webGPUBloomNode.rgb),
                    inputNode.a
                  );
                },
                dispose: () => {
                  this._webGPUBloomNode?.dispose?.();
                  this._webGPUBloomNode = null;
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
            layerRenderer.addPostProcessingPass(
              this.shaderPass,
              effectData.name
            );
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
            layerRenderer.removePostProcessingPass(this.shaderPass);
            if (this._webGPUPass) {
              layerRenderer.removePostProcessingPass(this._webGPUPass);
            }
            this._isEnabled = false;
            return true;
          }
          updatePreRender(target: gdjs.EffectsTarget): any {
            this._webGPUWidth = Math.max(1, target.getWidth());
            this._webGPUHeight = Math.max(1, target.getHeight());
          }
          updateDoubleParameter(parameterName: string, value: number): void {
            if (parameterName === 'strength') {
              this.shaderPass.strength = value;
              if (this._webGPUStrength) this._webGPUStrength.value = value;
            }
            if (parameterName === 'radius') {
              this.shaderPass.radius = value;
              if (this._webGPURadius) this._webGPURadius.value = value;
            }
            if (parameterName === 'threshold') {
              this.shaderPass.threshold = value;
              if (this._webGPUThreshold) this._webGPUThreshold.value = value;
            }
          }
          getDoubleParameter(parameterName: string): number {
            if (parameterName === 'strength') {
              return this.shaderPass.strength;
            }
            if (parameterName === 'radius') {
              return this.shaderPass.radius;
            }
            if (parameterName === 'threshold') {
              return this.shaderPass.threshold;
            }
            return 0;
          }
          updateStringParameter(parameterName: string, value: string): void {}
          updateColorParameter(parameterName: string, value: number): void {}
          getColorParameter(parameterName: string): number {
            return 0;
          }
          updateBooleanParameter(parameterName: string, value: boolean): void {}
          getNetworkSyncData(): BloomFilterNetworkSyncData {
            return {
              s: this.shaderPass.strength,
              r: this.shaderPass.radius,
              t: this.shaderPass.threshold,
            };
          }
          updateFromNetworkSyncData(data: BloomFilterNetworkSyncData) {
            this.updateDoubleParameter('strength', data.s);
            this.updateDoubleParameter('radius', data.r);
            this.updateDoubleParameter('threshold', data.t);
          }
        })();
      }
    })()
  );
}
