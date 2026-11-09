namespace gdjs {
  const instancingColorTemporary = new THREE.Color();
  const instancingMatrixTemporary = new THREE.Matrix4();
  const instancingPositionTemporary = new THREE.Vector3();
  const instancingScaleTemporary = new THREE.Vector3();

  /**
   * Base renderer for objects that render many instances with a single draw
   * call (`InstancedMesh` and `BatchedMesh`).
   *
   * The instance data is kept in flat typed arrays and only the instances
   * changed since the last frame are sent to the GPU.
   */
  export abstract class Instancing3DRuntimeObject3DRenderer
    extends gdjs.RuntimeObject3DRenderer
  {
    protected _runtimeObject: gdjs.RuntimeObject3D;
    protected _root: THREE.Group;
    protected _layout: string;

    protected _capacity = 0;
    /** Number of allocated slots (the high-water mark). */
    protected _allocatedSlotCount = 0;
    protected _activeCount = 0;
    protected _lastAddedInstanceIndex = -1;

    protected _positions = new Float32Array(0);
    protected _rotations = new Float32Array(0);
    protected _scales = new Float32Array(0);
    protected _colors = new Float32Array(0);
    protected _activeSlots = new Uint8Array(0);
    protected _visibleSlots = new Uint8Array(0);
    protected _freeSlots: number[] = [];

    private _dirtyMatrices = new Set<number>();
    private _countDirty = false;
    private _isRenderingInitialized = false;
    private _colorsDirtyFirst = -1;
    private _colorsDirtyLast = -1;

    constructor(
      runtimeObject: gdjs.RuntimeObject3D,
      instanceContainer: gdjs.RuntimeInstanceContainer,
      initialInstanceCount: number,
      initialLayout: string
    ) {
      const root = new THREE.Group();
      super(runtimeObject, instanceContainer, root);
      this._runtimeObject = runtimeObject;
      this._root = root;
      this._layout = initialLayout || 'Grid';

      const instanceCount = Math.max(
        1,
        Math.min(1000000, Math.floor(initialInstanceCount || 1))
      );
      this._ensureCapacity(instanceCount);
      this._allocatedSlotCount = instanceCount;
      for (let index = 0; index < instanceCount; index++) {
        this._initializeSlot(index, instanceCount);
        this._activeSlots[index] = 1;
        this._dirtyMatrices.add(index);
      }
      this._activeCount = instanceCount;
      this._colorsDirtyFirst = 0;
      this._colorsDirtyLast = instanceCount - 1;
      this._countDirty = true;

      this.updateSize();
      this.updatePosition();
      this.updateRotation();
    }

    private _initializeSlot(index: number, instanceCount: number): void {
      gdjs.getInstancing3DInitialLayout(
        this._layout,
        index,
        instanceCount,
        instancingPositionTemporary,
        instancingScaleTemporary
      );
      this._positions[index * 3] = instancingPositionTemporary.x;
      this._positions[index * 3 + 1] = instancingPositionTemporary.y;
      this._positions[index * 3 + 2] = instancingPositionTemporary.z;
      this._rotations[index * 3] = 0;
      this._rotations[index * 3 + 1] = 0;
      this._rotations[index * 3 + 2] = 0;
      this._scales[index * 3] = instancingScaleTemporary.x;
      this._scales[index * 3 + 1] = instancingScaleTemporary.y;
      this._scales[index * 3 + 2] = instancingScaleTemporary.z;
      this._colors[index * 3] = 1;
      this._colors[index * 3 + 1] = 1;
      this._colors[index * 3 + 2] = 1;
      this._visibleSlots[index] = 1;
    }

    private _ensureCapacity(capacity: number): void {
      if (capacity <= this._capacity) return;
      let newCapacity = Math.max(64, capacity);
      if (this._capacity > 0) {
        newCapacity = Math.max(newCapacity, this._capacity * 2);
      }
      const growFloatArray = (array: Float32Array, itemSize: number) => {
        const newArray = new Float32Array(newCapacity * itemSize);
        newArray.set(array);
        return newArray;
      };
      const growByteArray = (array: Uint8Array) => {
        const newArray = new Uint8Array(newCapacity);
        newArray.set(array);
        return newArray;
      };
      this._positions = growFloatArray(this._positions, 3);
      this._rotations = growFloatArray(this._rotations, 3);
      this._scales = growFloatArray(this._scales, 3);
      this._colors = growFloatArray(this._colors, 3);
      this._activeSlots = growByteArray(this._activeSlots);
      this._visibleSlots = growByteArray(this._visibleSlots);
      this._capacity = newCapacity;
      if (this._isRenderingInitialized) {
        this.rebuildRenderingMesh();
      }
    }

    /**
     * Called when the initial slot data is ready: build the Three.js mesh and
     * send the first frame of instance data.
     */
    protected initializeRenderingMesh(): void {
      this._isRenderingInitialized = true;
      this.rebuildRenderingMesh();
      this.update();
    }

    /**
     * Create the underlying `THREE.InstancedMesh` or `THREE.BatchedMesh` with
     * the current capacity and write the current instance data.
     */
    protected abstract rebuildRenderingMesh(): void;

    protected abstract writeMatrix(index: number, matrix: THREE.Matrix4): void;

    protected abstract writeColor(index: number, color: THREE.Color): void;

    protected abstract writeVisibility(index: number, visible: boolean): void;

    protected abstract commitDirtyMatrices(
      firstIndex: number,
      lastIndex: number
    ): void;

    protected abstract commitDirtyColors(
      firstIndex: number,
      lastIndex: number
    ): void;

    protected abstract onInstanceCountChanged(): void;

    protected abstract onInstanceAdded(index: number): void;

    protected abstract onInstanceRemoved(index: number): void;

    protected abstract onAllInstancesCleared(): void;

    protected abstract disposeRenderingMesh(): void;

    getInstanceCount(): number {
      return this._activeCount;
    }

    getLastAddedInstanceIndex(): number {
      return this._lastAddedInstanceIndex;
    }

    isInstanceActive(index: number): boolean {
      index = Math.floor(index);
      return (
        index >= 0 &&
        index < this._allocatedSlotCount &&
        this._activeSlots[index] === 1
      );
    }

    isInstanceVisible(index: number): boolean {
      index = Math.floor(index);
      return (
        index >= 0 &&
        index < this._allocatedSlotCount &&
        this._activeSlots[index] === 1 &&
        this._visibleSlots[index] === 1
      );
    }

    addInstance(x: number, y: number, z: number): number {
      let index: number;
      if (this._freeSlots.length > 0) {
        index = this._freeSlots.pop() as number;
      } else {
        index = this._allocatedSlotCount;
        this._ensureCapacity(index + 1);
        this._allocatedSlotCount = index + 1;
        this._initializeSlot(index, this._allocatedSlotCount);
        this.onInstanceAdded(index);
      }
      this._activeSlots[index] = 1;
      this._visibleSlots[index] = 1;
      this._activeCount++;
      this._lastAddedInstanceIndex = index;
      this._dirtyMatrices.add(index);
      this._countDirty = true;
      this._colorsDirtyFirst =
        this._colorsDirtyFirst < 0
          ? index
          : Math.min(this._colorsDirtyFirst, index);
      this._colorsDirtyLast = Math.max(this._colorsDirtyLast, index);
      this.setInstancePosition(index, x, y, z);
      return index;
    }

    removeInstance(index: number): void {
      index = Math.floor(index);
      if (!this.isInstanceActive(index)) return;
      this._activeSlots[index] = 0;
      this._visibleSlots[index] = 1;
      this._activeCount--;
      this._freeSlots.push(index);
      this._dirtyMatrices.add(index);
      this.onInstanceRemoved(index);
      this._countDirty = true;
    }

    clearInstances(): void {
      for (let index = 0; index < this._allocatedSlotCount; index++) {
        this._activeSlots[index] = 0;
      }
      this._activeCount = 0;
      this._lastAddedInstanceIndex = -1;
      this._freeSlots.length = 0;
      this._allocatedSlotCount = 0;
      this._colorsDirtyFirst = -1;
      this._colorsDirtyLast = -1;
      this._dirtyMatrices.clear();
      this._countDirty = true;
      this.onAllInstancesCleared();
    }

    setInstanceCount(count: number): void {
      const targetCount = Math.max(
        0,
        Math.min(1000000, Math.floor(count || 0))
      );
      let indexToRemove = this._allocatedSlotCount - 1;
      while (this._activeCount > targetCount && indexToRemove >= 0) {
        if (this._activeSlots[indexToRemove] === 1) {
          this.removeInstance(indexToRemove);
        }
        indexToRemove--;
      }
      while (this._activeCount < targetCount) {
        if (this._freeSlots.length > 0) {
          const index = this._freeSlots.pop() as number;
          this._activeSlots[index] = 1;
          this._visibleSlots[index] = 1;
          this._activeCount++;
          this._lastAddedInstanceIndex = index;
          this._dirtyMatrices.add(index);
          this.onInstanceAdded(index);
          this._countDirty = true;
        } else {
          // Add the missing instances at the center of the object box.
          this.addInstance(
            this._runtimeObject.getX() + this._runtimeObject.getWidth() / 2,
            this._runtimeObject.getY() + this._runtimeObject.getHeight() / 2,
            this._runtimeObject.getZ() + this._runtimeObject.getDepth() / 2
          );
        }
      }
    }

    resetInstancesLayout(): void {
      for (let index = 0; index < this._allocatedSlotCount; index++) {
        gdjs.getInstancing3DInitialLayout(
          this._layout,
          index,
          this._allocatedSlotCount,
          instancingPositionTemporary,
          instancingScaleTemporary
        );
        this._positions[index * 3] = instancingPositionTemporary.x;
        this._positions[index * 3 + 1] = instancingPositionTemporary.y;
        this._positions[index * 3 + 2] = instancingPositionTemporary.z;
        this._scales[index * 3] = instancingScaleTemporary.x;
        this._scales[index * 3 + 1] = instancingScaleTemporary.y;
        this._scales[index * 3 + 2] = instancingScaleTemporary.z;
        this._dirtyMatrices.add(index);
      }
    }

    setLayout(layout: string): void {
      if (this._layout === layout) return;
      this._layout = layout;
      this.resetInstancesLayout();
    }

    private _sceneXToNormalizedX(x: number): number {
      const width = this._runtimeObject.getWidth();
      return width === 0 ? 0.5 : (x - this._runtimeObject.getX()) / width;
    }

    private _sceneYToNormalizedY(y: number): number {
      const height = this._runtimeObject.getHeight();
      return height === 0 ? 0.5 : (y - this._runtimeObject.getY()) / height;
    }

    private _sceneZToNormalizedZ(z: number): number {
      const depth = this._runtimeObject.getDepth();
      return depth === 0 ? 0.5 : (z - this._runtimeObject.getZ()) / depth;
    }

    setInstancePosition(index: number, x: number, y: number, z: number): void {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return;
      this._positions[index * 3] = this._sceneXToNormalizedX(x);
      this._positions[index * 3 + 1] = this._sceneYToNormalizedY(y);
      this._positions[index * 3 + 2] = this._sceneZToNormalizedZ(z);
      this._dirtyMatrices.add(index);
    }

    setInstanceRotation(
      index: number,
      rotationX: number,
      rotationY: number,
      rotationZ: number
    ): void {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return;
      this._rotations[index * 3] = rotationX || 0;
      this._rotations[index * 3 + 1] = rotationY || 0;
      this._rotations[index * 3 + 2] = rotationZ || 0;
      this._dirtyMatrices.add(index);
    }

    setInstanceScale(
      index: number,
      scaleX: number,
      scaleY: number,
      scaleZ: number
    ): void {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return;
      this._scales[index * 3] = scaleX === undefined ? 1 : scaleX;
      this._scales[index * 3 + 1] = scaleY === undefined ? 1 : scaleY;
      this._scales[index * 3 + 2] = scaleZ === undefined ? 1 : scaleZ;
      this._dirtyMatrices.add(index);
    }

    setInstanceColor(index: number, color: string): void {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return;
      gdjs.setInstancing3DColorFromString(instancingColorTemporary, color);
      this._colors[index * 3] = instancingColorTemporary.r;
      this._colors[index * 3 + 1] = instancingColorTemporary.g;
      this._colors[index * 3 + 2] = instancingColorTemporary.b;
      this._colorsDirtyFirst =
        this._colorsDirtyFirst < 0
          ? index
          : Math.min(this._colorsDirtyFirst, index);
      this._colorsDirtyLast = Math.max(this._colorsDirtyLast, index);
    }

    setInstanceVisible(index: number, visible: boolean): void {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return;
      this._visibleSlots[index] = visible ? 1 : 0;
      this._dirtyMatrices.add(index);
    }

    getInstanceX(index: number): number {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return 0;
      return (
        this._runtimeObject.getX() +
        this._positions[index * 3] * this._runtimeObject.getWidth()
      );
    }

    getInstanceY(index: number): number {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return 0;
      return (
        this._runtimeObject.getY() +
        this._positions[index * 3 + 1] * this._runtimeObject.getHeight()
      );
    }

    getInstanceZ(index: number): number {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return 0;
      return (
        this._runtimeObject.getZ() +
        this._positions[index * 3 + 2] * this._runtimeObject.getDepth()
      );
    }

    getInstanceRotationX(index: number): number {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return 0;
      return this._rotations[index * 3];
    }

    getInstanceRotationY(index: number): number {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return 0;
      return this._rotations[index * 3 + 1];
    }

    getInstanceRotationZ(index: number): number {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return 0;
      return this._rotations[index * 3 + 2];
    }

    getInstanceScaleX(index: number): number {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return 0;
      return this._scales[index * 3];
    }

    getInstanceScaleY(index: number): number {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return 0;
      return this._scales[index * 3 + 1];
    }

    getInstanceScaleZ(index: number): number {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) return 0;
      return this._scales[index * 3 + 2];
    }

    getInstanceColor(index: number): string {
      index = Math.floor(index);
      if (index < 0 || index >= this._allocatedSlotCount) {
        return '255;255;255';
      }
      return gdjs.getInstancing3DColorString(
        this._colors[index * 3],
        this._colors[index * 3 + 1],
        this._colors[index * 3 + 2]
      );
    }

    /**
     * Apply the pending instance changes. Called once per frame by the runtime
     * object.
     */
    update(): void {
      if (!this._isRenderingInitialized) return;
      if (this._dirtyMatrices.size > 0) {
        let firstIndex = -1;
        let lastIndex = -1;
        for (const index of this._dirtyMatrices) {
          if (
            index < this._allocatedSlotCount &&
            this._activeSlots[index] === 1 &&
            this._visibleSlots[index] === 1
          ) {
            gdjs.composeInstancing3DMatrix(
              instancingMatrixTemporary,
              this._positions[index * 3],
              this._positions[index * 3 + 1],
              this._positions[index * 3 + 2],
              this._rotations[index * 3],
              this._rotations[index * 3 + 1],
              this._rotations[index * 3 + 2],
              this._scales[index * 3],
              this._scales[index * 3 + 1],
              this._scales[index * 3 + 2]
            );
            this.writeMatrix(index, instancingMatrixTemporary);
          } else {
            instancingMatrixTemporary.makeScale(0, 0, 0);
            this.writeMatrix(index, instancingMatrixTemporary);
          }
          this.writeVisibility(
            index,
            this._activeSlots[index] === 1 && this._visibleSlots[index] === 1
          );
          if (firstIndex < 0 || index < firstIndex) firstIndex = index;
          if (index > lastIndex) lastIndex = index;
        }
        this._dirtyMatrices.clear();
        if (firstIndex >= 0) {
          this.commitDirtyMatrices(firstIndex, lastIndex);
        }
      }
      if (this._colorsDirtyFirst >= 0) {
        const firstIndex = this._colorsDirtyFirst;
        const lastIndex = Math.min(
          this._colorsDirtyLast,
          this._allocatedSlotCount - 1
        );
        for (let index = firstIndex; index <= lastIndex; index++) {
          instancingColorTemporary.setRGB(
            this._colors[index * 3],
            this._colors[index * 3 + 1],
            this._colors[index * 3 + 2]
          );
          this.writeColor(index, instancingColorTemporary);
        }
        this.commitDirtyColors(firstIndex, lastIndex);
        this._colorsDirtyFirst = -1;
        this._colorsDirtyLast = -1;
      }
      if (this._countDirty) {
        this.onInstanceCountChanged();
        this._countDirty = false;
      }
    }

    dispose(): void {
      this.disposeRenderingMesh();
      this._root.removeFromParent();
      this._root.clear();
      this._freeSlots.length = 0;
    }

    protected writeInitialInstanceData(
      writeMatrix: (index: number, matrix: THREE.Matrix4) => void,
      writeColor: (index: number, color: THREE.Color) => void
    ): void {
      for (let index = 0; index < this._allocatedSlotCount; index++) {
        if (this._activeSlots[index] === 1 && this._visibleSlots[index] === 1) {
          gdjs.composeInstancing3DMatrix(
            instancingMatrixTemporary,
            this._positions[index * 3],
            this._positions[index * 3 + 1],
            this._positions[index * 3 + 2],
            this._rotations[index * 3],
            this._rotations[index * 3 + 1],
            this._rotations[index * 3 + 2],
            this._scales[index * 3],
            this._scales[index * 3 + 1],
            this._scales[index * 3 + 2]
          );
        } else {
          instancingMatrixTemporary.makeScale(0, 0, 0);
        }
        writeMatrix(index, instancingMatrixTemporary);
        instancingColorTemporary.setRGB(
          this._colors[index * 3],
          this._colors[index * 3 + 1],
          this._colors[index * 3 + 2]
        );
        writeColor(index, instancingColorTemporary);
      }
    }
  }
}
