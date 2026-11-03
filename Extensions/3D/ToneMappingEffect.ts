namespace gdjs {
  interface ToneMappingFilterNetworkSyncData {
    m: string;
    e: number;
  }

  const toneMappingFunctions = {
    Neutral: 'NeutralToneMapping',
    ACESFilmic: 'ACESFilmicToneMapping',
    AgX: 'AgXToneMapping',
    Reinhard: 'ReinhardToneMapping',
    Cineon: 'CineonToneMapping',
  };
  type ToneMappingMode = keyof typeof toneMappingFunctions;
  const isToneMappingMode = (mode: string): mode is ToneMappingMode =>
    toneMappingFunctions.hasOwnProperty(mode);

  /**
   * The Three.js tone mapping constant matching a GDevelop tone mapping mode.
   * Read at call time because `THREE` may be either the WebGL or the WebGPU
   * bundle (the WebGPU one is required for the TSL tone mapping node).
   */
  const getThreeToneMapping = (mode: ToneMappingMode): number => {
    switch (mode) {
      case 'ACESFilmic':
        return THREE.ACESFilmicToneMapping;
      case 'AgX':
        return THREE.AgXToneMapping;
      case 'Reinhard':
        return THREE.ReinhardToneMapping;
      case 'Cineon':
        return THREE.CineonToneMapping;
      case 'Neutral':
      default:
        return THREE.NeutralToneMapping;
    }
  };

  const toneMappingShader = {
    defines: {
      TONE_MAPPING_FUNCTION: toneMappingFunctions.Neutral,
    },
    uniforms: {
      tDiffuse: { value: null },
      exposure: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <tonemapping_pars_fragment>

      uniform sampler2D tDiffuse;
      uniform float exposure;

      varying vec2 vUv;

      void main() {
        vec4 color = texture2D(tDiffuse, vUv);
        gl_FragColor = vec4(TONE_MAPPING_FUNCTION(color.rgb * exposure), color.a);
      }`,
  };

  gdjs.PixiFiltersTools.registerFilterCreator(
    'Scene3D::ToneMapping',
    new (class implements gdjs.PixiFiltersTools.FilterCreator {
      makeFilter(
        target: EffectsTarget,
        effectData: EffectData
      ): gdjs.PixiFiltersTools.Filter {
        if (typeof THREE === 'undefined') {
          return new gdjs.PixiFiltersTools.EmptyFilter();
        }
        return new (class implements gdjs.PixiFiltersTools.Filter {
          shaderPass: THREE_ADDONS.ShaderPass;
          _isEnabled: boolean = false;
          _mode: ToneMappingMode = 'Neutral';
          /** The current target, needed to rebuild the WebGPU pass on mode change. */
          _target: EffectsTarget | null = null;
          /** The WebGPU (TSL) equivalent of the shader pass, when available. */
          _webGPUPass: gdjs.WebGPUPostProcessingPass | null = null;
          /** TSL uniform holding the exposure, so it can be updated without rebuilding. */
          _webGPUExposureUniform: any = null;

          constructor() {
            this.shaderPass = new THREE_ADDONS.ShaderPass(toneMappingShader);

            // Build the WebGPU (TSL) pass too, when the WebGPU bundle is
            // loaded (`THREE.TSL` only exists there). The WebGL pipeline
            // ignores it and the WebGPU pipeline ignores the shader pass, so
            // both backends are covered by registering both.
            const threeApi = THREE as any;
            if (
              threeApi.TSL &&
              typeof threeApi.TSL.uniform === 'function'
            ) {
              this._webGPUExposureUniform = threeApi.TSL.uniform(
                this.shaderPass.uniforms.exposure.value
              );
              this._webGPUPass = {
                getOutputNode: (inputNode: any) =>
                  inputNode.toneMapping(
                    getThreeToneMapping(this._mode),
                    this._webGPUExposureUniform
                  ),
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
            this._target = target;
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
            this._target = null;
            const layerRenderer = target.getRenderer();
            layerRenderer.removePostProcessingPass(this.shaderPass);
            if (this._webGPUPass) {
              layerRenderer.removePostProcessingPass(this._webGPUPass);
            }
            this._isEnabled = false;
            return true;
          }
          updatePreRender(target: gdjs.EffectsTarget): any {}
          updateDoubleParameter(parameterName: string, value: number): void {
            if (parameterName === 'exposure') {
              const exposure = Math.max(0, value);
              this.shaderPass.uniforms.exposure.value = exposure;
              if (this._webGPUExposureUniform) {
                this._webGPUExposureUniform.value = exposure;
              }
            }
          }
          getDoubleParameter(parameterName: string): number {
            if (parameterName === 'exposure') {
              return this.shaderPass.uniforms.exposure.value;
            }
            return 0;
          }
          updateStringParameter(parameterName: string, value: string): void {
            if (parameterName === 'mode') {
              this._setMode(value);
            }
          }
          _setMode(mode: string): void {
            if (!isToneMappingMode(mode) || mode === this._mode) {
              return;
            }
            this._mode = mode;
            // WebGL: the tone mapping function is a GLSL define.
            this.shaderPass.material.defines.TONE_MAPPING_FUNCTION =
              toneMappingFunctions[this._mode];
            this.shaderPass.material.needsUpdate = true;
            // WebGPU: the tone mapping mode is baked in the TSL node, so the
            // node chain must be rebuilt by re-registering the pass.
            if (this._webGPUPass && this._target instanceof gdjs.Layer) {
              const layerRenderer = this._target.getRenderer();
              layerRenderer.removePostProcessingPass(this._webGPUPass);
              layerRenderer.addPostProcessingPass(
                this._webGPUPass,
                effectData.name
              );
            }
          }
          updateColorParameter(parameterName: string, value: number): void {}
          getColorParameter(parameterName: string): number {
            return 0;
          }
          updateBooleanParameter(parameterName: string, value: boolean): void {}
          getNetworkSyncData(): ToneMappingFilterNetworkSyncData {
            return {
              m: this._mode,
              e: this.shaderPass.uniforms.exposure.value,
            };
          }
          updateFromNetworkSyncData(data: ToneMappingFilterNetworkSyncData) {
            this._setMode(data.m);
            this.updateDoubleParameter('exposure', data.e);
          }
        })();
      }
    })()
  );
}
