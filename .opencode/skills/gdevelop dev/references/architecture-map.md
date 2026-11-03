# GDevelop source architecture map for WebGPU work

This is a working map based on the user's known checkout and prior WebGPU branch. It is not an authoritative description of every current GDevelop version. Verify each path, symbol, package script, and dependency version in the active repository before editing.

## Known checkout

Previously used Windows path:

`A:\GDevelop-webgpu\GDevelop.js`

Do not assume it is mounted or current. Confirm with Git.

## Known investigation targets

| Area | Known path | What to verify |
|---|---|---|
| Runtime HTML/module loading | `GDJS/Runtime/index.html` | Script/module loading, base URLs, runtime entrypoints |
| Renderer adapter | `GDJS/Runtime/pixi-renderers/ThreeRendererAdapter.ts` | Backend-neutral interface, WebGL/WebGPU implementation, async init/dispose |
| Three.js WebGL entry | `GDJS/Runtime/pixi-renderers/three.js` | Current WebGL module export and compatibility |
| Three.js WebGPU entry | `GDJS/Runtime/pixi-renderers/three-webgpu.js` | Whether source exists, generated output, exported renderer symbol |
| Game renderer integration | `GDJS/Runtime/pixi-renderers/runtimegame-pixi-renderer.ts` | Game-level creation, render loop, resize and cleanup |
| Scene renderer integration | `GDJS/Runtime/pixi-renderers/runtimescene-pixi-renderer.ts` | Scene lifecycle and renderer ownership |
| Runtime game lifecycle | `GDJS/Runtime/runtimegame.ts` | Initialization sequencing and runtime settings |
| Project type definitions | `GDJS/Runtime/types/project-data.d.ts` | Project setting types/defaults and actual serialization source |
| Three addons entry | `SharedLibs/ThreeAddons/src/three.ts` | Shared Three.js imports/exports |
| Three WebGPU entry | `SharedLibs/ThreeAddons/src/three-webgpu.ts` | Pinned API and build entry |
| Three addons build | `SharedLibs/ThreeAddons/rollup.config.js` | Output format/name, externals, dependency duplication |
| Native exporter helper | `GDJS/GDJS/IDE/ExporterHelper.cpp` | Runtime file inclusion/copying in export output |

## Trace the system rather than assuming file responsibility

A typical investigation should establish these edges with symbol search and import tracing:

1. IDE/project setting -> project serialization -> runtime project data.
2. Runtime game constructor/start -> renderer factory/adapter.
3. Renderer adapter -> Three.js entry module -> WebGL or WebGPU implementation.
4. Game renderer -> scene renderer -> render loop.
5. Build entry -> emitted JS/chunks/assets -> package staging.
6. Preview server URL -> actual emitted file.
7. Exporter copy list -> exported runtime file -> browser URL.
8. Dispose/restart -> release of renderer and GPU resources.

The actual ownership may differ by branch/version. Follow real call sites.

## Search recipes

PowerShell from the confirmed repository root:

```powershell
git status --short --branch
git log -8 --oneline
rg -n "ThreeRendererAdapter|WebGPURenderer|WebGPURenderer|navigator\.gpu" GDJS SharedLibs
rg -n "three-webgpu|three\.js|ThreeAddons" .
rg -n "runtimegame-pixi-renderer|runtimescene-pixi-renderer" GDJS
rg -n "ExporterHelper|Runtime.*copy|Runtime.*file" GDJS
```

If `rg` is unavailable, use the IDE search or `Get-ChildItem` + `Select-String` with a bounded directory scope. Avoid recursive searches over `node_modules`, build outputs, and the whole drive.

## Important distinction

The `GDJS/Runtime/pixi-renderers` directory name does not prove the code is purely Pixi-based. Inspect the actual renderer integration and dependency graph. Similarly, `project-data.d.ts` may only describe types; find the authoritative serialization/defaulting code before changing project settings.
