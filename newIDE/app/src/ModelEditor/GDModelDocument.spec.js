// @flow
import * as THREE from 'three';
import { GDModelDocument } from './GDModelDocument';
import { createDefaultManifest } from './GDModelFormat';

const makeAnimationClip = (name: string = 'Run') =>
  new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('Arm.position', [0, 1], [0, 0, 0, 0, 1, 0]),
  ]);

/** A model looking like what the GLTF loader hands over. */
const makeGLTF = () => {
  const scene = new THREE.Group();
  scene.name = 'Scene';

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2, 4, 1),
    new THREE.MeshStandardMaterial({ color: 0xff8800, name: 'Body' })
  );
  body.name = 'Body';
  body.position.set(0, 2, 0);
  scene.add(body);

  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 2, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x00ff00, name: 'Arm' })
  );
  arm.name = 'Arm';
  arm.position.set(1, 3, 0);
  scene.add(arm);

  const tip = new THREE.Group();
  tip.name = 'HandTip';
  tip.position.set(0, 1, 0);
  arm.add(tip);

  return { scene, animations: [makeAnimationClip()], cameras: [], scenes: [] };
};

describe('GDModelDocument', () => {
  it('lists the nodes and measures itself', () => {
    const document = GDModelDocument.fromGLTF(makeGLTF());

    const entries = document.getNodeEntries();
    expect(entries.map(entry => entry.node.name)).toEqual([
      'Body',
      'Arm',
      'HandTip',
    ]);
    expect(entries.map(entry => entry.depth)).toEqual([0, 0, 1]);
    expect(entries[0].isMesh).toBe(true);
    expect(entries[2].type).toBe('Group');

    expect(document.getMeshEntries()).toHaveLength(2);
    const stats = document.getStats();
    expect(stats.meshCount).toBe(2);
    expect(stats.materialCount).toBe(2);
    expect(stats.animationCount).toBe(1);
    expect(stats.triangleCount).toBe(24); // Two boxes.

    const box = document.getModelBox();
    expect(box.min).toEqual([-1, 0, -0.5]);
    expect(box.max).toEqual([1.25, 4, 0.5]);
    expect(box.center[1]).toBeCloseTo(2);
  });

  describe('nodes', () => {
    it('creates primitives with unique names', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const first = document.addPrimitive('sphere', { size: 1 });
      const second = document.addPrimitive('sphere', { size: 1 });

      expect(first.name).toBe('Sphere');
      expect(second.name).toBe('Sphere_2');
      expect(first.isMesh).toBe(true);
      expect(first.geometry.getAttribute('position').count).toBeGreaterThan(0);
      // Two materials from the model, one for each new sphere.
      expect(document.getStats().materialCount).toBe(4);
    });

    it('deletes and restores a node', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const arm = document.findNodeByName('Arm');
      const parent = arm.parent;
      const index = parent.children.indexOf(arm);

      document.deleteNode(arm);
      expect(document.findNodeByName('Arm')).toBe(null);
      // The child of the node goes with it.
      expect(document.findNodeByName('HandTip')).toBe(null);
      expect(document.getNodeEntries()).toHaveLength(1);

      document.restoreNode(arm, parent, index);
      expect(document.getNodeEntries().map(entry => entry.node.name)).toEqual([
        'Body',
        'Arm',
        'HandTip',
      ]);
    });

    it('duplicates a node with its own names and materials', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const arm = document.findNodeByName('Arm');
      const clone = document.duplicateNode(arm);

      expect(clone.name).toBe('Arm_2');
      expect(clone.children[0].name).toBe('HandTip_2');
      expect(document.getNodeEntries()).toHaveLength(5);

      // The material is not shared with the original.
      expect(clone.material).not.toBe(arm.material);
      expect(clone.material.name).toBe(arm.material.name);

      document.applyMaterialProperties(clone.material, { color: '#123456' });
      expect(clone.material.color.getHexString()).toBe('123456');
      expect(arm.material.color.getHexString()).toBe('00ff00');
    });

    it('keeps a duplicated skinned mesh bound to its own bones', () => {
      const scene = new THREE.Group();
      const bone = new THREE.Bone();
      bone.name = 'Bone';
      const skinnedMesh = new THREE.SkinnedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial()
      );
      skinnedMesh.name = 'Skinned';
      skinnedMesh.add(bone);
      skinnedMesh.bind(new THREE.Skeleton([bone]));
      scene.add(skinnedMesh);

      const document = GDModelDocument.fromGLTF({ scene, animations: [] });
      const clone = document.duplicateNode(skinnedMesh);

      expect(clone.skeleton).not.toBe(skinnedMesh.skeleton);
      expect(clone.skeleton.bones[0]).not.toBe(bone);
      expect(clone.skeleton.bones[0]).toBe(clone.children[0]);
    });

    it('renames a node and keeps what targets it', () => {
      const gltf = makeGLTF();
      const document = GDModelDocument.fromGLTF(gltf);
      const arm = document.findNodeByName('Arm');
      document.addSocketForNode(arm, { name: 'hand' });
      document.addColliderFromNode(arm, 'box');

      expect(document.renameNode(arm, 'RightArm')).toBe(true);
      expect(arm.name).toBe('RightArm');
      // The animation track of the node follows its new name.
      expect(document.getAnimations()[0].tracks[0].name).toBe(
        'RightArm.position'
      );
      expect(document.getSockets()[0].node).toBe('RightArm');
      expect(document.getColliders()[0].node).toBe('RightArm');
    });

    it('refuses an empty or already used name', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const arm = document.findNodeByName('Arm');
      expect(document.renameNode(arm, 'Body')).toBe(false);
      expect(document.renameNode(arm, '  ')).toBe(false);
      expect(document.renameNode(arm, 'Arm')).toBe(true);
      expect(arm.name).toBe('Arm');
    });

    it('reads and writes the transform of a node', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const arm = document.findNodeByName('Arm');
      document.setNodeTransform(arm, {
        position: [1, 2, 3],
        rotation: [0, 90, 0],
        scale: [2, 2, 2],
      });
      const transform = document.getNodeTransform(arm);
      expect(transform.position).toEqual([1, 2, 3]);
      expect(transform.rotation[1]).toBeCloseTo(90);
      expect(transform.scale).toEqual([2, 2, 2]);
    });
  });

  describe('materials', () => {
    it('reads and writes the properties of a standard material', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const body = document.findNodeByName('Body');
      const [{ material }] = document.getMaterialSlots(body);

      const properties = document.getMaterialProperties(material);
      expect(properties.color).toBe('#ff8800');
      expect(properties.roughness).toBe(1);
      expect(properties.side).toBe('front');

      document.applyMaterialProperties(material, {
        color: '#0000ff',
        metalness: 1,
        roughness: 0.2,
        emissive: '#ffffff',
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.5,
        side: 'double',
      });

      const updated = document.getMaterialProperties(material);
      expect(updated.color).toBe('#0000ff');
      expect(updated.metalness).toBe(1);
      expect(updated.roughness).toBe(0.2);
      expect(updated.emissive).toBe('#ffffff');
      expect(updated.emissiveIntensity).toBe(0.5);
      expect(updated.transparent).toBe(true);
      expect(updated.opacity).toBe(0.5);
      expect(updated.side).toBe('double');
    });

    it('edits the clear coat of a physical material', () => {
      const scene = new THREE.Group();
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshPhysicalMaterial({ clearcoat: 0 })
      );
      mesh.name = 'Car';
      scene.add(mesh);
      const document = GDModelDocument.fromGLTF({ scene, animations: [] });
      const [{ material }] = document.getMaterialSlots(mesh);

      document.applyMaterialProperties(material, {
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        ior: 1.7,
        transmission: 0.2,
      });
      const properties = document.getMaterialProperties(material);
      expect(properties.clearcoat).toBe(1);
      expect(properties.clearcoatRoughness).toBe(0.1);
      expect(properties.ior).toBe(1.7);
      expect(properties.transmission).toBe(0.2);
    });
  });

  describe('sockets', () => {
    it('adds a socket on a node and finds where it is in the model', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const tip = document.findNodeByName('HandTip');
      const socket = document.addSocketForNode(tip, {
        position: [0, 2, 0],
      });

      expect(socket.name).toBe('socket1');
      // Arm is at (1, 3, 0), HandTip at (0, 1, 0) from the arm and the offset
      // of the socket is (0, 2, 0): (1, 6, 0) in the model.
      expect(document.getSocketPosition('socket1')).toEqual([1, 6, 0]);
      expect(document.getSocketPosition('unknown')).toBe(null);
    });

    it('renames, retargets and removes a socket', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const arm = document.findNodeByName('Arm');
      document.addSocketForNode(arm, { name: 'hand' });
      document.addSocketForNode(arm, { name: 'elbow' });

      expect(document.updateSocket('hand', { name: 'elbow' })).toBe(false);
      expect(document.updateSocket('hand', { name: 'palm' })).toBe(true);
      expect(document.getSockets().map(socket => socket.name)).toEqual([
        'palm',
        'elbow',
      ]);

      document.addSocketForNode(arm, {});
      expect(document.updateSocket('palm', { node: 'HandTip' })).toBe(true);
      expect(
        document.findSocket('palm') && document.findSocket('palm').node
      ).toBe('HandTip');

      expect(document.removeSocket('palm')).toBe(true);
      expect(document.removeSocket('palm')).toBe(false);
      expect(document.getSockets()).toHaveLength(2);
    });
  });

  describe('colliders', () => {
    it('measures a collider from the geometry of a node', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const arm = document.findNodeByName('Arm');
      const collider = document.addColliderFromNode(arm, 'capsule');

      expect(collider.name).toBe('collider1');
      expect(collider.type).toBe('capsule');
      expect(collider.size[0]).toBeCloseTo(0.5);
      expect(collider.size[1]).toBeCloseTo(2);
      expect(collider.center[1]).toBeCloseTo(3);
    });

    it('measures a collider for the whole model', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const collider = document.addColliderFromNode(null, 'box');
      expect(collider.node).toBe('');
      expect(collider.size[0]).toBeCloseTo(2.25);
      expect(collider.size[1]).toBeCloseTo(4);
    });

    it('updates and removes colliders', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      document.addColliderFromNode(null, 'box');
      expect(document.updateCollider('collider1', { type: 'trimesh' })).toBe(
        true
      );
      expect(
        document.findCollider('collider1') &&
          document.findCollider('collider1').type
      ).toBe('trimesh');
      expect(document.updateCollider('collider1', { name: '' })).toBe(false);
      expect(document.removeCollider('collider1')).toBe(true);
      expect(document.getColliders()).toHaveLength(0);
    });
  });

  describe('levels of detail', () => {
    it('adds levels sorted by distance and refuses duplicates', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      expect(document.addLOD('lod1.glb', 30)).toBe(true);
      expect(document.addLOD('lod2.glb', 10)).toBe(true);
      expect(document.addLOD('lod1.glb', 5)).toBe(false);
      expect(document.addLOD('', 5)).toBe(false);

      expect(document.getLODs().map(lod => lod.file)).toEqual([
        'lod2.glb',
        'lod1.glb',
      ]);
      expect(document.updateLOD(0, { distance: 100 })).toBe(true);
      expect(document.getLODs().map(lod => lod.distance)).toEqual([30, 100]);
      expect(document.removeLOD(0)).toBe(true);
      expect(document.getLODs()).toHaveLength(1);
    });
  });

  describe('animations', () => {
    it('lists, renames and removes clips', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      expect(document.getAnimationClips()).toEqual([
        { index: 0, name: 'Run', duration: 1, trackCount: 1 },
      ]);

      document.addAnimationEvent('Run', 0.5, 'footstep');
      expect(document.renameAnimationClip(0, 'Walk')).toBe(true);
      expect(document.getAnimationClips()[0].name).toBe('Walk');
      // The events follow the clip.
      expect(document.getAnimationEvents()[0].clip).toBe('Walk');

      const clip = document.removeAnimationClip(0);
      expect(clip && clip.name).toBe('Walk');
      expect(document.getAnimationClips()).toHaveLength(0);
      document.restoreAnimationClip(clip, 0);
      expect(document.getAnimationClips()).toHaveLength(1);
    });

    it('keeps clips with different names', () => {
      const gltf = makeGLTF();
      gltf.animations.push(makeAnimationClip('Idle'));
      const document = GDModelDocument.fromGLTF(gltf);
      expect(document.renameAnimationClip(0, 'Idle')).toBe(false);
      expect(document.renameAnimationClip(0, 'Jump')).toBe(true);
    });

    it('adds and removes animation events, sorted by time', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      document.addAnimationEvent('Run', 0.8, 'second');
      document.addAnimationEvent('Run', 0.2, 'first');
      expect(document.addAnimationEvent('', 0.1, 'no clip')).toBe(false);
      expect(document.addAnimationEvent('Run', 0.1, '  ')).toBe(false);

      expect(document.getAnimationEvents().map(event => event.name)).toEqual([
        'first',
        'second',
      ]);
      expect(document.removeAnimationEvent(0)).toBe(true);
      expect(document.getAnimationEvents()).toHaveLength(1);
    });
  });

  describe('saving', () => {
    it('measures the box of the model in the manifest it saves', () => {
      const document = GDModelDocument.fromGLTF(
        makeGLTF(),
        createDefaultManifest()
      );
      const manifest = document.buildManifest();
      expect(manifest.origin).toEqual([-1, 0, -0.5]);
      expect(manifest.center[0]).toBeCloseTo(-1 + 2.25 / 2);
      expect(document.hasEngineData()).toBe(false);
    });

    it('knows when the model holds engine specific data', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const arm = document.findNodeByName('Arm');
      document.addSocketForNode(arm, { name: 'hand' });
      expect(document.hasEngineData()).toBe(true);
    });

    it('disposes the geometries and the materials', () => {
      const document = GDModelDocument.fromGLTF(makeGLTF());
      const body = document.findNodeByName('Body');
      let geometryDisposed = false;
      let materialDisposed = false;
      body.geometry.addEventListener('dispose', () => {
        geometryDisposed = true;
      });
      body.material.addEventListener('dispose', () => {
        materialDisposed = true;
      });

      document.dispose();
      expect(geometryDisposed).toBe(true);
      expect(materialDisposed).toBe(true);
    });
  });
});
