namespace gdjs {
  /**
   * Renderer of {@link gdjs.InstancedMesh3DRuntimeObject}.
   *
   * All the instances are rendered with a single `THREE.InstancedMesh`, so
   * changing an instance only uploads the matrix (and color) of this instance
   * to the GPU.
   */
  export class InstancedMesh3DRuntimeObject3DRenderer
    extends gdjs.Instancing3DRuntimeObject3DRenderer
  {
    private _mesh: THREE.InstancedMesh | null = null;
    private _geometry: THREE.BufferGeometry;
    private _material: THREE.Material;
    private _materialType: string;
    private _tint: string;
    private _frustumCulled = false;
    private _isCastingShadow = true;
    private _isReceivingShadow = true;
    private _dirtyMatrixFirst = -1;
    private _dirtyMatrixLast = -1;

    constructor(
      runtimeObject: gdjs.InstancedMesh3DRuntimeObject,
      instanceContainer: gdjs.RuntimeInstanceContainer,
      objectData: gdjs.InstancedMesh3DObjectData
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
      this._frustumCulled = objectData.content.frustumCulled || false;
      this._isCastingShadow =
        objectData.content.isCastingShadow === undefined
          ? true
          : objectData.content.isCastingShadow;
      this._isReceivingShadow =
        objectData.content.isReceivingShadow === undefined
          ? true
          : objectData.content.isReceivingShadow;
      this._geometry = this._createGeometry(
        objectData.content.geometryType,
        objectData.content.modelResourceName,
        objectData.content.modelMeshName
      );
      this._material = gdjs.createInstancing3DMaterial(
        this._materialType,
        this._tint
      );
      this.initializeRenderingMesh();
    }

    private _createGeometry(
      geometryType: string | undefined,
      modelResourceName: string | undefined,
      modelMeshName: string | undefined
    ): THREE.BufferGeometry {
      if (
        geometryType &&
        geometryType.trim().toLowerCase() === 'model' &&
        modelResourceName
      ) {
        const model = this._runtimeObject
          .getInstanceContainer()
          .getGame()
          .getModel3DManager()
          .getModel(modelResourceName);
        const meshNames = gdjs.parseInstancing3DMeshNames(modelMeshName);
        const geometries = gdjs.extractInstancing3DModelGeometries(
          model,
          meshNames
        );
        if (geometries.length > 0) {
          // Only the first matching mesh is used by an InstancedMesh.
          for (let i = 1; i < geometries.length; i++) {
            geometries[i].geometry.dispose();
          }
          return geometries[0].geometry;
        }
      }
      const primitiveName =
        gdjs.getInstancing3DPrimitiveName(geometryType || '') || 'Box';
      return gdjs.createInstancing3DPrimitiveGeometry(primitiveName);
    }

    protected rebuildRenderingMesh(): void {
      if (this._mesh) {
        this._mesh.removeFromParent();
        this._mesh.dispose();
        this._mesh = null;
      }
      const capacity = Math.max(1, this._capacity);
      const mesh = new THREE.InstancedMesh(
        this._geometry,
        this._material,
        capacity
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(capacity * 3).fill(1),
        3
      );
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = this._allocatedSlotCount;
      mesh.castShadow = this._isCastingShadow;
      mesh.receiveShadow = this._isReceivingShadow;
      mesh.frustumCulled = this._frustumCulled;
      this._mesh = mesh;
      this._root.add(mesh);
      this._dirtyMatrixFirst = -1;
      this._dirtyMatrixLast = -1;
      // Fill the buffers once: they will then only be partially updated.
      const instanceMatrix = mesh.instanceMatrix;
      const instanceColor = mesh.instanceColor;
      this.writeInitialInstanceData(
        (index, matrix) => mesh.setMatrixAt(index, matrix),
        (index, color) => mesh.setColorAt(index, color)
      );
      instanceMatrix.needsUpdate = true;
      instanceColor.needsUpdate = true;
    }

    protected writeMatrix(index: number, matrix: THREE.Matrix4): void {
      if (!this._mesh) return;
      this._mesh.setMatrixAt(index, matrix);
      if (this._dirtyMatrixFirst < 0 || index < this._dirtyMatrixFirst) {
        this._dirtyMatrixFirst = index;
      }
      if (index > this._dirtyMatrixLast) {
        this._dirtyMatrixLast = index;
      }
    }

    protected writeColor(index: number, color: THREE.Color): void {
      if (!this._mesh) return;
      this._mesh.setColorAt(index, color);
    }

    protected writeVisibility(index: number, visible: boolean): void {
      // An InstancedMesh has no per-instance visibility flag: invisible
      // instances are given a zero scale matrix in `update`.
    }

    protected commitDirtyMatrices(firstIndex: number, lastIndex: number): void {
      if (!this._mesh) return;
      const instanceMatrix = this._mesh.instanceMatrix;
      instanceMatrix.addUpdateRange(
        firstIndex * 16,
        (lastIndex - firstIndex + 1) * 16
      );
      instanceMatrix.needsUpdate = true;
      if (this._frustumCulled) {
        this._mesh.computeBoundingSphere();
      }
    }

    protected commitDirtyColors(firstIndex: number, lastIndex: number): void {
      if (!this._mesh || !this._mesh.instanceColor) return;
      const instanceColor = this._mesh.instanceColor;
      instanceColor.addUpdateRange(
        firstIndex * 3,
        (lastIndex - firstIndex + 1) * 3
      );
      instanceColor.needsUpdate = true;
    }

    protected onInstanceCountChanged(): void {
      if (this._mesh) {
        this._mesh.count = this._allocatedSlotCount;
      }
    }

    protected onInstanceAdded(index: number): void {
      // Nothing to allocate: the instance buffers were sized for the capacity.
    }

    protected onInstanceRemoved(index: number): void {
      // The matrix is hidden with a zero scale in `update`.
    }

    protected onAllInstancesCleared(): void {
      if (this._mesh) {
        this._mesh.count = 0;
      }
    }

    protected disposeRenderingMesh(): void {
      if (this._mesh) {
        this._mesh.removeFromParent();
        this._mesh.dispose();
        this._mesh = null;
      }
      this._geometry.dispose();
      this._material.dispose();
    }

    rebuildGeometry(
      geometryType: string,
      modelResourceName: string,
      modelMeshName: string
    ): void {
      const newGeometry = this._createGeometry(
        geometryType,
        modelResourceName,
        modelMeshName
      );
      const oldGeometry = this._geometry;
      this._geometry = newGeometry;
      if (this._mesh) {
        this._mesh.geometry = newGeometry;
        this._mesh.computeBoundingSphere();
      }
      oldGeometry.dispose();
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
      this._frustumCulled = frustumCulled;
      if (this._mesh) {
        this._mesh.frustumCulled = frustumCulled;
        if (frustumCulled) this._mesh.computeBoundingSphere();
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
