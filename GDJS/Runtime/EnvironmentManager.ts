/*
 * GDevelop JS Platform
 * Copyright 2013-present Florian Rival (Florian.Rival@gmail.com). All rights
 * reserved. This project is released under the MIT License.
 */
namespace gdjs {
  const environmentLogger = new gdjs.Logger('Environment Manager');

  /**
   * The quality of the prefiltered environment map (PMREM). A lower quality
   * uses less GPU memory and is cheaper to build, but gives blurrier
   * reflections. `auto` keeps the resolution of the source (up to a safe
   * maximum) to render old projects exactly like before.
   *
   * @category 3D > Environment
   */
  export type EnvironmentQuality = 'auto' | 'low' | 'medium' | 'high';

  /**
   * Where the environment map of a scene comes from.
   *
   * @category 3D > Environment
   */
  export type EnvironmentSourceType =
    | 'default'
    | 'equirect'
    | 'cube'
    | 'skybox';

  /**
   * A source for an environment map.
   *
   * @category 3D > Environment
   */
  export interface EnvironmentSource {
    /** The kind of source. */
    type: EnvironmentSourceType;
    /** The image resource of an equirectangular source. */
    resourceName?: string;
    /** The 6 image resources of a cube source (X+, X-, Y+, Y-, Z+, Z-). */
    faceResourceNames?: string[];
    /** The texture to use for a `skybox` source (usually the scene background). */
    texture?: THREE.Texture | null;
  }

  /**
   * The state of a cached environment map.
   *
   * @category 3D > Environment
   */
  export type EnvironmentLoadState = 'loading' | 'ready' | 'failed';

  /**
   * A cached environment map, shared by every scene/effect using the same
   * source and quality.
   *
   * @category 3D > Environment
   */
  export interface EnvironmentCacheEntry {
    /** The key identifying the source and quality. */
    key: string;
    /** The source of the environment. */
    source: EnvironmentSource;
    /** The quality of the environment. */
    quality: EnvironmentQuality;
    /** Where the loading is. */
    state: EnvironmentLoadState;
    /** The PMREM render target (owned when `ownsTarget` is true). */
    target: THREE.WebGLRenderTarget | null;
    /** A texture that is not owned by this entry (like the default one). */
    sharedTexture: THREE.Texture | null;
    /** Whether the render target must be disposed when the entry is released. */
    ownsTarget: boolean;
    /** How many effects/scenes reference this entry. */
    refCount: number;
    /** Called when the texture changes (loading finished or upgraded). */
    listeners: Array<() => void>;
    /** True once the entry is not referenced anymore (loading is ignored). */
    cancelled: boolean;
  }

  /**
   * Get the lowercased extension of a resource file name.
   *
   * @category 3D > Environment
   */
  export const getEnvironmentFileExtension = (fileName: string): string => {
    const withoutQuery = fileName.split('?')[0].split('#')[0];
    const lastDot = withoutQuery.lastIndexOf('.');
    return lastDot === -1
      ? ''
      : withoutQuery.substring(lastDot + 1).toLowerCase();
  };

  /**
   * Normalize a quality stored in an effect parameter (or in an old project).
   *
   * @category 3D > Environment
   */
  export const normalizeEnvironmentQuality = (
    value: string | null | undefined
  ): EnvironmentQuality => {
    if (value === 'low' || value === 'medium' || value === 'high') {
      return value;
    }
    return 'auto';
  };

  /**
   * The maximum cube face size used by a quality tier. `auto` keeps the source
   * resolution, capped to avoid allocating huge GPU buffers.
   *
   * @category 3D > Environment
   */
  export const getEnvironmentQualityMaxCubeSize = (
    quality: EnvironmentQuality
  ): number => {
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

  /**
   * The cube face size to use for a source of the given native size, for a
   * quality tier. The source is never upscaled (it would not add details) and
   * is never smaller than 16 pixels (the minimum supported by Three.js).
   *
   * @category 3D > Environment
   */
  export const getEnvironmentQualityCubeSize = (
    quality: EnvironmentQuality,
    nativeSize: number
  ): number => {
    const maxSize = getEnvironmentQualityMaxCubeSize(quality);
    const safeNativeSize = Math.max(16, Math.floor(nativeSize) || 16);
    return Math.min(safeNativeSize, maxSize);
  };

  /**
   * Check if the given file contains an Ultra HDR gain map (inside a JPEG).
   * This is a cheap scan of the beginning of the file: it avoids trying to
   * parse every JPEG with the UltraHDRLoader (which logs an error for normal
   * JPEG files).
   *
   * @category 3D > Environment
   */
  export const isUltraHDRBuffer = (buffer: ArrayBuffer): boolean => {
    const maxLength = Math.min(buffer.byteLength, 256 * 1024);
    const bytes = new Uint8Array(buffer, 0, maxLength);
    // "MPF\0" is the marker of the Multi-Picture Format used by Ultra HDR.
    let hasMPF = false;
    for (let index = 0; index < bytes.length - 3; index++) {
      if (
        bytes[index] === 0x4d &&
        bytes[index + 1] === 0x50 &&
        bytes[index + 2] === 0x46 &&
        bytes[index + 3] === 0x00
      ) {
        hasMPF = true;
        break;
      }
    }
    if (!hasMPF) return false;
    // The gain map metadata is stored in XMP (legacy) or ISO 21496-1.
    const header = new TextDecoder('latin1').decode(
      bytes.subarray(0, Math.min(bytes.length, 64 * 1024))
    );
    return (
      header.indexOf('hdrgm') !== -1 ||
      header.indexOf('GContainer') !== -1 ||
      header.indexOf('HDR') !== -1
    );
  };

  /**
   * Build the cache key of an environment source.
   *
   * @category 3D > Environment
   */
  export const getEnvironmentCacheKey = (
    source: EnvironmentSource,
    quality: EnvironmentQuality
  ): string => {
    const faceKey = source.faceResourceNames
      ? source.faceResourceNames.join('|')
      : '';
    const textureKey =
      source.type === 'skybox' && source.texture ? source.texture.uuid : '';
    return [
      source.type,
      source.resourceName || '',
      faceKey,
      textureKey,
      quality,
    ].join('|');
  };

  /**
   * Owns the PMREM generator and the environment textures of a game. There is
   * one instance per game (and so per Three.js renderer) and it is shared by
   * every scene effect and by the PBR material manager.
   *
   * Textures are cached by source and quality and reference counted, so that
   * several layers can use the same environment without downloading or
   * prefiltering it twice. The default environment (RoomEnvironment) is built
   * once per quality and kept until the game is disposed.
   *
   * @category 3D > Environment
   */
  export class EnvironmentManager {
    private _runtimeGame: gdjs.RuntimeGame;
    private _pmremGenerator: THREE.PMREMGenerator | null = null;
    private _pmremRenderer: THREE.WebGLRenderer | null = null;
    private _entries = new Map<string, EnvironmentCacheEntry>();
    private _defaultTargets = new Map<
      EnvironmentQuality,
      THREE.WebGLRenderTarget | null
    >();
    private _prefilterTargets = new Map<
      THREE.Texture,
      THREE.WebGLRenderTarget
    >();
    private _disposed = false;

    // Resources used to resize equirectangular textures on the GPU.
    private _resizeScene: THREE.Scene | null = null;
    private _resizeCamera: THREE.OrthographicCamera | null = null;
    private _resizeGeometry: THREE.PlaneGeometry | null = null;
    private _resizeMaterial: THREE.ShaderMaterial | null = null;
    private _resizeMesh: THREE.Mesh | null = null;

    constructor(runtimeGame: gdjs.RuntimeGame) {
      this._runtimeGame = runtimeGame;
    }

    /**
     * @returns the Three.js renderer used by the game (or null if 3D is
     * disabled).
     */
    getThreeRenderer(): THREE.WebGLRenderer | null {
      const gameRenderer = this._runtimeGame.getRenderer();
      return gameRenderer ? gameRenderer.getThreeRenderer() : null;
    }

    private _getPMREMGenerator(): THREE.PMREMGenerator | null {
      const renderer = this.getThreeRenderer();
      if (!renderer) return null;
      if (this._pmremGenerator && this._pmremRenderer === renderer) {
        return this._pmremGenerator;
      }
      if (this._pmremGenerator) {
        this._pmremGenerator.dispose();
      }
      this._pmremGenerator = new THREE.PMREMGenerator(renderer);
      this._pmremRenderer = renderer;
      return this._pmremGenerator;
    }

    /**
     * Return the default environment (a prefiltered RoomEnvironment) for the
     * given quality. It is built once and owned by the manager.
     */
    getDefaultTexture(quality: EnvironmentQuality): THREE.Texture | null {
      const target = this._getDefaultTarget(quality);
      return target ? target.texture : null;
    }

    private _getDefaultTarget(
      quality: EnvironmentQuality
    ): THREE.WebGLRenderTarget | null {
      const cached = this._defaultTargets.get(quality);
      if (cached !== undefined) return cached;
      const generator = this._getPMREMGenerator();
      if (!generator) {
        // The 3D renderer may not be created yet: retry later instead of
        // caching a failure forever.
        return null;
      }
      const size = quality === 'low' ? 128 : quality === 'high' ? 512 : 256;
      let roomEnvironment: THREE_ADDONS.RoomEnvironment | null = null;
      try {
        roomEnvironment = new THREE_ADDONS.RoomEnvironment();
        const target = generator.fromScene(roomEnvironment, 0.04, 0.1, 100, {
          size,
        });
        this._defaultTargets.set(quality, target);
        return target;
      } catch (error) {
        environmentLogger.warn(
          'Unable to build the default environment: ' + error
        );
        this._defaultTargets.set(quality, null);
        return null;
      } finally {
        if (roomEnvironment) roomEnvironment.dispose();
      }
    }

    /**
     * Acquire a reference to a cached environment. The texture may still be
     * loading: use `getEntryTexture` to get the texture currently available
     * (which falls back to the default environment) and `addReadyListener` to
     * be notified when the real texture is ready.
     */
    acquire(
      source: EnvironmentSource,
      quality: EnvironmentQuality
    ): EnvironmentCacheEntry {
      const key = getEnvironmentCacheKey(source, quality);
      const existingEntry = this._entries.get(key);
      if (existingEntry) {
        existingEntry.refCount++;
        return existingEntry;
      }
      const entry: EnvironmentCacheEntry = {
        key,
        source,
        quality,
        state: 'loading',
        target: null,
        sharedTexture: null,
        ownsTarget: false,
        refCount: 1,
        listeners: [],
        cancelled: false,
      };
      this._entries.set(key, entry);
      this._buildEntry(entry);
      return entry;
    }

    /**
     * Release a reference to a cached environment. The texture is disposed
     * when no effect/scene uses it anymore.
     */
    release(entry: EnvironmentCacheEntry): void {
      if (entry.refCount > 0) entry.refCount--;
      if (entry.refCount > 0) return;
      entry.cancelled = true;
      entry.listeners.length = 0;
      this._entries.delete(entry.key);
      this._disposeEntryTarget(entry);
    }

    /**
     * Add a listener called when the texture of an entry is ready (or
     * upgraded, for an Ultra HDR image). The listener is called immediately if
     * the texture is already available.
     */
    addReadyListener(entry: EnvironmentCacheEntry, listener: () => void): void {
      if (entry.state !== 'loading') {
        listener();
      } else {
        entry.listeners.push(listener);
      }
    }

    /**
     * Return the best texture available for an entry: the prefiltered
     * environment if it is ready, or the default environment while loading or
     * on failure.
     */
    getEntryTexture(entry: EnvironmentCacheEntry): THREE.Texture | null {
      if (entry.target) return entry.target.texture;
      if (entry.sharedTexture) return entry.sharedTexture;
      return this.getDefaultTexture(entry.quality);
    }

    /**
     * Prefilter a texture with PMREM and return its texture. The render target
     * is owned by the manager and disposed with `disposePrefilteredTexture`.
     *
     * @deprecated Prefer `acquire`, which caches and reference counts textures.
     */
    prefilterEnvironmentTexture(
      sourceTexture: THREE.Texture
    ): THREE.Texture | null {
      const target = this._prefilterTexture(sourceTexture, 'auto');
      if (!target) return null;
      this._prefilterTargets.set(target.texture, target);
      return target.texture;
    }

    /**
     * Dispose a texture returned by `prefilterEnvironmentTexture`.
     */
    disposePrefilteredTexture(texture: THREE.Texture): void {
      const target = this._prefilterTargets.get(texture);
      if (target) {
        this._prefilterTargets.delete(texture);
        target.dispose();
      } else {
        texture.dispose();
      }
    }

    /**
     * Dispose every environment texture, the default environments and the
     * PMREM generator. To be called when the game is destroyed.
     */
    dispose(): void {
      if (this._disposed) return;
      this._disposed = true;
      for (const entry of this._entries.values()) {
        entry.cancelled = true;
        entry.listeners.length = 0;
        this._disposeEntryTarget(entry);
      }
      this._entries.clear();
      for (const target of this._defaultTargets.values()) {
        if (target) target.dispose();
      }
      this._defaultTargets.clear();
      for (const target of this._prefilterTargets.values()) {
        target.dispose();
      }
      this._prefilterTargets.clear();
      if (this._pmremGenerator) {
        this._pmremGenerator.dispose();
        this._pmremGenerator = null;
        this._pmremRenderer = null;
      }
      if (this._resizeGeometry) this._resizeGeometry.dispose();
      if (this._resizeMaterial) this._resizeMaterial.dispose();
      this._resizeMesh = null;
      this._resizeGeometry = null;
      this._resizeMaterial = null;
      this._resizeCamera = null;
      this._resizeScene = null;
    }

    private _disposeEntryTarget(entry: EnvironmentCacheEntry): void {
      if (entry.ownsTarget && entry.target) {
        entry.target.dispose();
      }
      entry.target = null;
      entry.ownsTarget = false;
      entry.sharedTexture = null;
    }

    private _notify(entry: EnvironmentCacheEntry): void {
      for (const listener of entry.listeners.slice()) {
        listener();
      }
    }

    private _setReady(
      entry: EnvironmentCacheEntry,
      target: THREE.WebGLRenderTarget
    ): void {
      if (entry.cancelled || entry.refCount <= 0) {
        target.dispose();
        return;
      }
      this._disposeEntryTarget(entry);
      entry.target = target;
      entry.ownsTarget = true;
      entry.state = 'ready';
      this._notify(entry);
    }

    private _setFailed(entry: EnvironmentCacheEntry, reason?: string): void {
      if (entry.state === 'ready') return;
      if (entry.cancelled) return;
      const wasAlreadyFailed = entry.state === 'failed';
      entry.state = 'failed';
      if (!wasAlreadyFailed && entry.source.type !== 'default') {
        const sourceName =
          entry.source.type === 'equirect'
            ? entry.source.resourceName
            : entry.source.type === 'cube'
              ? (entry.source.faceResourceNames || []).join(', ')
              : 'skybox';
        environmentLogger.warn(
          'Unable to use the environment map "' +
            (sourceName || '') +
            '"' +
            (reason ? ': ' + reason : '') +
            '. The default environment is used instead.'
        );
      }
      this._notify(entry);
    }

    private _buildEntry(entry: EnvironmentCacheEntry): void {
      const source = entry.source;
      if (source.type === 'default') {
        const target = this._getDefaultTarget(entry.quality);
        if (target) {
          entry.sharedTexture = target.texture;
          entry.state = 'ready';
        } else {
          entry.state = 'failed';
        }
        return;
      }
      if (source.type === 'skybox') {
        const texture = source.texture;
        if (!texture) {
          this._setFailed(entry);
          return;
        }
        const target = this._prefilterTexture(texture, entry.quality);
        if (target) {
          this._setReady(entry, target);
        } else {
          this._setFailed(entry);
        }
        return;
      }
      if (source.type === 'cube') {
        this._buildCubeEntry(entry);
        return;
      }
      this._buildEquirectangularEntry(entry);
    }

    private _buildCubeEntry(entry: EnvironmentCacheEntry): void {
      const faceResourceNames = entry.source.faceResourceNames;
      if (
        !faceResourceNames ||
        faceResourceNames.length !== 6 ||
        faceResourceNames.some((resourceName) => !resourceName)
      ) {
        this._setFailed(entry);
        return;
      }
      try {
        const cubeTexture = this._runtimeGame
          .getImageManager()
          .getThreeCubeTexture(
            faceResourceNames[0],
            faceResourceNames[1],
            faceResourceNames[2],
            faceResourceNames[3],
            faceResourceNames[4],
            faceResourceNames[5]
          );
        const target = this._prefilterCubemap(cubeTexture, entry.quality);
        if (target) {
          this._setReady(entry, target);
        } else {
          this._setFailed(entry);
        }
      } catch (error) {
        this._setFailed(entry);
      }
    }

    private _buildEquirectangularEntry(entry: EnvironmentCacheEntry): void {
      const resourceName = entry.source.resourceName;
      if (!resourceName) {
        this._setFailed(entry);
        return;
      }
      const resourceLoader = this._runtimeGame.getResourceLoader();
      const resource = resourceLoader.getResource(resourceName);
      if (!resource) {
        this._setFailed(entry);
        return;
      }
      const extension = getEnvironmentFileExtension(resource.file);
      if (extension === 'hdr' || extension === 'exr') {
        // No synchronous source: the default environment is shown until the
        // HDR file is parsed and prefiltered.
        this._loadHDRorEXR(entry, resource, extension);
        return;
      }
      const ldrTexture = this._getLDRTexture(resourceName);
      if (ldrTexture) {
        const target = this._prefilterTexture(ldrTexture, entry.quality);
        if (target) {
          this._setReady(entry, target);
        } else {
          this._setFailed(entry);
        }
      } else if (extension !== 'jpg' && extension !== 'jpeg') {
        this._setFailed(entry);
        return;
      }
      if (extension === 'jpg' || extension === 'jpeg') {
        // A plain JPEG is already usable (through the image manager): try to
        // upgrade it to its HDR version in the background if it is an Ultra
        // HDR image.
        this._tryUpgradeToUltraHDR(entry, resource);
      }
    }

    private _getLDRTexture(resourceName: string): THREE.Texture | null {
      try {
        const texture = this._runtimeGame
          .getImageManager()
          .getThreeTexture(resourceName, { isColorData: true });
        if (!texture) return null;
        texture.mapping = THREE.EquirectangularReflectionMapping;
        return texture;
      } catch (error) {
        return null;
      }
    }

    private _loadHDRorEXR(
      entry: EnvironmentCacheEntry,
      resource: ResourceData,
      extension: string
    ): void {
      const resourceLoader = this._runtimeGame.getResourceLoader();
      const url = resourceLoader.getFullUrl(resource.file);
      const withCredentials = resourceLoader.checkIfCredentialsRequired(url);
      const loadTexture = async (): Promise<THREE.Texture> => {
        if (extension === 'exr') {
          const loader = new THREE_ADDONS.EXRLoader();
          loader.setWithCredentials(withCredentials);
          return await loader.loadAsync(url);
        }
        const loader = new THREE_ADDONS.HDRLoader();
        loader.setWithCredentials(withCredentials);
        return await loader.loadAsync(url);
      };
      loadTexture().then(
        (texture) => {
          if (entry.cancelled) {
            texture.dispose();
            return;
          }
          const target = this._prefilterTexture(texture, entry.quality);
          texture.dispose();
          if (target) {
            this._setReady(entry, target);
          } else {
            this._setFailed(entry);
          }
        },
        (error) => {
          if (entry.cancelled) return;
          this._setFailed(entry, String(error));
        }
      );
    }

    private _tryUpgradeToUltraHDR(
      entry: EnvironmentCacheEntry,
      resource: ResourceData
    ): void {
      this._loadUltraHDRTexture(resource).then(
        (texture) => {
          if (!texture) return;
          if (entry.cancelled) {
            texture.dispose();
            return;
          }
          const target = this._prefilterTexture(texture, entry.quality);
          texture.dispose();
          if (target) {
            this._setReady(entry, target);
          }
        },
        (error) => {
          // The LDR version (if loaded) is a valid fallback for a JPEG: only
          // warn when there is nothing to display.
          if (entry.cancelled || entry.state === 'ready') return;
          this._setFailed(entry, String(error));
        }
      );
    }

    private _loadUltraHDRTexture(
      resource: ResourceData
    ): Promise<THREE.Texture | null> {
      const resourceLoader = this._runtimeGame.getResourceLoader();
      const url = resourceLoader.getFullUrl(resource.file);
      return fetch(url, {
        credentials: resourceLoader.checkIfCredentialsRequired(url)
          ? 'include'
          : 'omit',
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error('Network response was not ok');
          }
          return response.arrayBuffer();
        })
        .then(
          (buffer) =>
            new Promise<THREE.Texture | null>((resolve, reject) => {
              if (!isUltraHDRBuffer(buffer)) {
                resolve(null);
                return;
              }
              const loader = new THREE_ADDONS.UltraHDRLoader();
              try {
                loader.parse(buffer, (texData: any) => {
                  try {
                    const data = texData.data || texData.hdrBuffer;
                    const texture = new THREE.DataTexture(
                      data,
                      texData.width,
                      texData.height,
                      THREE.RGBAFormat,
                      texData.type || THREE.HalfFloatType
                    );
                    texture.colorSpace = THREE.LinearSRGBColorSpace;
                    texture.mapping = THREE.EquirectangularReflectionMapping;
                    texture.flipY = true;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.generateMipmaps = false;
                    texture.needsUpdate = true;
                    resolve(texture);
                  } catch (error) {
                    reject(error);
                  }
                });
              } catch (error) {
                reject(error);
              }
            })
        );
    }

    private _prefilterTexture(
      sourceTexture: THREE.Texture,
      quality: EnvironmentQuality
    ): THREE.WebGLRenderTarget | null {
      const generator = this._getPMREMGenerator();
      if (!generator) return null;
      if ((sourceTexture as THREE.CubeTexture).isCubeTexture) {
        return this._prefilterCubemap(
          sourceTexture as THREE.CubeTexture,
          quality
        );
      }
      return this._prefilterEquirectangular(sourceTexture, quality);
    }

    private _getTextureSize(texture: THREE.Texture): number {
      const image = (texture as any).image;
      if (!image) return 16;
      if (Array.isArray(image)) {
        return image[0]
          ? image[0].width || (image[0].image && image[0].image.width) || 16
          : 16;
      }
      return image.width || 16;
    }

    private _prefilterEquirectangular(
      sourceTexture: THREE.Texture,
      quality: EnvironmentQuality
    ): THREE.WebGLRenderTarget | null {
      const generator = this._getPMREMGenerator();
      if (!generator) return null;
      const nativeCubeSize = Math.max(
        16,
        Math.floor(this._getTextureSize(sourceTexture) / 4)
      );
      const cubeSize = getEnvironmentQualityCubeSize(quality, nativeCubeSize);
      let textureToUse = sourceTexture;
      let resizedTarget: THREE.WebGLRenderTarget | null = null;
      if (nativeCubeSize > cubeSize) {
        resizedTarget = this._resizeEquirectangularTexture(
          sourceTexture,
          cubeSize * 4,
          cubeSize * 2
        );
        if (resizedTarget) textureToUse = resizedTarget.texture;
      }
      try {
        return generator.fromEquirectangular(textureToUse);
      } catch (error) {
        environmentLogger.warn('Unable to prefilter the environment: ' + error);
        return null;
      } finally {
        if (resizedTarget) resizedTarget.dispose();
      }
    }

    private _prefilterCubemap(
      sourceTexture: THREE.CubeTexture,
      quality: EnvironmentQuality
    ): THREE.WebGLRenderTarget | null {
      const generator = this._getPMREMGenerator();
      if (!generator) return null;
      const nativeSize = Math.max(16, this._getTextureSize(sourceTexture));
      const cubeSize = getEnvironmentQualityCubeSize(quality, nativeSize);
      let cubemapToUse = sourceTexture;
      let resizedCubemap: THREE.CubeTexture | null = null;
      if (nativeSize > cubeSize) {
        const images = this._resizeCubeImages(sourceTexture.images, cubeSize);
        if (images) {
          resizedCubemap = new THREE.CubeTexture(images);
          resizedCubemap.colorSpace = sourceTexture.colorSpace;
          resizedCubemap.needsUpdate = true;
          cubemapToUse = resizedCubemap;
        }
      }
      try {
        return generator.fromCubemap(cubemapToUse);
      } catch (error) {
        environmentLogger.warn('Unable to prefilter the environment: ' + error);
        return null;
      } finally {
        if (resizedCubemap) resizedCubemap.dispose();
      }
    }

    /**
     * Resize the 6 faces of a LDR cube texture with a canvas. Returns null when
     * the faces cannot be resized (for example in a non-browser environment).
     */
    private _resizeCubeImages(
      images: Array<any>,
      size: number
    ): Array<any> | null {
      if (typeof document === 'undefined' || !images || images.length !== 6) {
        return null;
      }
      const resizedImages: Array<any> = [];
      for (const image of images) {
        if (!image) {
          resizedImages.push(image);
          continue;
        }
        const width = image.width || (image.image && image.image.width);
        const height = image.height || (image.image && image.image.height);
        if (!width || !height || (width <= size && height <= size)) {
          resizedImages.push(image);
          continue;
        }
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) return null;
        context.drawImage(image, 0, 0, size, size);
        resizedImages.push(canvas);
      }
      return resizedImages;
    }

    /**
     * Resize an equirectangular texture on the GPU, keeping its HDR values
     * (the target is a HalfFloat render target).
     */
    private _resizeEquirectangularTexture(
      sourceTexture: THREE.Texture,
      width: number,
      height: number
    ): THREE.WebGLRenderTarget | null {
      const renderer = this.getThreeRenderer();
      if (!renderer) return null;
      if (!this._resizeScene) {
        this._resizeScene = new THREE.Scene();
        this._resizeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this._resizeGeometry = new THREE.PlaneGeometry(2, 2);
        this._resizeMaterial = new THREE.ShaderMaterial({
          uniforms: { source: { value: null } },
          vertexShader:
            'varying vec2 vUv;\n' +
            'void main() {\n' +
            '  vUv = uv;\n' +
            '  gl_Position = vec4(position.xy, 0.0, 1.0);\n' +
            '}',
          fragmentShader:
            'uniform sampler2D source;\n' +
            'varying vec2 vUv;\n' +
            'void main() {\n' +
            '  gl_FragColor = texture2D(source, vUv);\n' +
            '}',
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
        this._resizeMesh = new THREE.Mesh(
          this._resizeGeometry,
          this._resizeMaterial
        );
        this._resizeScene.add(this._resizeMesh);
      }
      if (!this._resizeScene || !this._resizeCamera || !this._resizeMaterial) {
        return null;
      }
      const target = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
        depthBuffer: false,
        stencilBuffer: false,
      });
      target.texture.colorSpace = THREE.LinearSRGBColorSpace;
      const previousRenderTarget = renderer.getRenderTarget();
      const previousCubeFace = renderer.getActiveCubeFace();
      const previousMipmapLevel = renderer.getActiveMipmapLevel();
      const previousAutoClear = renderer.autoClear;
      const previousXrEnabled = renderer.xr.enabled;
      this._resizeMaterial.uniforms.source.value = sourceTexture;
      try {
        renderer.autoClear = false;
        renderer.xr.enabled = false;
        renderer.setRenderTarget(target);
        renderer.render(this._resizeScene, this._resizeCamera);
      } catch (error) {
        target.dispose();
        environmentLogger.warn(
          'Unable to resize the environment texture: ' + error
        );
        return null;
      } finally {
        renderer.xr.enabled = previousXrEnabled;
        renderer.autoClear = previousAutoClear;
        renderer.setRenderTarget(
          previousRenderTarget,
          previousCubeFace,
          previousMipmapLevel
        );
      }
      return target;
    }
  }
}
