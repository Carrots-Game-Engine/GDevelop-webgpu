# 3D model editor — how it is organised

The editor turns a `.glb`/`.gdm` model resource into an editable document,
displays it in a Three.js viewport, and writes it back to the resource. It is
opened from the 3D model object editor ("Edit the 3D model" / "New 3D model"),
in a full screen dialog.

## Files, and what each one is for

| File | Responsibility | Tests |
|---|---|---|
| `GDModelFormat.js` | The `.gdm` container (ZIP): read/write, CRC, manifest normalisation. No dependency at all. | `GDModelFormat.spec.js` |
| `MeshEditing.js` | Mesh operations (extrude, subdivide, delete, flip, weld, transform a selection, UV transform) as pure functions on a `BufferGeometry`, preserving every attribute. | `MeshEditing.spec.js` |
| `GDModelDocument.js` | The document: nodes, materials, sockets, colliders, LODs, animation clips and events, and what a save produces. Three.js core only. | `GDModelDocument.spec.js` |
| `ObjectCloning.js` | Cloning a node with its skeleton, and cloning materials. | through `GDModelDocument.spec.js` |
| `ModelEditorExport.js` | Choosing `.gdm` or `.glb`, building the file, keeping the manifest in the resource metadata for `.glb`. | `ModelEditorExport.spec.js` |
| `ModelEditorHistory.js` | Undo/redo (each edit is a pair of closures). | `ModelEditorHistory.spec.js` |
| `ModelEditorResource.js` | Loading a resource into a document, exporting the document to a GLB, saving the file and invalidating the caches. | (needs a browser) |
| `ModelEditorEngine.js` | The viewport: renderer, camera, orbit/transform gizmos, picking (object/vertex/edge/face), selection overlays, animation preview, thumbnail rendering. | (needs WebGL) |
| `ModelEditorDialog.js` | The editor window: state, commands, keyboard shortcuts, layout, saving. | (UI) |
| `ModelEditorToolbar.js`, `ModelEditorOutliner.js`, `ModelEditorInspector.js`, `ModelEditorExtrasPanel.js`, `ModelEditorAnimationPanel.js`, `ModelEditorViewport.js` | The panels. | (UI) |

The game runtime has its own copy of the container reader:
`GDJS/Runtime/GDModelFormat.ts` (kept in sync by hand, like
`Resource3DPreview.worker.js` is), tested by
`GDJS/tests/tests/gdmodel-format.js`.

## Rules this code follows

- **The editor never mutates a cached model.** `loadModelDocument` reads the
  file itself: `PixiResourcesLoader` caches a model by resource name for the
  scene editor, and editing that model in place would corrupt what is displayed
  in the scene.
- **Every edit goes through `record(...)`**, so that it can be undone in one
  step even when it touched several things (a rename also retargets animation
  tracks and sockets).
- **A save writes a real file**, through a blob URL given to the resource and
  `onFetchNewlyAddedResources()` (the same path as Piskel), then invalidates both
  the URL cache and the parsed model cache.
- **Pure logic stays free of `three/examples/jsm`**, which Jest cannot import
  (they are ES modules): the exporter and the loader are injected or live in
  `ModelEditorResource.js`.

## Commands

```bash
# The logic of the editor (fast, no WebGL):
cd newIDE/app && npx react-app-rewired test --watchAll=false --testPathPattern "ModelEditor/"

# The runtime reader, in a real browser:
cd GDJS && npm run build
cd tests && CHROME_BIN="<path to chrome>" npx karma start --browsers ChromeHeadlessNoSandbox --single-run --grep "gdjs.GDModelFormat"

# A full build of the IDE (needs more heap than the default):
cd newIDE/app && NODE_OPTIONS="--max-old-space-size=8192" npm run build
```

## What is not implemented

- Bones and armatures are not editable (a skinned mesh is edited as a mesh).
- No sculpting, booleans, or UV unwrapping (only transforming the existing UVs).
- Morph targets are lost when a mesh is edited.
- Levels of detail are stored and shown, but the runtime does not switch between
  them yet.
- There is no entry in the resources list: models are opened from the object
  editor.
