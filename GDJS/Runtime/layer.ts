/*
 * GDevelop JS Platform
 * Copyright 2013-2016 Florian Rival (Florian.Rival@gmail.com). All rights reserved.
 * This project is released under the MIT License.
 */
namespace gdjs {
  /**
   * Represents a layer of a scene, used to display objects.
   * @category Core Engine > Layers
   */
  export class Layer extends gdjs.RuntimeLayer {
    /**
     * The cameras of the layer.
     *
     * `cameraId` 0 always designates the active camera (see
     * `getActiveCameraIndex`), other IDs designate the other cameras.
     * Cameras are created lazily and can be added with `addCamera`.
     */
    private _cameras!: Array<gdjs.LayerCamera>;
    private _activeCameraIndex: integer = 0;

    /**
     * @param layerData The data used to initialize the layer
     * @param instanceContainer The container in which the layer is used
     */
    constructor(
      layerData: LayerData,
      instanceContainer: gdjs.RuntimeInstanceContainer
    ) {
      super(layerData, instanceContainer);

      // The camera can already have been created by the renderer (which reads
      // the camera to set up the 3D rendering, before this constructor body).
      this.getActiveCamera();

      // Restore the cameras declared in the project (their size and viewport).
      // The position and the angle are runtime states: they start from the
      // default camera position.
      const camerasData = layerData.cameras || [];
      if (camerasData.length > 0) {
        const defaultCamera = this._createInitialCamera();
        this._cameras = camerasData.map((cameraData) =>
          this._createCameraFromData(cameraData, defaultCamera)
        );
        this._activeCameraIndex = 0;
      }

      // Let the renderer do its final set up:
      this._renderer.onCreated();
    }

    /**
     * Create a camera from the data of the project.
     *
     * @param cameraData The data of the camera in the project.
     * @param defaultCamera The camera to copy the runtime state from.
     */
    private _createCameraFromData(
      cameraData: CameraData,
      defaultCamera: gdjs.LayerCamera
    ): gdjs.LayerCamera {
      const camera = defaultCamera.clone();
      camera.useDefaultSize = cameraData.defaultSize !== false;
      camera.width = cameraData.width || 0;
      camera.height = cameraData.height || 0;
      if (!camera.useDefaultSize && camera.width > 0) {
        // The zoom is derived from the size so that the renderer shows the
        // requested area of the scene.
        camera.zoom = this.getWidth() / camera.width;
        camera.isZDirty = true;
      }
      camera.useDefaultViewport = cameraData.defaultViewport !== false;
      camera.viewportLeft = cameraData.viewportLeft || 0;
      camera.viewportTop = cameraData.viewportTop || 0;
      camera.viewportRight =
        cameraData.viewportRight !== undefined ? cameraData.viewportRight : 1;
      camera.viewportBottom =
        cameraData.viewportBottom !== undefined ? cameraData.viewportBottom : 1;
      return camera;
    }

    /**
     * Create a camera with the position and the settings the layer starts with.
     */
    private _createInitialCamera(): gdjs.LayerCamera {
      const camera = new gdjs.LayerCamera();
      camera.fov = this._initialCamera3DFieldOfView;
      camera.near = this._initialCamera3DNearPlaneDistance;
      camera.far = this._initialCamera3DFarPlaneDistance;

      if (
        this._defaultCameraBehavior ===
        gdjs.RuntimeLayerDefaultCameraBehavior.TOP_LEFT_ANCHORED_IF_NEVER_MOVED
      ) {
        // If top-left must stay in the top-left corner, this means we center the camera on the current size.
        camera.x = this._runtimeScene.getViewportOriginX();
        camera.y = this._runtimeScene.getViewportOriginY();
      } else {
        // Otherwise, the default camera position is the center of the initial viewport.
        camera.x =
          (this._runtimeScene.getInitialUnrotatedViewportMinX() +
            this._runtimeScene.getInitialUnrotatedViewportMaxX()) /
          2;
        camera.y =
          (this._runtimeScene.getInitialUnrotatedViewportMinY() +
            this._runtimeScene.getInitialUnrotatedViewportMaxY()) /
          2;
      }
      if (this.getCameraType() === gdjs.RuntimeLayerCameraType.ORTHOGRAPHIC) {
        camera.z =
          (this._initialCamera3DFarPlaneDistance +
            this._initialCamera3DNearPlaneDistance) /
          2;
        camera.isZDirty = false;
      }
      return camera;
    }

    /**
     * Get the state of the active camera, which is the one rendered.
     */
    getActiveCamera(): gdjs.LayerCamera {
      if (!this._cameras || this._cameras.length === 0) {
        // The renderer can ask for the camera before the constructor body runs.
        this._cameras = [this._createInitialCamera()];
      }
      return this._cameras[this._activeCameraIndex || 0];
    }

    /**
     * Get the number of cameras of the layer (which is at least 1).
     */
    getCameraCount(): integer {
      this.getActiveCamera();
      return this._cameras.length;
    }

    /**
     * Get the ID of the active camera, which is the camera rendered.
     */
    getActiveCameraIndex(): integer {
      return this._activeCameraIndex;
    }

    /**
     * Get the state of a camera of the layer.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera, which is the one used for rendering. An unknown camera number
     * designates the active camera.
     */
    getCamera(cameraId?: integer): gdjs.LayerCamera {
      const activeCamera = this.getActiveCamera();
      if (!cameraId) return activeCamera;
      const cameraIdAsInteger = Math.floor(cameraId);
      if (cameraIdAsInteger <= 0) return activeCamera;
      const camera = this._cameras[cameraIdAsInteger];
      return camera || activeCamera;
    }

    /**
     * Get the state of a camera of the layer by its index, without the
     * "camera 0 is the active camera" shortcut of `getCamera`.
     *
     * This is used by the renderer to display all the cameras of the layer.
     *
     * @param index The index of the camera in the list of cameras.
     */
    getCameraAtIndex(index: integer): gdjs.LayerCamera {
      this.getActiveCamera();
      const indexAsInteger = Math.floor(index);
      if (indexAsInteger < 0) return this.getActiveCamera();
      return this._cameras[indexAsInteger] || this.getActiveCamera();
    }

    /**
     * Add a camera to the layer, starting from the state of the active camera.
     *
     * @returns The ID of the new camera. It can then be used with the camera
     * functions taking a camera number, and made active with `setActiveCamera`.
     */
    addCamera(): integer {
      this._cameras.push(this.getActiveCamera().clone());
      return this._cameras.length - 1;
    }

    /**
     * Delete a camera of the layer.
     *
     * The last camera of a layer can't be deleted: a layer always has at least
     * one camera.
     *
     * @param cameraId The number of the camera to delete.
     */
    deleteCamera(cameraId: integer): void {
      const index = Math.floor(cameraId);
      if (index < 0 || index >= this.getCameraCount()) return;
      if (this._cameras.length <= 1) return;

      this._cameras.splice(index, 1);
      if (this._activeCameraIndex > index) {
        this._activeCameraIndex--;
      } else if (this._activeCameraIndex === index) {
        this._activeCameraIndex = Math.min(index, this._cameras.length - 1);
      }
      this._renderer.updateWorldScale();
      this._renderer.updatePosition();
      this._renderer.invalidateRotation();
    }

    /**
     * Change the camera used for rendering the layer.
     *
     * The previous active camera keeps its state: it can be made active again.
     *
     * @param cameraId The number of the camera to render.
     */
    setActiveCamera(cameraId: integer): void {
      const cameraIdAsInteger = Math.floor(cameraId);
      if (cameraIdAsInteger < 0 || cameraIdAsInteger >= this.getCameraCount()) {
        return;
      }
      if (cameraIdAsInteger === this._activeCameraIndex) {
        return;
      }
      this._activeCameraIndex = cameraIdAsInteger;
      // The projection planes are part of the camera state.
      this._renderer.updateWorldScale();
      this._renderer.updatePosition();
      this._renderer.invalidateRotation();
    }

    /**
     * Copy a camera state into one of the cameras of the layer.
     *
     * Used by the 3D cameras to drive the rendering when they are moved.
     *
     * @param state The state to copy.
     * @param cameraId The camera to update (the active one by default).
     */
    applyCameraState(state: gdjs.LayerCamera, cameraId?: integer): void {
      const camera = this.getCamera(cameraId);
      if (camera.equals(state)) {
        return;
      }
      const rotationChanged =
        camera.rotation !== state.rotation ||
        camera.rotationX !== state.rotationX ||
        camera.rotationY !== state.rotationY;
      const planesChanged =
        camera.near !== state.near || camera.far !== state.far;
      camera.copyFrom(state);
      if (camera === this.getActiveCamera()) {
        if (planesChanged) this._renderer.updateWorldScale();
        this._renderer.updatePosition();
        if (rotationChanged) this._renderer.invalidateRotation();
      }
    }

    /**
     * @deprecated Use `getActiveCamera().isZDirty` instead.
     */
    get _isCameraZDirty(): boolean {
      return this.getActiveCamera().isZDirty;
    }

    /**
     * Called by the RuntimeScene whenever the game resolution size is changed.
     * Updates the layer width/height and position.
     */
    override onGameResolutionResized(
      oldGameResolutionOriginX: float,
      oldGameResolutionOriginY: float
    ): void {
      // Adapt position of the camera center only if the camera has never moved as:
      // * When the camera follows a player/object, it will rarely be at the default position.
      //   (and if is, it will be moved again by the behavior/events).
      // * Cameras not following a player/object are usually UIs which are intuitively
      //   expected not to "move" (top-left stays "fixed"), while gameplay is "centered" (center stays "fixed").
      //
      // Note that anchor behavior is usually a better choice for UIs.
      const activeCamera = this.getActiveCamera();
      if (
        this._defaultCameraBehavior ===
          gdjs.RuntimeLayerDefaultCameraBehavior
            .TOP_LEFT_ANCHORED_IF_NEVER_MOVED &&
        // Have a safety margin of 1 pixel to avoid rounding errors.
        Math.abs(activeCamera.x - oldGameResolutionOriginX) < 1 &&
        Math.abs(activeCamera.y - oldGameResolutionOriginY) < 1 &&
        activeCamera.zoom === 1
      ) {
        activeCamera.x +=
          this._runtimeScene.getViewportOriginX() - oldGameResolutionOriginX;
        activeCamera.y +=
          this._runtimeScene.getViewportOriginY() - oldGameResolutionOriginY;
      }

      this._renderer.updatePosition();
      this._renderer.updateResolution();
    }

    /**
     * Change the camera center X position.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @return The x position of the camera
     */
    override getCameraX(cameraId?: integer): float {
      this._forceDimensionUpdate();
      return this.getCamera(cameraId).x;
    }

    /**
     * Change the camera center Y position.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @return The y position of the camera
     */
    override getCameraY(cameraId?: integer): float {
      this._forceDimensionUpdate();
      return this.getCamera(cameraId).y;
    }

    /**
     * Set the camera center X position.
     *
     * @param x The new x position
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override setCameraX(x: float, cameraId?: integer): void {
      this._forceDimensionUpdate();
      const camera = this.getCamera(cameraId);
      camera.x = x;
      if (camera === this.getActiveCamera()) {
        this._renderer.updatePosition();
      }
    }

    /**
     * Set the camera center Y position.
     *
     * @param y The new y position
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override setCameraY(y: float, cameraId?: integer): void {
      this._forceDimensionUpdate();
      const camera = this.getCamera(cameraId);
      camera.y = y;
      if (camera === this.getActiveCamera()) {
        this._renderer.updatePosition();
      }
    }

    /**
     * Get the camera width (which can be different than the game resolution width
     * if the camera is zoomed).
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @return The width of the camera
     */
    override getCameraWidth(cameraId?: integer): float {
      const camera = this.getCamera(cameraId);
      return camera.useDefaultSize || camera.width <= 0
        ? this.getWidth() / camera.zoom
        : camera.width;
    }

    /**
     * Get the camera height (which can be different than the game resolution height
     * if the camera is zoomed).
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @return The height of the camera
     */
    override getCameraHeight(cameraId?: integer): float {
      const camera = this.getCamera(cameraId);
      return camera.useDefaultSize || camera.height <= 0
        ? this.getHeight() / camera.zoom
        : camera.height;
    }

    /**
     * Set the size of the rendered area of a camera.
     *
     * The zoom is reset so that the camera shows the requested size.
     *
     * @param width The new width, in scene units.
     * @param height The new height, in scene units.
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override setCameraSize(
      width: float,
      height: float,
      cameraId?: integer
    ): void {
      const camera = this.getCamera(cameraId);
      camera.useDefaultSize = false;
      camera.width = width > 0 ? width : this.getWidth();
      camera.height = height > 0 ? height : this.getHeight();
      if (width > 0) {
        camera.zoom = this.getWidth() / width;
      }
      camera.isZDirty = true;
      if (camera === this.getActiveCamera()) {
        this._renderer.updateWorldScale();
        this._renderer.updatePosition();
      }
    }

    /**
     * Get the left side of the area of the window where a camera is displayed.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @return A value between 0 and 1.
     */
    override getCameraViewportLeft(cameraId?: integer): float {
      const camera = this.getCamera(cameraId);
      return camera.useDefaultViewport ? 0 : camera.viewportLeft;
    }

    /**
     * Get the top side of the area of the window where a camera is displayed.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @return A value between 0 and 1.
     */
    override getCameraViewportTop(cameraId?: integer): float {
      const camera = this.getCamera(cameraId);
      return camera.useDefaultViewport ? 0 : camera.viewportTop;
    }

    /**
     * Get the right side of the area of the window where a camera is displayed.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @return A value between 0 and 1.
     */
    override getCameraViewportRight(cameraId?: integer): float {
      const camera = this.getCamera(cameraId);
      return camera.useDefaultViewport ? 1 : camera.viewportRight;
    }

    /**
     * Get the bottom side of the area of the window where a camera is displayed.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @return A value between 0 and 1.
     */
    override getCameraViewportBottom(cameraId?: integer): float {
      const camera = this.getCamera(cameraId);
      return camera.useDefaultViewport ? 1 : camera.viewportBottom;
    }

    /**
     * Set the area of the window where a camera is displayed.
     *
     * @param left The left side, between 0 and 1.
     * @param top The top side, between 0 and 1.
     * @param right The right side, between 0 and 1.
     * @param bottom The bottom side, between 0 and 1.
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override setCameraViewport(
      left: float,
      top: float,
      right: float,
      bottom: float,
      cameraId?: integer
    ): void {
      const camera = this.getCamera(cameraId);
      camera.useDefaultViewport = false;
      camera.viewportLeft = Math.min(Math.max(left, 0), 1);
      camera.viewportTop = Math.min(Math.max(top, 0), 1);
      camera.viewportRight = Math.min(Math.max(right, 0), 1);
      camera.viewportBottom = Math.min(Math.max(bottom, 0), 1);
      if (camera === this.getActiveCamera()) {
        this._renderer.updateWorldScale();
        this._renderer.updatePosition();
      }
    }

    /**
     * Set the zoom of a camera.
     *
     * @param newZoom The new zoom. Must be superior to 0. 1 is the default zoom.
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override setCameraZoom(newZoom: float, cameraId?: integer): void {
      if (newZoom <= 0) {
        return;
      }
      const camera = this.getCamera(cameraId);
      camera.zoom = newZoom;
      camera.isZDirty = true;
      if (camera === this.getActiveCamera()) {
        this._renderer.updatePosition();
      }
    }

    /**
     * Get the zoom of a camera.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @return The zoom.
     */
    override getCameraZoom(cameraId?: integer): float {
      return this.getCamera(cameraId).zoom;
    }

    /**
     * Set the camera center Z position.
     *
     * @param z The new y position.
     * @param fov The field of view.
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override setCameraZ(z: float, fov: float | null, cameraId?: integer): void {
      const camera = this.getCamera(cameraId);
      if (fov) {
        const cameraFovInRadians = gdjs.toRad(fov);

        // The zoom factor is capped to a not too big value to avoid infinity.
        // MAX_SAFE_INTEGER is an arbitrary choice. It's big but not too big.
        const zoomFactor = Math.min(
          Number.MAX_SAFE_INTEGER,
          (0.5 * this.getHeight()) / (z * Math.tan(0.5 * cameraFovInRadians))
        );

        if (zoomFactor > 0) {
          camera.zoom = zoomFactor;
        }
      }

      camera.z = z;
      camera.isZDirty = false;
      if (camera === this.getActiveCamera()) {
        this._renderer.updatePosition();
      }
    }

    /**
     * Get the camera center Z position.
     *
     * @param fov The field of view.
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @return The z position of the camera
     */
    override getCameraZ(fov: float | null, cameraId?: integer): float {
      const camera = this.getCamera(cameraId);
      if (!camera.isZDirty || !fov) {
        return camera.z;
      }

      // Set the camera so that it displays the whole PixiJS plane, as if it was a 2D rendering.
      // The Z position is computed by taking the half height of the displayed rendering,
      // and using the angle of the triangle defined by the field of view to compute the length
      // of the triangle defining the distance between the camera and the rendering plane.
      const cameraZPosition =
        (0.5 * this.getHeight()) /
        camera.zoom /
        Math.tan(0.5 * gdjs.toRad(fov));

      return cameraZPosition;
    }

    /**
     * Get the rotation of the camera, expressed in degrees.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @return The rotation, in degrees.
     */
    override getCameraRotation(cameraId?: integer): float {
      return this.getCamera(cameraId).rotation;
    }

    /**
     * Set the rotation of the camera, expressed in degrees.
     * The rotation is made around the camera center.
     *
     * @param rotation The new rotation, in degrees.
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override setCameraRotation(rotation: float, cameraId?: integer): void {
      const camera = this.getCamera(cameraId);
      camera.rotation = rotation;
      if (camera === this.getActiveCamera()) {
        this._renderer.updatePosition();
        this._renderer.invalidateRotation();
      }
    }

    override getCameraRotationY(cameraId?: integer): float {
      return this.getCamera(cameraId).rotationY;
    }

    override setCameraRotationY(rotationY: float, cameraId?: integer): void {
      const camera = this.getCamera(cameraId);
      camera.rotationY = rotationY;
      if (camera === this.getActiveCamera()) {
        this._renderer.updatePosition();
        this._renderer.invalidateRotation();
      }
    }

    override getCameraRotationX(cameraId?: integer): float {
      return this.getCamera(cameraId).rotationX;
    }

    override setCameraRotationX(rotationX: float, cameraId?: integer): void {
      const camera = this.getCamera(cameraId);
      camera.rotationX = rotationX;
      if (camera === this.getActiveCamera()) {
        this._renderer.updatePosition();
        this._renderer.invalidateRotation();
      }
    }

    override getCameraForwardX(cameraId?: integer): number {
      return this._renderer.getCameraForwardX();
    }

    override getCameraForwardY(cameraId?: integer): number {
      return this._renderer.getCameraForwardY();
    }

    override getCameraForwardZ(cameraId?: integer): number {
      return this._renderer.getCameraForwardZ();
    }

    override getCameraUpX(cameraId?: integer): number {
      return this._renderer.getCameraUpX();
    }

    override getCameraUpY(cameraId?: integer): number {
      return this._renderer.getCameraUpY();
    }

    override getCameraUpZ(cameraId?: integer): number {
      return this._renderer.getCameraUpZ();
    }

    override getCameraRightX(cameraId?: integer): number {
      return this._renderer.getCameraRightX();
    }

    override getCameraRightY(cameraId?: integer): number {
      return this._renderer.getCameraRightY();
    }

    override getCameraRightZ(cameraId?: integer): number {
      return this._renderer.getCameraRightZ();
    }

    /**
     * Set the camera 3D field of view.
     *
     * @param fieldOfView The field of view, in degrees.
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override setCamera3DFieldOfView(
      fieldOfView: float,
      cameraId?: integer
    ): void {
      if (!this._renderer.getThreeCamera()) return;
      const camera = this.getCamera(cameraId);
      const newFieldOfView = Math.min(Math.max(fieldOfView, 0), 180);
      if (camera.fov === newFieldOfView) return;
      camera.fov = newFieldOfView;
      if (camera === this.getActiveCamera()) {
        this._renderer.updatePosition();
      }
    }

    /**
     * Get the camera 3D field of view.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override getCamera3DFieldOfView(cameraId?: integer): float {
      if (!this._renderer.getThreeCamera()) return 0;
      if (this.getCameraType() === gdjs.RuntimeLayerCameraType.ORTHOGRAPHIC) {
        return 0;
      }
      return this.getCamera(cameraId).fov;
    }

    /**
     * Set the camera 3D near plane distance.
     *
     * @param nearPlaneDistance The distance, in scene units.
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override setCamera3DNearPlaneDistance(
      nearPlaneDistance: float,
      cameraId?: integer
    ): void {
      if (!this._renderer.getThreeCamera()) return;
      const camera = this.getCamera(cameraId);
      const newNearPlaneDistance = Math.max(nearPlaneDistance, 0);
      if (camera.near === newNearPlaneDistance) return;
      camera.near = newNearPlaneDistance;
      // The near plane distance must stay lower than the far plane one.
      if (camera.near > camera.far) {
        camera.near = camera.far;
      }
      if (camera === this.getActiveCamera()) {
        this._renderer.updateWorldScale();
        this._renderer.updatePosition();
      }
    }

    /**
     * Get the camera 3D near plane distance.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override getCamera3DNearPlaneDistance(cameraId?: integer): float {
      if (!this._renderer.getThreeCamera()) return 0;
      return this.getCamera(cameraId).near;
    }

    /**
     * Set the camera 3D far plane distance.
     *
     * @param farPlaneDistance The distance, in scene units.
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override setCamera3DFarPlaneDistance(
      farPlaneDistance: float,
      cameraId?: integer
    ): void {
      if (!this._renderer.getThreeCamera()) return;
      const camera = this.getCamera(cameraId);
      const newFarPlaneDistance = Math.max(farPlaneDistance, 0);
      if (camera.far === newFarPlaneDistance) return;
      camera.far = newFarPlaneDistance;
      // The far plane distance must stay greater than the near plane one.
      if (camera.far < camera.near) {
        camera.far = camera.near;
      }
      if (camera === this.getActiveCamera()) {
        this._renderer.updateWorldScale();
        this._renderer.updatePosition();
      }
    }

    /**
     * Get the camera 3D far plane distance.
     *
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     */
    override getCamera3DFarPlaneDistance(cameraId?: integer): float {
      if (!this._renderer.getThreeCamera()) return 0;
      return this.getCamera(cameraId).far;
    }

    /**
     * Convert a point from the canvas coordinates (for example,
     * the mouse position) to the container coordinates.
     *
     * This method handles 3D rotations.
     *
     * @param x The x position, in canvas coordinates.
     * @param y The y position, in canvas coordinates.
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @param result The point instance that is used to return the result.
     */
    override convertCoords(
      x: float,
      y: float,
      cameraId: integer = 0,
      result: FloatPoint
    ): FloatPoint {
      // This code duplicates applyLayerInverseTransformation for performance reasons;

      // The result parameter used to be optional.
      let position = result || [0, 0];

      if (this._renderer.isCameraRotatedIn3D()) {
        return this._renderer.transformTo3DWorld(x, y, 0, cameraId, result);
      }

      const camera = this.getCamera(cameraId);
      x -= this.getRuntimeScene()._cachedGameResolutionWidth / 2;
      y -= this.getRuntimeScene()._cachedGameResolutionHeight / 2;
      x /= camera.zoom;
      y /= camera.zoom;

      // Only compute angle and cos/sin once (allow heavy optimization from JS engines).
      const angleInRadians = (camera.rotation / 180) * Math.PI;
      const tmp = x;
      const cosValue = Math.cos(angleInRadians);
      const sinValue = Math.sin(angleInRadians);
      x = cosValue * x - sinValue * y;
      y = sinValue * tmp + cosValue * y;
      position[0] = x + camera.x;
      position[1] = y + camera.y;
      return position;
    }

    /**
     * Return an array containing the coordinates of the point passed as parameter
     * in layer local coordinates (as opposed to the parent coordinates).
     *
     * All transformations (scale, rotation) are supported.
     *
     * This method doesn't handle 3D rotations.
     *
     * @param x The X position of the point, in parent coordinates.
     * @param y The Y position of the point, in parent coordinates.
     * @param result Array that will be updated with the result
     * @param result The point instance that is used to return the result.
     * (x and y position of the point in layer coordinates).
     */
    override applyLayerInverseTransformation(
      x: float,
      y: float,
      cameraId: integer,
      result: FloatPoint
    ): FloatPoint {
      const camera = this.getCamera(cameraId);
      x -= this._runtimeScene.getViewportOriginX();
      y -= this._runtimeScene.getViewportOriginY();
      x /= camera.zoom;
      y /= camera.zoom;

      // Only compute angle and cos/sin once (allow heavy optimization from JS engines).
      const angleInRadians = (camera.rotation / 180) * Math.PI;
      const tmp = x;
      const cosValue = Math.cos(angleInRadians);
      const sinValue = Math.sin(angleInRadians);
      x = cosValue * x - sinValue * y;
      y = sinValue * tmp + cosValue * y;
      result[0] = x + camera.x;
      result[1] = y + camera.y;

      return result;
    }

    /**
     * Convert a point from the container coordinates (for example,
     * an object position) to the canvas coordinates.
     *
     * This method doesn't handle 3D rotations.
     *
     * @param x The x position, in container coordinates.
     * @param y The y position, in container coordinates.
     * @param cameraId The camera number. 0 (or nothing) designates the active
     * camera.
     * @param result The point instance that is used to return the result.
     */
    override convertInverseCoords(
      x: float,
      y: float,
      cameraId: integer = 0,
      result: FloatPoint
    ): FloatPoint {
      // This code duplicates applyLayerTransformation for performance reasons;

      // The result parameter used to be optional.
      let position = result || [0, 0];
      const camera = this.getCamera(cameraId);
      x -= camera.x;
      y -= camera.y;

      // Only compute angle and cos/sin once (allow heavy optimization from JS engines).
      const angleInRadians = (camera.rotation / 180) * Math.PI;
      const tmp = x;
      const cosValue = Math.cos(-angleInRadians);
      const sinValue = Math.sin(-angleInRadians);
      x = cosValue * x - sinValue * y;
      y = sinValue * tmp + cosValue * y;
      x *= camera.zoom;
      y *= camera.zoom;
      position[0] = x + this.getRuntimeScene()._cachedGameResolutionWidth / 2;
      position[1] = y + this.getRuntimeScene()._cachedGameResolutionHeight / 2;

      return position;
    }

    /**
     * Return an array containing the coordinates of the point passed as parameter
     * in parent coordinate coordinates (as opposed to the layer local coordinates).
     *
     * All transformations (scale, rotation) are supported.
     *
     * This method doesn't handle 3D rotations.
     *
     * @param x The X position of the point, in layer coordinates.
     * @param y The Y position of the point, in layer coordinates.
     * @param result Array that will be updated with the result
     * (x and y position of the point in parent coordinates).
     */
    override applyLayerTransformation(
      x: float,
      y: float,
      cameraId: integer,
      result: FloatPoint
    ): FloatPoint {
      const camera = this.getCamera(cameraId);
      x -= camera.x;
      y -= camera.y;

      // Only compute angle and cos/sin once (allow heavy optimization from JS engines).
      const angleInRadians = (camera.rotation / 180) * Math.PI;
      const tmp = x;
      const cosValue = Math.cos(-angleInRadians);
      const sinValue = Math.sin(-angleInRadians);
      x = cosValue * x - sinValue * y;
      y = sinValue * tmp + cosValue * y;
      x *= camera.zoom;
      y *= camera.zoom;
      x += this._runtimeScene.getViewportOriginX();
      y += this._runtimeScene.getViewportOriginY();

      result[0] = x;
      result[1] = y;
      return result;
    }

    /**
     * This ensure that the viewport dimensions are up to date.
     *
     * It's needed because custom objects dimensions are only updated on
     * demand for efficiency reasons.
     */
    private _forceDimensionUpdate(): void {
      // This will update dimensions.
      this._runtimeScene.getViewportWidth();
    }
  }
}
