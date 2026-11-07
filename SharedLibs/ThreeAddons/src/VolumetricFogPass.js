import {
  Color,
  HalfFloatType,
  Matrix4,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { Pass, FullScreenQuad } from "./examples/jsm/postprocessing/Pass.js";

/** A vector reused to read the position of the target of the sun. */
const _lightTargetPosition = new Vector3();

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/**
 * Raymarches the fog between the camera and the scene, at half the resolution.
 * The result holds the light scattered by the fog in the RGB channels and the
 * transmittance of the fog in the alpha channel, so that the fog can be
 * composited over the scene by the next pass.
 */
const fogFragmentShader = /* glsl */ `
  #include <common>
  #include <packing>

  varying vec2 vUv;

  uniform sampler2D tDepth;
  uniform sampler2DShadow tShadowMap;

  uniform mat4 cameraMatrixWorld;
  uniform mat4 projectionMatrixInverse;

  uniform float nearClip;
  uniform float farClip;

  uniform vec3 fogColor;
  uniform vec3 fogUpAxis;
  uniform float fogDensity;
  uniform float fogHeight;
  uniform float fogFalloff;
  uniform float fogMaxDistance;

  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  uniform float sunIntensity;

  uniform mat4 shadowMatrix;
  uniform vec2 shadowMapSize;
  uniform float shadowBias;
  uniform float shadowRadius;
  uniform float shadowIntensity;

  uniform float jitter;

  // A noise giving a different value for each pixel, to offset the samples so
  // that the steps of neighbouring pixels don't align (which shows as bands).
  float interleavedGradientNoise(const in vec2 position) {
    return fract(52.9829189 * fract(dot(position, vec2(0.06711056, 0.00583715))));
  }

  vec3 getWorldPosition(const in vec2 uv) {
    float depth = texture2D(tDepth, uv).x;
    vec4 clipPosition = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 viewPosition = projectionMatrixInverse * clipPosition;
    viewPosition /= viewPosition.w;
    return (cameraMatrixWorld * viewPosition).xyz;
  }

  float getDensity(const in vec3 position) {
    // The fog is the densest at the fog height and thins out above it.
    float heightAboveFog = max(0.0, dot(position, fogUpAxis) - fogHeight);
    return fogDensity * exp(-heightAboveFog * fogFalloff);
  }

  // Henyey-Greenstein phase function: the light of the sun is scattered more
  // towards the direction it comes from, like in reality.
  float getSunPhase(const in vec3 rayDirection) {
    const float anisotropy = 0.6;
    float cosinus = dot(rayDirection, sunDirection);
    float denominator =
      1.0 + anisotropy * anisotropy - 2.0 * anisotropy * cosinus;
    return (1.0 - anisotropy * anisotropy) /
      (4.0 * PI * pow(denominator, 1.5));
  }

  // How much of the light of the sun reaches the given point, read in its
  // shadow map. The light shafts are this light scattered by the fog.
  float getSunVisibility(const in vec3 position) {
    vec4 shadowPosition = shadowMatrix * vec4(position, 1.0);
    shadowPosition.xyz /= shadowPosition.w;
    shadowPosition.z += shadowBias;
    if (
      shadowPosition.x < 0.0 || shadowPosition.x > 1.0 ||
      shadowPosition.y < 0.0 || shadowPosition.y > 1.0 ||
      shadowPosition.z > 1.0
    ) {
      // Out of the shadow map, the light is not known to be blocked.
      return 1.0;
    }
    // 4 taps in a square rotated for each pixel. The shadow map is filtered by
    // the hardware, so each tap is already 4 samples.
    float angle = interleavedGradientNoise(gl_FragCoord.xy) * PI2;
    float cosinus = cos(angle);
    float sinus = sin(angle);
    float radius = shadowRadius / shadowMapSize.x;
    vec2 offset = vec2(cosinus, sinus) * radius;
    vec2 perpendicularOffset = vec2(-sinus, cosinus) * radius;
    float shadow = (
      texture(tShadowMap, vec3(shadowPosition.xy + offset, shadowPosition.z)) +
      texture(tShadowMap, vec3(shadowPosition.xy - offset, shadowPosition.z)) +
      texture(
        tShadowMap,
        vec3(shadowPosition.xy + perpendicularOffset, shadowPosition.z)
      ) +
      texture(
        tShadowMap,
        vec3(shadowPosition.xy - perpendicularOffset, shadowPosition.z)
      )
    ) * 0.25;
    return mix(1.0, shadow, shadowIntensity);
  }

  void main() {
    vec3 worldPosition = getWorldPosition(vUv);
    vec3 ray = worldPosition - cameraPosition;
    float rayLength = length(ray);
    if (rayLength <= 0.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    vec3 rayDirection = ray / rayLength;
    // The fog farther than this is already opaque: no need to march it.
    float maxDistance = min(rayLength, fogMaxDistance);
    float stepLength = maxDistance / float(STEP_COUNT);
    // The first sample of each pixel is moved so that the steps of
    // neighbouring pixels don't align.
    float firstSampleDistance =
      interleavedGradientNoise(gl_FragCoord.xy) * jitter * stepLength;

    float opticalDepth = 0.0;
    vec3 scatteredLight = vec3(0.0);
    #if SHADOWS == 1
      float sunPhase = getSunPhase(rayDirection) * sunIntensity;
    #endif

    for (int i = 0; i < STEP_COUNT; i++) {
      float distance = firstSampleDistance + float(i) * stepLength;
      vec3 samplePosition = cameraPosition + rayDirection * distance;
      float density = getDensity(samplePosition);
      #if SHADOWS == 1
        float transmittance = exp(-opticalDepth);
        float visibility = getSunVisibility(samplePosition);
        scatteredLight +=
          sunColor *
          (sunPhase * visibility * density * stepLength * transmittance);
      #endif
      opticalDepth += density * stepLength;
    }

    float transmittance = exp(-opticalDepth);
    // The light of the sky scattered by the fog, plus the light of the sun.
    vec3 inScatteredLight =
      fogColor * (1.0 - transmittance) + scatteredLight;
    gl_FragColor = vec4(inScatteredLight, transmittance);
  }`;

/**
 * Composite the fog over the scene. The buffers hold premultiplied colors
 * (see `LayerPixiRenderer`): the fog replaces the color of what is behind it,
 * within the coverage of the pixel.
 */
const compositeFragmentShader = /* glsl */ `
  varying vec2 vUv;

  uniform sampler2D tDiffuse;
  uniform sampler2D tFog;

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    vec4 fog = texture2D(tFog, vUv);
    gl_FragColor = vec4(
      color.rgb * fog.a + fog.rgb * color.a,
      color.a
    );
  }`;

/**
 * A fog computed by raymarching the scene depth, rather than per material:
 * - it gets denser near a given height (height fog),
 * - the light of a directional light is scattered by the fog where its shadow
 * map says it reaches it, which draws light shafts.
 *
 * The fog is raymarched at half the resolution, then composited at full
 * resolution, as it's smooth enough to not need more.
 */
class VolumetricFogPass extends Pass {
  constructor() {
    super();

    /**
     * The uniforms of both shaders. Distances and heights are in Three.js
     * world units, the density and the falloff are per world unit.
     * @type {Record<string, THREE.IUniform>}
     */
    this.uniforms = {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tFog: { value: null },
      tShadowMap: { value: null },
      cameraMatrixWorld: { value: new Matrix4() },
      projectionMatrixInverse: { value: new Matrix4() },
      nearClip: { value: 0.1 },
      farClip: { value: 1000.0 },
      fogColor: { value: new Color(0xffffff) },
      fogUpAxis: { value: new Vector3(0.0, 0.0, 1.0) },
      fogDensity: { value: 0.001 },
      fogHeight: { value: 0.0 },
      fogFalloff: { value: 0.0 },
      fogMaxDistance: { value: 1000.0 },
      sunColor: { value: new Color(0xffffff) },
      sunDirection: { value: new Vector3(0.0, 1.0, 0.0) },
      sunIntensity: { value: 0.0 },
      shadowMatrix: { value: new Matrix4() },
      shadowMapSize: { value: new Vector2(1024.0, 1024.0) },
      shadowBias: { value: 0.0 },
      shadowRadius: { value: 1.0 },
      shadowIntensity: { value: 1.0 },
      jitter: { value: 1.0 },
    };

    this._stepCount = 24;
    this._shadowsEnabled = false;
    this._isPerspectiveCamera = true;
    /** @type {THREE.Camera | null} */
    this._camera = null;
    /** @type {THREE.DirectionalLight | null} */
    this._sunLight = null;
    /**
     * How much of the light of the sun is scattered by the fog.
     * @type {number}
     */
    this.sunIntensityScale = 1.0;

    this._fogRenderTarget = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: false,
    });
    this.uniforms.tFog.value = this._fogRenderTarget.texture;

    this._fogMaterial = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader: fogFragmentShader,
    });
    this._compositeMaterial = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader: compositeFragmentShader,
    });
    this._fullScreenQuad = new FullScreenQuad(this._fogMaterial);

    this._updateFogMaterialDefines();
  }

  /**
   * @param {number} stepCount The number of samples of the fog along each ray.
   * More samples give a smoother fog, but are slower to render.
   */
  setStepCount(stepCount) {
    const newStepCount = Math.max(1, Math.round(stepCount));
    if (this._stepCount === newStepCount) {
      return;
    }
    this._stepCount = newStepCount;
    this._updateFogMaterialDefines();
  }

  /**
   * @param {boolean} shadowsEnabled True to scatter the light of the sun where
   * its shadow map says it reaches the fog (light shafts).
   */
  setShadowsEnabled(shadowsEnabled) {
    if (this._shadowsEnabled === shadowsEnabled) {
      return;
    }
    this._shadowsEnabled = shadowsEnabled;
    this._updateFogMaterialDefines();
  }

  /** @param {boolean} isPerspectiveCamera */
  setPerspectiveCamera(isPerspectiveCamera) {
    if (this._isPerspectiveCamera === isPerspectiveCamera) {
      return;
    }
    this._isPerspectiveCamera = isPerspectiveCamera;
    this._updateFogMaterialDefines();
  }

  /**
   * The camera is moved by the renderer just before the passes are rendered:
   * its matrices are read when rendering rather than before, so that the fog
   * follows the camera without a frame of delay.
   * @param {THREE.Camera | null} camera
   */
  setCamera(camera) {
    this._camera = camera;
  }

  /**
   * The light whose shadow map gives the light shafts. Its shadow camera is
   * moved with the camera like the scene camera, so it's read when rendering.
   * @param {THREE.DirectionalLight | null} light
   */
  setSunLight(light) {
    this._sunLight = light;
  }

  _updateCameraUniforms() {
    const camera = this._camera;
    if (!camera) {
      return;
    }
    const uniforms = this.uniforms;
    uniforms.cameraMatrixWorld.value.copy(camera.matrixWorld);
    uniforms.projectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    uniforms.nearClip.value = camera.near;
    uniforms.farClip.value = camera.far;
  }

  _updateSunUniforms() {
    const light = this._sunLight;
    const shadow = light ? light.shadow : null;
    const shadowMap = shadow ? shadow.map : null;
    const shadowTexture = shadowMap ? shadowMap.depthTexture : null;
    // A shadow map compared by the hardware (with `PCFShadowMap`) is needed to
    // read the depth of the light in a single sample.
    const shadowsEnabled = !!(
      light &&
      shadow &&
      shadowMap &&
      shadowTexture &&
      shadowTexture.compareFunction
    );
    this.setShadowsEnabled(shadowsEnabled);
    if (!shadowsEnabled || !light || !shadow || !shadowMap || !shadowTexture) {
      return;
    }

    const uniforms = this.uniforms;
    uniforms.tShadowMap.value = shadowTexture;
    uniforms.shadowMatrix.value.copy(shadow.matrix);
    uniforms.shadowMapSize.value.set(shadowMap.width, shadowMap.height);
    uniforms.shadowBias.value = shadow.bias;
    uniforms.shadowRadius.value = shadow.radius;
    uniforms.shadowIntensity.value = shadow.intensity;
    uniforms.sunColor.value.copy(light.color);
    uniforms.sunIntensity.value = light.intensity * this.sunIntensityScale;

    // The direction from the scene towards the light, in world coordinates.
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    uniforms.sunDirection.value
      .setFromMatrixPosition(light.matrixWorld)
      .sub(
        _lightTargetPosition.setFromMatrixPosition(light.target.matrixWorld)
      );
    if (uniforms.sunDirection.value.lengthSq() > 0) {
      uniforms.sunDirection.value.normalize();
    }
  }

  _updateFogMaterialDefines() {
    this._fogMaterial.defines = {
      PERSPECTIVE_CAMERA: this._isPerspectiveCamera ? 1 : 0,
      SHADOWS: this._shadowsEnabled ? 1 : 0,
      STEP_COUNT: this._stepCount,
    };
    this._fogMaterial.needsUpdate = true;
  }

  setSize(width, height) {
    this._fogRenderTarget.setSize(
      Math.max(1, Math.ceil(width / 2)),
      Math.max(1, Math.ceil(height / 2))
    );
  }

  render(renderer, writeBuffer, readBuffer) {
    this._updateCameraUniforms();
    this._updateSunUniforms();
    this.uniforms.tDiffuse.value = readBuffer.texture;

    this._fullScreenQuad.material = this._fogMaterial;
    renderer.setRenderTarget(this._fogRenderTarget);
    this._fullScreenQuad.render(renderer);

    this._fullScreenQuad.material = this._compositeMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this._fullScreenQuad.render(renderer);
  }

  dispose() {
    this._fogRenderTarget.dispose();
    this._fogMaterial.dispose();
    this._compositeMaterial.dispose();
    this._fullScreenQuad.dispose();
  }
}

export { VolumetricFogPass };
