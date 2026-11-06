namespace gdjs {
  interface EnvironmentMapFilterNetworkSyncData {
    /** The environment light intensity. */
    ei?: number;
    /** The background brightness. */
    bi?: number;
    /** The rotation of the environment (in degrees). */
    r?: number;
    /** The source ('default', 'cube', 'equirect' or 'skybox'). */
    s?: string;
    /** Whether the images are shown as the background. */
    sb?: boolean;
    /** The image resources. */
    rs?: Array<string>;
    /** The PMREM quality ('auto', 'low', 'medium' or 'high'). */
    q?: string;
    /** The background blurriness. */
    bb?: number;
    /** Whether the environment lights the materials. */
    am?: boolean;
    /** Whether the background rotates with the environment. */
    rb?: boolean;
  }

  const normalizeEnvironmentSourceType = (
    source: string | null | undefined
  ): gdjs.EnvironmentSourceType => {
    if (
      source === 'default' ||
      source === 'cube' ||
      source === 'equirect' ||
      source === 'skybox'
    ) {
      return source;
    }
    return 'cube';
  };

  /**
   * The "Environment map" effect lights a 3D scene with images (image based
   * lighting) and can show them as the background of the layer.
   *
   * The images are prefiltered with PMREM to get a smooth roughness on every
   * GPU (see https://threejs.org/docs/#api/en/materials/MeshStandardMaterial).
   * The prefiltered textures are cached and shared by all the layers using the
   * same source (see `gdjs.EnvironmentManager`).
   */
  gdjs.PixiFiltersTools.registerFilterCreator(
    'Scene3D::EnvironmentMap',
    new (class implements gdjs.PixiFiltersTools.FilterCreator {
      makeFilter(
        target: EffectsTarget,
        effectData: EffectData
      ): gdjs.PixiFiltersTools.Filter {
        if (typeof THREE === 'undefined') {
          return new gdjs.PixiFiltersTools.EmptyFilter();
        }
        return new (class implements gdjs.PixiFiltersTools.Filter {
          // The settings of the effect.
          private _source: gdjs.EnvironmentSourceType =
            normalizeEnvironmentSourceType(effectData.stringParameters.source);
          private _resourceNames: Array<string> = [
            effectData.stringParameters.rightFaceResourceName || '',
            effectData.stringParameters.leftFaceResourceName || '',
            effectData.stringParameters.topFaceResourceName || '',
            effectData.stringParameters.bottomFaceResourceName || '',
            effectData.stringParameters.frontFaceResourceName || '',
            effectData.stringParameters.backFaceResourceName || '',
            effectData.stringParameters.equirectangularResourceName || '',
          ];
          private _environmentIntensity: float =
            effectData.doubleParameters.environmentIntensity !== undefined
              ? effectData.doubleParameters.environmentIntensity
              : 1;
          private _showBackground: boolean =
            effectData.booleanParameters.showBackground || false;
          private _backgroundIntensity: float =
            effectData.doubleParameters.backgroundIntensity !== undefined
              ? effectData.doubleParameters.backgroundIntensity
              : 1;
          private _backgroundBlurriness: float =
            effectData.doubleParameters.backgroundBlurriness !== undefined
              ? effectData.doubleParameters.backgroundBlurriness
              : 0;
          private _rotation: float = effectData.doubleParameters.rotation || 0;
          private _quality: gdjs.EnvironmentQuality =
            gdjs.normalizeEnvironmentQuality(
              effectData.stringParameters.quality
            );
          private _affectsMaterials: boolean =
            effectData.booleanParameters.affectsMaterials !== undefined
              ? effectData.booleanParameters.affectsMaterials
              : true;
          private _linkBackgroundRotation: boolean =
            effectData.booleanParameters.linkBackgroundRotation !== undefined
              ? effectData.booleanParameters.linkBackgroundRotation
              : true;

          // The state of the effect.
          private _isEnabled: boolean = false;
          /** The cached environment used by the effect (not owned). */
          private _environmentEntry: gdjs.EnvironmentCacheEntry | null = null;
          /** The texture currently applied to the scene (not owned). */
          private _environmentTexture: THREE.Texture | null = null;
          /** The background texture used by a `skybox` source (not owned). */
          private _skyboxTexture: THREE.Texture | null = null;

          // The state of the scene before the effect was applied.
          private _oldEnvironment: THREE.Texture | null = null;
          private _oldEnvironmentIntensity: float = 1;
          private _oldEnvironmentRotation: THREE.Euler = new THREE.Euler();
          private _oldBackground:
            | THREE.CubeTexture
            | THREE.Texture
            | THREE.Color
            | null = null;
          private _oldBackgroundIntensity: float = 1;
          private _oldBackgroundBlurriness: float = 0;
          private _oldBackgroundRotation: THREE.Euler = new THREE.Euler();
          private _environmentApplied: boolean = false;
          private _backgroundApplied: boolean = false;
          /**
           * The last target the effect was applied to, used to rebuild the
           * environment when a network sync data is received (the update is
           * not given any target).
           */
          private _lastTarget: EffectsTarget | null = null;

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
            this._lastTarget = target;
            const scene = target.get3DRendererObject() as
              | THREE.Scene
              | null
              | undefined;
            if (!scene) {
              return false;
            }
            this._saveSceneState(scene);
            this._isEnabled = true;
            this._acquireEnvironment(target, scene);
            this._applyToScene(scene);
            return true;
          }

          removeEffect(target: EffectsTarget): boolean {
            const scene = target.get3DRendererObject() as
              | THREE.Scene
              | null
              | undefined;
            if (!scene) {
              return false;
            }
            this._restoreScene(scene);
            this._isEnabled = false;
            this._releaseEnvironment(target);
            this._lastTarget = null;
            return true;
          }

          updatePreRender(target: EffectsTarget): void {
            this._lastTarget = target;
            if (!this._isEnabled || this._source !== 'skybox') {
              return;
            }
            // The Skybox effect may be applied after this effect: follow the
            // texture it puts in the scene background.
            const scene = target.get3DRendererObject() as
              | THREE.Scene
              | null
              | undefined;
            if (!scene) return;
            const background = scene.background as THREE.Texture | null;
            if (
              background &&
              (background as THREE.Texture).isTexture &&
              background !== this._skyboxTexture &&
              background !== this._environmentTexture
            ) {
              this._acquireEnvironment(target, scene);
              this._applyToScene(scene);
            }
          }

          private _saveSceneState(scene: THREE.Scene): void {
            this._oldEnvironment = scene.environment;
            this._oldEnvironmentIntensity = scene.environmentIntensity;
            this._oldEnvironmentRotation.copy(scene.environmentRotation);
            this._oldBackground = scene.background;
            this._oldBackgroundIntensity = scene.backgroundIntensity;
            this._oldBackgroundBlurriness = scene.backgroundBlurriness;
            this._oldBackgroundRotation.copy(scene.backgroundRotation);
            this._environmentApplied = false;
            this._backgroundApplied = false;
          }

          private _restoreScene(scene: THREE.Scene): void {
            if (this._environmentApplied) {
              scene.environment = this._oldEnvironment;
              scene.environmentIntensity = this._oldEnvironmentIntensity;
              scene.environmentRotation.copy(this._oldEnvironmentRotation);
              this._environmentApplied = false;
            }
            if (this._backgroundApplied) {
              scene.background = this._oldBackground;
              scene.backgroundIntensity = this._oldBackgroundIntensity;
              scene.backgroundBlurriness = this._oldBackgroundBlurriness;
              scene.backgroundRotation.copy(this._oldBackgroundRotation);
              this._backgroundApplied = false;
            }
          }

          private _applyToScene(scene: THREE.Scene): void {
            const rotation = gdjs.toRad(this._rotation);
            if (this._environmentTexture && this._affectsMaterials) {
              scene.environment = this._environmentTexture;
              scene.environmentIntensity = this._environmentIntensity;
              scene.environmentRotation.set(0, rotation, 0);
              this._environmentApplied = true;
            } else if (this._environmentApplied) {
              scene.environment = this._oldEnvironment;
              scene.environmentIntensity = this._oldEnvironmentIntensity;
              scene.environmentRotation.copy(this._oldEnvironmentRotation);
              this._environmentApplied = false;
            }

            // A `skybox` source already comes from the background: it is left
            // untouched (the Skybox effect owns it).
            if (
              this._environmentTexture &&
              this._showBackground &&
              this._source !== 'skybox'
            ) {
              scene.background = this._environmentTexture;
              scene.backgroundIntensity = this._backgroundIntensity;
              scene.backgroundBlurriness = this._backgroundBlurriness;
              if (this._linkBackgroundRotation) {
                scene.backgroundRotation.set(0, rotation, 0);
              } else {
                scene.backgroundRotation.set(0, 0, 0);
              }
              this._backgroundApplied = true;
            } else if (this._backgroundApplied) {
              scene.background = this._oldBackground;
              scene.backgroundIntensity = this._oldBackgroundIntensity;
              scene.backgroundBlurriness = this._oldBackgroundBlurriness;
              scene.backgroundRotation.copy(this._oldBackgroundRotation);
              this._backgroundApplied = false;
            }
          }

          /**
           * Build the source of the environment and acquire the cached
           * prefiltered texture. The default environment is used immediately
           * while an HDR/EXR file is loading, or when the source fails.
           */
          private _acquireEnvironment(
            target: EffectsTarget,
            scene: THREE.Scene
          ): void {
            this._releaseEnvironment(target);
            const environmentManager = this._getEnvironmentManager(target);
            const source = this._getSource(scene);
            const entry = environmentManager.acquire(source, this._quality);
            this._environmentEntry = entry;
            this._skyboxTexture =
              source.type === 'skybox' ? source.texture || null : null;
            this._environmentTexture =
              environmentManager.getEntryTexture(entry);
            environmentManager.addReadyListener(entry, () => {
              if (this._environmentEntry !== entry) return;
              this._environmentTexture =
                environmentManager.getEntryTexture(entry);
              this._applyToCurrentScene(target);
            });
          }

          private _getEnvironmentManager(
            target: EffectsTarget
          ): gdjs.EnvironmentManager {
            return target
              .getRuntimeScene()
              .getGame()
              .getPBRMaterialManager()
              .getEnvironmentManager();
          }

          private _getSource(scene: THREE.Scene): gdjs.EnvironmentSource {
            if (this._source === 'default') {
              return { type: 'default' };
            }
            if (this._source === 'skybox') {
              const background = scene.background as THREE.Texture | null;
              if (
                background &&
                (background as THREE.Texture).isTexture &&
                background !== this._environmentTexture
              ) {
                return { type: 'skybox', texture: background };
              }
              return { type: 'default' };
            }
            if (this._source === 'equirect') {
              const resourceName = this._resourceNames[6];
              return resourceName
                ? { type: 'equirect', resourceName }
                : { type: 'default' };
            }
            const faceResourceNames = this._resourceNames.slice(0, 6);
            if (!faceResourceNames.some((resourceName) => !!resourceName)) {
              return { type: 'default' };
            }
            return { type: 'cube', faceResourceNames };
          }

          private _releaseEnvironment(target: EffectsTarget): void {
            if (this._environmentEntry) {
              this._getEnvironmentManager(target).release(
                this._environmentEntry
              );
              this._environmentEntry = null;
            }
            this._environmentTexture = null;
            this._skyboxTexture = null;
          }

          private _rebuildEnvironment(target: EffectsTarget): void {
            const scene = target.get3DRendererObject() as
              | THREE.Scene
              | null
              | undefined;
            if (!scene || !this._isEnabled) {
              return;
            }
            this._acquireEnvironment(target, scene);
            this._applyToScene(scene);
          }

          private _applyToCurrentScene(target: EffectsTarget): void {
            const scene = target.get3DRendererObject() as
              | THREE.Scene
              | null
              | undefined;
            if (scene && this._isEnabled) {
              this._applyToScene(scene);
            }
          }

          updateDoubleParameter(parameterName: string, value: number): void {
            if (parameterName === 'environmentIntensity') {
              this._environmentIntensity = value;
            } else if (parameterName === 'backgroundIntensity') {
              this._backgroundIntensity = value;
            } else if (parameterName === 'backgroundBlurriness') {
              this._backgroundBlurriness = value;
            } else if (parameterName === 'rotation') {
              this._rotation = value;
            } else {
              return;
            }
            this._applyToCurrentScene(target);
          }

          getDoubleParameter(parameterName: string): number {
            if (parameterName === 'environmentIntensity') {
              return this._environmentIntensity;
            }
            if (parameterName === 'backgroundIntensity') {
              return this._backgroundIntensity;
            }
            if (parameterName === 'backgroundBlurriness') {
              return this._backgroundBlurriness;
            }
            if (parameterName === 'rotation') {
              return this._rotation;
            }
            return 0;
          }

          updateStringParameter(parameterName: string, value: string): void {
            if (parameterName === 'source') {
              this._source = normalizeEnvironmentSourceType(value);
            } else if (parameterName === 'quality') {
              this._quality = gdjs.normalizeEnvironmentQuality(value);
            } else if (parameterName === 'rightFaceResourceName') {
              this._resourceNames[0] = value;
            } else if (parameterName === 'leftFaceResourceName') {
              this._resourceNames[1] = value;
            } else if (parameterName === 'topFaceResourceName') {
              this._resourceNames[2] = value;
            } else if (parameterName === 'bottomFaceResourceName') {
              this._resourceNames[3] = value;
            } else if (parameterName === 'frontFaceResourceName') {
              this._resourceNames[4] = value;
            } else if (parameterName === 'backFaceResourceName') {
              this._resourceNames[5] = value;
            } else if (parameterName === 'equirectangularResourceName') {
              this._resourceNames[6] = value;
            } else {
              return;
            }
            this._rebuildEnvironment(target);
          }

          updateColorParameter(parameterName: string, value: number): void {}
          getColorParameter(parameterName: string): number {
            return 0;
          }

          updateBooleanParameter(parameterName: string, value: boolean): void {
            if (parameterName === 'showBackground') {
              this._showBackground = value;
            } else if (parameterName === 'affectsMaterials') {
              this._affectsMaterials = value;
            } else if (parameterName === 'linkBackgroundRotation') {
              this._linkBackgroundRotation = value;
            } else {
              return;
            }
            this._applyToCurrentScene(target);
          }

          getNetworkSyncData(): EnvironmentMapFilterNetworkSyncData {
            return {
              ei: this._environmentIntensity,
              bi: this._backgroundIntensity,
              r: this._rotation,
              s: this._source,
              sb: this._showBackground,
              rs: this._resourceNames.slice(),
              q: this._quality,
              bb: this._backgroundBlurriness,
              am: this._affectsMaterials,
              rb: this._linkBackgroundRotation,
            };
          }

          updateFromNetworkSyncData(
            syncData: EnvironmentMapFilterNetworkSyncData
          ): void {
            if (syncData.ei !== undefined)
              this._environmentIntensity = syncData.ei;
            if (syncData.bi !== undefined)
              this._backgroundIntensity = syncData.bi;
            if (syncData.r !== undefined) this._rotation = syncData.r;
            if (syncData.sb !== undefined) this._showBackground = syncData.sb;
            if (syncData.s !== undefined)
              this._source = normalizeEnvironmentSourceType(syncData.s);
            if (syncData.rs !== undefined)
              this._resourceNames = syncData.rs.slice();
            if (syncData.q !== undefined)
              this._quality = gdjs.normalizeEnvironmentQuality(syncData.q);
            if (syncData.bb !== undefined)
              this._backgroundBlurriness = syncData.bb;
            if (syncData.am !== undefined) this._affectsMaterials = syncData.am;
            if (syncData.rb !== undefined)
              this._linkBackgroundRotation = syncData.rb;
            if (this._lastTarget) {
              this._rebuildEnvironment(this._lastTarget);
            }
          }
        })();
      }
    })()
  );
}
