/*
 * GDevelop JS Platform
 * Copyright 2013-2016 Florian Rival (Florian.Rival@gmail.com). All rights reserved.
 * This project is released under the MIT License.
 */
namespace gdjs {
  /**
   * Return the shortest signed difference, in degrees, to go from `from` to
   * `to` (in the range [-180, 180]).
   */
  const getShortestAngleDifference = (from: float, to: float): float => {
    let difference = (to - from) % 360;
    if (difference > 180) difference -= 360;
    if (difference < -180) difference += 360;
    return difference;
  };

  /** @category Core Engine > Layers */
  export type LayerCameraData = {
    x?: float;
    y?: float;
    z?: float;
    zoom?: float;
    rotation?: float;
    rotationX?: float;
    rotationY?: float;
    fov?: float;
    near?: float;
    far?: float;
    isZDirty?: boolean;
  };

  /**
   * The state of a camera of a layer.
   *
   * A layer can hold several cameras (see `gdjs.Layer.addCamera`), but only
   * its active camera is rendered and used by the 2D/3D coordinate
   * conversions. `cameraId` 0 always designates the active camera.
   *
   * @category Core Engine > Layers
   */
  export class LayerCamera {
    /** Position of the camera center on the X axis, in scene coordinates. */
    x: float = 0;
    /** Position of the camera center on the Y axis, in scene coordinates. */
    y: float = 0;
    /**
     * Position of the camera on the Z axis, in scene coordinates.
     *
     * For a 2D layer, it's the distance between the camera and the plane where
     * the 2D rendering is done. For a 3D layer, it's the "elevation" of the
     * camera.
     */
    z: float = 0;
    /** The camera zoom factor, strictly greater than 0. */
    zoom: float = 1;
    /** Rotation around the Z axis, in degrees. */
    rotation: float = 0;
    /** Rotation around the X axis (3D), in degrees. */
    rotationX: float = 0;
    /** Rotation around the Y axis (3D), in degrees. */
    rotationY: float = 0;
    /** Vertical field of view of the 3D camera, in degrees. */
    fov: float = 45;
    /** Distance of the near plane of the 3D camera, in scene units. */
    near: float = 0.1;
    /** Distance of the far plane of the 3D camera, in scene units. */
    far: float = 2000;
    /**
     * True when `z` is derived from `zoom` (the zoom was set after the Z
     * position, or the Z position was never set).
     */
    isZDirty: boolean = true;

    constructor(data?: LayerCameraData) {
      if (data) this.copyFrom(data);
    }

    /**
     * Copy the values of a camera state (or of a subset of it).
     */
    copyFrom(data: LayerCameraData): void {
      if (data.x !== undefined) this.x = data.x;
      if (data.y !== undefined) this.y = data.y;
      if (data.z !== undefined) this.z = data.z;
      if (data.zoom !== undefined) {
        this.zoom = data.zoom > 0 ? data.zoom : this.zoom;
      }
      if (data.rotation !== undefined) this.rotation = data.rotation;
      if (data.rotationX !== undefined) this.rotationX = data.rotationX;
      if (data.rotationY !== undefined) this.rotationY = data.rotationY;
      if (data.fov !== undefined) this.fov = data.fov;
      if (data.near !== undefined) this.near = data.near;
      if (data.far !== undefined) this.far = data.far;
      if (data.isZDirty !== undefined) this.isZDirty = data.isZDirty;
    }

    clone(): LayerCamera {
      return new LayerCamera(this);
    }

    /**
     * Return true if the two cameras are in the same state (within `epsilon`).
     */
    equals(other: LayerCamera, epsilon: float = 1e-6): boolean {
      return (
        Math.abs(this.x - other.x) <= epsilon &&
        Math.abs(this.y - other.y) <= epsilon &&
        Math.abs(this.z - other.z) <= epsilon &&
        Math.abs(this.zoom - other.zoom) <= epsilon &&
        Math.abs(this.rotation - other.rotation) <= epsilon &&
        Math.abs(this.rotationX - other.rotationX) <= epsilon &&
        Math.abs(this.rotationY - other.rotationY) <= epsilon &&
        Math.abs(this.fov - other.fov) <= epsilon &&
        Math.abs(this.near - other.near) <= epsilon &&
        Math.abs(this.far - other.far) <= epsilon &&
        this.isZDirty === other.isZDirty
      );
    }

    /**
     * Interpolate a camera state between two states.
     *
     * Rotations are interpolated on the shortest path and the Z position is
     * kept explicit (it's interpolated, not derived from the zoom).
     *
     * @param from The state to start from.
     * @param to The state to reach.
     * @param ratio The ratio of the interpolation, from 0 to 1.
     * @param result The camera state to update with the result.
     */
    static interpolate(
      from: LayerCamera,
      to: LayerCamera,
      ratio: float,
      result: LayerCamera
    ): LayerCamera {
      result.x = from.x + (to.x - from.x) * ratio;
      result.y = from.y + (to.y - from.y) * ratio;
      result.z = from.z + (to.z - from.z) * ratio;
      result.zoom = from.zoom + (to.zoom - from.zoom) * ratio;
      result.rotation =
        from.rotation +
        getShortestAngleDifference(from.rotation, to.rotation) * ratio;
      result.rotationX =
        from.rotationX +
        getShortestAngleDifference(from.rotationX, to.rotationX) * ratio;
      result.rotationY =
        from.rotationY +
        getShortestAngleDifference(from.rotationY, to.rotationY) * ratio;
      result.fov = from.fov + (to.fov - from.fov) * ratio;
      result.near = from.near + (to.near - from.near) * ratio;
      result.far = from.far + (to.far - from.far) * ratio;
      result.isZDirty = false;
      return result;
    }
  }
}
