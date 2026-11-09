// @flow
/**
 * The Three.js viewport of the 3D model editor.
 *
 * It owns everything that needs a WebGL context (renderer, camera, orbit and
 * transform gizmos, lighting, animation preview, selection overlays), and calls
 * back to React when something changed so that the panels stay in sync. The
 * document it displays (`GDModelDocument`) is owned by React: the engine only
 * mutates it, through high level operations, and reports what was done so that
 * the history can undo it.
 *
 * Two modes:
 * - `object`: clicking selects a node (mesh or group) and the gizmo moves it;
 * - `mesh`: clicking selects a vertex, an edge or a face of a mesh, and the
 *   gizmo moves that selection inside the mesh.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { type GDModelDocument } from './GDModelDocument';
import {
  getCentroid,
  getTriangle,
  getTriangleCount,
  getTrianglesOfVertices,
  getVerticesOfTriangles,
  keepTriangles,
} from './MeshEditing';

export type EditorMode = 'object' | 'mesh';
export type MeshSelectionMode = 'vertex' | 'edge' | 'face';
export type TransformMode = 'translate' | 'rotate' | 'scale';

export type EngineSelectionState = {|
  selectedNodeName: ?string,
  selectedMeshName: ?string,
  editedMeshName: ?string,
  selectedVertexCount: number,
  selectedTriangleCount: number,
|};

export type ModelEditorEngineOptions = {|
  canvas: HTMLCanvasElement,
  onSelectionChanged: (state: EngineSelectionState) => void,
  onObjectTransformCommitted: (
    node: any,
    before: Object,
    after: Object
  ) => void,
  onMeshEditCommitted: (mesh: any, before: any, after: any) => void,
  onMeshEditingEntered: (mesh: ?any) => void,
|};

const BACKGROUND_COLOR = 0x22262c;
const SELECTION_COLOR = 0xff9800;
const WIREFRAME_COLOR = 0x6b7480;
const MAX_TRIANGLES_FOR_WIREFRAME = 60000;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

/** A mesh whose entity is being edited (vertex/edge/face selection). */
const isMesh = (node: any): boolean =>
  !!node && !!node.isMesh && !!node.geometry;

export class ModelEditorEngine {
  _canvas: HTMLCanvasElement;
  _options: ModelEditorEngineOptions;

  _renderer: any;
  _scene: any;
  _camera: any;
  _orbitControls: any;
  _transformControls: any;
  _transformHelper: any;
  _orbitTarget: any;
  _grid: any;
  _axes: any;
  _lights: any;
  _pmremGenerator: any;
  _environmentTexture: any;
  _mixer: any = null;
  _currentClipIndex: ?number = null;
  _isPlaying: boolean = false;
  _clock: any;

  _document: ?GDModelDocument = null;
  _currentRoot: ?any = null;
  _mode: EditorMode = 'object';
  _meshSelectionMode: MeshSelectionMode = 'vertex';
  _transformMode: TransformMode = 'translate';
  _isSnappingEnabled: boolean = false;

  _selectedNode: ?any = null;
  _editedMesh: ?any = null;
  _selectedVertexIds: Set<number> = new Set();
  _selectedTriangleIds: Set<number> = new Set();

  _editOverlay: ?any = null;
  _selectionBoxHelper: ?any = null;
  _meshProxy: any;

  _animationFrameId: number = 0;
  _isDisposed: boolean = false;

  _pointerDownPosition: { x: number, y: number } | null = null;
  _dragSnapshot: ?{
    node: any,
    before: Object,
    mesh: any,
    geometryBefore: any,
    startProxyMatrix: any,
    meshWorldInverse: any,
    positions: Float32Array,
    normals: ?Float32Array,
    vertexIds: Array<number>,
  } = null;

  constructor(options: ModelEditorEngineOptions) {
    this._canvas = options.canvas;
    this._options = options;

    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      antialias: true,
      // Needed to read the viewport back for the thumbnail of the resource.
      preserveDrawingBuffer: true,
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1;

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(BACKGROUND_COLOR);

    this._camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
    this._camera.position.set(3, 3, 5);
    this._camera.rotation.order = 'ZYX';

    this._orbitControls = new OrbitControls(
      this._camera,
      this._renderer.domElement
    );
    this._orbitControls.enableDamping = true;
    this._orbitControls.dampingFactor = 0.15;
    this._orbitControls.screenSpacePanning = true;
    this._orbitControls.target.set(0, 0, 0);

    this._transformControls = new TransformControls(
      this._camera,
      this._renderer.domElement
    );
    this._transformControls.setSize(0.9);
    this._transformHelper = this._transformControls.getHelper();
    this._transformHelper.rotation.order = 'ZYX';
    this._scene.add(this._transformHelper);
    this._transformControls.addEventListener(
      'dragging-changed',
      (event: any) => {
        this._orbitControls.enabled = !event.value;
      }
    );
    this._transformControls.addEventListener('mouseDown', () =>
      this._onTransformStarted()
    );
    this._transformControls.addEventListener('objectChange', () =>
      this._onTransformChanged()
    );
    this._transformControls.addEventListener('mouseUp', () =>
      this._onTransformEnded()
    );
    // The proxy is the object the gizmo moves in edit mode.
    this._meshProxy = new THREE.Object3D();
    this._scene.add(this._meshProxy);

    this._setupLights();
    this._setupHelpers();

    this._pmremGenerator = new THREE.PMREMGenerator(this._renderer);
    const roomEnvironment = new RoomEnvironment();
    this._environmentTexture = this._pmremGenerator.fromScene(
      roomEnvironment,
      0.04
    ).texture;
    this._scene.environment = this._environmentTexture;
    roomEnvironment.dispose && roomEnvironment.dispose();

    this._clock = new THREE.Clock();
    this._canvas.addEventListener('pointerdown', this._onPointerDown);
    this._canvas.addEventListener('pointerup', this._onPointerUp);
    this._canvas.addEventListener('dblclick', this._onDoubleClick);

    this.resize();
    this._renderLoop();
  }

  _setupLights() {
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x445566, 1.6);
    hemisphereLight.position.set(0, 1000, 0);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2);
    keyLight.position.set(4, 10, 6);
    keyLight.castShadow = false;

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-6, 4, -5);

    this._lights = new THREE.Group();
    this._lights.add(hemisphereLight, keyLight, fillLight);
    this._scene.add(this._lights);
  }

  _setupHelpers() {
    this._grid = new THREE.GridHelper(100, 100, 0x4a5058, 0x343a41);
    this._grid.material.transparent = true;
    this._grid.material.opacity = 0.65;
    this._axes = new THREE.AxesHelper(1);
    this._scene.add(this._grid, this._axes);
  }

  // -------------------------------------------------------------------------
  // Document
  // -------------------------------------------------------------------------

  setDocument(document: ?GDModelDocument): void {
    this._document = document;
    this._stopAnimation();
    this._selectedNode = null;
    this._editedMesh = null;
    this._selectedVertexIds = new Set();
    this._selectedTriangleIds = new Set();
    this._clearEditOverlay();
    this._transformControls.detach();

    if (this._currentRoot) {
      this._scene.remove(this._currentRoot);
      this._currentRoot = null;
    }

    if (!this._document) {
      this._notifySelectionChanged();
      return;
    }

    this._currentRoot = this._document.getRoot();
    this._scene.add(this._currentRoot);
    this._updateHelpersScale();
    this.focusAll();
    this._notifySelectionChanged();
  }

  getDocument(): ?GDModelDocument {
    return this._document;
  }

  _updateHelpersScale() {
    const document = this._document;
    if (!document) return;
    const size = document.getModelSize();
    const longestSide = Math.max(size.x, size.y, size.z) || 1;
    const gridSize = Math.max(longestSide * 4, 1);

    this._scene.remove(this._grid, this._axes);
    this._grid.geometry.dispose();
    this._grid.material.dispose();
    this._axes.geometry.dispose();
    this._axes.material.dispose();
    this._grid = new THREE.GridHelper(gridSize, 20, 0x4a5058, 0x343a41);
    this._grid.material.transparent = true;
    this._grid.material.opacity = 0.65;
    this._axes = new THREE.AxesHelper(longestSide / 2);
    this._scene.add(this._grid, this._axes);
  }

  // -------------------------------------------------------------------------
  // Modes
  // -------------------------------------------------------------------------

  setMode(mode: EditorMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this._selectedVertexIds = new Set();
    this._selectedTriangleIds = new Set();
    this._clearEditOverlay();
    this._transformControls.detach();

    if (mode === 'mesh') {
      const mesh =
        this._selectedNode && isMesh(this._selectedNode)
          ? this._selectedNode
          : this._document
          ? this._findFirstMesh()
          : null;
      this._editedMesh = mesh || null;
      this._options.onMeshEditingEntered(this._editedMesh);
      this._rebuildEditOverlay();
      this._refreshGizmo();
    } else {
      this._editedMesh = null;
      this._options.onMeshEditingEntered(null);
      this._refreshGizmo();
    }
    this._notifySelectionChanged();
  }

  getMode(): EditorMode {
    return this._mode;
  }

  setMeshSelectionMode(mode: MeshSelectionMode): void {
    this._meshSelectionMode = mode;
    this._selectedVertexIds = new Set();
    this._selectedTriangleIds = new Set();
    this._rebuildEditOverlay();
    this._refreshGizmo();
    this._notifySelectionChanged();
  }

  getMeshSelectionMode(): MeshSelectionMode {
    return this._meshSelectionMode;
  }

  setTransformMode(mode: TransformMode): void {
    this._transformMode = mode;
    this._transformControls.setMode(mode);
  }

  setSnappingEnabled(enabled: boolean): void {
    this._isSnappingEnabled = enabled;
    if (!enabled) {
      this._transformControls.setTranslationSnap(null);
      this._transformControls.setRotationSnap(null);
      this._transformControls.setScaleSnap(null);
      return;
    }
    const size = this._document ? this._document.getModelSize() : null;
    const longestSide = size ? Math.max(size.x, size.y, size.z) || 1 : 1;
    const step = Math.max(longestSide / 100, 0.0001);
    this._transformControls.setTranslationSnap(step);
    this._transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
    this._transformControls.setScaleSnap(0.1);
  }

  _findFirstMesh(): ?any {
    const document = this._document;
    if (!document) return null;
    const meshEntry = document.getMeshEntries()[0];
    return meshEntry ? meshEntry.node : null;
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  getSelectionState(): EngineSelectionState {
    return {
      selectedNodeName: this._selectedNode ? this._selectedNode.name : null,
      selectedMeshName: isMesh(this._selectedNode)
        ? this._selectedNode.name
        : null,
      editedMeshName: this._editedMesh ? this._editedMesh.name : null,
      selectedVertexCount: this._selectedVertexIds.size,
      selectedTriangleCount: this._selectedTriangleIds.size,
    };
  }

  _notifySelectionChanged() {
    this._options.onSelectionChanged(this.getSelectionState());
  }

  selectNodeByName(name: ?string): void {
    const document = this._document;
    if (!document) return;
    const node = name ? document.findNodeByName(name) : null;
    this._selectedNode = node || null;
    this._selectedVertexIds = new Set();
    this._selectedTriangleIds = new Set();

    if (this._mode === 'mesh') {
      this._editedMesh = isMesh(node) ? node : this._editedMesh;
      this._options.onMeshEditingEntered(this._editedMesh);
      this._rebuildEditOverlay();
    }
    this._selectionBoxHelper && this._scene.remove(this._selectionBoxHelper);
    this._selectionBoxHelper = null;
    if (this._selectedNode) {
      this._selectionBoxHelper = new THREE.BoxHelper(
        this._selectedNode,
        SELECTION_COLOR
      );
      this._scene.add(this._selectionBoxHelper);
    }
    this._refreshGizmo();
    this._notifySelectionChanged();
  }

  getSelectedNode(): ?any {
    return this._selectedNode;
  }

  getEditedMesh(): ?any {
    return this._editedMesh;
  }

  getSelectedVertexIds(): Set<number> {
    return this._selectedVertexIds;
  }

  getSelectedTriangleIds(): Set<number> {
    return this._selectedTriangleIds;
  }

  clearSelection(): void {
    this._selectedVertexIds = new Set();
    this._selectedTriangleIds = new Set();
    this._rebuildEditOverlay();
    this._refreshGizmo();
    this._notifySelectionChanged();
  }

  selectAllMeshElements(): void {
    const mesh = this._editedMesh;
    if (!mesh) return;
    const triangleCount = getTriangleCount(mesh.geometry);
    const triangleIds = new Set<number>();
    for (let triangleId = 0; triangleId < triangleCount; triangleId++)
      triangleIds.add(triangleId);
    this._selectedTriangleIds = triangleIds;
    this._selectedVertexIds = getVerticesOfTriangles(
      mesh.geometry,
      triangleIds
    );
    this._rebuildEditOverlay();
    this._refreshGizmo();
    this._notifySelectionChanged();
  }

  /** Called by the UI after a mesh operation replaced the geometry. */
  refreshAfterGeometryChange(): void {
    this._rebuildEditOverlay();
    this._refreshGizmo();
    this._notifySelectionChanged();
  }

  _refreshGizmo() {
    if (this._mode === 'mesh') {
      const mesh = this._editedMesh;
      if (!mesh || !this._selectedVertexIds.size) {
        this._transformControls.detach();
        return;
      }
      mesh.updateMatrixWorld(true);
      const centroid = getCentroid(mesh.geometry, this._selectedVertexIds);
      const worldPosition = new THREE.Vector3().fromArray([
        centroid.x,
        centroid.y,
        centroid.z,
      ]);
      mesh.localToWorld(worldPosition);
      this._meshProxy.position.copy(worldPosition);
      this._meshProxy.rotation.set(0, 0, 0);
      this._meshProxy.scale.set(1, 1, 1);
      this._transformControls.setMode(this._transformMode);
      this._transformControls.attach(this._meshProxy);
      return;
    }

    if (this._selectedNode) {
      this._transformControls.setMode(this._transformMode);
      this._transformControls.attach(this._selectedNode);
    } else {
      this._transformControls.detach();
    }
  }

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  _getPointerPosition(event: any): { x: number, y: number } {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  _raycast(event: any): Array<any> {
    const document = this._document;
    if (!document) return [];
    const position = this._getPointerPosition(event);
    const rect = this._canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      (position.x / Math.max(rect.width, 1)) * 2 - 1,
      -(position.y / Math.max(rect.height, 1)) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this._camera);
    return raycaster.intersectObject(document.getRoot(), true);
  }

  _onPointerDown = (event: any) => {
    this._pointerDownPosition = { x: event.clientX, y: event.clientY };
  };

  _onPointerUp = (event: any) => {
    const pointerDownPosition = this._pointerDownPosition;
    this._pointerDownPosition = null;
    if (!pointerDownPosition) return;

    // A click, not the end of an orbit/pan gesture.
    const movement = Math.max(
      Math.abs(event.clientX - pointerDownPosition.x),
      Math.abs(event.clientY - pointerDownPosition.y)
    );
    if (movement > 4) return;
    if (event.button !== 0) return;
    if (!this._document) return;

    const hits = this._raycast(event);
    const isAdditive = event.shiftKey || event.ctrlKey || event.metaKey;

    if (this._mode === 'object') {
      if (!hits.length) {
        this.selectNodeByName(null);
        return;
      }
      const hitObject = hits[0].object;
      this.selectNodeByName(hitObject.name);
      return;
    }

    // Mesh mode.
    if (!hits.length) {
      if (!isAdditive) this.clearSelection();
      return;
    }

    const hit = hits[0];
    const mesh = hit.object;
    if (!isMesh(mesh)) return;
    if (this._editedMesh !== mesh) {
      this._editedMesh = mesh;
      this._selectedVertexIds = new Set();
      this._selectedTriangleIds = new Set();
      this._options.onMeshEditingEntered(mesh);
    }

    if (this._meshSelectionMode === 'face') {
      if (typeof hit.faceIndex !== 'number') return;
      this._selectTriangle(mesh, hit.faceIndex, isAdditive);
    } else if (this._meshSelectionMode === 'vertex') {
      const vertexId = this._findNearestVertex(mesh, hit.point);
      if (vertexId !== null) this._selectVertex(mesh, vertexId, isAdditive);
    } else {
      const edge = this._findNearestEdge(mesh, hit);
      if (edge) {
        const vertexIds = isAdditive
          ? new Set(this._selectedVertexIds)
          : new Set<number>();
        vertexIds.add(edge[0]);
        vertexIds.add(edge[1]);
        this._setVertexSelection(mesh, vertexIds);
      }
    }
  };

  _onDoubleClick = () => {
    this.focusSelection();
  };

  _findNearestVertex(mesh: any, worldPoint: any): ?number {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position) return null;

    mesh.updateMatrixWorld(true);
    const localPoint = mesh.worldToLocal(worldPoint.clone());
    // The search is done in local space, with a tolerance relative to the size
    // of the mesh, so that it works at any zoom level.
    const box = new THREE.Box3().setFromBufferAttribute(position);
    const size = new THREE.Vector3();
    box.getSize(size);
    const tolerance = Math.max(size.x, size.y, size.z) * 0.02;

    let nearestVertexId = null;
    let nearestDistanceSquared = tolerance * tolerance;
    for (let vertexId = 0; vertexId < position.count; vertexId++) {
      const dx = position.getX(vertexId) - localPoint.x;
      const dy = position.getY(vertexId) - localPoint.y;
      const dz = position.getZ(vertexId) - localPoint.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared <= nearestDistanceSquared) {
        nearestDistanceSquared = distanceSquared;
        nearestVertexId = vertexId;
      }
    }
    return nearestVertexId;
  }

  _findNearestEdge(mesh: any, hit: any): ?[number, number] {
    if (typeof hit.faceIndex !== 'number') return null;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const triangle = getTriangle(geometry, hit.faceIndex);
    const localPoint = mesh.worldToLocal(hit.point.clone());

    const distanceToSegment = (start: any, end: any, point: any): number => {
      const direction = new THREE.Vector3().subVectors(end, start);
      const lengthSquared = direction.lengthSq();
      const ratio =
        lengthSquared > 0
          ? clamp(
              new THREE.Vector3().subVectors(point, start).dot(direction) /
                lengthSquared,
              0,
              1
            )
          : 0;
      const closestPoint = start.clone().add(direction.multiplyScalar(ratio));
      return closestPoint.distanceTo(point);
    };

    const edges: Array<[number, number]> = [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ];

    let nearestEdge = null;
    let nearestDistance = Infinity;
    edges.forEach(([first, second]) => {
      const start = new THREE.Vector3().fromBufferAttribute(position, first);
      const end = new THREE.Vector3().fromBufferAttribute(position, second);
      const distance = distanceToSegment(start, end, localPoint);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestEdge = [first, second];
      }
    });
    return nearestEdge;
  }

  _selectTriangle(mesh: any, triangleId: number, isAdditive: boolean) {
    const triangleIds = isAdditive
      ? new Set(this._selectedTriangleIds)
      : new Set<number>();
    if (triangleIds.has(triangleId)) triangleIds.delete(triangleId);
    else triangleIds.add(triangleId);

    this._selectedTriangleIds = triangleIds;
    this._selectedVertexIds = getVerticesOfTriangles(
      mesh.geometry,
      triangleIds
    );
    this._rebuildEditOverlay();
    this._refreshGizmo();
    this._notifySelectionChanged();
  }

  _selectVertex(mesh: any, vertexId: number, isAdditive: boolean) {
    const vertexIds = isAdditive
      ? new Set(this._selectedVertexIds)
      : new Set<number>();
    if (vertexIds.has(vertexId)) vertexIds.delete(vertexId);
    else vertexIds.add(vertexId);
    this._setVertexSelection(mesh, vertexIds);
  }

  _setVertexSelection(mesh: any, vertexIds: Set<number>) {
    this._selectedVertexIds = vertexIds;
    this._selectedTriangleIds = getTrianglesOfVertices(
      mesh.geometry,
      vertexIds
    );
    this._rebuildEditOverlay();
    this._refreshGizmo();
    this._notifySelectionChanged();
  }

  // -------------------------------------------------------------------------
  // Edit overlay (vertices, wireframe, selected faces)
  // -------------------------------------------------------------------------

  _clearEditOverlay() {
    if (!this._editOverlay) return;
    this._scene.remove(this._editOverlay);
    this._editOverlay.traverse((object: any) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) object.material.dispose();
    });
    this._editOverlay = null;
  }

  _rebuildEditOverlay() {
    this._clearEditOverlay();
    const mesh = this._editedMesh;
    if (!mesh || this._mode !== 'mesh') return;

    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position) return;
    mesh.updateMatrixWorld(true);

    const overlay = new THREE.Group();
    overlay.matrixAutoUpdate = false;
    overlay.matrix.copy(mesh.matrixWorld);

    const box = new THREE.Box3().setFromBufferAttribute(position);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longestSide = Math.max(size.x, size.y, size.z) || 1;

    // Every vertex, as a small dot.
    const verticesGeometry = new THREE.BufferGeometry();
    verticesGeometry.setAttribute('position', position.clone());
    const vertices = new THREE.Points(
      verticesGeometry,
      new THREE.PointsMaterial({
        color: WIREFRAME_COLOR,
        size: longestSide / 220,
        sizeAttenuation: true,
        depthTest: true,
      })
    );
    vertices.renderOrder = 2;
    overlay.add(vertices);

    // The wireframe, only for meshes small enough to stay interactive.
    if (getTriangleCount(geometry) <= MAX_TRIANGLES_FOR_WIREFRAME) {
      const wireframe = new THREE.LineSegments(
        new THREE.WireframeGeometry(geometry),
        new THREE.LineBasicMaterial({
          color: WIREFRAME_COLOR,
          transparent: true,
          opacity: 0.35,
        })
      );
      overlay.add(wireframe);
    }

    // The selected faces.
    if (this._selectedTriangleIds.size) {
      const selectedGeometry = keepTriangles(
        geometry,
        this._selectedTriangleIds
      );
      const selectedFaces = new THREE.Mesh(
        selectedGeometry,
        new THREE.MeshBasicMaterial({
          color: SELECTION_COLOR,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      selectedFaces.renderOrder = 3;
      overlay.add(selectedFaces);
    }

    // The selected vertices, as bigger dots.
    if (this._selectedVertexIds.size) {
      const selectedPositions = new Float32Array(
        this._selectedVertexIds.size * 3
      );
      let index = 0;
      this._selectedVertexIds.forEach(vertexId => {
        selectedPositions[index++] = position.getX(vertexId);
        selectedPositions[index++] = position.getY(vertexId);
        selectedPositions[index++] = position.getZ(vertexId);
      });
      const selectedVerticesGeometry = new THREE.BufferGeometry();
      selectedVerticesGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(selectedPositions, 3)
      );
      const selectedVertices = new THREE.Points(
        selectedVerticesGeometry,
        new THREE.PointsMaterial({
          color: SELECTION_COLOR,
          size: longestSide / 110,
          sizeAttenuation: true,
          depthTest: false,
        })
      );
      selectedVertices.renderOrder = 4;
      overlay.add(selectedVertices);
    }

    this._editOverlay = overlay;
    this._scene.add(overlay);
  }

  // -------------------------------------------------------------------------
  // Transform
  // -------------------------------------------------------------------------

  _onTransformStarted() {
    const node = this._selectedNode;
    if (this._mode === 'object') {
      if (!node) return;
      this._dragSnapshot = {
        node,
        before: {
          position: node.position.toArray(),
          quaternion: node.quaternion.toArray(),
          scale: node.scale.toArray(),
        },
        mesh: null,
        geometryBefore: null,
        startProxyMatrix: new THREE.Matrix4(),
        meshWorldInverse: new THREE.Matrix4(),
        positions: new Float32Array(0),
        normals: null,
        vertexIds: [],
      };
      return;
    }

    const mesh = this._editedMesh;
    if (!mesh || !this._selectedVertexIds.size) return;
    mesh.updateMatrixWorld(true);

    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const vertexIds = Array.from(this._selectedVertexIds);

    this._dragSnapshot = {
      node: mesh,
      before: {
        position: mesh.position.toArray(),
        quaternion: mesh.quaternion.toArray(),
        scale: mesh.scale.toArray(),
      },
      mesh,
      geometryBefore: geometry.clone(),
      startProxyMatrix: this._meshProxy.matrixWorld.clone(),
      meshWorldInverse: new THREE.Matrix4().copy(mesh.matrixWorld).invert(),
      positions: new Float32Array(position.array),
      normals: normal ? new Float32Array(normal.array) : null,
      vertexIds,
    };
  }

  _onTransformChanged() {
    const snapshot = this._dragSnapshot;
    if (!snapshot) return;

    if (this._mode === 'object') {
      if (this._selectionBoxHelper && this._selectedNode)
        this._selectionBoxHelper.setFromObject(this._selectedNode);
      return;
    }

    const {
      mesh,
      geometryBefore,
      startProxyMatrix,
      meshWorldInverse,
    } = snapshot;
    if (!mesh || !geometryBefore) return;

    const deltaWorld = new THREE.Matrix4()
      .copy(this._meshProxy.matrixWorld)
      .multiply(new THREE.Matrix4().copy(startProxyMatrix).invert());
    // The vertices are in the space of the mesh: bring the world delta in.
    const deltaLocal = new THREE.Matrix4()
      .copy(mesh.matrixWorld)
      .multiply(deltaWorld)
      .multiply(meshWorldInverse);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(deltaLocal);

    const position = mesh.geometry.getAttribute('position');
    const normal = mesh.geometry.getAttribute('normal');
    const sourcePosition = geometryBefore.getAttribute('position');
    const sourceNormal = geometryBefore.getAttribute('normal');
    const point = new THREE.Vector3();
    const normalVector = new THREE.Vector3();

    snapshot.vertexIds.forEach(vertexId => {
      point
        .set(
          sourcePosition.getX(vertexId),
          sourcePosition.getY(vertexId),
          sourcePosition.getZ(vertexId)
        )
        .applyMatrix4(deltaLocal);
      position.setXYZ(vertexId, point.x, point.y, point.z);

      if (normal && sourceNormal) {
        normalVector
          .set(
            sourceNormal.getX(vertexId),
            sourceNormal.getY(vertexId),
            sourceNormal.getZ(vertexId)
          )
          .applyMatrix3(normalMatrix)
          .normalize();
        normal.setXYZ(vertexId, normalVector.x, normalVector.y, normalVector.z);
      }
    });
    position.needsUpdate = true;
    if (normal) normal.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeBoundingBox();

    this._rebuildEditOverlay();
  }

  _onTransformEnded() {
    const snapshot = this._dragSnapshot;
    this._dragSnapshot = null;
    if (!snapshot) return;

    if (this._mode === 'object') {
      const node = snapshot.node;
      const after = {
        position: node.position.toArray(),
        quaternion: node.quaternion.toArray(),
        scale: node.scale.toArray(),
      };
      if (this._selectionBoxHelper)
        this._selectionBoxHelper.setFromObject(node);
      const hasChanged =
        JSON.stringify(snapshot.before) !== JSON.stringify(after);
      if (hasChanged)
        this._options.onObjectTransformCommitted(node, snapshot.before, after);
      return;
    }

    const mesh = snapshot.mesh;
    if (!mesh || !snapshot.geometryBefore) return;
    const geometryAfter = mesh.geometry.clone();
    const hasChanged = Array.from(
      geometryAfter.getAttribute('position').array
    ).some(
      (value, index) =>
        Math.abs(
          value - snapshot.geometryBefore.getAttribute('position').array[index]
        ) > 1e-6
    );
    this._rebuildEditOverlay();
    if (hasChanged)
      this._options.onMeshEditCommitted(
        mesh,
        snapshot.geometryBefore,
        geometryAfter
      );
  }

  // -------------------------------------------------------------------------
  // Animation preview
  // -------------------------------------------------------------------------

  playAnimation(clipIndex: number): void {
    const document = this._document;
    if (!document) return;
    const clip = document.getAnimations()[clipIndex];
    if (!clip) return;

    this._stopAnimation();
    const root = document.getRoot();
    this._mixer = new THREE.AnimationMixer(root);
    const action = this._mixer.clipAction(clip);
    action.play();
    this._mixer.setTime(0);
    this._currentClipIndex = clipIndex;
    this._isPlaying = true;
  }

  pauseAnimation(): void {
    this._isPlaying = false;
  }

  resumeAnimation(): void {
    if (this._mixer) this._isPlaying = true;
  }

  setAnimationTime(time: number): void {
    if (this._mixer) this._mixer.setTime(Math.max(0, time));
  }

  getAnimationTime(): number {
    return this._mixer ? this._mixer.time : 0;
  }

  isPlayingAnimation(): boolean {
    return this._isPlaying;
  }

  getAnimationDuration(): number {
    const document = this._document;
    if (!document || this._currentClipIndex === null) return 0;
    const clip = document.getAnimations()[this._currentClipIndex];
    return clip ? clip.duration : 0;
  }

  _stopAnimation() {
    if (this._mixer) {
      this._mixer.stopAllAction();
      this._mixer.uncacheRoot(this._mixer.getRoot());
      this._mixer = null;
    }
    this._isPlaying = false;
    this._currentClipIndex = null;
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  focusAll(): void {
    const document = this._document;
    if (!document) return;
    this._frameBox(new THREE.Box3().setFromObject(document.getRoot()));
  }

  focusSelection(): void {
    if (
      this._mode === 'mesh' &&
      this._editedMesh &&
      this._selectedVertexIds.size
    ) {
      const mesh = this._editedMesh;
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3();
      const position = mesh.geometry.getAttribute('position');
      const point = new THREE.Vector3();
      this._selectedVertexIds.forEach(vertexId => {
        point
          .set(
            position.getX(vertexId),
            position.getY(vertexId),
            position.getZ(vertexId)
          )
          .applyMatrix4(mesh.matrixWorld);
        box.expandByPoint(point);
      });
      this._frameBox(box);
      return;
    }
    if (this._selectedNode) {
      this._frameBox(new THREE.Box3().setFromObject(this._selectedNode));
      return;
    }
    this.focusAll();
  }

  _frameBox(box: any): void {
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.001);
    const distance =
      (radius * 1.6) / Math.sin((this._camera.fov * Math.PI) / 360);

    const direction = new THREE.Vector3(1, 0.75, 1).normalize();
    this._camera.position
      .copy(sphere.center)
      .add(direction.multiplyScalar(distance));
    this._camera.near = Math.max(distance / 1000, 0.0001);
    this._camera.far = distance * 100;
    this._camera.updateProjectionMatrix();
    this._orbitControls.target.copy(sphere.center);
    this._orbitControls.update();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  resize(): void {
    const canvas = this._canvas;
    const container = canvas.parentElement;
    const width = canvas.clientWidth || (container ? container.clientWidth : 0);
    const height =
      canvas.clientHeight || (container ? container.clientHeight : 0);
    if (!width || !height) return;
    this._renderer.setSize(width, height, false);
    this._camera.aspect = width / height;
    this._camera.updateProjectionMatrix();
  }

  _renderLoop = () => {
    if (this._isDisposed) return;
    this._animationFrameId = requestAnimationFrame(this._renderLoop);

    const delta = this._clock.getDelta();
    if (this._mixer && this._isPlaying) this._mixer.update(delta);
    if (this._selectionBoxHelper) this._selectionBoxHelper.update();
    this._orbitControls.update();
    if (this._editOverlay && this._editedMesh) {
      this._editedMesh.updateMatrixWorld();
      this._editOverlay.matrix.copy(this._editedMesh.matrixWorld);
    }
    this._renderer.render(this._scene, this._camera);
  };

  /**
   * Render the model on a small square canvas, for the thumbnail of the
   * resource. The camera is restored afterwards.
   */
  async captureThumbnail(size: number = 256): Promise<?Uint8Array> {
    const document = this._document;
    if (!document) return null;

    const previousSize = new THREE.Vector2();
    this._renderer.getSize(previousSize);
    const previousPixelRatio = this._renderer.getPixelRatio();
    const previousCameraPosition = this._camera.position.clone();
    const previousTarget = this._orbitControls.target.clone();
    const previousGridVisibility = this._grid.visible;
    const previousAxesVisibility = this._axes.visible;
    const previousEnvironment = this._scene.environment;
    const previousBackground = this._scene.background;

    this._grid.visible = false;
    this._axes.visible = false;
    this._scene.background = new THREE.Color(BACKGROUND_COLOR);

    const box = new THREE.Box3().setFromObject(document.getRoot());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.001);
    const distance =
      (radius * 1.5) / Math.sin((this._camera.fov * Math.PI) / 360);
    this._camera.position
      .copy(sphere.center)
      .add(new THREE.Vector3(0.9, 0.6, 1).normalize().multiplyScalar(distance));
    this._camera.lookAt(sphere.center);
    this._camera.aspect = 1;
    this._camera.near = Math.max(distance / 1000, 0.0001);
    this._camera.far = distance * 100;
    this._camera.updateProjectionMatrix();

    this._renderer.setPixelRatio(1);
    this._renderer.setSize(size, size, false);
    this._renderer.render(this._scene, this._camera);

    let bytes = null;
    try {
      const canvas = this._renderer.domElement;
      const blob = await new Promise(resolve =>
        canvas.toBlob(newBlob => resolve(newBlob), 'image/png')
      );
      if (blob) bytes = new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      console.warn('Unable to render the thumbnail of the model:', error);
    }

    this._grid.visible = previousGridVisibility;
    this._axes.visible = previousAxesVisibility;
    this._scene.environment = previousEnvironment;
    this._scene.background = previousBackground;
    this._camera.position.copy(previousCameraPosition);
    this._camera.aspect =
      (this._canvas.clientWidth || 1) / (this._canvas.clientHeight || 1);
    this._camera.updateProjectionMatrix();
    this._orbitControls.target.copy(previousTarget);
    this._renderer.setPixelRatio(previousPixelRatio);
    this._renderer.setSize(previousSize.x, previousSize.y, false);

    return bytes;
  }

  dispose(): void {
    this._isDisposed = true;
    cancelAnimationFrame(this._animationFrameId);
    this._canvas.removeEventListener('pointerdown', this._onPointerDown);
    this._canvas.removeEventListener('pointerup', this._onPointerUp);
    this._canvas.removeEventListener('dblclick', this._onDoubleClick);

    this._stopAnimation();
    this._clearEditOverlay();
    if (this._selectionBoxHelper) {
      this._scene.remove(this._selectionBoxHelper);
      this._selectionBoxHelper = null;
    }
    this._transformControls.detach();
    this._transformControls.dispose();
    this._orbitControls.dispose();
    if (this._environmentTexture) this._environmentTexture.dispose();
    if (this._pmremGenerator) this._pmremGenerator.dispose();

    this._scene.traverse((object: any) => {
      if (object.geometry && object !== this._grid) object.geometry.dispose();
    });
    this._renderer.dispose();
  }
}
