// @flow
import * as PIXI from 'pixi.js-legacy';
import * as THREE from 'three';
import Rectangle from '../Utils/Rectangle';
import { type InstancesEditorSettings } from './InstancesEditorSettings';
import RenderedInstance from '../ObjectsRendering/Renderers/RenderedInstance';

/**
 * The state of a 3D camera of the scene, as used to render the scene editor
 * from the point of view of this camera.
 */
export type Camera3DPreview = {|
  x: number,
  y: number,
  z: number,
  rotationX: number,
  rotationY: number,
  angle: number,
  fieldOfView: number,
  near: number,
  far: number,
  isOrthographic: boolean,
  zoom: number,
  /** The size of the area displaying the 2D content of the layers. */
  contentWidth: number,
  contentHeight: number,
|};

type Props = {|
  initialViewX: number,
  initialViewY: number,
  width: number,
  height: number,
  instancesEditorSettings: InstancesEditorSettings,
|};

export default class ViewPosition {
  viewX: number = 0;
  viewY: number = 0;
  _width: number;
  _height: number;
  instancesEditorSettings: InstancesEditorSettings;
  _camera3DPreview: Camera3DPreview | null = null;
  // $FlowFixMe[missing-local-annot]
  _pixiContainer = (new PIXI.Container(): any);

  constructor({
    initialViewX,
    initialViewY,
    width,
    height,
    instancesEditorSettings,
  }: Props) {
    this.viewX = initialViewX;
    this.viewY = initialViewY;
    this.instancesEditorSettings = instancesEditorSettings;
    this.resize(width, height);
  }

  setInstancesEditorSettings(instancesEditorSettings: InstancesEditorSettings) {
    this.instancesEditorSettings = instancesEditorSettings;
  }

  /**
   * Set the 3D camera through which the scene is displayed, or `null` to come
   * back to the normal edition view.
   *
   * This only changes the rendering: the camera of the game is not modified.
   */
  setCamera3DPreview(camera3DPreview: Camera3DPreview | null) {
    this._camera3DPreview = camera3DPreview;
  }

  isCamera3DPreviewEnabled(): boolean {
    return !!this._camera3DPreview;
  }

  resize(width: number, height: number) {
    this._width = width;
    this._height = height;
  }

  getWidth(): any {
    return this._width;
  }

  getHeight(): any {
    return this._height;
  }

  containsPoint(x: number, y: number): any {
    const canvasPoint = this.toCanvasCoordinates(x, y);
    return (
      0 <= canvasPoint[0] &&
      canvasPoint[0] <= this._width &&
      0 <= canvasPoint[1] &&
      canvasPoint[1] <= this._height
    );
  }

  /**
   * Convert a point from the canvas coordinates (for example, the mouse position) to the
   * "world" coordinates.
   */
  toSceneCoordinates = (x: number, y: number): [number, number] => {
    x -= this._width / 2;
    y -= this._height / 2;
    x /= Math.abs(this.instancesEditorSettings.zoomFactor);
    y /= Math.abs(this.instancesEditorSettings.zoomFactor);

    var viewRotation = 0;
    var tmp = x;
    x =
      Math.cos((viewRotation / 180) * Math.PI) * x -
      Math.sin((viewRotation / 180) * Math.PI) * y;
    y =
      Math.sin((viewRotation / 180) * Math.PI) * tmp +
      Math.cos((viewRotation / 180) * Math.PI) * y;

    return [x + this.viewX, y + this.viewY];
  };

  /**
   * Convert a length from canvas referential to scene referential.
   */
  toSceneScale = (a: number): number =>
    this.instancesEditorSettings.zoomFactor === 0
      ? a
      : a / Math.abs(this.instancesEditorSettings.zoomFactor);
  /**
   * Convert a length from scene referential to canvas referential.
   */
  toCanvasScale = (a: number): number =>
    a * Math.abs(this.instancesEditorSettings.zoomFactor);

  /**
   * Convert a point from the "world" coordinates (for example, an object position) to the
   * canvas coordinates.
   */
  toCanvasCoordinates = (x: number, y: number): [number, number] => {
    x -= this.viewX;
    y -= this.viewY;

    var viewRotation = -0;
    var tmp = x;
    x =
      Math.cos((viewRotation / 180) * Math.PI) * x -
      Math.sin((viewRotation / 180) * Math.PI) * y;
    y =
      Math.sin((viewRotation / 180) * Math.PI) * tmp +
      Math.cos((viewRotation / 180) * Math.PI) * y;

    x *= Math.abs(this.instancesEditorSettings.zoomFactor);
    y *= Math.abs(this.instancesEditorSettings.zoomFactor);

    return [x + this._width / 2, y + this._height / 2];
  };

  scrollBy(x: number, y: number) {
    this.viewX += x;
    this.viewY += y;
  }

  scrollTo(x: number, y: number) {
    this.viewX = x;
    this.viewY = y;
  }

  /**
   * Moves view to the rectangle center and returns the ideal zoom
   * factor to fit to the rectangle.
   */
  fitToRectangle(rectangle: Rectangle): number {
    this.viewX = rectangle.centerX();
    this.viewY = rectangle.centerY();
    const idealZoomOnX = this._width / rectangle.width();
    const idealZoomOnY = this._height / rectangle.height();

    return Math.min(idealZoomOnX, idealZoomOnY) * 0.95; // Add margin so that the object doesn't feel cut
  }

  getViewX(): any {
    return this.viewX;
  }

  getViewY(): any {
    return this.viewY;
  }

  // $FlowFixMe[value-as-type]
  applyTransformationToPixi(container: PIXI.Container) {
    container.position.x =
      -this.viewX * this.instancesEditorSettings.zoomFactor;
    container.position.y =
      -this.viewY * this.instancesEditorSettings.zoomFactor;
    container.position.x += this._width / 2;
    container.position.y += this._height / 2;
    container.scale.x = this.instancesEditorSettings.zoomFactor;
    container.scale.y = this.instancesEditorSettings.zoomFactor;
  }

  applyTransformationToThree(
    // $FlowFixMe[value-as-type]
    threeCamera: THREE.Camera,
    // $FlowFixMe[value-as-type]
    threePlaneMesh: THREE.Mesh
  ) {
    threeCamera.aspect = this._width / this._height;

    const camera3DPreview = this._camera3DPreview;
    if (camera3DPreview) {
      // Display the scene as seen by the 3D camera, to check what the camera
      // will show when the game is played.
      // Keep in sync with the runtime: see `updatePosition` in
      // `GDJS/Runtime/pixi-renderers/layer-pixi-renderer.ts`.
      threeCamera.fov = camera3DPreview.fieldOfView;
      threeCamera.near = Math.max(camera3DPreview.near, 0.01);
      threeCamera.far = Math.max(camera3DPreview.far, threeCamera.near + 1);
      threeCamera.position.set(
        camera3DPreview.x,
        -camera3DPreview.y, // Inverted because the scene is mirrored on Y axis.
        camera3DPreview.z
      );
      threeCamera.rotation.set(
        RenderedInstance.toRad(camera3DPreview.rotationX),
        RenderedInstance.toRad(camera3DPreview.rotationY),
        -RenderedInstance.toRad(camera3DPreview.angle)
      );
      threeCamera.updateProjectionMatrix();

      // The 2D content of the layer is displayed on the plane at Z=0, like in
      // the game, so that the camera sees it where it really is.
      threePlaneMesh.visible = true;
      threePlaneMesh.scale.x = camera3DPreview.contentWidth;
      threePlaneMesh.scale.y = camera3DPreview.contentHeight;
      threePlaneMesh.position.set(camera3DPreview.x, -camera3DPreview.y, 0);
      threePlaneMesh.rotation.z = 0;
      return;
    }

    const zoomFactor = this.instancesEditorSettings.zoomFactor;

    threeCamera.position.x = this.viewX;
    threeCamera.position.y = -this.viewY; // Inverted because the scene is mirrored on Y axis.
    threeCamera.rotation.z = 0;

    // Set the camera so that it displays the whole PixiJS plane, as if it was a 2D rendering.
    // The Z position is computed by taking the half height of the displayed rendering,
    // and using the angle of the triangle defined by the field of view to compute the length
    // of the triangle defining the distance between the camera and the rendering plane.
    const cameraFovInRadians = RenderedInstance.toRad(threeCamera.fov);
    const cameraZPosition =
      (0.5 * this._height) / zoomFactor / Math.tan(0.5 * cameraFovInRadians);
    threeCamera.position.z = cameraZPosition;
    threeCamera.far = cameraZPosition + 2000;
    threeCamera.updateProjectionMatrix();

    // Adapt the plane size so that it covers the whole screen.
    threePlaneMesh.scale.x = this._width / zoomFactor;
    threePlaneMesh.scale.y = this._height / zoomFactor;
    // Adapt the plane position so that it's always displayed on the whole screen.
    threePlaneMesh.position.x = threeCamera.position.x;
    threePlaneMesh.position.y = -threeCamera.position.y; // Inverted because the scene is mirrored on Y axis.
    threePlaneMesh.rotation.z = 0;
  }
}
