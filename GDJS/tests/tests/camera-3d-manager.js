/**
 * Common tests for gdjs game engine.
 * See README.md for more information.
 */

describe('gdjs.Camera3DManager', () => {
  const runtimeGame = gdjs.getPixiRuntimeGame();

  const makeSceneWith3DLayer = () => {
    const runtimeScene = new gdjs.RuntimeScene(runtimeGame);
    runtimeScene.addLayer({
      name: '',
      renderingType: '3d',
      cameraType: 'perspective',
      visibility: true,
      cameras: [],
      effects: [],
      ambientLightColorR: 0,
      ambientLightColorG: 0,
      ambientLightColorB: 0,
      isLightingLayer: false,
      followBaseLayerCamera: false,
    });
    return runtimeScene;
  };

  /**
   * @param {gdjs.RuntimeScene} runtimeScene
   * @param {{
   *   x?: number,
   *   y?: number,
   *   z?: number,
   *   angle?: number,
   *   rotationX?: number,
   *   rotationY?: number,
   *   fieldOfView?: number,
   *   nearPlaneDistance?: number,
   *   farPlaneDistance?: number,
   *   projection?: 'perspective' | 'orthographic',
   *   zoom?: number,
   *   activeAtStart?: boolean,
   *   priority?: number,
   *   blendDuration?: number,
   * }} [options]
   */
  const addCamera = (runtimeScene, options = {}) => {
    const camera = new gdjs.Camera3DRuntimeObject(runtimeScene, {
      name: 'Camera',
      type: 'Camera3DObject',
      variables: [],
      behaviors: [],
      effects: [],
      content: {
        width: 50,
        height: 50,
        depth: 50,
        fieldOfView: options.fieldOfView || 45,
        nearPlaneDistance:
          options.nearPlaneDistance !== undefined
            ? options.nearPlaneDistance
            : 0.1,
        farPlaneDistance:
          options.farPlaneDistance !== undefined
            ? options.farPlaneDistance
            : 2000,
        projection: options.projection || 'perspective',
        zoom: options.zoom || 1,
        activeAtStart: options.activeAtStart === true,
        priority: options.priority || 0,
        blendDuration: options.blendDuration || 0,
      },
    });
    if (options.x !== undefined) camera.setX(options.x);
    if (options.y !== undefined) camera.setY(options.y);
    if (options.z !== undefined) camera.setZ(options.z);
    if (options.angle !== undefined) camera.setAngle(options.angle);
    if (options.rotationX !== undefined) {
      camera.setRotationX(options.rotationX);
    }
    if (options.rotationY !== undefined) {
      camera.setRotationY(options.rotationY);
    }
    return camera;
  };

  it('has no active camera until one is activated', () => {
    const runtimeScene = makeSceneWith3DLayer();
    const manager = runtimeScene.getCamera3DManager();
    addCamera(runtimeScene);

    manager.update();

    expect(manager.getActiveCamera()).to.be(null);
  });

  it('activates the camera marked as active', () => {
    const runtimeScene = makeSceneWith3DLayer();
    const manager = runtimeScene.getCamera3DManager();
    addCamera(runtimeScene);
    const activeCamera = addCamera(runtimeScene, {
      activeAtStart: true,
      x: 300,
      y: 400,
      z: 500,
      fieldOfView: 60,
    });

    manager.update();

    expect(manager.getActiveCamera()).to.be(activeCamera);

    const layer = runtimeScene.getLayer('');
    expect(layer.getCameraX()).to.be(300);
    expect(layer.getCameraY()).to.be(400);
    expect(layer.getCameraZ(60)).to.be(500);
    expect(layer.getCamera3DFieldOfView()).to.be(60);
  });

  it('uses the camera with the highest priority among the active ones', () => {
    const runtimeScene = makeSceneWith3DLayer();
    const manager = runtimeScene.getCamera3DManager();
    addCamera(runtimeScene, { activeAtStart: true, priority: 1 });
    const highPriorityCamera = addCamera(runtimeScene, {
      activeAtStart: true,
      priority: 10,
    });

    manager.update();

    expect(manager.getActiveCamera()).to.be(highPriorityCamera);
  });

  it('can activate a camera and deactivates the other ones', () => {
    const runtimeScene = makeSceneWith3DLayer();
    const manager = runtimeScene.getCamera3DManager();
    const firstCamera = addCamera(runtimeScene, { activeAtStart: true });
    const secondCamera = addCamera(runtimeScene, { x: 250 });

    manager.update();
    expect(manager.getActiveCamera()).to.be(firstCamera);

    gdjs.scene3d.camera3d.activateCamera3D(runtimeScene, secondCamera, null);
    manager.update();

    expect(manager.getActiveCamera()).to.be(secondCamera);
    expect(firstCamera.isCamera3DActive()).to.be(false);
    expect(runtimeScene.getLayer('').getCameraX()).to.be(250);
  });

  it('follows the camera object when it moves', () => {
    const runtimeScene = makeSceneWith3DLayer();
    const manager = runtimeScene.getCamera3DManager();
    const camera = addCamera(runtimeScene, { activeAtStart: true, z: 500 });

    manager.update();
    camera.setX(120);
    camera.setY(340);
    camera.setZ(600);
    camera.setAngle(45);
    camera.setRotationX(10);
    manager.update();

    const layer = runtimeScene.getLayer('');
    expect(layer.getCameraX()).to.be(120);
    expect(layer.getCameraY()).to.be(340);
    expect(layer.getCameraZ(45)).to.be(600);
    expect(layer.getCameraRotation()).to.be(45);
    expect(layer.getCameraRotationX()).to.be(10);
    // The zoom stays coherent with the Z position and the field of view
    // (600 is the height of the game resolution).
    expect(layer.getCameraZoom()).to.be.within(1.207, 1.2072);
  });

  it('keeps the last camera state when the camera is deactivated', () => {
    const runtimeScene = makeSceneWith3DLayer();
    const manager = runtimeScene.getCamera3DManager();
    const camera = addCamera(runtimeScene, {
      activeAtStart: true,
      x: 700,
      z: 500,
    });

    manager.update();
    expect(runtimeScene.getLayer('').getCameraX()).to.be(700);

    gdjs.scene3d.camera3d.deactivateCamera3D(runtimeScene, camera);
    manager.update();

    expect(manager.getActiveCamera()).to.be(null);
    expect(runtimeScene.getLayer('').getCameraX()).to.be(700);
  });

  it('unregisters a deleted camera', () => {
    const runtimeScene = makeSceneWith3DLayer();
    const manager = runtimeScene.getCamera3DManager();
    const camera = addCamera(runtimeScene, { activeAtStart: true });

    manager.update();
    expect(manager.getActiveCamera()).to.be(camera);

    camera.onDeletedFromScene();
    manager.update();

    expect(manager.getActiveCamera()).to.be(null);
    expect(manager.getCameras().length).to.be(0);
  });

  it('blends from the previous camera state', () => {
    const runtimeScene = makeSceneWith3DLayer();
    const manager = runtimeScene.getCamera3DManager();
    const timeManager = runtimeScene.getTimeManager();
    addCamera(runtimeScene, {
      activeAtStart: true,
      x: 100,
      z: 500,
    });
    const secondCamera = addCamera(runtimeScene, {
      x: 900,
      z: 500,
      blendDuration: 1,
    });

    manager.update();
    expect(runtimeScene.getLayer('').getCameraX()).to.be(100);

    gdjs.scene3d.camera3d.activateCamera3D(runtimeScene, secondCamera, null);

    // The camera is active right away, so conditions using `isActiveCamera`
    // are true in the same frame.
    manager.update();
    expect(runtimeScene.getLayer('').getCameraX()).to.be(100);

    // Half of the transition: the camera is in between.
    timeManager.update(500, 1);
    manager.update();
    const halfWayX = runtimeScene.getLayer('').getCameraX();
    expect(halfWayX).to.be.within(400, 600);
    expect(halfWayX).to.not.be(100);
    expect(halfWayX).to.not.be(900);

    // At the end of the transition: the camera is on the new one.
    timeManager.update(500, 1);
    manager.update();
    expect(runtimeScene.getLayer('').getCameraX()).to.be(900);
  });

  it('applies the projection and the planes of the camera', () => {
    const runtimeScene = makeSceneWith3DLayer();
    const manager = runtimeScene.getCamera3DManager();
    addCamera(runtimeScene, {
      activeAtStart: true,
      nearPlaneDistance: 5,
      farPlaneDistance: 900,
    });

    manager.update();

    const layer = runtimeScene.getLayer('');
    const threeCamera = layer.getRenderer().getThreeCamera();
    expect(layer.getCamera3DNearPlaneDistance()).to.be(5);
    expect(layer.getCamera3DFarPlaneDistance()).to.be(900);
    expect(threeCamera.near).to.be.within(0.0499, 0.0501);
    expect(threeCamera.far).to.be.within(8.9999, 9.0001);
  });

  it('uses the zoom of an orthographic camera', () => {
    const runtimeScene = makeSceneWith3DLayer();
    const layer = runtimeScene.getLayer('');
    const manager = runtimeScene.getCamera3DManager();
    addCamera(runtimeScene, {
      activeAtStart: true,
      projection: 'orthographic',
      zoom: 3,
      z: 500,
    });

    manager.update();

    expect(layer.getCameraZoom()).to.be(3);
  });

  it('reports a camera as active only when it drives the scene', () => {
    const runtimeScene = makeSceneWith3DLayer();
    const manager = runtimeScene.getCamera3DManager();
    const firstCamera = addCamera(runtimeScene, { activeAtStart: true });
    const secondCamera = addCamera(runtimeScene);

    manager.update();
    expect(firstCamera.isActiveCamera()).to.be(true);
    expect(secondCamera.isActiveCamera()).to.be(false);

    secondCamera.activate();
    expect(secondCamera.isActiveCamera()).to.be(true);
    expect(firstCamera.isActiveCamera()).to.be(false);

    secondCamera.deactivate();
    manager.update();
    expect(secondCamera.isActiveCamera()).to.be(false);
    expect(manager.getActiveCamera()).to.be(null);
  });
});
