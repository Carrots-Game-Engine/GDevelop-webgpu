// @flow
/**
 * The model being edited: its nodes, materials, animation clips, and the data
 * that only GDevelop knows about (sockets, colliders, levels of detail,
 * animation events).
 *
 * The document owns the Three.js objects it is given: it is built from a loaded
 * GLTF and edited in place. Saving it exports the scene back to a GLB and packs
 * the manifest around it (`GDModelFormat`), so that everything glTF supports
 * (meshes, skins, materials, animations) is stored in the standard file, and
 * everything else in the manifest.
 *
 * This module only depends on the core of Three.js, so that it can be tested
 * headlessly.
 */
import * as THREE from 'three';
import {
  GD_MODEL_COLLIDER_TYPES,
  createDefaultManifest,
  manifestHasEngineData,
  normalizeManifest,
  type GDModelAnimationEvent,
  type GDModelCollider,
  type GDModelFileEntry,
  type GDModelLOD,
  type GDModelManifest,
  type GDModelSocket,
  type GDModelVector3,
} from './GDModelFormat';
import {
  cloneMaterial,
  cloneObjectWithSkeleton,
  createDefaultMaterial,
} from './ObjectCloning';

export const GD_MODEL_PRIMITIVES = [
  'box',
  'sphere',
  'cylinder',
  'cone',
  'torus',
  'plane',
];

export type GDModelPrimitive =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'plane';

export type GDModelNodeEntry = {|
  node: any,
  depth: number,
  id: number,
  type: string,
  isMesh: boolean,
  isSkinnedMesh: boolean,
|};

export type GDModelMaterialSlot = {|
  index: number,
  material: any,
|};

export type GDModelMaterialProperties = {|
  color: string,
  metalness: number,
  roughness: number,
  emissive: string,
  emissiveIntensity: number,
  opacity: number,
  transparent: boolean,
  alphaTest: number,
  wireframe: boolean,
  flatShading: boolean,
  clearcoat: number,
  clearcoatRoughness: number,
  ior: number,
  transmission: number,
  envMapIntensity: number,
  side: 'front' | 'back' | 'double',
  hasColorTexture: boolean,
|};

export type GDModelDocumentStats = {|
  nodeCount: number,
  meshCount: number,
  vertexCount: number,
  triangleCount: number,
  materialCount: number,
  animationCount: number,
  socketCount: number,
  colliderCount: number,
  lodCount: number,
  animationEventCount: number,
|};

export type GDModelAnimationClipInfo = {|
  index: number,
  name: string,
  duration: number,
  trackCount: number,
|};

const SIDE_FROM_CONSTANT = {
  [THREE.FrontSide]: 'front',
  [THREE.BackSide]: 'back',
  [THREE.DoubleSide]: 'double',
};

const SIDE_TO_CONSTANT = {
  front: THREE.FrontSide,
  back: THREE.BackSide,
  double: THREE.DoubleSide,
};

const toHexColor = (value: any): string =>
  value && typeof value.getHexString === 'function'
    ? '#' + value.getHexString()
    : '#ffffff';

const getMaterialList = (mesh: any): Array<any> => {
  if (!mesh.material) return [];
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
};

export class GDModelDocument {
  _root: any;
  _animations: Array<any>;
  _manifest: GDModelManifest;
  _extraFiles: Array<GDModelFileEntry>;
  _nextNodeId: number = 1;

  constructor({
    root,
    animations,
    manifest,
    extraFiles,
  }: {|
    root: any,
    animations?: Array<any>,
    manifest?: ?GDModelManifest,
    extraFiles?: Array<GDModelFileEntry>,
  |}) {
    this._root = root;
    this._root.rotation.order = this._root.rotation.order || 'ZYX';
    this._animations = animations ? animations.slice() : [];
    this._manifest = manifest
      ? normalizeManifest(manifest)
      : createDefaultManifest();
    this._extraFiles = extraFiles ? extraFiles.slice() : [];
  }

  /** Build a document from a loaded GLTF (which is then owned by the document). */
  // eslint-disable-next-line no-use-before-define
  static fromGLTF(gltf: any, manifest?: ?GDModelManifest): GDModelDocument {
    return new GDModelDocument({
      root: gltf.scene,
      animations: gltf.animations || [],
      manifest,
    });
  }

  getRoot(): any {
    return this._root;
  }

  getManifest(): GDModelManifest {
    return this._manifest;
  }

  getExtraFiles(): Array<GDModelFileEntry> {
    return this._extraFiles;
  }

  setExtraFiles(extraFiles: Array<GDModelFileEntry>): void {
    this._extraFiles = extraFiles.slice();
  }

  getAnimations(): Array<any> {
    return this._animations;
  }

  // -------------------------------------------------------------------------
  // Nodes
  // -------------------------------------------------------------------------

  getNodeEntries(): Array<GDModelNodeEntry> {
    const entries = [];
    const visit = (node: any, depth: number) => {
      // The root itself is not listed: it is the model.
      if (node !== this._root) {
        entries.push({
          node,
          depth,
          id: node.userData.gdModelEditorId || 0,
          type: node.isSkinnedMesh
            ? 'Skinned mesh'
            : node.isMesh
            ? 'Mesh'
            : node.isBone
            ? 'Bone'
            : node.isLight
            ? 'Light'
            : node.isCamera
            ? 'Camera'
            : 'Group',
          isMesh: !!node.isMesh,
          isSkinnedMesh: !!node.isSkinnedMesh,
        });
      }
      node.children.forEach((child: any) =>
        visit(child, node === this._root ? 0 : depth + 1)
      );
    };
    visit(this._root, 0);
    entries.forEach((entry, index) => {
      entry.id = index + 1;
      entry.node.userData.gdModelEditorId = entry.id;
    });
    this._nextNodeId = entries.length + 1;
    return entries;
  }

  getMeshEntries(): Array<GDModelNodeEntry> {
    return this.getNodeEntries().filter(entry => entry.isMesh);
  }

  findNodeByName(name: string): ?any {
    let found = null;
    this._root.traverse((node: any) => {
      if (!found && node !== this._root && node.name === name) found = node;
    });
    return found;
  }

  getNodeNames(): Array<string> {
    return this.getNodeEntries().map(entry => entry.node.name);
  }

  /** Whether this name can be given to a node (empty and used names are out). */
  canRenameNode(node: any, newName: string): boolean {
    const trimmedName = (newName || '').trim();
    if (!trimmedName) return false;
    const existing = this.findNodeByName(trimmedName);
    return !existing || existing === node;
  }

  /**
   * Rename a node, keeping the animation tracks that target it and the sockets
   * and colliders referencing it.
   */
  renameNode(node: any, newName: string): boolean {
    const trimmedName = (newName || '').trim();
    if (!this.canRenameNode(node, trimmedName)) return false;
    const previousName = node.name;
    if (previousName === trimmedName) return true;

    this._animations.forEach(clip => {
      clip.tracks.forEach((track: any) => {
        const prefix = previousName + '.';
        if (track.name.startsWith(prefix))
          track.name = trimmedName + '.' + track.name.substring(prefix.length);
      });
    });

    this._manifest.sockets.forEach(socket => {
      if (socket.node === previousName) socket.node = trimmedName;
    });
    this._manifest.colliders.forEach(collider => {
      if (collider.node === previousName) collider.node = trimmedName;
    });

    node.name = trimmedName;
    return true;
  }

  _makeUniqueName(baseName: string): string {
    let index = 1;
    let name = baseName;
    while (this.findNodeByName(name)) {
      index++;
      name = `${baseName}_${index}`;
    }
    return name;
  }

  /** Size of a new primitive: a tenth of the model, or a visible box. */
  _getDefaultPrimitiveSize(): number {
    const size = new THREE.Vector3();
    this._getBoundingBox().getSize(size);
    const longestSide = Math.max(size.x, size.y, size.z);
    return longestSide > 0.001 && isFinite(longestSide) ? longestSide / 10 : 50;
  }

  _createGeometry(primitive: GDModelPrimitive, size: number): any {
    switch (primitive) {
      case 'sphere':
        return new THREE.SphereGeometry(size / 2, 24, 16);
      case 'cylinder':
        return new THREE.CylinderGeometry(size / 2, size / 2, size, 24);
      case 'cone':
        return new THREE.ConeGeometry(size / 2, size, 24);
      case 'torus':
        return new THREE.TorusGeometry(size / 2, size / 6, 12, 32);
      case 'plane':
        return new THREE.PlaneGeometry(size, size);
      case 'box':
      default:
        return new THREE.BoxGeometry(size, size, size);
    }
  }

  addPrimitive(
    primitive: GDModelPrimitive,
    options?: {| size?: number |}
  ): any {
    const size =
      options && options.size && options.size > 0
        ? options.size
        : this._getDefaultPrimitiveSize();
    const name = primitive.charAt(0).toUpperCase() + primitive.substring(1);
    const mesh = new THREE.Mesh(
      this._createGeometry(primitive, size),
      createDefaultMaterial()
    );
    mesh.name = this._makeUniqueName(name);
    this._root.add(mesh);
    return mesh;
  }

  /** Remove a node from the model, returning it (so that it can be undone). */
  deleteNode(node: any): void {
    if (node && node.parent) node.parent.remove(node);
  }

  /** Add a node again (undo of a deletion). */
  restoreNode(node: any, parent: any, index?: number): void {
    const target = parent || this._root;
    if (
      typeof index === 'number' &&
      index >= 0 &&
      index <= target.children.length
    )
      target.children.splice(index, 0, node);
    else target.add(node);
    node.parent = target;
  }

  /**
   * Copy a node (and its children), giving every copy its own name and its own
   * materials.
   */
  duplicateNode(node: any): any {
    const clone = cloneObjectWithSkeleton(node);

    const originalNodes = [node];
    const clonedNodes = [clone];
    node.traverse((child: any) => {
      if (child !== node) originalNodes.push(child);
    });
    clone.traverse((child: any) => {
      if (child !== clone) clonedNodes.push(child);
    });

    // The clone is not part of the document yet, so unique names are computed
    // against the document and the names already given to the copy.
    const takenNames = new Set();
    originalNodes.forEach((original: any, index: number) => {
      const cloned: any = clonedNodes[index];
      if (!cloned) return;
      const baseName = original.name || 'Node';
      let name = baseName;
      let suffix = 1;
      while (this.findNodeByName(name) || takenNames.has(name)) {
        suffix++;
        name = `${baseName}_${suffix}`;
      }
      takenNames.add(name);
      cloned.name = name;
    });

    clone.traverse((child: any) => {
      if (!child.isMesh) return;
      if (Array.isArray(child.material))
        child.material = child.material.map(cloneMaterial);
      else if (child.material) child.material = cloneMaterial(child.material);
    });

    const parent = node.parent || this._root;
    parent.add(clone);
    return clone;
  }

  /** Replace the geometry of a mesh (mesh editing), returning the old one. */
  replaceMeshGeometry(mesh: any, geometry: any): any {
    const previousGeometry = mesh.geometry;
    mesh.geometry = geometry;
    return previousGeometry;
  }

  // -------------------------------------------------------------------------
  // Measurement
  // -------------------------------------------------------------------------

  _getBoundingBox(): any {
    this._root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(this._root);
  }

  getModelSize(): { x: number, y: number, z: number } {
    const size = new THREE.Vector3();
    this._getBoundingBox().getSize(size);
    return { x: size.x, y: size.y, z: size.z };
  }

  getModelBox(): {|
    min: GDModelVector3,
    max: GDModelVector3,
    center: GDModelVector3,
  |} {
    const box = this._getBoundingBox();
    return {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
      center: [
        (box.min.x + box.max.x) / 2,
        (box.min.y + box.max.y) / 2,
        (box.min.z + box.max.z) / 2,
      ],
    };
  }

  getStats(): GDModelDocumentStats {
    let vertexCount = 0;
    let triangleCount = 0;
    let meshCount = 0;
    const materials = new Set();
    this._root.traverse((node: any) => {
      getMaterialList(node).forEach(material => materials.add(material));
      if (!node.isMesh || !node.geometry) return;
      meshCount++;
      const position = node.geometry.getAttribute('position');
      if (position) vertexCount += position.count;
      triangleCount += Math.floor(
        (node.geometry.index
          ? node.geometry.index.count
          : position
          ? position.count
          : 0) / 3
      );
    });

    return {
      nodeCount: this.getNodeEntries().length,
      meshCount,
      vertexCount,
      triangleCount,
      materialCount: materials.size,
      animationCount: this._animations.length,
      socketCount: this._manifest.sockets.length,
      colliderCount: this._manifest.colliders.length,
      lodCount: this._manifest.lods.length,
      animationEventCount: this._manifest.animationEvents.length,
    };
  }

  // -------------------------------------------------------------------------
  // Materials
  // -------------------------------------------------------------------------

  getMaterialSlots(node: any): Array<GDModelMaterialSlot> {
    return getMaterialList(node).map((material, index) => ({
      index,
      material,
    }));
  }

  getMaterialProperties(material: any): GDModelMaterialProperties {
    const physical = material.isMeshPhysicalMaterial ? material : null;
    return {
      color: toHexColor(material.color),
      metalness:
        typeof material.metalness === 'number' ? material.metalness : 0,
      roughness:
        typeof material.roughness === 'number' ? material.roughness : 1,
      emissive: toHexColor(material.emissive),
      emissiveIntensity:
        typeof material.emissiveIntensity === 'number'
          ? material.emissiveIntensity
          : 1,
      opacity: typeof material.opacity === 'number' ? material.opacity : 1,
      transparent: !!material.transparent,
      alphaTest:
        typeof material.alphaTest === 'number' ? material.alphaTest : 0,
      wireframe: !!material.wireframe,
      flatShading: !!material.flatShading,
      clearcoat:
        physical && physical.clearcoat !== undefined ? physical.clearcoat : 0,
      clearcoatRoughness:
        physical && physical.clearcoatRoughness !== undefined
          ? physical.clearcoatRoughness
          : 0,
      ior: physical && physical.ior !== undefined ? physical.ior : 1.5,
      transmission:
        physical && physical.transmission !== undefined
          ? physical.transmission
          : 0,
      envMapIntensity:
        typeof material.envMapIntensity === 'number'
          ? material.envMapIntensity
          : 1,
      side: SIDE_FROM_CONSTANT[material.side] || 'front',
      hasColorTexture: !!material.map,
    };
  }

  /**
   * Change the properties of a material. Only the properties changed get their
   * `needsUpdate` flag set, so that a slider drag does not rebuild shaders.
   */
  applyMaterialProperties(
    material: any,
    properties: $Shape<GDModelMaterialProperties>
  ): void {
    let needsUpdate = false;
    if (properties.color !== undefined) material.color.set(properties.color);
    if (properties.metalness !== undefined && 'metalness' in material)
      material.metalness = properties.metalness;
    if (properties.roughness !== undefined && 'roughness' in material)
      material.roughness = properties.roughness;
    if (properties.emissive !== undefined && material.emissive)
      material.emissive.set(properties.emissive);
    if (
      properties.emissiveIntensity !== undefined &&
      'emissiveIntensity' in material
    )
      material.emissiveIntensity = properties.emissiveIntensity;
    if (properties.opacity !== undefined) material.opacity = properties.opacity;
    if (properties.transparent !== undefined) {
      material.transparent = properties.transparent;
      needsUpdate = true;
    }
    if (properties.alphaTest !== undefined) {
      material.alphaTest = properties.alphaTest;
      needsUpdate = true;
    }
    if (properties.wireframe !== undefined && 'wireframe' in material)
      material.wireframe = properties.wireframe;
    if (properties.flatShading !== undefined && 'flatShading' in material) {
      material.flatShading = properties.flatShading;
      needsUpdate = true;
    }
    if (properties.clearcoat !== undefined && 'clearcoat' in material)
      material.clearcoat = properties.clearcoat;
    if (
      properties.clearcoatRoughness !== undefined &&
      'clearcoatRoughness' in material
    )
      material.clearcoatRoughness = properties.clearcoatRoughness;
    if (properties.ior !== undefined && 'ior' in material)
      material.ior = properties.ior;
    if (properties.transmission !== undefined && 'transmission' in material) {
      material.transmission = properties.transmission;
      needsUpdate = true;
    }
    if (properties.envMapIntensity !== undefined)
      material.envMapIntensity = properties.envMapIntensity;
    if (properties.side !== undefined) {
      material.side = SIDE_TO_CONSTANT[properties.side] || THREE.FrontSide;
      needsUpdate = true;
    }
    if (needsUpdate) material.needsUpdate = true;
  }

  /** Make every material unique to its mesh, to edit one without the others. */
  makeMaterialsUnique(node: any): void {
    node.traverse((child: any) => {
      if (!child.isMesh) return;
      if (Array.isArray(child.material))
        child.material = child.material.map(cloneMaterial);
      else if (child.material) child.material = cloneMaterial(child.material);
    });
  }

  // -------------------------------------------------------------------------
  // Sockets
  // -------------------------------------------------------------------------

  getSockets(): Array<GDModelSocket> {
    return this._manifest.sockets;
  }

  findSocket(name: string): ?GDModelSocket {
    return this._manifest.sockets.find(socket => socket.name === name);
  }

  addSocketForNode(node: any, options?: $Shape<GDModelSocket>): GDModelSocket {
    const baseName = 'socket';
    let index = 1;
    while (this.findSocket(`${baseName}${index}`)) index++;
    const socket: GDModelSocket = {
      name: (options && options.name) || `${baseName}${index}`,
      node: node.name,
      position: (options && options.position) || [0, 0, 0],
      rotation: (options && options.rotation) || [0, 0, 0],
    };
    this._manifest.sockets.push(socket);
    return socket;
  }

  updateSocket(name: string, changes: $Shape<GDModelSocket>): boolean {
    const socket = this.findSocket(name);
    if (!socket) return false;
    if (changes.name !== undefined) {
      const trimmed = changes.name.trim();
      if (!trimmed) return false;
      const other = this.findSocket(trimmed);
      if (other && other !== socket) return false;
      socket.name = trimmed;
    }
    if (changes.node !== undefined) socket.node = changes.node;
    if (changes.position !== undefined) socket.position = changes.position;
    if (changes.rotation !== undefined) socket.rotation = changes.rotation;
    return true;
  }

  removeSocket(name: string): boolean {
    const index = this._manifest.sockets.findIndex(
      socket => socket.name === name
    );
    if (index === -1) return false;
    this._manifest.sockets.splice(index, 1);
    return true;
  }

  /**
   * Where a socket is in the model, in the space of the model root (the space
   * the runtime places the object in).
   */
  getSocketPosition(name: string): ?GDModelVector3 {
    const socket = this.findSocket(name);
    if (!socket) return null;
    const node = this.findNodeByName(socket.node);
    if (!node) return null;
    this._root.updateMatrixWorld(true);
    const nodePosition = new THREE.Vector3().fromArray(socket.position);
    node.localToWorld(nodePosition);
    const rootInverse = new THREE.Matrix4()
      .copy(this._root.matrixWorld)
      .invert();
    nodePosition.applyMatrix4(rootInverse);
    return [nodePosition.x, nodePosition.y, nodePosition.z];
  }

  // -------------------------------------------------------------------------
  // Colliders
  // -------------------------------------------------------------------------

  getColliders(): Array<GDModelCollider> {
    return this._manifest.colliders;
  }

  findCollider(name: string): ?GDModelCollider {
    return this._manifest.colliders.find(collider => collider.name === name);
  }

  /**
   * Create a collider from the geometry of a node (or from the whole model when
   * no node is given), measured in model space.
   */
  addColliderFromNode(
    node: ?any,
    type: 'box' | 'sphere' | 'capsule' | 'convex' | 'trimesh' = 'box'
  ): GDModelCollider {
    const box = new THREE.Box3();
    if (node && node.isMesh) {
      node.updateMatrixWorld(true);
      box.setFromObject(node);
    } else {
      box.copy(this._getBoundingBox());
    }

    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    let baseName = 'collider';
    let index = 1;
    while (this.findCollider(`${baseName}${index}`)) index++;

    const collider: GDModelCollider = {
      name: `${baseName}${index}`,
      type: GD_MODEL_COLLIDER_TYPES.includes(type) ? type : 'box',
      node: node ? node.name : '',
      size: [size.x, size.y, size.z],
      center: [center.x, center.y, center.z],
    };
    this._manifest.colliders.push(collider);
    return collider;
  }

  updateCollider(name: string, changes: $Shape<GDModelCollider>): boolean {
    const collider = this.findCollider(name);
    if (!collider) return false;
    if (changes.name !== undefined) {
      const trimmed = changes.name.trim();
      if (!trimmed) return false;
      const other = this.findCollider(trimmed);
      if (other && other !== collider) return false;
      collider.name = trimmed;
    }
    if (changes.type !== undefined)
      // $FlowFixMe[incompatible-type] - callers pass one of the known types.
      collider.type = changes.type;
    if (changes.node !== undefined) collider.node = changes.node;
    if (changes.size !== undefined) collider.size = changes.size;
    if (changes.center !== undefined) collider.center = changes.center;
    return true;
  }

  removeCollider(name: string): boolean {
    const index = this._manifest.colliders.findIndex(
      collider => collider.name === name
    );
    if (index === -1) return false;
    this._manifest.colliders.splice(index, 1);
    return true;
  }

  // -------------------------------------------------------------------------
  // Levels of detail
  // -------------------------------------------------------------------------

  getLODs(): Array<GDModelLOD> {
    return this._manifest.lods;
  }

  addLOD(file: string, distance: number): boolean {
    if (!file) return false;
    if (this._manifest.lods.some(lod => lod.file === file)) return false;
    this._manifest.lods.push({ file, distance: Math.max(0, distance) });
    this._manifest.lods.sort(
      (first, second) => first.distance - second.distance
    );
    return true;
  }

  updateLOD(index: number, changes: $Shape<GDModelLOD>): boolean {
    const lod = this._manifest.lods[index];
    if (!lod) return false;
    if (changes.distance !== undefined)
      lod.distance = Math.max(0, changes.distance);
    if (changes.file !== undefined && changes.file) lod.file = changes.file;
    this._manifest.lods.sort(
      (first, second) => first.distance - second.distance
    );
    return true;
  }

  removeLOD(index: number): boolean {
    if (index < 0 || index >= this._manifest.lods.length) return false;
    this._manifest.lods.splice(index, 1);
    return true;
  }

  // -------------------------------------------------------------------------
  // Animations
  // -------------------------------------------------------------------------

  getAnimationClips(): Array<GDModelAnimationClipInfo> {
    return this._animations.map((clip, index) => ({
      index,
      name: clip.name,
      duration: clip.duration,
      trackCount: clip.tracks.length,
    }));
  }

  canRenameAnimationClip(index: number, newName: string): boolean {
    const trimmedName = (newName || '').trim();
    if (!trimmedName) return false;
    return !this._animations.some(
      (clip, clipIndex) => clipIndex !== index && clip.name === trimmedName
    );
  }

  renameAnimationClip(index: number, newName: string): boolean {
    const clip = this._animations[index];
    if (!clip) return false;
    if (!this.canRenameAnimationClip(index, newName)) return false;
    const previousName = clip.name;
    clip.name = newName.trim();
    this._manifest.animationEvents.forEach(event => {
      if (event.clip === previousName) event.clip = clip.name;
    });
    return true;
  }

  removeAnimationClip(index: number): any {
    if (index < 0 || index >= this._animations.length) return null;
    const clip = this._animations[index];
    this._animations.splice(index, 1);
    return clip;
  }

  restoreAnimationClip(clip: any, index: number): void {
    this._animations.splice(index, 0, clip);
  }

  getAnimationEvents(): Array<GDModelAnimationEvent> {
    return this._manifest.animationEvents;
  }

  addAnimationEvent(clip: string, time: number, name: string): boolean {
    if (!clip || !name.trim()) return false;
    this._manifest.animationEvents.push({
      clip,
      time: Math.max(0, time),
      name: name.trim(),
    });
    this._manifest.animationEvents.sort(
      (first, second) => first.time - second.time
    );
    return true;
  }

  removeAnimationEvent(index: number): boolean {
    if (index < 0 || index >= this._manifest.animationEvents.length)
      return false;
    this._manifest.animationEvents.splice(index, 1);
    return true;
  }

  // -------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------

  /**
   * The manifest to save: what was edited, plus the measured box of the model
   * (so that a reader knows its extents without loading it).
   */
  buildManifest(): GDModelManifest {
    const box = this.getModelBox();
    return normalizeManifest({
      ...this._manifest,
      origin: box.min,
      center: box.center,
    });
  }

  /** Whether the model holds anything a plain glTF file cannot. */
  hasEngineData(): boolean {
    return manifestHasEngineData(this.buildManifest());
  }

  /** Change the transform of a node and keep the animation tracks in sync. */
  setNodeTransform(
    node: any,
    transform: {|
      position?: GDModelVector3,
      rotation?: GDModelVector3,
      scale?: GDModelVector3,
    |}
  ): void {
    if (transform.position) node.position.fromArray(transform.position);
    if (transform.rotation)
      node.rotation.set(
        (transform.rotation[0] / 180) * Math.PI,
        (transform.rotation[1] / 180) * Math.PI,
        (transform.rotation[2] / 180) * Math.PI
      );
    if (transform.scale) node.scale.fromArray(transform.scale);
  }

  getNodeTransform(
    node: any
  ): {|
    position: GDModelVector3,
    rotation: GDModelVector3,
    scale: GDModelVector3,
  |} {
    return {
      position: [node.position.x, node.position.y, node.position.z],
      rotation: [
        (node.rotation.x * 180) / Math.PI,
        (node.rotation.y * 180) / Math.PI,
        (node.rotation.z * 180) / Math.PI,
      ],
      scale: [node.scale.x, node.scale.y, node.scale.z],
    };
  }

  /** Release the GPU resources of the model and its materials. */
  dispose(): void {
    const geometries = new Set();
    const materials = new Set();
    this._root.traverse((node: any) => {
      if (node.geometry) geometries.add(node.geometry);
      getMaterialList(node).forEach(material => materials.add(material));
    });
    geometries.forEach(
      (geometry: any) => geometry.dispose && geometry.dispose()
    );
    materials.forEach((material: any) => {
      for (const key in material) {
        const value = material[key];
        if (value && value.isTexture && value.dispose) value.dispose();
      }
      if (material.dispose) material.dispose();
    });
  }
}
