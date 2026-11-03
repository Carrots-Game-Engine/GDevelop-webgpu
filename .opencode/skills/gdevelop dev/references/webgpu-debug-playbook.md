# WebGPU debugging playbook for GDevelop

Use this evidence-first playbook. Do not apply a workaround until the failing layer is identified.

## Symptom: `three-webgpu.js` returns 404

1. Capture the exact requested URL from browser DevTools > Network.
2. Check status, initiator, request type, and final URL after redirects.
3. Search source imports and build config for the exact module path/name.
4. Run the smallest relevant package build.
5. Inspect the output directory for the emitted file and any chunks it imports.
6. Inspect package staging/copy rules used by Preview.
7. Inspect exporter staging/copy rules separately.
8. Compare URL base resolution in Preview versus exported HTML.
9. Fix the earliest incorrect edge in the chain; do not patch the browser URL alone.

PowerShell checks (adapt discovered paths):
```powershell
Get-ChildItem -Path . -Recurse -File -Filter "*three*webgpu*" |
  Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|build|dist)\\' } |
  Select-Object -ExpandProperty FullName
```

## Symptom: `THREE.WebGPURenderer` is undefined

Check in order:
- Did the module request succeed?
- Is the imported module the expected module, not an HTML 404 response?
- Does the pinned Three.js module export `WebGPURenderer` under that exact name?
- Is the import namespace/default export being interpreted correctly?
- Are core and renderer modules from the same Three.js version/build?
- Did bundling externalize the dependency unexpectedly?
- Is initialization asynchronous and not yet complete?
- Is the runtime reading a stale cached output?

Do not assign a fake `THREE.WebGPURenderer` global. Prefer explicit module exports and type-safe imports.

## Symptom: WebGPU unavailable / adapter is null

Check:
- Secure context and browser support.
- `navigator.gpu` availability.
- `requestAdapter()` result.
- Adapter/device request errors and browser console.
- GPU blocklists, permissions, driver/browser version, and remote/VM environment.
- Whether fallback is invoked and whether the failed backend is fully disposed.

Do not equate API presence with successful device creation.

## Symptom: blank screen or no scene rendering

Check:
- Runtime initialization completion before first render.
- Canvas ownership and dimensions.
- Render loop start/stop.
- Scene renderer creation and camera/scene wiring.
- Renderer clear color, alpha, color space, tone mapping, and output target.
- Shader/material compilation errors and unsupported effects.
- Resize and device pixel ratio.
- Whether the renderer is rendering to a different canvas/target.

## Symptom: works in Preview but fails after export (or vice versa)

Compare:
- Exact HTML entrypoint.
- Module URLs and base path.
- Emitted chunks and asset names.
- Runtime file-copy lists.
- Relative versus absolute imports.
- MIME types and server headers.
- Cache behavior.
- Exported folder contents.

A Preview-only pass is not export validation.

## Symptom: `emcmake` is not recognized

This is a toolchain/environment issue until proven otherwise.

1. Read the repo build instructions and identify which target requires Emscripten.
2. Check:
```powershell
Get-Command emcmake -ErrorAction SilentlyContinue
where.exe emcmake
```
3. Follow the repository's documented Emscripten SDK installation/activation steps.
4. Do not guess the SDK path or permanently edit PATH without permission.
5. Run independent JS/TypeScript checks while the native toolchain is unavailable.
6. Report native build as blocked by a missing prerequisite, not as a code regression.

## Evidence required before declaring success

- Browser Network shows the intended WebGPU module and dependencies loading successfully.
- Runtime logs show successful adapter/device/renderer initialization.
- A real GDevelop scene renders.
- Resize and scene transition work.
- WebGL fallback works when WebGPU is unavailable or disabled.
- Exported build loads the same runtime assets correctly.
- Relevant automated tests/builds pass.
