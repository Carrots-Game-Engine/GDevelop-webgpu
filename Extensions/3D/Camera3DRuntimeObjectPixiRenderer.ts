namespace gdjs {
  /**
   * The renderer of a {@link gdjs.Camera3DRuntimeObject}.
   *
   * A 3D camera is not drawn: it only drives the camera of its layer. An empty
   * (invisible) Three.js object is still kept so that the camera can be moved
   * with the same code as the other 3D objects.
   *
   * @category Renderers
   */
  export class Camera3DRuntimeObjectRenderer extends gdjs.RuntimeObject3DRenderer {
    private _camera3DRuntimeObject: gdjs.Camera3DRuntimeObject;
    private _object3D: THREE.Object3D;

    constructor(
      runtimeObject: gdjs.Camera3DRuntimeObject,
      instanceContainer: gdjs.RuntimeInstanceContainer
    ) {
      const object3D = new THREE.Group();
      object3D.visible = false;
      super(runtimeObject, instanceContainer, object3D);

      this._camera3DRuntimeObject = runtimeObject;
      this._object3D = object3D;
      this.updatePosition();
      this.updateRotation();
    }

    /**
     * The camera is positioned at its exact X, Y and Z position (unlike the
     * other 3D objects which are centered on their size).
     */
    override updatePosition(): void {
      this._object3D.position.set(
        this._camera3DRuntimeObject.getX(),
        this._camera3DRuntimeObject.getY(),
        this._camera3DRuntimeObject.getZ()
      );
    }

    override updateRotation(): void {
      this._object3D.rotation.set(
        gdjs.toRad(this._camera3DRuntimeObject.getRotationX()),
        gdjs.toRad(this._camera3DRuntimeObject.getRotationY()),
        gdjs.toRad(this._camera3DRuntimeObject.getAngle())
      );
      this.invalidateRotation();
    }

    override updateSize(): void {
      // A camera has no size.
    }

    override updateVisibility(): void {
      // A camera is never drawn: it must not be hidden when the object is.
      this._object3D.visible = false;
    }
  }
}
