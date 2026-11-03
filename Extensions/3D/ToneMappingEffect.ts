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
   * bundle.
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
      uniform sampler2D tDiffuse;
      uniform float exposure;

      varying vec2 vUv;

      // The tone mapping operators are inlined on purpose, instead of
      // including Three.js' internal 'tonemapping_pars_fragment' chunk:
      //
      // - that chunk is injected by Three.js itself in the prefix of every
      //   non-raw ShaderMaterial when the renderer has a tone mapping set, so
      //   including it here would declare the functions twice and make the
      //   shader fail to compile (the pass would then silently do nothing);
      // - its functions already multiply by the renderer's
      //   'toneMappingExposure', which would apply the exposure twice with
      //   the effect's own 'exposure' uniform;
      // - it makes the effect depend on the renderer's tone mapping state,
      //   while the WebGPU (TSL) path applies the effect's exposure exactly
      //   once. Keeping both paths identical needs self-contained operators.
      //
      // Ported from Three.js r185 'tonemapping_pars_fragment', with the
      // exposure passed explicitly to each operator.

      vec3 LinearToneMapping(vec3 color, float exposure) {
        return clamp(exposure * color, 0.0, 1.0);
      }

      vec3 ReinhardToneMapping(vec3 color, float exposure) {
        color *= exposure;
        return clamp(color / (vec3(1.0) + color), 0.0, 1.0);
      }

      vec3 CineonToneMapping(vec3 color, float exposure) {
        color *= exposure;
        color = max(vec3(0.0), color - 0.004);
        return pow(
          (color * (6.2 * color + 0.5)) /
            (color * (6.2 * color + 1.7) + 0.06),
          vec3(2.2)
        );
      }

      vec3 RRTAndODTFit(vec3 v) {
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return a / b;
      }

      vec3 ACESFilmicToneMapping(vec3 color, float exposure) {
        const mat3 ACESInputMat = mat3(
          vec3(0.59719, 0.07600, 0.02840),
          vec3(0.35458, 0.90834, 0.13383),
          vec3(0.04823, 0.01566, 0.83777)
        );
        const mat3 ACESOutputMat = mat3(
          vec3( 1.60475, -0.10208, -0.00327),
          vec3(-0.53108,  1.10813, -0.07276),
          vec3(-0.07367, -0.00605,  1.07602)
        );
        color *= exposure / 0.6;
        color = ACESInputMat * color;
        color = RRTAndODTFit(color);
        color = ACESOutputMat * color;
        return clamp(color, 0.0, 1.0);
      }

      const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
        vec3( 1.6605, -0.1246, -0.0182),
        vec3(-0.5876,  1.1329, -0.1006),
        vec3(-0.0728, -0.0083,  1.1187)
      );
      const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
        vec3(0.6274, 0.0691, 0.0164),
        vec3(0.3293, 0.9195, 0.0880),
        vec3(0.0433, 0.0113, 0.8956)
      );

      vec3 agxDefaultContrastApprox(vec3 x) {
        vec3 x2 = x * x;
        vec3 x4 = x2 * x2;
        return + 15.5 * x4 * x2
          - 40.14 * x4 * x
          + 31.96 * x4
          - 6.868 * x2 * x
          + 0.4298 * x2
          + 0.1191 * x
          - 0.00232;
      }

      vec3 AgXToneMapping(vec3 color, float exposure) {
        const mat3 AgXInsetMatrix = mat3(
          vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
          vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
          vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859)
        );
        const mat3 AgXOutsetMatrix = mat3(
          vec3( 1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
          vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
          vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405)
        );
        const float AgxMinEv = -12.47393;
        const float AgxMaxEv = 4.026069;
        color *= exposure;
        color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
        color = AgXInsetMatrix * color;
        color = max(color, 1e-10);
        color = log2(color);
        color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
        color = clamp(color, 0.0, 1.0);
        color = agxDefaultContrastApprox(color);
        color = AgXOutsetMatrix * color;
        color = pow(max(vec3(0.0), color), vec3(2.2));
        color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
        return clamp(color, 0.0, 1.0);
      }

      vec3 NeutralToneMapping(vec3 color, float exposure) {
        const float StartCompression = 0.8 - 0.04;
        const float Desaturation = 0.15;
        color *= exposure;
        float x = min(color.r, min(color.g, color.b));
        float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
        color -= offset;
        float peak = max(color.r, max(color.g, color.b));
        if (peak < StartCompression) return color;
        float d = 1.0 - StartCompression;
        float newPeak = 1.0 - d * d / (peak + d - StartCompression);
        color *= newPeak / peak;
        float g = 1.0 - 1.0 / (Desaturation * (peak - newPeak) + 1.0);
        return mix(color, vec3(newPeak), g);
      }

      void main() {
        vec4 color = texture2D(tDiffuse, vUv);
        gl_FragColor = vec4(
          TONE_MAPPING_FUNCTION(color.rgb, exposure),
          color.a
        );
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
          /**
           * The WebGL pass, or `null` when `THREE_ADDONS` is unavailable.
           */
          shaderPass: THREE_ADDONS.ShaderPass | null = null;
          _isEnabled: boolean = false;
          _mode: ToneMappingMode = 'Neutral';
          _exposure: float = 1.0;
          /** The layer renderer currently using the effect, to rebuild the WebGPU pass on mode change. */
          _layerRenderer: gdjs.LayerRenderer | null = null;
          /** The WebGPU (TSL) equivalent of the shader pass, when available. */
          _webGPUPass: gdjs.WebGPUPostProcessingPass | null = null;
          /** TSL uniform holding the exposure, so it can be updated without rebuilding. */
          _webGPUExposureUniform: any = null;

          constructor() {
            // Build both representations of the effect and let the active
            // post-processing pipeline keep the one matching its backend (the
            // WebGL pipeline ignores the WebGPU pass and vice versa).
            //
            // Building both - instead of guessing the backend from the loaded
            // Three.js bundle - is what makes the effect work whichever
            // pipeline ends up running. Notably, `THREE.WebGPURenderer`
            // silently falls back to its WebGL2 backend when no WebGPU device
            // is available, and the editor can load the WebGPU bundle while a
            // WebGL renderer is used.
            if (typeof THREE_ADDONS !== 'undefined') {
              this.shaderPass = new THREE_ADDONS.ShaderPass(
                toneMappingShader
              );
              this._exposure = this.shaderPass.uniforms.exposure.value;
            }
            const threeApi = THREE as any;
            if (threeApi.TSL && typeof threeApi.TSL.uniform === 'function') {
              this._webGPUExposureUniform = threeApi.TSL.uniform(
                this._exposure
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
            const layerRenderer = target.getRenderer();
            this._layerRenderer = layerRenderer;
            if (this.shaderPass) {
              layerRenderer.addPostProcessingPass(
                this.shaderPass,
                effectData.name
              );
            }
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
            this._layerRenderer = null;
            const layerRenderer = target.getRenderer();
            if (this.shaderPass) {
              layerRenderer.removePostProcessingPass(this.shaderPass);
            }
            if (this._webGPUPass) {
              layerRenderer.removePostProcessingPass(this._webGPUPass);
            }
            this._isEnabled = false;
            return true;
          }
          updatePreRender(target: gdjs.EffectsTarget): any {}
          updateDoubleParameter(parameterName: string, value: number): void {
            if (parameterName === 'exposure') {
              this._exposure = Math.max(0, value);
              if (this.shaderPass) {
                this.shaderPass.uniforms.exposure.value = this._exposure;
              }
              if (this._webGPUExposureUniform) {
                this._webGPUExposureUniform.value = this._exposure;
              }
            }
          }
          getDoubleParameter(parameterName: string): number {
            if (parameterName === 'exposure') {
              return this._exposure;
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
            if (this.shaderPass) {
              this.shaderPass.material.defines.TONE_MAPPING_FUNCTION =
                toneMappingFunctions[this._mode];
              this.shaderPass.material.needsUpdate = true;
            }
            // WebGPU: the tone mapping mode is baked in the TSL node, so the
            // node chain must be rebuilt by re-registering the pass.
            if (this._webGPUPass && this._layerRenderer) {
              this._layerRenderer.removePostProcessingPass(this._webGPUPass);
              this._layerRenderer.addPostProcessingPass(
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
              e: this._exposure,
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
