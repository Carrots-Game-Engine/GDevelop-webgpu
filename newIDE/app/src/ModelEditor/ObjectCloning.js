// @flow
/**
 * Clone of a Three.js object that keeps skinned meshes bound to the cloned
 * bones.
 *
 * `Object3D.clone(true)` does not rebind the skeleton of a `SkinnedMesh`: the
 * copy would be deformed by the bones of the original. This is the algorithm
 * used by Three.js (`examples/jsm/utils/SkeletonUtils.js`), written here so
 * that the model document does not depend on a module that cannot be imported
 * in tests.
 */
import * as THREE from 'three';

const parallelTraverse = (
  first: any,
  second: any,
  callback: (first: any, second: any) => void
) => {
  callback(first, second);
  for (let index = 0; index < first.children.length; index++)
    parallelTraverse(first.children[index], second.children[index], callback);
};

export const cloneObjectWithSkeleton = (source: any): any => {
  const sourceLookup = new Map<any, any>();
  const cloneLookup = new Map<any, any>();

  const clone = source.clone();
  parallelTraverse(source, clone, (sourceNode, clonedNode) => {
    sourceLookup.set(clonedNode, sourceNode);
    cloneLookup.set(sourceNode, clonedNode);
  });

  clone.traverse((node: any) => {
    if (!node.isSkinnedMesh) return;

    const clonedMesh = node;
    const sourceMesh = sourceLookup.get(node);
    if (!sourceMesh || !sourceMesh.skeleton) return;

    const sourceBones = sourceMesh.skeleton.bones;
    clonedMesh.skeleton = sourceMesh.skeleton.clone();
    clonedMesh.bindMatrix.copy(sourceMesh.bindMatrix);
    clonedMesh.skeleton.bones = sourceBones.map((bone: any) => {
      const clonedBone = cloneLookup.get(bone);
      return clonedBone || bone;
    });
    clonedMesh.bind(clonedMesh.skeleton, clonedMesh.bindMatrix);
  });

  return clone;
};

/** Clone a material, keeping the textures (which are shared, as in Blender). */
export const cloneMaterial = (material: any): any => {
  const clone = material.clone();
  clone.name = material.name;
  return clone;
};

/** A default material for the meshes created by the editor. */
export const createDefaultMaterial = (): any =>
  new THREE.MeshStandardMaterial({
    color: 0x9aa0a6,
    metalness: 0.05,
    roughness: 0.65,
    name: 'GDevelop material',
  });
