// @ts-check

describe('Scene3D::InstancedMesh3DObject and Scene3D::BatchedMesh3DObject', () => {
  /**
   * @returns {gdjs.RuntimeScene}
   */
  const makeRuntimeScene = () => {
    const runtimeGame = gdjs.getPixiRuntimeGame();
    runtimeGame
      .getRenderer()
      .createStandardCanvas(document.createElement('div'));
    const runtimeScene = new gdjs.RuntimeScene(runtimeGame);
    runtimeScene.addLayer({
      name: '',
      renderingType: '3d',
      visibility: true,
      effects: [],
      cameras: [],
      ambientLightColorR: 0,
      ambientLightColorG: 0,
      ambientLightColorB: 0,
      isLightingLayer: false,
      followBaseLayerCamera: true,
    });
    return runtimeScene;
  };

  /**
   * @param {gdjs.RuntimeScene} runtimeScene
   * @param {Object<string, any>} [content]
   * @returns {gdjs.InstancedMesh3DRuntimeObject}
   */
  const addInstancedMesh = (runtimeScene, content = {}) => {
    // @ts-ignore - the object data is only partially filled for the test.
    const object = new gdjs.InstancedMesh3DRuntimeObject(runtimeScene, {
      name: 'Instances',
      type: 'Scene3D::InstancedMesh3DObject',
      effects: [],
      variables: [],
      behaviors: [],
      content: {
        width: 100,
        height: 100,
        depth: 100,
        instanceCount: 4,
        initialLayout: 'None',
        geometryType: 'Box',
        modelResourceName: '',
        modelMeshName: '',
        materialType: 'Basic',
        tint: '255;255;255',
        isCastingShadow: true,
        isReceivingShadow: true,
        frustumCulled: false,
        ...content,
      },
    });
    runtimeScene.addObject(object);
    return object;
  };

  /**
   * @param {gdjs.RuntimeScene} runtimeScene
   * @param {Object<string, any>} [content]
   * @returns {gdjs.BatchedMesh3DRuntimeObject}
   */
  const addBatchedMesh = (runtimeScene, content = {}) => {
    // @ts-ignore - the object data is only partially filled for the test.
    const object = new gdjs.BatchedMesh3DRuntimeObject(runtimeScene, {
      name: 'BatchedInstances',
      type: 'Scene3D::BatchedMesh3DObject',
      effects: [],
      variables: [],
      behaviors: [],
      content: {
        width: 100,
        height: 100,
        depth: 100,
        instanceCount: 4,
        initialLayout: 'None',
        geometryTypes: 'Box',
        modelResourceName: '',
        modelMeshNames: '',
        materialType: 'Basic',
        tint: '255;255;255',
        isCastingShadow: true,
        isReceivingShadow: true,
        frustumCulled: true,
        sortObjects: false,
        ...content,
      },
    });
    runtimeScene.addObject(object);
    return object;
  };

  /**
   * @param {gdjs.InstancedMesh3DRuntimeObject} object
   * @returns {THREE.InstancedMesh}
   */
  const getInstancedMesh = (object) => {
    const root = object.getRenderer().get3DRendererObject();
    const mesh = root.children.find(
      (child) => child instanceof THREE.InstancedMesh
    );
    if (!(mesh instanceof THREE.InstancedMesh)) {
      throw new Error('The object has no THREE.InstancedMesh.');
    }
    return mesh;
  };

  /**
   * @param {gdjs.BatchedMesh3DRuntimeObject} object
   * @returns {THREE.BatchedMesh}
   */
  const getBatchedMesh = (object) => {
    const root = object.getRenderer().get3DRendererObject();
    const mesh = root.children.find(
      (child) => child instanceof THREE.BatchedMesh
    );
    if (!(mesh instanceof THREE.BatchedMesh)) {
      throw new Error('The object has no THREE.BatchedMesh.');
    }
    return mesh;
  };

  describe('InstancedMesh', () => {
    it('draws all the instances with a single THREE.InstancedMesh', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addInstancedMesh(runtimeScene, { instanceCount: 6 });

      const mesh = getInstancedMesh(object);
      expect(object.getInstanceCount()).to.be(6);
      expect(mesh.count).to.be(6);
      expect(mesh.instanceMatrix.count).to.be.above(5);
      expect(mesh.instanceColor).not.to.be(null);
    });

    it('adds, removes and reuses instance slots', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addInstancedMesh(runtimeScene, { instanceCount: 3 });

      expect(object.addInstance(10, 20, 30)).to.be(3);
      expect(object.getInstanceCount()).to.be(4);
      expect(object.getLastAddedInstanceIndex()).to.be(3);
      expect(object.isInstanceActive(3)).to.be(true);

      object.removeInstance(1);
      expect(object.getInstanceCount()).to.be(3);
      expect(object.isInstanceActive(1)).to.be(false);
      expect(object.isInstanceVisible(1)).to.be(false);

      // The slot of the removed instance is reused.
      expect(object.addInstance(0, 0, 0)).to.be(1);
      expect(object.isInstanceActive(1)).to.be(true);
      expect(object.getInstanceCount()).to.be(4);
    });

    it('converts scene coordinates to positions in the object box', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addInstancedMesh(runtimeScene, {
        instanceCount: 1,
        width: 200,
        height: 100,
        depth: 50,
      });
      object.setX(10);
      object.setY(20);
      object.setZ(30);

      object.setInstancePosition(0, 110, 70, 55);
      expect(object.getInstanceX(0)).to.be(110);
      expect(object.getInstanceY(0)).to.be(70);
      expect(object.getInstanceZ(0)).to.be(55);

      object.setInstancePosition(0, 210, 120, 80);
      expect(object.getInstanceX(0)).to.be(210);
      expect(object.getInstanceY(0)).to.be(120);
      expect(object.getInstanceZ(0)).to.be(80);
    });

    it('composes the rotation and scale of an instance', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addInstancedMesh(runtimeScene, { instanceCount: 1 });
      object.setInstanceRotation(0, 0, 0, 90);
      object.setInstanceScale(0, 2, 2, 2);
      object.update(runtimeScene);

      const mesh = getInstancedMesh(object);
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(0, matrix);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      matrix.decompose(position, quaternion, scale);

      expect(position.length()).to.be.below(1e-6);
      expect(scale.x).to.be.above(1.999);
      expect(scale.y).to.be.above(1.999);
      expect(scale.z).to.be.above(1.999);

      const euler = new THREE.Euler().setFromQuaternion(quaternion, 'ZYX');
      expect(Math.abs(THREE.MathUtils.radToDeg(euler.z) - 90)).to.be.below(
        0.001
      );
    });

    it('updates the color of an instance', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addInstancedMesh(runtimeScene, { instanceCount: 2 });

      object.setInstanceColor(1, '255;0;0');
      expect(object.getInstanceColor(1)).to.be('255;0;0');
      object.update(runtimeScene);

      const mesh = getInstancedMesh(object);
      const color = new THREE.Color();
      mesh.getColorAt(1, color);
      expect(color.r).to.be(1);
      expect(color.g).to.be(0);
      expect(color.b).to.be(0);
    });

    it('hides an instance with a zero scale matrix', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addInstancedMesh(runtimeScene, { instanceCount: 2 });

      object.setInstanceVisible(0, false);
      expect(object.isInstanceVisible(0)).to.be(false);
      object.update(runtimeScene);

      const mesh = getInstancedMesh(object);
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(0, matrix);
      // `Matrix4.decompose` returns a 1,1,1 scale for a singular matrix, so
      // check the scale components of the matrix itself.
      expect(Math.abs(matrix.elements[0])).to.be.below(1e-6);
      expect(Math.abs(matrix.elements[5])).to.be.below(1e-6);
      expect(Math.abs(matrix.elements[10])).to.be.below(1e-6);
    });

    it('clears and re-adds instances', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addInstancedMesh(runtimeScene, { instanceCount: 3 });
      const mesh = getInstancedMesh(object);

      object.clearInstances();
      expect(object.getInstanceCount()).to.be(0);
      expect(mesh.count).to.be(0);

      expect(object.addInstance(50, 50, 50)).to.be(0);
      object.update(runtimeScene);
      expect(object.getInstanceCount()).to.be(1);
      expect(mesh.count).to.be(1);
      expect(object.getInstanceX(0)).to.be(50);
    });

    it('resets the instances to the configured layout', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addInstancedMesh(runtimeScene, {
        instanceCount: 4,
        initialLayout: 'Line',
      });

      object.setInstancePosition(0, 100, 0, 0);
      object.resetInstancesLayout();

      expect(object.getInstanceX(0)).to.be(12.5);
      // The scales are stored in Float32 arrays.
      expect(object.getInstanceScaleX(0)).to.be.within(0.2249, 0.2251);
    });

    it('changes the count of instances', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addInstancedMesh(runtimeScene, { instanceCount: 2 });

      object.setInstanceCount(5);
      expect(object.getInstanceCount()).to.be(5);
      expect(object.getLastAddedInstanceIndex()).to.be(4);
      // Missing instances are added at the center of the object.
      expect(object.getInstanceX(4)).to.be(50);
      expect(object.getInstanceY(4)).to.be(50);
      expect(object.getInstanceZ(4)).to.be(50);

      object.setInstanceCount(1);
      expect(object.getInstanceCount()).to.be(1);
      expect(object.isInstanceActive(4)).to.be(false);
    });
  });

  describe('BatchedMesh', () => {
    it('builds a palette from primitives', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addBatchedMesh(runtimeScene, {
        instanceCount: 5,
        geometryTypes: 'Box, Sphere, Cylinder',
      });

      expect(object.getGeometryCount()).to.be(3);
      expect(object.getGeometryName(0)).to.be('Box');
      expect(object.getGeometryName(1)).to.be('Sphere');
      expect(object.getGeometryName(2)).to.be('Cylinder');

      const mesh = getBatchedMesh(object);
      expect(object.getInstanceCount()).to.be(5);
      expect(mesh.maxInstanceCount).to.be.above(4);
    });

    it('changes the geometry of an instance', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addBatchedMesh(runtimeScene, {
        instanceCount: 3,
        geometryTypes: 'Box,Sphere,Cylinder',
      });

      object.setInstanceGeometry(0, 2);
      expect(object.getInstanceGeometry(0)).to.be(2);

      const mesh = getBatchedMesh(object);
      expect(mesh.getGeometryIdAt(0)).to.be(2);
    });

    it('hides removed and invisible instances', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addBatchedMesh(runtimeScene, {
        instanceCount: 3,
        geometryTypes: 'Box,Sphere',
      });
      const mesh = getBatchedMesh(object);

      object.setInstanceVisible(1, false);
      object.update(runtimeScene);
      expect(mesh.getVisibleAt(1)).to.be(false);

      object.removeInstance(2);
      expect(object.isInstanceActive(2)).to.be(false);
      object.update(runtimeScene);
      expect(mesh.getVisibleAt(2)).to.be(false);
    });

    it('rebuilds the batch when all the instances are cleared', () => {
      const runtimeScene = makeRuntimeScene();
      const object = addBatchedMesh(runtimeScene, {
        instanceCount: 3,
        geometryTypes: 'Box,Sphere',
      });
      const initialMesh = getBatchedMesh(object);

      object.clearInstances();
      expect(object.getInstanceCount()).to.be(0);
      const clearedMesh = getBatchedMesh(object);
      expect(clearedMesh === initialMesh).to.be(false);

      expect(object.addInstance(50, 50, 50)).to.be(0);
      object.update(runtimeScene);
      expect(object.getInstanceCount()).to.be(1);
      expect(clearedMesh.getGeometryIdAt(0)).to.be(0);
    });
  });

  describe('instancing utilities', () => {
    it('normalizes a primitive in a unit cube with plain attributes', () => {
      const geometry = gdjs.createInstancing3DPrimitiveGeometry('Box');
      geometry.computeBoundingBox();
      if (!geometry.boundingBox) {
        throw new Error('The geometry has no bounding box.');
      }
      const size = geometry.boundingBox.getSize(new THREE.Vector3());
      expect(size.x).to.be.within(0.999, 1.001);
      expect(size.y).to.be.within(0.999, 1.001);
      expect(size.z).to.be.within(0.999, 1.001);
      expect(geometry.getIndex()).not.to.be(null);
      expect(geometry.getAttribute('position')).not.to.be(undefined);
      expect(geometry.getAttribute('normal')).not.to.be(undefined);
      expect(geometry.getAttribute('uv')).not.to.be(undefined);
    });
  });
});
