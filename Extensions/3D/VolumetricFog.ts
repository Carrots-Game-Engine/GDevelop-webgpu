namespace gdjs {
  interface VolumetricFogFilterNetworkSyncData {
    c: number;
    d: number;
    h: number;
    f: number;
    m: number;
    s: number;
    q: string;
    t?: string;
  }

  /** The number of samples of the fog along each ray, for each quality. */
  const volumetricFogStepCounts: Record<string, number> = {
    Performance: 12,
    Low: 16,
    Medium: 24,
    High: 32,
    Ultra: 48,
  };

  gdjs.PixiFiltersTools.registerFilterCreator(
    'Scene3D::VolumetricFog',
    new (class implements gdjs.PixiFiltersTools.FilterCreator {
      makeFilter(
        target: EffectsTarget,
        effectData: EffectData
      ): gdjs.PixiFiltersTools.Filter {
        if (typeof THREE === 'undefined') {
          return new gdjs.PixiFiltersTools.EmptyFilter();
        }
        return new (class implements gdjs.PixiFiltersTools.Filter {
          shaderPass: THREE_ADDONS.VolumetricFogPass;
          _isEnabled: boolean = false;
          // In scene units: converted to the Three.js world units before each
          // rendering, as the world scale can change in the editor.
          _density: float = 0.0012;
          _height: float = 0;
          _heightFalloff: float = 0.002;
          _maxDistance: float = 4000;
          _lightShafts: float = 1;
          _quality: string = 'Medium';
          _top: string = 'Z+';
          _sunLight: THREE.DirectionalLight | null = null;

          constructor() {
            this.shaderPass = new THREE_ADDONS.VolumetricFogPass();
            this.shaderPass.setStepCount(
              volumetricFogStepCounts[this._quality]
            );
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
            // The depth texture is counted once per enabled effect.
            if (this._isEnabled) {
              return true;
            }
            const layerRenderer = target.getRenderer();
            layerRenderer.setSceneDepthTextureNeeded(true);
            layerRenderer.addPostProcessingPass(
              this.shaderPass,
              effectData.name
            );
            this._isEnabled = true;
            return true;
          }
          removeEffect(target: EffectsTarget): boolean {
            if (!(target instanceof gdjs.Layer)) {
              return false;
            }
            if (!this._isEnabled) {
              return true;
            }
            const layerRenderer = target.getRenderer();
            layerRenderer.removePostProcessingPass(this.shaderPass);
            layerRenderer.setSceneDepthTextureNeeded(false);
            this._isEnabled = false;
            return true;
          }
          updatePreRender(target: gdjs.EffectsTarget): any {
            if (!(target instanceof gdjs.Layer)) {
              return;
            }
            const layerRenderer = target.getRenderer();
            const camera = layerRenderer.getThreeCamera();
            const scene = layerRenderer.getThreeScene();
            const depthTexture = layerRenderer.getSceneDepthTexture();
            // Without the depth of the scene, there is nothing to raymarch.
            this.shaderPass.enabled = !!camera && !!scene && !!depthTexture;
            if (!camera || !scene || !depthTexture) {
              return;
            }

            // The camera and the light are read again when rendering, as they
            // are moved by the renderer just before.
            this.shaderPass.setCamera(camera);
            this.shaderPass.setPerspectiveCamera(
              camera instanceof THREE.PerspectiveCamera
            );
            this.shaderPass.setSunLight(this._getSunLight(scene));
            // The intensity of a directional light is an irradiance: the
            // radiance it gives to a surface is `intensity / PI`, which is
            // comparable to the color of the fog.
            this.shaderPass.sunIntensityScale = this._lightShafts / Math.PI;

            const uniforms = this.shaderPass.uniforms;
            uniforms.tDepth.value = depthTexture;

            const inverseWorldScale = target
              .getRuntimeScene()
              .getScene()
              .getRenderer3DInverseWorldScale();
            const worldScale = 1 / inverseWorldScale;
            // The density and the falloff are per scene unit, distances and
            // heights are in scene units.
            uniforms.fogDensity.value = this._density * worldScale;
            // The scene is scaled and mirrored on the Y axis (see
            // LayerPixiRenderer): the up axis of the 3D world is the Z axis of
            // the scene, or its Y axis when it goes up.
            uniforms.fogUpAxis.value.set(
              0,
              this._top === 'Y-' ? -1 : 0,
              this._top === 'Y-' ? 0 : 1
            );
            uniforms.fogHeight.value = this._height * inverseWorldScale;
            uniforms.fogFalloff.value = this._heightFalloff * worldScale;
            uniforms.fogMaxDistance.value = Math.max(
              0.0001,
              this._maxDistance * inverseWorldScale
            );
          }
          /**
           * The light shafts are drawn from the shadow map of the first
           * directional light casting shadows.
           * @param scene The scene of the layer.
           */
          _getSunLight(scene: THREE.Scene): THREE.DirectionalLight | null {
            const cachedLight = this._sunLight;
            if (cachedLight && cachedLight.parent && cachedLight.castShadow) {
              return cachedLight;
            }
            this._sunLight = null;
            scene.traverse((object) => {
              if (
                !this._sunLight &&
                object instanceof THREE.DirectionalLight &&
                object.castShadow
              ) {
                this._sunLight = object;
              }
            });
            return this._sunLight;
          }
          updateDoubleParameter(parameterName: string, value: number): void {
            if (parameterName === 'density') {
              this._density = Math.max(0, value);
            } else if (parameterName === 'height') {
              this._height = value;
            } else if (parameterName === 'heightFalloff') {
              this._heightFalloff = Math.max(0, value);
            } else if (parameterName === 'maxDistance') {
              this._maxDistance = Math.max(0, value);
            } else if (parameterName === 'lightShafts') {
              this._lightShafts = Math.max(0, value);
            }
          }
          getDoubleParameter(parameterName: string): number {
            if (parameterName === 'density') {
              return this._density;
            }
            if (parameterName === 'height') {
              return this._height;
            }
            if (parameterName === 'heightFalloff') {
              return this._heightFalloff;
            }
            if (parameterName === 'maxDistance') {
              return this._maxDistance;
            }
            if (parameterName === 'lightShafts') {
              return this._lightShafts;
            }
            return 0;
          }
          updateStringParameter(parameterName: string, value: string): void {
            if (parameterName === 'color') {
              this.shaderPass.uniforms.fogColor.value.setHex(
                gdjs.rgbOrHexStringToNumber(value)
              );
            }
            if (parameterName === 'quality') {
              const stepCount = volumetricFogStepCounts[value];
              if (stepCount !== undefined) {
                this._quality = value;
                this.shaderPass.setStepCount(stepCount);
              }
            }
            if (parameterName === 'top') {
              this._top = value;
            }
          }
          updateColorParameter(parameterName: string, value: number): void {
            if (parameterName === 'color') {
              this.shaderPass.uniforms.fogColor.value.setHex(value);
            }
          }
          getColorParameter(parameterName: string): number {
            if (parameterName === 'color') {
              return this.shaderPass.uniforms.fogColor.value.getHex();
            }
            return 0;
          }
          updateBooleanParameter(parameterName: string, value: boolean): void {}
          getNetworkSyncData(): VolumetricFogFilterNetworkSyncData {
            return {
              c: this.shaderPass.uniforms.fogColor.value.getHex(),
              d: this._density,
              h: this._height,
              f: this._heightFalloff,
              m: this._maxDistance,
              s: this._lightShafts,
              q: this._quality,
              t: this._top,
            };
          }
          updateFromNetworkSyncData(data: VolumetricFogFilterNetworkSyncData) {
            this.shaderPass.uniforms.fogColor.value.setHex(data.c);
            this._density = data.d;
            this._height = data.h;
            this._heightFalloff = data.f;
            this._maxDistance = data.m;
            this._lightShafts = data.s;
            this._quality = data.q;
            this._top = data.t || 'Z+';
            const stepCount = volumetricFogStepCounts[this._quality];
            if (stepCount !== undefined) {
              this.shaderPass.setStepCount(stepCount);
            }
          }
        })();
      }
    })()
  );
}
