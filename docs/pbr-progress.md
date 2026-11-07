# PBR material + lighting system — progress

## 2026-11-07 — Phase 1: HDR environment maps, PMREM cache, scene controls

Status: implemented, awaiting full build/test pass.

### Scope

Upgrade `Scene3D::EnvironmentMap` (image based lighting) so that a scene can
be lit by equirectangular HDR/EXR/Ultra HDR files, a 6-face cubemap, the layer
skybox or a built-in default environment, with a cached PMREM, asynchronous
loading, full scene-environment controls and runtime events.

### Implementation

- **Three.js addons** — added `HDRLoader`, `EXRLoader`, `UltraHDRLoader`,
  `RoomEnvironment` (and `fflate.module.js`) to `SharedLibs/ThreeAddons/src` and
  rebuilt `ThreeAddons.js` with rollup. Typings added to
  `GDJS/Runtime/types/global-three-addons.d.ts`.
- **`GDJS/Runtime/EnvironmentManager.ts`** (new) — owns one lazily created
  `PMREMGenerator` per renderer (recreated if the renderer changes, disposed on
  teardown). Environment textures are cached by `(source + quality)` and
  reference counted, so several layers share the same prefiltered texture. The
  default environment is a `RoomEnvironment` prefiltered once per quality tier.
  Equirectangular HDR/EXR files are loaded asynchronously (default shown until
  ready), plain JPEG files are used immediately and upgraded to their Ultra HDR
  version in the background when they contain a gain map, and LDR files are
  downscaled on the GPU (HalfFloat target) for the requested quality tier.
  Every render-target resize saves/restores the render target, active cube
  face, mipmap level, XR state and auto-clear of the Three.js renderer.
- **`GDJS/Runtime/PBRMaterialManager.ts`** — creates and owns the
  `EnvironmentManager` (exposed with `getEnvironmentManager()`), keeps a
  reference-counted entry for the global scene environment and delegates
  `prefilterEnvironmentTexture` / `disposeEnvironmentTexture`. Adds global
  settings: intensity, rotation, background intensity, background blurriness,
  show-background, affects-materials and linked background rotation, plus the
  matching `gdjs.pbr.*` event functions.
- **Per-material environment intensity** — Three.js overwrites the
  `envMapIntensity` uniform with `scene.environmentIntensity` when the material
  has no `envMap`. A small `onBeforeCompile` patch adds a
  `gdjsEnvMapIntensityScale` multiplier around `envMapIntensity` in the image
  based lighting functions, so the per-material slider keeps working with
  `scene.environment`. Materials share one program cache key.
- **`Extensions/3D/EnvironmentMapEffect.ts`** — rewritten with the same
  `EnvironmentManager` used by the runtime manager. Supports sources `default`,
  `cube`, `equirect` and `skybox`, saves/restores the whole scene environment
  and background state (including intensity, blurriness and rotation),
  falls back to the default environment on empty/failed sources and follows the
  background set by a `Skybox` effect for the `skybox` source. New network sync
  fields (`q`, `bb`, `am`, `rb`) keep the legacy fields (`ei`, `bi`, `r`, `s`,
  `sb`, `rs`) untouched.
- **`Extensions/3D/JsExtension.js`** — exposes the new effect parameters
  (source choices, quality, background blurriness, linked background rotation,
  affects materials) and new events: environment rotation, background
  intensity, background blurriness, background shown and environment lights the
  objects.
- **Editor** — `LayerEnvironmentMapEffect.js` uses a PMREM generator shared per
  renderer, supports HDR/EXR/Ultra HDR through
  `PixiResourcesLoader.getThreeEquirectangularEnvironmentTexture`, the quality
  tiers, the default fallback and the new settings, and restores the saved
  scene state. `PBRMaterialPreview.js` assigns `material.envMap` so the
  `envMapIntensity` slider is effective. `ResourceSource.js` accepts `hdr` and
  `exr` image resources and `pixi-image-manager.ts` skips preloading them with
  Pixi (they are loaded by Three.js).
- **Tests** — `GDJS/tests/tests/environment-manager.js` covers the pure helpers
  (`getEnvironmentFileExtension`, `normalizeEnvironmentQuality`,
  `getEnvironmentQualityMaxCubeSize`, `getEnvironmentQualityCubeSize`,
  `isUltraHDRBuffer`, `getEnvironmentCacheKey`). `karma.conf.js` loads
  `EnvironmentManager.js` before `PBRMaterialManager.js`.

### Backward compatibility

Legacy projects are unchanged: the effect defaults to the `cube` source,
`auto` quality keeps the native resolution, and all new parameters are optional
with the same behaviour as before. Network sync data is additive.

### Verified / known points

- `renderer.info.memory.textures` is expected to stay stable across scene
  reloads: environments are reference counted and each render target (not only
  its texture) is disposed.
- The runtime and the editor cannot literally share the same source (the editor
  cannot import runtime TypeScript); the editor mirrors the runtime behaviour
  and must be kept in sync with `Extensions/3D/EnvironmentMapEffect.ts`.

## 2026-11-07 — Phase 1 follow-up: texture quality and controls

### Scope

Anisotropic filtering, texture tiling (repeat/offset/rotation), normal map
flip Y, and clear coat roughness for PBR materials.

### Implementation

- **Anisotropic filtering** (`pixi-image-manager.ts`) — smoothed 3D textures
  now use mipmaps (`LinearMipmapLinearFilter`) and an anisotropic filtering of
  `min(16, renderer capabilities)`, applied only when the texture is smoothed
  (pixel-art textures stay `NearestFilter` with no mipmaps). `setMaxAnisotropy`
  lowers the value for weak devices and re-applies it to the existing textures;
  when no 3D renderer exists yet, a fallback of 8 is used and the value is
  resolved again once the renderer is available.
- **UV transforms** (`PBRMaterialManager.ts`) — `PBRMaterialSettings.uvTransform`
  and `slotUvTransforms` apply a tiling/offset/rotation to the texture slots.
  The shared textures of the image manager are never modified: a clone is made
  only for a non-default transform, cached by (resource, color space, transform)
  and reference counted by material, so copies (`makeUniqueMaterialCopy`,
  `configureMaterial`) never double-dispose it. Clones are disposed when their
  last user is gone, when their resource is unloaded, and on `dispose()`.
- **Normal map flip Y** — `normalFlipY` flips the green channel of the normal
  map (`normalScale.set(s, flip ? -s : s)`). The strength (`normalScale.x`) is
  always positive, so changing the strength from events keeps the sign of Y and
  changing the flip keeps the strength.
- **Clear coat roughness** — `clearcoatRoughness` is a new float property
  (0 by default). It does not force the physical material by itself: only
  `clearcoat > 0`, `transmission > 0` or a non-default `ior` do. The physical
  only fields (`ior`, `transmission`, `clearcoat`, `clearcoatRoughness`) are
  only assigned to a `MeshPhysicalMaterial`. The `plastic` preset now uses
  `clearcoatRoughness: 0.15`.
- **Events** — the new features are exposed through `setPBRBoolean` /
  `getPBRBoolean`, `setPBRTextureUvTransform` / `getPBRTextureUvTransform` and
  the new `clearcoatRoughness` float property, plus a `MaxAnisotropy`
  scene expression. The editor mirrors them in `pbrConfig.js` and
  `PBRMaterialEditor/index.js`.

### Verified / known points

- Mipmapped filtering is now used for every smoothed 3D texture (not only PBR):
  this reduces aliasing but is a visible change for the whole 3D rendering.
- The UV transform only applies to the slots the settings actually set (a slot
  left untouched keeps the texture of the original material and is never
  cloned).
- `Texture.clone()` already sets `needsUpdate` in three r185
  (`Texture.copy` sets it), the explicit call is kept for clarity.
