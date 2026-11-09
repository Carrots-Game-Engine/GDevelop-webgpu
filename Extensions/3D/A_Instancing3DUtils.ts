namespace gdjs {
  const instancingEpsilon = 1 / (1 << 16);

  /** Names of the primitives that can be used to build instanced geometries. */
  export type Instancing3DPrimitiveName =
    'Box' | 'Sphere' | 'Cylinder' | 'Cone' | 'Torus' | 'Plane';

  /** The primitives proposed by default, in this order. */
  export const instancing3DPrimitiveNames: Array<Instancing3DPrimitiveName> = [
    'Box',
    'Sphere',
    'Cylinder',
    'Cone',
    'Torus',
    'Plane',
  ];

  /** A geometry that can be added to an instancing palette. */
  export interface Instancing3DGeometryData {
    name: string;
    geometry: THREE.BufferGeometry;
  }

  const temporaryInstancingPosition = new THREE.Vector3();
  const temporaryInstancingScale = new THREE.Vector3();
  const temporaryInstancingQuaternion = new THREE.Quaternion();
  const temporaryInstancingEuler = new THREE.Euler();

  /**
   * Return the primitive name matching `value` ignoring case and spaces, or
   * null when it is unknown.
   */
  export const getInstancing3DPrimitiveName = (
    value: string
  ): Instancing3DPrimitiveName | null => {
    const normalizedValue = value.trim().toLowerCase();
    for (const primitiveName of instancing3DPrimitiveNames) {
      if (primitiveName.toLowerCase() === normalizedValue) {
        return primitiveName;
      }
    }
    return null;
  };

  /**
   * Parse a comma separated list of primitives. Unknown names are ignored and
   * duplicates are removed.
   */
  export const parseInstancing3DPrimitiveNames = (
    value: string | undefined
  ): Array<Instancing3DPrimitiveName> => {
    const primitiveNames: Array<Instancing3DPrimitiveName> = [];
    if (!value) return primitiveNames;
    for (const part of value.split(',')) {
      const primitiveName = getInstancing3DPrimitiveName(part);
      if (primitiveName && !primitiveNames.includes(primitiveName)) {
        primitiveNames.push(primitiveName);
      }
    }
    return primitiveNames;
  };

  /**
   * Parse a comma separated list of mesh names. Empty entries are ignored.
   */
  export const parseInstancing3DMeshNames = (
    value: string | undefined
  ): string[] => {
    if (!value) return [];
    return value
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
  };

  /**
   * Copy a geometry in a plain indexed buffer geometry with only the
   * `position`, `normal` and `uv` attributes.
   *
   * `THREE.BatchedMesh` requires every geometry of a batch to share the same
   * attributes, so attributes like tangents, colors or skinning data are
   * dropped. Missing normals and UVs are generated.
   */
  export const prepareInstancing3DGeometry = (
    source: THREE.BufferGeometry
  ): THREE.BufferGeometry => {
    const sourcePosition = source.getAttribute('position');
    if (!sourcePosition) {
      return prepareInstancing3DGeometry(new THREE.BoxGeometry(1, 1, 1));
    }
    const vertexCount = sourcePosition.count;
    const positions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = sourcePosition.getX(i);
      positions[i * 3 + 1] = sourcePosition.getY(i);
      positions[i * 3 + 2] = sourcePosition.getZ(i);
    }

    const normals = new Float32Array(vertexCount * 3);
    const sourceNormal = source.getAttribute('normal');
    if (sourceNormal) {
      for (let i = 0; i < vertexCount; i++) {
        normals[i * 3] = sourceNormal.getX(i);
        normals[i * 3 + 1] = sourceNormal.getY(i);
        normals[i * 3 + 2] = sourceNormal.getZ(i);
      }
    }

    const uvs = new Float32Array(vertexCount * 2);
    const sourceUv = source.getAttribute('uv');
    if (sourceUv) {
      for (let i = 0; i < vertexCount; i++) {
        uvs[i * 2] = sourceUv.getX(i);
        uvs[i * 2 + 1] = sourceUv.getY(i);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const sourceIndex = source.getIndex();
    if (sourceIndex) {
      const indices =
        sourceIndex.count > 65535
          ? new Uint32Array(sourceIndex.count)
          : new Uint16Array(sourceIndex.count);
      for (let i = 0; i < sourceIndex.count; i++) {
        indices[i] = sourceIndex.getX(i);
      }
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    } else {
      const indices =
        vertexCount > 65535
          ? new Uint32Array(vertexCount)
          : new Uint16Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) {
        indices[i] = i;
      }
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    }

    if (!sourceNormal) {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  };

  /**
   * Flip a geometry on the Y axis to match the GDevelop 3D convention (Y goes
   * down, like on the 2D plane). The winding of the triangles is reversed so
   * that faces keep facing the same direction.
   */
  export const flipInstancing3DGeometryY = (
    geometry: THREE.BufferGeometry
  ): void => {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < position.count; i++) {
      position.setY(i, -position.getY(i));
      if (normal) normal.setY(i, -normal.getY(i));
    }
    position.needsUpdate = true;
    if (normal) normal.needsUpdate = true;

    const index = geometry.getIndex();
    if (!index) {
      throw new Error('flipInstancing3DGeometryY expects an indexed geometry.');
    }
    // `index.array` may be shared with a source geometry, but geometries
    // prepared by this module own their buffers.
    const indexArray = index.array;
    for (let i = 0; i < indexArray.length; i += 3) {
      const second = indexArray[i + 1];
      indexArray[i + 1] = indexArray[i + 2];
      indexArray[i + 2] = second;
    }
    index.needsUpdate = true;
    if (!normal) {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  };

  /**
   * Stretch a geometry in a 1x1x1 cube centered on the origin.
   */
  export const normalizeInstancing3DGeometry = (
    geometry: THREE.BufferGeometry
  ): void => {
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    if (!boundingBox) return;
    const size = boundingBox.getSize(new THREE.Vector3());
    const center = boundingBox.getCenter(new THREE.Vector3());
    const scaleX = size.x < instancingEpsilon ? 1 : 1 / size.x;
    const scaleY = size.y < instancingEpsilon ? 1 : 1 / size.y;
    const scaleZ = size.z < instancingEpsilon ? 1 : 1 / size.z;
    const matrix = new THREE.Matrix4()
      .makeScale(scaleX, scaleY, scaleZ)
      .multiply(
        new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z)
      );
    geometry.applyMatrix4(matrix);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  };

  /**
   * Create a primitive geometry normalized in a 1x1x1 cube centered on the
   * origin, oriented like a model authored with a Y-up axis system.
   */
  export const createInstancing3DPrimitiveGeometry = (
    primitiveName: Instancing3DPrimitiveName
  ): THREE.BufferGeometry => {
    let source: THREE.BufferGeometry;
    switch (primitiveName) {
      case 'Sphere':
        source = new THREE.SphereGeometry(0.5, 24, 16);
        break;
      case 'Cylinder':
        source = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1);
        break;
      case 'Cone':
        source = new THREE.ConeGeometry(0.5, 1, 24, 1);
        break;
      case 'Torus':
        source = new THREE.TorusGeometry(0.35, 0.15, 16, 32);
        break;
      case 'Plane':
        source = new THREE.PlaneGeometry(1, 1);
        break;
      case 'Box':
      default:
        source = new THREE.BoxGeometry(1, 1, 1);
        break;
    }
    const geometry = prepareInstancing3DGeometry(source);
    source.dispose();
    flipInstancing3DGeometryY(geometry);
    normalizeInstancing3DGeometry(geometry);
    return geometry;
  };

  /**
   * Extract the geometries of the meshes of a model as standalone geometries
   * normalized in a 1x1x1 cube.
   *
   * The model is not modified. When `meshNames` is not empty, only the meshes
   * whose name matches (ignoring case) are returned.
   */
  export const extractInstancing3DModelGeometries = (
    model: THREE_ADDONS.GLTF | null,
    meshNames: string[]
  ): Array<Instancing3DGeometryData> => {
    const extractedGeometries: Array<Instancing3DGeometryData> = [];
    if (!model || !model.scene) return extractedGeometries;

    model.scene.updateMatrixWorld(true);
    const inverseSceneMatrix = new THREE.Matrix4();
    if (model.scene.matrixWorld.determinant() === 0) {
      inverseSceneMatrix.identity();
    } else {
      inverseSceneMatrix.copy(model.scene.matrixWorld).invert();
    }
    const normalizedMeshNames = meshNames.map((name) => name.toLowerCase());
    const nameCounts = new Map<string, number>();

    model.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const meshName = mesh.name || '';
      if (
        normalizedMeshNames.length > 0 &&
        !normalizedMeshNames.includes(meshName.toLowerCase())
      ) {
        return;
      }

      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(
          inverseSceneMatrix,
          mesh.matrixWorld
        )
      );
      const preparedGeometry = prepareInstancing3DGeometry(geometry);
      geometry.dispose();
      flipInstancing3DGeometryY(preparedGeometry);
      normalizeInstancing3DGeometry(preparedGeometry);

      const baseName = meshName || 'Mesh';
      const nameCount = nameCounts.get(baseName) || 0;
      nameCounts.set(baseName, nameCount + 1);
      extractedGeometries.push({
        name: nameCount === 0 ? baseName : `${baseName} ${nameCount + 1}`,
        geometry: preparedGeometry,
      });
    });

    return extractedGeometries;
  };

  const instancingColor = new THREE.Color();

  /**
   * Set a `THREE.Color` from a GDevelop color string (`"r;g;b"` or
   * `"#rrggbb"`). White is used when the string is invalid.
   */
  export const setInstancing3DColorFromString = (
    color: THREE.Color,
    colorString: string | undefined
  ): void => {
    if (!colorString || !colorString.trim()) {
      color.setRGB(1, 1, 1);
      return;
    }
    const components = gdjs.rgbOrHexToRGBColor(colorString);
    color.setRGB(components[0] / 255, components[1] / 255, components[2] / 255);
  };

  /**
   * Convert a color to the `"r;g;b"` GDevelop format.
   */
  export const getInstancing3DColorString = (
    red: number,
    green: number,
    blue: number
  ): string => {
    return `${Math.round(red * 255)};${Math.round(green * 255)};${Math.round(
      blue * 255
    )}`;
  };

  /**
   * Create the material shared by every instance of an instancing object.
   */
  export const createInstancing3DMaterial = (
    materialType: string | undefined,
    tint: string | undefined
  ): THREE.Material => {
    setInstancing3DColorFromString(instancingColor, tint);
    if (materialType === 'Basic') {
      return new THREE.MeshBasicMaterial({ color: instancingColor.clone() });
    }
    return new THREE.MeshStandardMaterial({
      color: instancingColor.clone(),
      metalness: 0,
      roughness: 0.8,
    });
  };

  /**
   * Compose the matrix of an instance from normalized coordinates (0 to 1 in
   * the object box), rotations in degrees and local scale multipliers.
   *
   * The local space is centered on the object box because the renderer root is
   * positioned on the object center and scaled to the object size.
   */
  export const composeInstancing3DMatrix = (
    matrix: THREE.Matrix4,
    x: number,
    y: number,
    z: number,
    rotationX: number,
    rotationY: number,
    rotationZ: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number
  ): void => {
    temporaryInstancingPosition.set(x - 0.5, y - 0.5, z - 0.5);
    temporaryInstancingEuler.set(
      gdjs.toRad(rotationX),
      gdjs.toRad(rotationY),
      gdjs.toRad(rotationZ),
      'ZYX'
    );
    temporaryInstancingQuaternion.setFromEuler(temporaryInstancingEuler);
    temporaryInstancingScale.set(scaleX, scaleY, scaleZ);
    matrix.compose(
      temporaryInstancingPosition,
      temporaryInstancingQuaternion,
      temporaryInstancingScale
    );
  };

  const hashInstancingLayoutValue = (value: number): number => {
    const hash = Math.sin(value * 127.1 + 311.7) * 43758.5453;
    return hash - Math.floor(hash);
  };

  /**
   * Compute the default position and scale of an instance for a layout.
   *
   * Positions are normalized in the object box and scales are local
   * multipliers, so that instances don't overlap in the initial layout.
   */
  export const getInstancing3DInitialLayout = (
    layout: string | undefined,
    index: number,
    instanceCount: number,
    position: THREE.Vector3,
    scale: THREE.Vector3
  ): void => {
    position.set(0.5, 0.5, 0.5);
    scale.set(1, 1, 1);
    if (instanceCount <= 1) return;

    switch (layout) {
      case 'Line': {
        const instanceScale = Math.max(0.02, 0.9 / instanceCount);
        position.set((index + 0.5) / instanceCount, 0.5, 0.5);
        scale.set(instanceScale, instanceScale, instanceScale);
        break;
      }
      case 'Random': {
        position.set(
          0.2 + 0.6 * hashInstancingLayoutValue(index + 1),
          0.2 + 0.6 * hashInstancingLayoutValue(index + 2),
          0.2 + 0.6 * hashInstancingLayoutValue(index + 3)
        );
        scale.set(0.15, 0.15, 0.15);
        break;
      }
      case 'None':
        break;
      case 'Grid':
      default: {
        const columns = Math.ceil(Math.sqrt(instanceCount));
        const rows = Math.ceil(instanceCount / columns);
        const column = index % columns;
        const row = Math.floor(index / columns);
        position.set((column + 0.5) / columns, (row + 0.5) / rows, 0.5);
        const instanceScale = Math.max(
          0.02,
          Math.min(0.9 / columns, 0.9 / rows)
        );
        scale.set(instanceScale, instanceScale, instanceScale);
        break;
      }
    }
  };

  /**
   * Dispose all the geometries of a palette.
   */
  export const disposeInstancing3DGeometries = (
    geometries: Array<Instancing3DGeometryData>
  ): void => {
    for (const geometryData of geometries) {
      geometryData.geometry.dispose();
    }
    geometries.length = 0;
  };
}
