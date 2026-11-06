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
