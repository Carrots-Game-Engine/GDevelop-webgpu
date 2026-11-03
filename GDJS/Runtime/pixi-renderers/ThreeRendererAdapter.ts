/*
 * GDevelop JS Platform
 * Copyright 2013-present Florian Rival (Florian.Rival@gmail.com). All rights reserved.
 * This project is released under the MIT License.
 */

/**
 * ThreeRendererAdapter — detailed documentation file.
 *
 * The actual runtime implementation (`IThreeBackend`, `WebGLBackend`,
 * `ThreeRendererAdapter`, `getThreeBackend`) lives in `runtimegame.ts` so
 * that it is available as soon as `runtimegame.js` is loaded, regardless of
 * the order in which the pixi-renderer scripts arrive in the page.
 *
 * This file exists for documentation / IDE discoverability purposes only.
 * Nothing here runs at runtime — every symbol is already declared in the
 * `gdjs` namespace by `runtimegame.js`.
 *
 * @see gdjs.ThreeRendererAdapter
 * @see gdjs.IThreeBackend
 * @see gdjs.WebGLBackend
 * @see gdjs.getThreeBackend
 * @category Renderers
 */
namespace gdjs {
  // All symbols (IThreeBackend, WebGLBackend, ThreeRendererAdapter,
  // ThreeRendererAdapterOptions, getThreeBackend) are defined in
  // runtimegame.ts and exported from the gdjs namespace there.
  // Re-exporting or redefining them here is intentionally omitted to
  // avoid duplicate-declaration errors.
}
