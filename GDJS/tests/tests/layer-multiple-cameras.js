/**
 * Common tests for gdjs game engine.
 * See README.md for more information.
 */

describe('gdjs.Layer with multiple cameras', () => {
  const runtimeGame = gdjs.getPixiRuntimeGame();

  /**
   * @param {'2d' | '3d' | '2d+3d'} renderingType
   * @param {'perspective' | 'orthographic'} [cameraType]
   */
  const makeSceneWithLayer = (renderingType, cameraType = 'perspective') => {
    const runtimeScene = new gdjs.RuntimeScene(runtimeGame);
    runtimeScene.addLayer({
      name: '',
      renderingType,
      cameraType,
      visibility: true,
      cameras: [],
      effects: [],
      ambientLightColorR: 0,
      ambientLightColorG: 0,
      ambientLightColorB: 0,
      isLightingLayer: false,
      followBaseLayerCamera: false,
    });
    return { runtimeScene, layer: runtimeScene.getLayer('') };
  };

  it('starts with a single camera, which is the active one', () => {
    const { layer } = makeSceneWithLayer('2d');

    expect(layer.getCameraCount()).to.be(1);
    expect(layer.getActiveCameraIndex()).to.be(0);
    expect(layer.getCamera()).to.be(layer.getActiveCamera());
  });

  it('adds a camera starting from the active camera state', () => {
    const { layer } = makeSceneWithLayer('2d');
    layer.setCameraX(120);
    layer.setCameraY(340);
    layer.setCameraZoom(2);

    const newCameraId = layer.addCamera();

    expect(newCameraId).to.be(1);
    expect(layer.getCameraCount()).to.be(2);
    expect(layer.getCameraX(1)).to.be(120);
    expect(layer.getCameraY(1)).to.be(340);
    expect(layer.getCameraZoom(1)).to.be(2);
    // The new camera is not used for rendering.
    expect(layer.getActiveCameraIndex()).to.be(0);
  });

  it('keeps the cameras independent', () => {
    const { layer } = makeSceneWithLayer('2d');
    layer.setCameraX(100);
    layer.setCameraY(200);
    layer.addCamera();

    layer.setCameraX(500, 1);
    layer.setCameraY(600, 1);
    layer.setCameraZoom(3, 1);
    layer.setCameraRotation(45, 1);

    // Camera 0 is the active camera, so it's still the first one.
    expect(layer.getCameraX()).to.be(100);
    expect(layer.getCameraY()).to.be(200);
    expect(layer.getCameraZoom()).to.be(1);
    expect(layer.getCameraRotation()).to.be(0);

    expect(layer.getCameraX(1)).to.be(500);
    expect(layer.getCameraY(1)).to.be(600);
    expect(layer.getCameraZoom(1)).to.be(3);
    expect(layer.getCameraRotation(1)).to.be(45);
  });

  it('renders the active camera', () => {
    const { layer } = makeSceneWithLayer('3d');
    const threeCamera = layer.getRenderer().getThreeCamera();
    expect(threeCamera).to.not.be(null);

    layer.addCamera();
    layer.setCameraX(700, 1);
    layer.setCameraY(800, 1);
    layer.setCameraZ(900, 45, 1);
    layer.setCameraRotation(30, 1);
    layer.setCameraRotationX(10, 1);
    layer.setCameraRotationY(20, 1);

    // The camera 1 has no effect while it's not the active one: the
    // initial camera is at the center of the viewport (400 in scene units,
    // scaled by 1/100 for the Three.js camera).
    expect(threeCamera.position.x).to.be.within(3.999, 4.001);

    layer.setActiveCamera(1);

    expect(layer.getActiveCameraIndex()).to.be(1);
    // Camera 0 always designates the active camera.
    expect(layer.getCameraX()).to.be(700);
    expect(layer.getCameraX(0)).to.be(700);
    expect(layer.getCameraY()).to.be(800);
    expect(threeCamera.position.x).to.be.within(
      (700 * 1) / 100 - 0.001,
      (700 * 1) / 100 + 0.001
    );
    expect(threeCamera.position.y).to.be.within(
      (-800 * 1) / 100 - 0.001,
      (-800 * 1) / 100 + 0.001
    );
    expect(threeCamera.rotation.z).to.be.within(
      gdjs.toRad(-30) - 0.0001,
      gdjs.toRad(-30) + 0.0001
    );
    expect(threeCamera.rotation.x).to.be.within(
      gdjs.toRad(10) - 0.0001,
      gdjs.toRad(10) + 0.0001
    );
    expect(threeCamera.rotation.y).to.be.within(
      gdjs.toRad(20) - 0.0001,
      gdjs.toRad(20) + 0.0001
    );
  });

  it('has a field of view and planes for each camera', () => {
    const { layer } = makeSceneWithLayer('3d');

    expect(layer.getCamera3DFieldOfView()).to.be(45);
    expect(layer.getCamera3DNearPlaneDistance()).to.be(0.1);
    expect(layer.getCamera3DFarPlaneDistance()).to.be(2000);

    layer.addCamera();
    layer.setCamera3DFieldOfView(70, 1);
    layer.setCamera3DNearPlaneDistance(5, 1);
    layer.setCamera3DFarPlaneDistance(500, 1);

    // The active camera is unchanged.
    expect(layer.getCamera3DFieldOfView()).to.be(45);

    layer.setActiveCamera(1);

    expect(layer.getCamera3DFieldOfView()).to.be(70);
    expect(layer.getCamera3DNearPlaneDistance()).to.be(5);
    expect(layer.getCamera3DFarPlaneDistance()).to.be(500);
    // The Three.js camera is in the units of the scene, which are scaled.
    expect(layer.getRenderer().getThreeCamera().fov).to.be(70);
    expect(layer.getRenderer().getThreeCamera().near).to.be.within(
      0.0499,
      0.0501
    );
  });

  it('converts coordinates with the given camera', () => {
    const { layer } = makeSceneWithLayer('2d');
    layer.setCameraX(100);
    layer.setCameraY(200);
    layer.addCamera();
    layer.setCameraX(1000, 1);
    layer.setCameraY(2000, 1);

    // The center of the screen is the camera position.
    const [activeX, activeY] = layer.convertCoords(
      layer.getWidth() / 2,
      layer.getHeight() / 2,
      0,
      [0, 0]
    );
    const [otherX, otherY] = layer.convertCoords(
      layer.getWidth() / 2,
      layer.getHeight() / 2,
      1,
      [0, 0]
    );

    expect(activeX).to.be.within(99.99, 100.01);
    expect(activeY).to.be.within(199.99, 200.01);
    expect(otherX).to.be.within(999.99, 1000.01);
    expect(otherY).to.be.within(1999.99, 2000.01);
  });

  it('uses the active camera for an unknown camera number', () => {
    const { layer } = makeSceneWithLayer('2d');
    layer.setCameraX(150);

    expect(layer.getCameraX(12)).to.be(150);
    expect(layer.getCameraX(-1)).to.be(150);
  });

  it('copies a camera state into the active camera', () => {
    const { layer } = makeSceneWithLayer('3d');
    const state = new gdjs.LayerCamera({
      x: 42,
      y: 43,
      z: 400,
      zoom: 2,
      rotation: 15,
      rotationX: 5,
      rotationY: 6,
      fov: 60,
      near: 1,
      far: 100,
      isZDirty: false,
    });

    layer.applyCameraState(state);

    expect(layer.getCameraX()).to.be(42);
    expect(layer.getCameraY()).to.be(43);
    expect(layer.getCameraZ(60)).to.be(400);
    expect(layer.getCameraZoom()).to.be(2);
    expect(layer.getCameraRotation()).to.be(15);
    expect(layer.getCameraRotationX()).to.be(5);
    expect(layer.getCameraRotationY()).to.be(6);
    expect(layer.getCamera3DFieldOfView()).to.be(60);
    expect(layer.getRenderer().getThreeCamera().position.x).to.be.within(
      0.4199,
      0.4201
    );
  });

  it('interpolates camera states', () => {
    const from = new gdjs.LayerCamera({
      x: 0,
      y: 0,
      z: 100,
      zoom: 1,
      rotation: 350,
      fov: 45,
      near: 0.1,
      far: 1000,
    });
    const to = new gdjs.LayerCamera({
      x: 100,
      y: 200,
      z: 300,
      zoom: 2,
      rotation: 10,
      fov: 65,
      near: 0.2,
      far: 2000,
    });

    const result = gdjs.LayerCamera.interpolate(
      from,
      to,
      0.5,
      new gdjs.LayerCamera()
    );

    expect(result.x).to.be(50);
    expect(result.y).to.be(100);
    expect(result.z).to.be(200);
    expect(result.zoom).to.be(1.5);
    // The rotation goes through 360 (the shortest path, 350 -> 10).
    expect(result.rotation).to.be.within(359.999, 360.001);
    expect(result.fov).to.be(55);
    expect(result.near).to.be.within(0.1499, 0.1501);
    expect(result.far).to.be(1500);
    // The interpolated Z position is explicit.
    expect(result.isZDirty).to.be(false);
  });

  it('sets the size of a camera', () => {
    const { layer } = makeSceneWithLayer('2d');
    layer.addCamera();

    layer.setCameraSize(1000, 400, 1);

    expect(layer.getCameraWidth(1)).to.be(1000);
    expect(layer.getCameraHeight(1)).to.be(400);
    // The zoom is derived from the size so that the renderer shows the
    // requested area.
    expect(layer.getCameraZoom(1)).to.be.within(0.7999, 0.8001);
    // The active camera is not changed.
    expect(layer.getCameraWidth()).to.be(layer.getWidth());
  });

  it('sets the viewport of a camera', () => {
    const { layer } = makeSceneWithLayer('2d');
    layer.addCamera();

    layer.setCameraViewport(0, 0, 0.5, 1, 1);

    expect(layer.getCameraViewportLeft(1)).to.be(0);
    expect(layer.getCameraViewportTop(1)).to.be(0);
    expect(layer.getCameraViewportRight(1)).to.be(0.5);
    expect(layer.getCameraViewportBottom(1)).to.be(1);
    // The active camera is not changed.
    expect(layer.getCameraViewportRight()).to.be(1);
  });

  it('deletes a camera and keeps the active camera valid', () => {
    const { layer } = makeSceneWithLayer('2d');
    layer.addCamera();
    layer.addCamera();
    layer.setActiveCamera(2);

    layer.deleteCamera(1);

    expect(layer.getCameraCount()).to.be(2);
    expect(layer.getActiveCameraIndex()).to.be(1);

    layer.deleteCamera(1);
    expect(layer.getCameraCount()).to.be(1);
    // The last camera can't be deleted.
    layer.deleteCamera(0);
    expect(layer.getCameraCount()).to.be(1);
  });
});
