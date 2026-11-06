// @flow
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import PixiResourcesLoader from '../../ObjectsRendering/PixiResourcesLoader';

/**
 * The type of the "Environment map" effect (see
 * `Extensions/3D/EnvironmentMapEffect.ts`, which must be kept in sync with
 * this file).
 */
const effectType = 'Scene3D::EnvironmentMap';

const findEnvironmentMapEffect = (layer: gdLayer): gdEffect | null => {
  const effects = layer.getEffects();
  for (let index = 0; index < effects.getEffectsCount(); index++) {
    const effect = effects.getEffectAt(index);
    if (effect.getEffectType() === effectType && effect.isEnabled()) {
      return effect;
    }
  }
  return null;
};

/**
 * Normalize a quality stored in an effect parameter.
 */
const normalizeQuality = (
  value: ?string
): 'auto' | 'low' | 'medium' | 'high' => {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'auto';
};

const getQualityMaxCubeSize = (quality: string): number => {
  switch (quality) {
    case 'low':
      return 128;
    case 'medium':
      return 256;
    case 'high':
      return 512;
    default:
      return 1024;
  }
};

const getQualityCubeSize = (quality: string, nativeSize: number): number => {
  const safeNativeSize = Math.max(16, Math.floor(nativeSize) || 16);
  return Math.min(safeNativeSize, getQualityMaxCubeSize(quality));
};

/**
 * A PMREM generator shared by every layer rendered with the same Three.js
 * renderer, kept alive as long as a layer uses it.
 */
type SharedPMREM = {|
  // $FlowFixMe[value-as-type]
  renderer: THREE.WebGLRenderer,
  // $FlowFixMe[value-as-type]
  generator: THREE.PMREMGenerator,
  // $FlowFixMe[value-as-type]
  defaultTextures: { [quality: string]: THREE.Texture },
  refCount: number,
|};

const sharedPMREMs: Array<SharedPMREM> = [];

// $FlowFixMe[value-as-type]
const getSharedPMREM = (threeRenderer: THREE.WebGLRenderer): SharedPMREM => {
  let entry = sharedPMREMs.find(
    candidate => candidate.renderer === threeRenderer
  );
  if (!entry) {
    entry = {
      renderer: threeRenderer,
      generator: new THREE.PMREMGenerator(threeRenderer),
      defaultTextures: {},
      refCount: 0,
    };
    sharedPMREMs.push(entry);
  }
  entry.refCount++;
  return entry;
};

const releaseSharedPMREM = (entry: SharedPMREM): void => {
  entry.refCount--;
  if (entry.refCount > 0) return;
  Object.keys(entry.defaultTextures).forEach(quality => {
    entry.defaultTextures[quality].dispose();
  });
  entry.generator.dispose();
  const index = sharedPMREMs.indexOf(entry);
  if (index !== -1) sharedPMREMs.splice(index, 1);
};

// $FlowFixMe[value-as-type]
const getDefaultTexture = (
  entry: SharedPMREM,
  quality: string
  // $FlowFixMe[value-as-type]
): THREE.Texture | null => {
  const existing = entry.defaultTextures[quality];
  if (existing) return existing;
  const size = quality === 'low' ? 128 : quality === 'high' ? 512 : 256;
  const roomEnvironment = new RoomEnvironment();
  try {
    const target = entry.generator.fromScene(roomEnvironment, 0.04, 0.1, 100, {
      size,
    });
    entry.defaultTextures[quality] = target.texture;
    return target.texture;
  } catch (error) {
    console.warn('Unable to build the default environment:', error);
    return null;
  } finally {
    roomEnvironment.dispose();
  }
};

/**
 * Show the "Environment map" effect of a layer in the scene editor: light the
 * 3D scene with the images of the effect (image based lighting) and show them
 * as the background of the layer when it is configured.
 *
 * The environment is prefiltered with a PMREM generator shared by every layer
 * rendered with the same Three.js renderer (like in the game engine).
 */
export default class LayerEnvironmentMapEffect {
  // The settings of the effect being displayed (to rebuild the textures when
  // they change).
  _key: string | null = null;
  _isApplied: boolean = false;

  // The shared PMREM generator used to prefilter the source texture.
  _pmremEntry: SharedPMREM | null = null;
  // The PMREM render target of the source texture (owned).
  // $FlowFixMe[value-as-type]
  _prefilterTarget: THREE.WebGLRenderTarget | null = null;
  // The texture currently applied to the scene (not always owned).
  // $FlowFixMe[value-as-type]
  _environmentTexture: THREE.Texture | null = null;
  // $FlowFixMe[value-as-type]
  _skyboxTexture: THREE.Texture | null = null;

  // The state of the scene before the effect was applied.
  _oldEnvironment: any = null;
  _oldEnvironmentIntensity: number = 1;
  // $FlowFixMe[value-as-type]
  _oldEnvironmentRotation: THREE.Euler = new THREE.Euler();
  _oldBackground: any = null;
  _oldBackgroundIntensity: number = 1;
  _oldBackgroundBlurriness: number = 0;
  // $FlowFixMe[value-as-type]
  _oldBackgroundRotation: THREE.Euler = new THREE.Euler();
  _environmentApplied: boolean = false;
  _backgroundApplied: boolean = false;

  // Avoid applying the result of an outdated texture loading.
  _buildToken: number = 0;

  /**
   * Apply the "Environment map" effect of the layer to its 3D scene, and keep
   * it up to date with the effect settings. Must be called at each frame.
   */
  update(
    project: gdProject,
    layer: gdLayer,
    // $FlowFixMe[value-as-type]
    threeScene: THREE.Scene | null,
    // $FlowFixMe[value-as-type]
    threeRenderer: THREE.WebGLRenderer | null
  ): void {
    if (
      threeRenderer &&
      (!this._pmremEntry || this._pmremEntry.renderer !== threeRenderer)
    ) {
      if (this._pmremEntry) releaseSharedPMREM(this._pmremEntry);
      this._pmremEntry = getSharedPMREM(threeRenderer);
    }
    if (!threeScene) return;
    const effect = findEnvironmentMapEffect(layer);
    if (!effect) {
      if (this._isApplied) {
        this._restoreScene(threeScene);
        this._disposeTextures();
        this._key = null;
        this._isApplied = false;
      }
      return;
    }

    const key = JSON.stringify([
      effect.getStringParameter('source'),
      effect.getStringParameter('rightFaceResourceName'),
      effect.getStringParameter('leftFaceResourceName'),
      effect.getStringParameter('topFaceResourceName'),
      effect.getStringParameter('bottomFaceResourceName'),
      effect.getStringParameter('frontFaceResourceName'),
      effect.getStringParameter('backFaceResourceName'),
      effect.getStringParameter('equirectangularResourceName'),
      effect.getStringParameter('quality'),
    ]);
    if (key !== this._key) {
      this._key = key;
      this._buildTextures(project, effect, threeScene);
    } else if (effect.getStringParameter('source') === 'skybox') {
      // The Skybox effect may be applied after this effect: follow the texture
      // it puts in the scene background.
      const background: any = threeScene.background;
      if (
        background &&
        background.isTexture &&
        background !== this._skyboxTexture &&
        background !== this._environmentTexture
      ) {
        this._buildTextures(project, effect, threeScene);
      }
    }
    this._applyToScene(effect, threeScene);
  }

  /**
   * Restore the scene and dispose the textures of the effect. Must be called
   * when the layer is destroyed.
   */
  // $FlowFixMe[value-as-type]
  dispose(threeScene: THREE.Scene | null): void {
    if (threeScene && this._isApplied) {
      this._restoreScene(threeScene);
    }
    this._disposeTextures();
    if (this._pmremEntry) {
      releaseSharedPMREM(this._pmremEntry);
      this._pmremEntry = null;
    }
    this._isApplied = false;
    this._key = null;
  }

  // $FlowFixMe[value-as-type]
  _restoreScene(threeScene: THREE.Scene): void {
    if (this._environmentApplied) {
      threeScene.environment = this._oldEnvironment;
      threeScene.environmentIntensity = this._oldEnvironmentIntensity;
      threeScene.environmentRotation.copy(this._oldEnvironmentRotation);
      this._environmentApplied = false;
    }
    if (this._backgroundApplied) {
      threeScene.background = this._oldBackground;
      threeScene.backgroundIntensity = this._oldBackgroundIntensity;
      threeScene.backgroundBlurriness = this._oldBackgroundBlurriness;
      threeScene.backgroundRotation.copy(this._oldBackgroundRotation);
      this._backgroundApplied = false;
    }
    this._isApplied = false;
  }

  _applyToScene(effect: gdEffect, threeScene: THREE.Scene): void {
    if (!this._environmentTexture) {
      // The environment is still loading and no default could be built.
      return;
    }
    if (!this._isApplied) {
      this._oldEnvironment = threeScene.environment;
      this._oldEnvironmentIntensity = threeScene.environmentIntensity;
      this._oldEnvironmentRotation.copy(threeScene.environmentRotation);
      this._oldBackground = threeScene.background;
      this._oldBackgroundIntensity = threeScene.backgroundIntensity;
      this._oldBackgroundBlurriness = threeScene.backgroundBlurriness;
      this._oldBackgroundRotation.copy(threeScene.backgroundRotation);
      this._isApplied = true;
    }
    const rotation = (effect.getDoubleParameter('rotation') * Math.PI) / 180;
    const affectsMaterials = effect.getBooleanParameter('affectsMaterials');
    if (affectsMaterials) {
      threeScene.environment = this._environmentTexture;
      threeScene.environmentIntensity = effect.getDoubleParameter(
        'environmentIntensity'
      );
      threeScene.environmentRotation.set(0, rotation, 0);
      this._environmentApplied = true;
    } else if (this._environmentApplied) {
      threeScene.environment = this._oldEnvironment;
      threeScene.environmentIntensity = this._oldEnvironmentIntensity;
      threeScene.environmentRotation.copy(this._oldEnvironmentRotation);
      this._environmentApplied = false;
    }

    const showBackground =
      effect.getBooleanParameter('showBackground') &&
      effect.getStringParameter('source') !== 'skybox';
    if (showBackground) {
      threeScene.background = this._environmentTexture;
      threeScene.backgroundIntensity = effect.getDoubleParameter(
        'backgroundIntensity'
      );
      threeScene.backgroundBlurriness = effect.getDoubleParameter(
        'backgroundBlurriness'
      );
      threeScene.backgroundRotation.set(
        0,
        effect.getBooleanParameter('linkBackgroundRotation') ? rotation : 0,
        0
      );
      this._backgroundApplied = true;
    } else if (this._backgroundApplied) {
      threeScene.background = this._oldBackground;
      threeScene.backgroundIntensity = this._oldBackgroundIntensity;
      threeScene.backgroundBlurriness = this._oldBackgroundBlurriness;
      threeScene.backgroundRotation.copy(this._oldBackgroundRotation);
      this._backgroundApplied = false;
    }
  }

  _buildTextures(
    project: gdProject,
    effect: gdEffect,
    // $FlowFixMe[value-as-type]
    threeScene: THREE.Scene
  ): void {
    this._disposeTextures();
    const buildToken = ++this._buildToken;

    const entry = this._pmremEntry;
    const quality = normalizeQuality(effect.getStringParameter('quality'));
    const source = effect.getStringParameter('source');

    // The default environment is already prefiltered (RoomEnvironment).
    if (
      source === 'default' ||
      (source === 'skybox' && !this._getSkyboxTexture(threeScene))
    ) {
      this._environmentTexture = entry
        ? getDefaultTexture(entry, quality)
        : null;
      this._skyboxTexture = null;
      return;
    }
    if (source === 'skybox') {
      const skyboxTexture = this._getSkyboxTexture(threeScene);
      this._skyboxTexture = skyboxTexture;
      // The skybox texture is owned by the Skybox effect: it is not disposed.
      this._prefilterSource(skyboxTexture, quality, buildToken);
      return;
    }

    // Show the default environment immediately while the images are loading.
    if (entry) {
      this._environmentTexture = getDefaultTexture(entry, quality);
    }
    const loading =
      source === 'equirect'
        ? this._loadEquirectangularTexture(
            project,
            effect.getStringParameter('equirectangularResourceName')
          )
        : this._loadCubeTexture(project, effect);
    loading.then(
      sourceTexture => {
        if (buildToken !== this._buildToken) {
          if (sourceTexture) sourceTexture.dispose();
          return;
        }
        if (!sourceTexture) {
          // Fallback to the default environment when the source is empty or
          // failed to load.
          if (entry && !this._environmentTexture) {
            this._environmentTexture = getDefaultTexture(entry, quality);
          }
          return;
        }
        try {
          this._prefilterSource(sourceTexture, quality, buildToken);
        } finally {
          // The loaded source is only used to build the PMREM texture.
          sourceTexture.dispose();
        }
      },
      error => {
        console.warn('Unable to load the environment map images:', error);
        if (buildToken === this._buildToken && entry) {
          this._environmentTexture = getDefaultTexture(entry, quality);
        }
      }
    );
  }

  // $FlowFixMe[value-as-type]
  _getSkyboxTexture(threeScene: THREE.Scene): THREE.Texture | null {
    const background: any = threeScene.background;
    if (background && background.isTexture) return background;
    return null;
  }

  /**
   * Prefilter a source texture with the shared PMREM generator, applying the
   * quality tier by downscaling the LDR images (HDR/EXR keep their native
   * resolution). The source texture is not disposed by this method.
   */
  _prefilterSource(
    sourceTexture: any,
    quality: string,
    buildToken: number
  ): void {
    const entry = this._pmremEntry;
    if (!entry || !sourceTexture) {
      return;
    }
    let textureToUse = sourceTexture;
    let resizedTexture = null;
    const isCube = !!sourceTexture.isCubeTexture;
    if (isCube) {
      const nativeSize = this._getCubeTextureSize(sourceTexture);
      const cubeSize = getQualityCubeSize(quality, nativeSize);
      if (nativeSize > cubeSize) {
        resizedTexture = this._resizeCubeTexture(sourceTexture, cubeSize);
        if (resizedTexture) textureToUse = resizedTexture;
      }
    } else {
      const nativeCubeSize = Math.max(
        16,
        Math.floor(this._getTextureSize(sourceTexture) / 4)
      );
      const cubeSize = getQualityCubeSize(quality, nativeCubeSize);
      if (nativeCubeSize > cubeSize) {
        resizedTexture = this._resizeEquirectangularTexture(
          sourceTexture,
          cubeSize * 4,
          cubeSize * 2
        );
        if (resizedTexture) textureToUse = resizedTexture;
      }
    }

    try {
      const target = isCube
        ? entry.generator.fromCubemap(textureToUse)
        : entry.generator.fromEquirectangular(textureToUse);
      if (buildToken !== this._buildToken) {
        target.dispose();
        return;
      }
      this._prefilterTarget = target;
      this._environmentTexture = target.texture;
    } catch (error) {
      console.warn('Unable to prefilter the environment map:', error);
      this._environmentTexture = getDefaultTexture(entry, quality);
    } finally {
      if (resizedTexture) resizedTexture.dispose();
    }
  }

  _getTextureSize(texture: any): number {
    const image = texture && texture.image;
    if (!image) return 16;
    if (Array.isArray(image)) {
      return image[0]
        ? image[0].width || (image[0].image && image[0].image.width) || 16
        : 16;
    }
    return image.width || 16;
  }

  _getCubeTextureSize(cubeTexture: any): number {
    const images = cubeTexture.images;
    if (!images || !images[0]) return 16;
    return images[0].width || (images[0].image && images[0].image.width) || 16;
  }

  _resizeEquirectangularTexture(
    sourceTexture: any,
    width: number,
    height: number
  ): any {
    const image = sourceTexture.image;
    // Only LDR images (HTMLImageElement/Canvas) can be resized with a canvas.
    // HDR/EXR DataTextures keep their native resolution.
    if (
      !image ||
      image.data ||
      (image.width <= width && image.height <= height)
    ) {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const texture = new THREE.Texture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = sourceTexture.colorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  _resizeCubeTexture(cubeTexture: any, size: number): any {
    const images = cubeTexture.images;
    if (!images || images.length !== 6) return null;
    const resizedImages = images.map(image => {
      const width = image.width || (image.image && image.image.width);
      const height = image.height || (image.image && image.image.height);
      if (!width || !height || (width <= size && height <= size)) return image;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) return image;
      context.drawImage(image, 0, 0, size, size);
      return canvas;
    });
    const resized = new THREE.CubeTexture(resizedImages);
    resized.colorSpace = cubeTexture.colorSpace;
    resized.needsUpdate = true;
    return resized;
  }

  _loadEquirectangularTexture(
    project: gdProject,
    resourceName: string
    // $FlowFixMe[value-as-type]
  ): Promise<THREE.Texture | null> {
    if (!resourceName) return Promise.resolve(null);
    return PixiResourcesLoader.getThreeEquirectangularEnvironmentTexture(
      project,
      resourceName
    );
  }

  _loadCubeTexture(
    project: gdProject,
    effect: gdEffect
    // $FlowFixMe[value-as-type]
  ): Promise<THREE.Texture | null> {
    const resourceNames = [
      effect.getStringParameter('rightFaceResourceName'),
      effect.getStringParameter('leftFaceResourceName'),
      effect.getStringParameter('topFaceResourceName'),
      effect.getStringParameter('bottomFaceResourceName'),
      effect.getStringParameter('frontFaceResourceName'),
      effect.getStringParameter('backFaceResourceName'),
    ];
    if (!resourceNames.some(resourceName => resourceName)) {
      return Promise.resolve(null);
    }
    return Promise.all(
      resourceNames.map(resourceName =>
        resourceName
          ? PixiResourcesLoader.getThreeTexture(project, resourceName)
          : Promise.resolve(null)
      )
    ).then(textures => {
      const images = textures.map(texture => (texture ? texture.image : null));
      if (!images.some(image => image)) {
        return null;
      }
      // The same face order as `getThreeCubeTexture` in the game engine (the
      // images of the X axis are swapped).
      const cubeTexture = new THREE.CubeTexture(images);
      cubeTexture.colorSpace = THREE.SRGBColorSpace;
      cubeTexture.needsUpdate = true;
      return cubeTexture;
    });
  }

  _disposeTextures(): void {
    if (this._prefilterTarget) {
      this._prefilterTarget.dispose();
      this._prefilterTarget = null;
    }
    this._environmentTexture = null;
    this._skyboxTexture = null;
  }
}
