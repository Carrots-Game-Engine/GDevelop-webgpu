namespace gdjs {
  /**
   * Base parameters for {@link gdjs.Camera3DRuntimeObject}
   * @category Objects > 3D Camera
   */
  export interface Camera3DObjectData extends Object3DData {
    /** The base parameters of the Camera3D object */
    content: Object3DDataContent & {
      fieldOfView: number;
      nearPlaneDistance: number;
      farPlaneDistance: number;
      projection: 'perspective' | 'orthographic';
      zoom: number;
      /** True if the camera drives its layer at the beginning of the scene. */
      activeAtStart: boolean;
      /** The camera with the highest priority among the active ones is used. */
      priority: number;
      /** The duration, in seconds, of the transition when this camera is activated. */
      blendDuration: number;
    };
  }

  type Camera3DObjectNetworkSyncDataType = {
    fov: number;
    near: number;
    far: number;
    proj: 'perspective' | 'orthographic';
    zoom: number;
    act: boolean;
    prio: number;
    blend: number;
  };

  type Camera3DObjectNetworkSyncData = Object3DNetworkSyncData &
    Camera3DObjectNetworkSyncDataType;

  /**
   * A camera that can drive the camera of its layer.
   *
   * The camera object itself is not drawn: only one of the 3D cameras of a
   * scene is active at a time and it moves the camera of its layer. Cameras
   * can be activated from events or by a behavior, using `setCamera3DActive`,
   * without having to write the camera position each frame.
   *
   * @category Objects > 3D Camera
   */
  export class Camera3DRuntimeObject
    extends gdjs.RuntimeObject3D
    implements gdjs.Camera3DLike
  {
    private _renderer: gdjs.Camera3DRuntimeObjectRenderer;

    private _fieldOfView: float;
    private _nearPlaneDistance: float;
    private _farPlaneDistance: float;
    private _isOrthographic: boolean;
    private _zoom: float;
    private _isActive: boolean;
    private _priority: number;
    private _blendDuration: float;

    constructor(
      instanceContainer: gdjs.RuntimeInstanceContainer,
      objectData: Camera3DObjectData,
      instanceData?: InstanceData
    ) {
      super(instanceContainer, objectData, instanceData);

      const content = objectData.content;
      this._fieldOfView = content.fieldOfView || 45;
      this._nearPlaneDistance = content.nearPlaneDistance || 0.1;
      this._farPlaneDistance = content.farPlaneDistance || 2000;
      this._isOrthographic = content.projection === 'orthographic';
      this._zoom = content.zoom || 1;
      this._isActive = content.activeAtStart === true;
      this._priority = content.priority || 0;
      this._blendDuration = content.blendDuration || 0;

      this._renderer = new gdjs.Camera3DRuntimeObjectRenderer(
        this,
        instanceContainer
      );

      const camera3DManager = instanceContainer.getScene().getCamera3DManager();
      camera3DManager.registerCamera(this);
      this.registerDestroyCallback(() =>
        camera3DManager.unregisterCamera(this)
      );
    }

    override getRenderer(): gdjs.Camera3DRuntimeObjectRenderer {
      return this._renderer;
    }

    override updateFromObjectData(
      oldObjectData: Camera3DObjectData,
      newObjectData: Camera3DObjectData
    ): boolean {
      super.updateFromObjectData(oldObjectData, newObjectData);

      const content = newObjectData.content;
      this._fieldOfView = content.fieldOfView || 45;
      this._nearPlaneDistance = content.nearPlaneDistance || 0.1;
      this._farPlaneDistance = content.farPlaneDistance || 2000;
      this._isOrthographic = content.projection === 'orthographic';
      this._zoom = content.zoom || 1;
      this._priority = content.priority || 0;
      this._blendDuration = content.blendDuration || 0;

      return true;
    }

    override getNetworkSyncData(
      syncOptions: GetNetworkSyncDataOptions
    ): Camera3DObjectNetworkSyncData {
      return {
        ...super.getNetworkSyncData(syncOptions),
        fov: this._fieldOfView,
        near: this._nearPlaneDistance,
        far: this._farPlaneDistance,
        proj: this._isOrthographic ? 'orthographic' : 'perspective',
        zoom: this._zoom,
        act: this._isActive,
        prio: this._priority,
        blend: this._blendDuration,
      };
    }

    override updateFromNetworkSyncData(
      networkSyncData: Camera3DObjectNetworkSyncData,
      options: UpdateFromNetworkSyncDataOptions
    ) {
      super.updateFromNetworkSyncData(networkSyncData, options);

      if (networkSyncData.fov !== undefined) {
        this._fieldOfView = networkSyncData.fov;
      }
      if (networkSyncData.near !== undefined) {
        this._nearPlaneDistance = networkSyncData.near;
      }
      if (networkSyncData.far !== undefined) {
        this._farPlaneDistance = networkSyncData.far;
      }
      if (networkSyncData.proj !== undefined) {
        this._isOrthographic = networkSyncData.proj === 'orthographic';
      }
      if (networkSyncData.zoom !== undefined) {
        this._zoom = networkSyncData.zoom;
      }
      if (networkSyncData.act !== undefined) {
        this._isActive = networkSyncData.act;
      }
      if (networkSyncData.prio !== undefined) {
        this._priority = networkSyncData.prio;
      }
      if (networkSyncData.blend !== undefined) {
        this._blendDuration = networkSyncData.blend;
      }
    }

    /**
     * Get the field of view of the camera, in degrees.
     */
    getCamera3DFieldOfView(): float {
      return this._fieldOfView;
    }

    /**
     * Set the field of view of the camera, in degrees.
     */
    setCamera3DFieldOfView(fieldOfView: float): void {
      this._fieldOfView = Math.min(Math.max(fieldOfView, 0), 180);
    }

    getCamera3DNearPlaneDistance(): float {
      return this._nearPlaneDistance;
    }

    setCamera3DNearPlaneDistance(nearPlaneDistance: float): void {
      this._nearPlaneDistance = Math.max(nearPlaneDistance, 0);
    }

    getCamera3DFarPlaneDistance(): float {
      return this._farPlaneDistance;
    }

    setCamera3DFarPlaneDistance(farPlaneDistance: float): void {
      this._farPlaneDistance = Math.max(farPlaneDistance, 0);
    }

    /**
     * Get the zoom of the camera, used when the projection is orthographic.
     */
    getCamera3DZoom(): float {
      return this._zoom;
    }

    setCamera3DZoom(zoom: float): void {
      if (zoom <= 0) return;
      this._zoom = zoom;
    }

    isCamera3DOrthographic(): boolean {
      return this._isOrthographic;
    }

    /**
     * Return true if the camera is driving the camera of its layer.
     */
    isCamera3DActive(): boolean {
      return this._isActive;
    }

    /**
     * Activate or deactivate the camera.
     *
     * The camera with the highest priority among the active ones is used.
     */
    setCamera3DActive(active: boolean): void {
      this._isActive = active;
    }

    /**
     * Return true if this camera is the one currently driving the scene.
     */
    isActiveCamera(): boolean {
      return (
        this.getRuntimeScene().getCamera3DManager().getActiveCamera() === this
      );
    }

    /**
     * Activate this camera. The other cameras are deactivated.
     */
    activate(): void {
      this.getRuntimeScene().getCamera3DManager().activateCamera(this);
    }

    /**
     * Deactivate this camera. The camera of the layer keeps its last state.
     */
    deactivate(): void {
      this.setCamera3DActive(false);
    }

    getCamera3DPriority(): number {
      return this._priority;
    }

    setCamera3DPriority(priority: number): void {
      this._priority = priority;
    }

    /**
     * Get the duration, in seconds, of the transition to this camera when it
     * becomes active.
     */
    getCamera3DBlendDuration(): number {
      return this._blendDuration;
    }

    setCamera3DBlendDuration(blendDuration: number): void {
      this._blendDuration = Math.max(blendDuration, 0);
    }
  }
}
