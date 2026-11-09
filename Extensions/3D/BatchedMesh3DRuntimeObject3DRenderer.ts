namespace gdjs {
  /**
   * Renderer of {@link gdjs.BatchedMesh3DRuntimeObject}.
   *
   * All the instances are rendered with a single `THREE.BatchedMesh`, so all
   * the geometries of the palette share the same draw call even when they are
   * different.
   */
  export class BatchedMesh3DRuntimeObject3DRenderer
    extends gdjs.Instancing3DRuntimeObject3DRenderer
  {
    private _mesh: THREE.BatchedMesh | null = null;
    private _palette: Array<gdjs.Instancing3DGeometryData> = [];
    private _material: THREE.Material;
    private _materialType: string;
    private _tint: string;
    private _perObjectFrustumCulled = true;
    private _sortObjects = false;
    private _isCastingShadow = true;
    private _isReceivingShadow = true;
    private _geometryTypes: string;
    private _modelResourceName: string;
    private _modelMeshNames: string;
    /** Geometry palette index chosen by each instance. */
    private _instanceGeometryIndices = new Uint32Array(0);
    /** Number of instances allocated in the current `THREE.BatchedMesh`. */
    private _meshInstanceCount = 0;

    constructor(
      runtimeObject: gdjs.BatchedMesh3DRuntimeObject,
      instanceContainer: gdjs.RuntimeInstanceContainer,
      objectData: gdjs.BatchedMesh3DObjectData
    ) {
      super(
        runtimeObject,
        instanceContainer,
        objectData.content.instanceCount || 16,
        objectData.content.initialLayout || 'Grid'
      );
      this._materialType =
        objectData.content.materialType || 'StandardWithoutMetalness';
      this._tint = objectData.content.tint || '255;255;255';
      this._perObjectFrustumCulled =
        objectData.content.frustumCulled === undefined
          ? true
          : objectData.content.frustumCulled;
      this._sortObjects = objectData.content.sortObjects || false;
      this._isCastingShadow =
        objectData.content.isCastingShadow === undefined
          ? true
          : objectData.content.isCastingShadow;
      this._isReceivingShadow =
        objectData.content.isReceivingShadow === undefined
          ? true
          : objectData.content.isReceivingShadow;
      this._geometryTypes = objectData.content.geometryTypes || 'Box';
      this._modelResourceName = objectData.content.modelResourceName || '';
      this._modelMeshNames = objectData.content.modelMeshNames || '';
      this._palette = this._buildPalette();
      this._material = gdjs.createInstancing3DMaterial(
        this._materialType,
        this._tint
      );
      this.initializeRenderingMesh();
    }

    private _buildPalette(): Array<gdjs.Instancing3DGeometryData> {
      const palette: Array<gdjs.Instancing3DGeometryData> = [];
      for (const primitiveName of gdjs.parseInstancing3DPrimitiveNames(
        this._geometryTypes
      )) {
        palette.push({
          name: primitiveName,
          geometry: gdjs.createInstancing3DPrimitiveGeometry(primitiveName),
        });
      }
      if (this._modelResourceName) {
        const model = this._runtimeObject
          .getInstanceContainer()
          .getGame()
          .getModel3DManager()
          .getModel(this._modelResourceName);
        const modelGeometries = gdjs.extractInstancing3DModelGeometries(
          model,
          gdjs.parseInstancing3DMeshNames(this._modelMeshNames)
        );
        for (const geometryData of modelGeometries) {
          palette.push(geometryData);
        }
      }
      if (palette.length === 0) {
        palette.push({
          name: 'Box',
          geometry: gdjs.createInstancing3DPrimitiveGeometry('Box'),
        });
      }
      return palette;
    }

    private _getPaletteBufferSizes(): {
      vertexCount: number;
      indexCount: number;
    } {
      let vertexCount = 0;
      let indexCount = 0;
      for (const geometryData of this._palette) {
        const geometry = geometryData.geometry;
        vertexCount += geometry.getAttribute('position').count;
        const index = geometry.getIndex();
        indexCount += index ? index.count : 0;
      }
      return { vertexCount, indexCount };
    }

    protected rebuildRenderingMesh(): void {
      if (this._mesh) {
        this._mesh.removeFromParent();
        this._mesh.dispose();
        this._mesh = null;
      }
      if (this._instanceGeometryIndices.length < this._capacity) {
        const newGeometryIndices = new Uint32Array(this._capacity);
        newGeometryIndices.set(this._instanceGeometryIndices);
        this._instanceGeometryIndices = newGeometryIndices;
      }

      const { vertexCount, indexCount } = this._getPaletteBufferSizes();
      const mesh = new THREE.BatchedMesh(
        Math.max(1, this._capacity),
        Math.max(1, vertexCount),
        Math.max(1, indexCount),
        this._material
      );
      for (const geometryData of this._palette) {
        mesh.addGeometry(geometryData.geometry);
      }
      for (let index = 0; index < this._allocatedSlotCount; index++) {
        mesh.addInstance(
          Math.min(
            this._instanceGeometryIndices[index] || 0,
            this._palette.length - 1
          )
        );
      }
      this._meshInstanceCount = this._allocatedSlotCount;
      mesh.castShadow = this._isCastingShadow;
      mesh.receiveShadow = this._isReceivingShadow;
      mesh.perObjectFrustumCulled = this._perObjectFrustumCulled;
      mesh.sortObjects = this._sortObjects;
      this._mesh = mesh;
      this._root.add(mesh);
      this.writeInitialInstanceData(
        (index, matrix) => mesh.setMatrixAt(index, matrix),
        (index, color) => mesh.setColorAt(index, color)
      );
    }

    protected writeMatrix(index: number, matrix: THREE.Matrix4): void {
      if (!this._mesh) return;
      this._mesh.setMatrixAt(index, matrix);
    }

    protected writeColor(index: number, color: THREE.Color): void {
      if (!this._mesh) return;
      this._mesh.setColorAt(index, color);
    }

    protected writeVisibility(index: number, visible: boolean): void {
      if (!this._mesh) return;
      this._mesh.setVisibleAt(index, visible);
    }

    protected commitDirtyMatrices(firstIndex: number, lastIndex: number): void {
      // `THREE.BatchedMesh` updates its instance data textures itself.
    }

    protected commitDirtyColors(firstIndex: number, lastIndex: number): void {
      // `THREE.BatchedMesh` updates its instance data textures itself.
    }

    protected onInstanceCountChanged(): void {
      // The `THREE.BatchedMesh` keeps all the allocated instances; inactive
      // ones are hidden by their matrix and visibility flag.
    }

    protected onInstanceAdded(index: number): void {
      if (!this._mesh) return;
      if (index < this._meshInstanceCount) return;
      const geometryId = Math.min(
        this._instanceGeometryIndices[index] || 0,
        this._palette.length - 1
      );
      this._mesh.addInstance(geometryId);
      this._meshInstanceCount++;
    }

    protected onInstanceRemoved(index: number): void {
      if (this._mesh) {
        this._mesh.setVisibleAt(index, false);
      }
    }

    protected onAllInstancesCleared(): void {
      this.rebuildRenderingMesh();
    }

    protected disposeRenderingMesh(): void {
      if (this._mesh) {
        this._mesh.removeFromParent();
        this._mesh.dispose();
        this._mesh = null;
      }
      gdjs.disposeInstancing3DGeometries(this._palette);
      this._material.dispose();
    }

    getGeometryCount(): number {
      return this._palette.length;
    }

    getGeometryName(index: number): string {
      index = Math.floor(index);
      if (index < 0 || index >= this._palette.length) return '';
      return this._palette[index].name;
    }

    setInstanceGeometry(index: number, geometryIndex: number): void {
      index = Math.floor(index);
      geometryIndex = Math.floor(geometryIndex);
      if (index < 0 || index >= this._allocatedSlotCount) return;
      if (geometryIndex < 0 || geometryIndex >= this._palette.length) return;
      this._instanceGeometryIndices[index] = geometryIndex;
      if (this._mesh && index < this._meshInstanceCount) {
        this._mesh.setGeometryIdAt(index, geometryIndex);
      }
    }

    getInstanceGeometry(index: number): number {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return 0;
      return this._instanceGeometryIndices[index] || 0;
    }

    rebuildPalette(
      geometryTypes: string,
      modelResourceName: string,
      modelMeshNames: string
    ): void {
      this._geometryTypes = geometryTypes;
      this._modelResourceName = modelResourceName;
      this._modelMeshNames = modelMeshNames;
      gdjs.disposeInstancing3DGeometries(this._palette);
      this._palette = this._buildPalette();
      for (let index = 0; index < this._allocatedSlotCount; index++) {
        if (this._instanceGeometryIndices[index] >= this._palette.length) {
          this._instanceGeometryIndices[index] = 0;
        }
      }
      this.rebuildRenderingMesh();
    }

    setMaterialProfile(materialType: string, tint: string): void {
      if (this._materialType === materialType && this._tint === tint) return;
      this._materialType = materialType;
      this._tint = tint;
      const newMaterial = gdjs.createInstancing3DMaterial(materialType, tint);
      const oldMaterial = this._material;
      this._material = newMaterial;
      if (this._mesh) {
        this._mesh.material = newMaterial;
      }
      oldMaterial.dispose();
    }

    setFrustumCulled(frustumCulled: boolean): void {
      this._perObjectFrustumCulled = frustumCulled;
      if (this._mesh) {
        this._mesh.perObjectFrustumCulled = frustumCulled;
      }
    }

    setSortObjects(sortObjects: boolean): void {
      this._sortObjects = sortObjects;
      if (this._mesh) {
        this._mesh.sortObjects = sortObjects;
      }
    }

    setIsCastingShadow(isCastingShadow: boolean): void {
      this._isCastingShadow = isCastingShadow;
      if (this._mesh) this._mesh.castShadow = isCastingShadow;
    }

    setIsReceivingShadow(isReceivingShadow: boolean): void {
      this._isReceivingShadow = isReceivingShadow;
      if (this._mesh) this._mesh.receiveShadow = isReceivingShadow;
    }
  }
}
