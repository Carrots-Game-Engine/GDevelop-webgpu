/*
 * GDevelop JS Platform
 * Copyright 2013-2016 Florian Rival (Florian.Rival@gmail.com). All rights reserved.
 * This project is released under the MIT License.
 */
namespace gdjs {
  /**
   * The part of a 3D camera object that the `gdjs.Camera3DManager` needs.
   *
   * The core engine doesn't know about the "3D camera" object declared by the
   * 3D extension: any object implementing this interface can be registered and
   * drive the camera of a layer.
   *
   * @category Core Engine > Scene
   */
  export interface Camera3DLike {
    getLayer(): string;
    getX(): float;
    getY(): float;
    getZ(): float;
    getAngle(): float;
    getRotationX(): float;
    getRotationY(): float;
    getCamera3DFieldOfView(): float;
    getCamera3DNearPlaneDistance(): float;
    getCamera3DFarPlaneDistance(): float;
    /** The zoom used when the camera is orthographic. */
    getCamera3DZoom(): float;
    isCamera3DOrthographic(): boolean;
    isCamera3DActive(): boolean;
    setCamera3DActive(active: boolean): void;
    getCamera3DPriority(): number;
    getCamera3DBlendDuration(): number;
    setCamera3DBlendDuration(blendDuration: number): void;
  }

  /**
   * Choose the 3D camera that drives the camera of its layer and apply it.
   *
   * Only one 3D camera is active at a time: the one that is marked as active
   * and has the highest priority (the first registered one in case of a tie).
   * A camera can be activated from events or by a behavior without any event
   * (`setCamera3DActive`).
   *
   * The camera of a layer is only driven while a 3D camera is active: when no
   * 3D camera is active anymore, the layer camera keeps its last state.
   *
   * @category Core Engine > Scene
   */
  export class Camera3DManager {
    private _runtimeScene: gdjs.RuntimeScene;
    private _cameras: Array<gdjs.Camera3DLike> = [];
    /** The camera currently driving a layer camera. */
    private _activeCamera: gdjs.Camera3DLike | null = null;

    // States used to compute what is displayed. They are reused to avoid
    // allocating objects at every frame.
    private readonly _targetState = new gdjs.LayerCamera();
    private readonly _displayState = new gdjs.LayerCamera();
    /** The state the current transition started from, if any. */
    private _transitionFrom: gdjs.LayerCamera | null = null;
    private _transitionDurationInMs: float = 0;
    private _transitionStartTime: float = 0;

    constructor(runtimeScene: gdjs.RuntimeScene) {
      this._runtimeScene = runtimeScene;
    }

    /**
     * Add a 3D camera. It has no effect until it's made active.
     */
    registerCamera(camera: gdjs.Camera3DLike): void {
      if (this._cameras.indexOf(camera) !== -1) return;
      this._cameras.push(camera);
    }

    unregisterCamera(camera: gdjs.Camera3DLike): void {
      const index = this._cameras.indexOf(camera);
      if (index === -1) return;
      this._cameras.splice(index, 1);
      if (this._activeCamera === camera) {
        this._activeCamera = null;
        this._transitionFrom = null;
      }
    }

    getCameras(): ReadonlyArray<gdjs.Camera3DLike> {
      return this._cameras;
    }

    /**
     * The 3D camera that is currently driving the camera of its layer.
     */
    getActiveCamera(): gdjs.Camera3DLike | null {
      return this._activeCamera;
    }

    /**
     * Make a camera the active one, without waiting for the priority rules.
     *
     * The other cameras are deactivated so that the given camera is the one
     * used right away.
     *
     * @param camera The camera to activate.
     * @param blendDuration The duration, in seconds, of the transition from
     * the current camera state. The one of the camera is used when not set.
     */
    activateCamera(camera: gdjs.Camera3DLike, blendDuration?: number): void {
      for (const otherCamera of this._cameras) {
        if (otherCamera !== camera) otherCamera.setCamera3DActive(false);
      }
      camera.setCamera3DActive(true);
      if (blendDuration !== undefined) {
        camera.setCamera3DBlendDuration(blendDuration);
      }

      // Make the camera the active one right away, so that conditions like
      // `isActiveCamera` are true in the same frame (the transition, if any,
      // is started now and continues in `update`).
      if (this._activeCamera !== camera) {
        const previousActiveCamera = this._activeCamera;
        this._activeCamera = camera;
        this._startTransition(camera, previousActiveCamera);
      }
    }

    /**
     * Choose the active camera and apply it to the camera of its layer.
     *
     * Must be called before the objects are culled and rendered so that the
     * camera used by the culling is the one rendered.
     */
    update(): void {
      const previousActiveCamera = this._activeCamera;
      const activeCamera = this._resolveActiveCamera();
      if (activeCamera !== previousActiveCamera) {
        this._activeCamera = activeCamera;
        this._startTransition(activeCamera, previousActiveCamera);
      }
      if (!activeCamera) {
        // No camera is active anymore: the camera of the layer keeps its last
        // state.
        this._transitionFrom = null;
        return;
      }

      const layer = this._runtimeScene.getLayer(activeCamera.getLayer());
      if (!(layer instanceof gdjs.Layer)) return;

      this._getCameraState(activeCamera, layer, this._targetState);

      const now = this._runtimeScene.getTimeManager().getTimeFromStart();
      let displayedState = this._targetState;
      if (this._transitionFrom && this._transitionDurationInMs > 0) {
        const ratio = Math.min(
          (now - this._transitionStartTime) / this._transitionDurationInMs,
          1
        );
        // Smooth the transition so that it starts and ends gently.
        const easedRatio = ratio * ratio * (3 - 2 * ratio);
        displayedState = gdjs.LayerCamera.interpolate(
          this._transitionFrom,
          this._targetState,
          easedRatio,
          this._displayState
        );
        if (ratio >= 1) this._transitionFrom = null;
      } else {
        this._transitionFrom = null;
      }

      layer.applyCameraState(displayedState);
    }

    /**
     * The camera with the highest priority among the active ones.
     */
    private _resolveActiveCamera(): gdjs.Camera3DLike | null {
      let bestCamera: gdjs.Camera3DLike | null = null;
      let bestPriority = -Infinity;
      for (const camera of this._cameras) {
        if (!camera.isCamera3DActive()) continue;
        const priority = camera.getCamera3DPriority();
        if (priority > bestPriority) {
          bestCamera = camera;
          bestPriority = priority;
        }
      }
      return bestCamera;
    }

    /**
     * Start a transition from the camera state currently displayed by the
     * layer of the new camera.
     */
    private _startTransition(
      activeCamera: gdjs.Camera3DLike | null,
      previousActiveCamera: gdjs.Camera3DLike | null
    ): void {
      this._transitionFrom = null;
      this._transitionDurationInMs = 0;
      // No transition when a camera is activated for the first time.
      if (!activeCamera || !previousActiveCamera) return;

      const layer = this._runtimeScene.getLayer(activeCamera.getLayer());
      if (!(layer instanceof gdjs.Layer)) return;
      const durationInSeconds = Math.max(
        activeCamera.getCamera3DBlendDuration(),
        0
      );
      if (durationInSeconds <= 0) return;

      this._transitionFrom = layer.getActiveCamera().clone();
      this._transitionDurationInMs = durationInSeconds * 1000;
      this._transitionStartTime = this._runtimeScene
        .getTimeManager()
        .getTimeFromStart();
    }

    /**
     * Compute the camera state of a 3D camera, in the units of the camera of
     * its layer.
     */
    private _getCameraState(
      camera: gdjs.Camera3DLike,
      layer: gdjs.Layer,
      result: gdjs.LayerCamera
    ): void {
      result.x = camera.getX();
      result.y = camera.getY();
      result.z = camera.getZ();
      result.rotation = camera.getAngle();
      result.rotationX = camera.getRotationX();
      result.rotationY = camera.getRotationY();
      result.fov = Math.min(Math.max(camera.getCamera3DFieldOfView(), 0), 180);
      result.near = Math.max(camera.getCamera3DNearPlaneDistance(), 0.000001);
      result.far = Math.max(camera.getCamera3DFarPlaneDistance(), result.near);
      // The Z position is explicit: it's not computed from the zoom.
      result.isZDirty = false;

      // The size and the viewport are a configuration of the layer camera,
      // not of the 3D camera object: keep them as they are.
      const layerCamera = layer.getActiveCamera();
      result.width = layerCamera.width;
      result.height = layerCamera.height;
      result.useDefaultSize = layerCamera.useDefaultSize;
      result.viewportLeft = layerCamera.viewportLeft;
      result.viewportTop = layerCamera.viewportTop;
      result.viewportRight = layerCamera.viewportRight;
      result.viewportBottom = layerCamera.viewportBottom;
      result.useDefaultViewport = layerCamera.useDefaultViewport;

      if (camera.isCamera3DOrthographic()) {
        result.zoom = Math.max(camera.getCamera3DZoom(), 0.000001);
      } else {
        // Keep the zoom coherent with the Z position and the field of view,
        // so that 2D objects displayed on the plane keep the same size.
        const zPosition = camera.getZ();
        result.zoom =
          zPosition > 0
            ? (0.5 * layer.getHeight()) /
              (zPosition * Math.tan(0.5 * gdjs.toRad(result.fov)))
            : 1;
      }
    }
  }
}
