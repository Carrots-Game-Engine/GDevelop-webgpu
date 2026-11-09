namespace gdjs {
  /**
   * Base parameters for {@link gdjs.InstancedMesh3DRuntimeObject}
   * @category Objects > 3D Instanced Mesh
   */
  export interface InstancedMesh3DObjectData extends Object3DData {
    /** The base parameters of the InstancedMesh3D object */
    content: Object3DDataContent & {
      instanceCount: number | undefined;
      initialLayout: string | undefined;
      geometryType: string | undefined;
      modelResourceName: string | undefined;
      modelMeshName: string | undefined;
      materialType: string | undefined;
      tint: string | undefined;
      isCastingShadow: boolean | undefined;
      isReceivingShadow: boolean | undefined;
      frustumCulled: boolean | undefined;
    };
  }

  /**
   * A 3D object drawing many copies of the same geometry with a single
   * `THREE.InstancedMesh`.
   *
   * The instance coordinates are expressed in the object box: `(0, 0, 0)` is
   * the top-left-front corner and `(width, height, depth)` the
   * bottom-right-back corner. They are stored normalized so that resizing the
   * object keeps the layout.
   *
   * @category Objects > 3D Instanced Mesh
   */
  export class InstancedMesh3DRuntimeObject extends gdjs.RuntimeObject3D {
    private _renderer: gdjs.InstancedMesh3DRuntimeObject3DRenderer;
    private _layout: string;
    private _geometryType: string;
    private _modelResourceName: string;
    private _modelMeshName: string;
    private _materialType: string;
    private _tint: string;
    private _isCastingShadow: boolean;
    private _isReceivingShadow: boolean;
    private _frustumCulled: boolean;

    constructor(
      instanceContainer: gdjs.RuntimeInstanceContainer,
      objectData: InstancedMesh3DObjectData,
      instanceData?: InstanceData
    ) {
      super(instanceContainer, objectData, instanceData);
      const content = objectData.content;
      this._layout = content.initialLayout || 'Grid';
      this._geometryType = content.geometryType || 'Box';
      this._modelResourceName = content.modelResourceName || '';
      this._modelMeshName = content.modelMeshName || '';
      this._materialType =
        content.materialType === 'Basic' ? 'Basic' : 'StandardWithoutMetalness';
      this._tint = content.tint || '255;255;255';
      this._isCastingShadow =
        content.isCastingShadow === undefined ? true : content.isCastingShadow;
      this._isReceivingShadow =
        content.isReceivingShadow === undefined
          ? true
          : content.isReceivingShadow;
      this._frustumCulled = content.frustumCulled || false;

      this._renderer = new gdjs.InstancedMesh3DRuntimeObject3DRenderer(
        this,
        instanceContainer,
        {
          ...objectData,
          content: {
            ...content,
            materialType: this._materialType,
            tint: this._tint,
            isCastingShadow: this._isCastingShadow,
            isReceivingShadow: this._isReceivingShadow,
            frustumCulled: this._frustumCulled,
          },
        }
      );
      this.registerDestroyCallback(() => this._renderer.dispose());

      // *ALWAYS* call `this.onCreated()` at the very end of your object constructor.
      this.onCreated();
    }

    getRenderer(): gdjs.InstancedMesh3DRuntimeObject3DRenderer {
      return this._renderer;
    }

    update(instanceContainer: gdjs.RuntimeInstanceContainer): void {
      this._renderer.update();
    }

    updateFromObjectData(
      oldObjectData: InstancedMesh3DObjectData,
      newObjectData: InstancedMesh3DObjectData
    ): boolean {
      super.updateFromObjectData(oldObjectData, newObjectData);
      const oldContent = oldObjectData.content;
      const newContent = newObjectData.content;

      if (
        oldContent.initialLayout !== newContent.initialLayout ||
        oldContent.instanceCount !== newContent.instanceCount
      ) {
        this._layout = newContent.initialLayout || 'Grid';
        this._renderer.setLayout(this._layout);
        if (oldContent.instanceCount !== newContent.instanceCount) {
          this._renderer.setInstanceCount(newContent.instanceCount || 0);
        }
      }
      if (
        oldContent.geometryType !== newContent.geometryType ||
        oldContent.modelResourceName !== newContent.modelResourceName ||
        oldContent.modelMeshName !== newContent.modelMeshName
      ) {
        this._geometryType = newContent.geometryType || 'Box';
        this._modelResourceName = newContent.modelResourceName || '';
        this._modelMeshName = newContent.modelMeshName || '';
        this._renderer.rebuildGeometry(
          this._geometryType,
          this._modelResourceName,
          this._modelMeshName
        );
      }
      const materialType =
        newContent.materialType === 'Basic'
          ? 'Basic'
          : 'StandardWithoutMetalness';
      const tint = newContent.tint || '255;255;255';
      if (this._materialType !== materialType || this._tint !== tint) {
        this._materialType = materialType;
        this._tint = tint;
        this._renderer.setMaterialProfile(materialType, tint);
      }
      if (oldContent.frustumCulled !== newContent.frustumCulled) {
        this.setFrustumCulled(newContent.frustumCulled || false);
      }
      if (oldContent.isCastingShadow !== newContent.isCastingShadow) {
        this.setIsCastingShadow(newContent.isCastingShadow !== false);
      }
      if (oldContent.isReceivingShadow !== newContent.isReceivingShadow) {
        this.setIsReceivingShadow(newContent.isReceivingShadow !== false);
      }
      return true;
    }

    getInstanceCount(): number {
      return this._renderer.getInstanceCount();
    }

    getInstanceCountExpression(): number {
      return this._renderer.getInstanceCount();
    }

    getLastAddedInstanceIndex(): number {
      return this._renderer.getLastAddedInstanceIndex();
    }

    addInstance(x: number, y: number, z: number): number {
      return this._renderer.addInstance(x, y, z);
    }

    removeInstance(index: number): void {
      this._renderer.removeInstance(index);
    }

    clearInstances(): void {
      this._renderer.clearInstances();
    }

    setInstanceCount(count: number): void {
      this._renderer.setInstanceCount(count);
    }

    resetInstancesLayout(): void {
      this._renderer.resetInstancesLayout();
    }

    setInstancePosition(index: number, x: number, y: number, z: number): void {
      this._renderer.setInstancePosition(index, x, y, z);
    }

    setInstanceRotation(
      index: number,
      rotationX: number,
      rotationY: number,
      rotationZ: number
    ): void {
      this._renderer.setInstanceRotation(
        index,
        rotationX,
        rotationY,
        rotationZ
      );
    }

    setInstanceScale(
      index: number,
      scaleX: number,
      scaleY: number,
      scaleZ: number
    ): void {
      this._renderer.setInstanceScale(index, scaleX, scaleY, scaleZ);
    }

    setInstanceColor(index: number, color: string): void {
      this._renderer.setInstanceColor(index, color);
    }

    setInstanceVisible(index: number, visible: boolean): void {
      this._renderer.setInstanceVisible(index, visible);
    }

    isInstanceActive(index: number): boolean {
      return this._renderer.isInstanceActive(index);
    }

    isInstanceVisible(index: number): boolean {
      return this._renderer.isInstanceVisible(index);
    }

    getInstanceX(index: number): number {
      return this._renderer.getInstanceX(index);
    }

    getInstanceY(index: number): number {
      return this._renderer.getInstanceY(index);
    }

    getInstanceZ(index: number): number {
      return this._renderer.getInstanceZ(index);
    }

    getInstanceRotationX(index: number): number {
      return this._renderer.getInstanceRotationX(index);
    }

    getInstanceRotationY(index: number): number {
      return this._renderer.getInstanceRotationY(index);
    }

    getInstanceRotationZ(index: number): number {
      return this._renderer.getInstanceRotationZ(index);
    }

    getInstanceScaleX(index: number): number {
      return this._renderer.getInstanceScaleX(index);
    }

    getInstanceScaleY(index: number): number {
      return this._renderer.getInstanceScaleY(index);
    }

    getInstanceScaleZ(index: number): number {
      return this._renderer.getInstanceScaleZ(index);
    }

    getInstanceColor(index: number): string {
      return this._renderer.getInstanceColor(index);
    }

    setFrustumCulled(frustumCulled: boolean): void {
      this._frustumCulled = frustumCulled;
      this._renderer.setFrustumCulled(frustumCulled);
    }

    isFrustumCulled(): boolean {
      return this._frustumCulled;
    }

    setIsCastingShadow(isCastingShadow: boolean): void {
      this._isCastingShadow = isCastingShadow;
      this._renderer.setIsCastingShadow(isCastingShadow);
    }

    isCastingShadow(): boolean {
      return this._isCastingShadow;
    }

    setIsReceivingShadow(isReceivingShadow: boolean): void {
      this._isReceivingShadow = isReceivingShadow;
      this._renderer.setIsReceivingShadow(isReceivingShadow);
    }

    isReceivingShadow(): boolean {
      return this._isReceivingShadow;
    }

    setMaterialType(materialType: string): void {
      const newMaterialType =
        materialType === 'Basic' ? 'Basic' : 'StandardWithoutMetalness';
      if (this._materialType === newMaterialType) return;
      this._materialType = newMaterialType;
      this._renderer.setMaterialProfile(newMaterialType, this._tint);
    }

    getMaterialType(): string {
      return this._materialType;
    }

    setTint(tint: string): void {
      if (this._tint === tint) return;
      this._tint = tint;
      this._renderer.setMaterialProfile(this._materialType, tint);
    }

    getTint(): string {
      return this._tint;
    }
  }

  gdjs.registerObject(
    'Scene3D::InstancedMesh3DObject',
    gdjs.InstancedMesh3DRuntimeObject
  );
}
