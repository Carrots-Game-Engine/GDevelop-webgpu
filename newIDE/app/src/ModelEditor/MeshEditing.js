// @flow
/**
 * Mesh operations of the 3D model editor.
 *
 * Every operation is a pure function taking a `THREE.BufferGeometry` and
 * returning a *new* geometry (the caller keeps the previous one to undo). They
 * all preserve every attribute of the source geometry (normals, UVs, colors,
 * skinning data...), so that editing a skinned or vertex-colored mesh does not
 * silently drop what makes it look right.
 *
 * They are written without any Three.js addon and without WebGL so that they
 * can be tested headlessly.
 */
import * as THREE from 'three';

export type MeshGeometryStats = {|
  vertexCount: number,
  triangleCount: number,
  hasUVs: boolean,
|};

export type TriangleSelection = {|
  triangleIds: Set<number>,
|};

export type VertexSelection = {|
  vertexIds: Set<number>,
|};

const ATTRIBUTE_CACHE_PREFIX = '__gdModelEditor';

/** Number of triangles of a geometry, whether it is indexed or not. */
export const getTriangleCount = (geometry: any): number => {
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  return Math.floor(
    (geometry.index ? geometry.index.count : position.count) / 3
  );
};

/** Vertex indices of a triangle. */
export const getTriangle = (
  geometry: any,
  triangleId: number
): [number, number, number] => {
  const index = geometry.index;
  if (index)
    return [
      index.getX(triangleId * 3),
      index.getX(triangleId * 3 + 1),
      index.getX(triangleId * 3 + 2),
    ];
  return [triangleId * 3, triangleId * 3 + 1, triangleId * 3 + 2];
};

/** Vertex indices used by a set of triangles. */
export const getVerticesOfTriangles = (
  geometry: any,
  triangleIds: Set<number>
): Set<number> => {
  const vertexIds = new Set<number>();
  triangleIds.forEach(triangleId => {
    const triangle = getTriangle(geometry, triangleId);
    vertexIds.add(triangle[0]);
    vertexIds.add(triangle[1]);
    vertexIds.add(triangle[2]);
  });
  return vertexIds;
};

/** Triangles of a geometry using any of these vertices. */
export const getTrianglesOfVertices = (
  geometry: any,
  vertexIds: Set<number>
): Set<number> => {
  const triangleIds = new Set<number>();
  const triangleCount = getTriangleCount(geometry);
  for (let triangleId = 0; triangleId < triangleCount; triangleId++) {
    const triangle = getTriangle(geometry, triangleId);
    if (
      vertexIds.has(triangle[0]) ||
      vertexIds.has(triangle[1]) ||
      vertexIds.has(triangle[2])
    )
      triangleIds.add(triangleId);
  }
  return triangleIds;
};

export const getGeometryStats = (geometry: any): MeshGeometryStats => ({
  vertexCount: geometry.getAttribute('position')
    ? geometry.getAttribute('position').count
    : 0,
  triangleCount: getTriangleCount(geometry),
  hasUVs: !!geometry.getAttribute('uv'),
});

// ---------------------------------------------------------------------------
// Copying vertices between geometries
// ---------------------------------------------------------------------------

/**
 * Builds a geometry from vertices picked (or interpolated) in another one,
 * copying every attribute.
 */
class GeometryBuilder {
  _source: any;
  _attributeNames: Array<string>;
  _values: { [string]: Array<number> };
  _triangles: Array<[number, number, number]> = [];
  _triangleGroups: Array<number> = [];

  constructor(source: any) {
    this._source = source;
    this._attributeNames = Object.keys(source.attributes).filter(
      name => name !== ATTRIBUTE_CACHE_PREFIX
    );
    this._values = {};
    this._attributeNames.forEach(name => {
      this._values[name] = [];
    });
  }

  get vertexCount(): number {
    const firstName = this._attributeNames[0];
    if (!firstName) return 0;
    const attribute = this._source.getAttribute(firstName);
    return this._values[firstName].length / attribute.itemSize;
  }

  /** Copy a vertex of the source geometry. */
  copyVertex(sourceIndex: number): number {
    this._attributeNames.forEach(name => {
      const attribute = this._source.getAttribute(name);
      const itemSize = attribute.itemSize;
      for (let component = 0; component < itemSize; component++)
        this._values[name].push(attribute.getComponent(sourceIndex, component));
    });
    return this.vertexCount - 1;
  }

  /** Copy a vertex of the source geometry, replacing its position. */
  copyVertexWithPosition(
    sourceIndex: number,
    position: { x: number, y: number, z: number }
  ): number {
    const vertexIndex = this.copyVertex(sourceIndex);
    this.setPosition(vertexIndex, position);
    return vertexIndex;
  }

  /** Create a vertex halfway (or at any ratio) between two vertices. */
  interpolateVertex(
    firstSourceIndex: number,
    secondSourceIndex: number,
    ratio: number = 0.5
  ): number {
    this._attributeNames.forEach(name => {
      const attribute = this._source.getAttribute(name);
      const itemSize = attribute.itemSize;
      const isInteger =
        attribute.array instanceof Uint8Array ||
        attribute.array instanceof Uint16Array ||
        attribute.array instanceof Uint32Array ||
        attribute.array instanceof Int8Array ||
        attribute.array instanceof Int16Array ||
        attribute.array instanceof Int32Array;
      for (let component = 0; component < itemSize; component++) {
        const first = attribute.getComponent(firstSourceIndex, component);
        const second = attribute.getComponent(secondSourceIndex, component);
        const value = first + (second - first) * ratio;
        this._values[name].push(isInteger ? Math.round(value) : value);
      }
    });
    return this.vertexCount - 1;
  }

  setPosition(
    vertexIndex: number,
    position: { x: number, y: number, z: number }
  ) {
    const attribute = this._source.getAttribute('position');
    const itemSize = attribute.itemSize;
    const base = vertexIndex * itemSize;
    this._values.position[base] = position.x;
    this._values.position[base + 1] = position.y;
    this._values.position[base + 2] = position.z;
  }

  getPosition(vertexIndex: number): { x: number, y: number, z: number } {
    const attribute = this._source.getAttribute('position');
    const itemSize = attribute.itemSize;
    const base = vertexIndex * itemSize;
    return {
      x: this._values.position[base],
      y: this._values.position[base + 1],
      z: this._values.position[base + 2],
    };
  }

  addTriangle(
    first: number,
    second: number,
    third: number,
    shouldFlip: boolean = false,
    groupIndex: number = 0
  ) {
    if (first === second || second === third || first === third) return;
    this._triangles.push(
      shouldFlip ? [first, third, second] : [first, second, third]
    );
    this._triangleGroups.push(groupIndex);
  }

  /** Material of a triangle of the source geometry (multi-material meshes). */
  getSourceGroupIndex(triangleId: number): number {
    const groups = this._source.groups;
    if (!groups || !groups.length) return 0;
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      const start = group.start / 3;
      const end = start + group.count / 3;
      if (triangleId >= start && triangleId < end)
        return group.materialIndex || 0;
    }
    return 0;
  }

  /**
   * Add the triangles of the source between two source vertices and their
   * copies. Used to rebuild the untouched part of a geometry.
   */
  build(): any {
    const geometry = new THREE.BufferGeometry();
    this._attributeNames.forEach(name => {
      const sourceAttribute = this._source.getAttribute(name);
      const ArrayType = sourceAttribute.array.constructor;
      const values = this._values[name];
      const array = new ArrayType(values.length);
      for (let index = 0; index < values.length; index++)
        array[index] = values[index];
      const attribute = new THREE.BufferAttribute(
        array,
        sourceAttribute.itemSize,
        sourceAttribute.normalized
      );
      if (sourceAttribute.name) attribute.name = sourceAttribute.name;
      geometry.setAttribute(name, attribute);
    });

    const indices = [];
    let highestVertexIndex = 0;
    this._triangles.forEach(triangle => {
      indices.push(triangle[0], triangle[1], triangle[2]);
      highestVertexIndex = Math.max(
        highestVertexIndex,
        triangle[0],
        triangle[1],
        triangle[2]
      );
    });
    geometry.setIndex(
      highestVertexIndex > 65535
        ? new THREE.Uint32BufferAttribute(indices, 1)
        : new THREE.Uint16BufferAttribute(indices, 1)
    );

    // Keep the grouping of multi-material meshes: each group is a run of
    // consecutive triangles drawn with the same material.
    let groupStart = 0;
    for (let index = 0; index < this._triangleGroups.length; index++) {
      const isLastTriangle = index === this._triangleGroups.length - 1;
      const nextGroupIndex = isLastTriangle
        ? this._triangleGroups[index]
        : this._triangleGroups[index + 1];
      if (!isLastTriangle && nextGroupIndex === this._triangleGroups[index])
        continue;
      geometry.addGroup(
        groupStart * 3,
        (index + 1 - groupStart) * 3,
        this._triangleGroups[index]
      );
      groupStart = index + 1;
    }
    geometry.userData = {
      ...(this._source.userData || {}),
      [ATTRIBUTE_CACHE_PREFIX]: true,
    };
    return geometry;
  }
}

/** Copy a geometry as-is. */
export const cloneGeometry = (geometry: any): any =>
  typeof geometry.clone === 'function' ? geometry.clone() : geometry;

/**
 * Rebuild a geometry keeping only the vertices of the given triangles, so that
 * deleted parts do not leave unusable vertices (and memory) behind.
 */
export const keepTriangles = (geometry: any, triangleIds: Set<number>): any => {
  const builder = new GeometryBuilder(geometry);
  const remappedVertexIndices = new Map<number, number>();

  const remapVertex = (vertexIndex: number): number => {
    const existing = remappedVertexIndices.get(vertexIndex);
    if (existing !== undefined) return existing;
    const newIndex = builder.copyVertex(vertexIndex);
    remappedVertexIndices.set(vertexIndex, newIndex);
    return newIndex;
  };

  const triangleCount = getTriangleCount(geometry);
  for (let triangleId = 0; triangleId < triangleCount; triangleId++) {
    if (!triangleIds.has(triangleId)) continue;
    const triangle = getTriangle(geometry, triangleId);
    builder.addTriangle(
      remapVertex(triangle[0]),
      remapVertex(triangle[1]),
      remapVertex(triangle[2]),
      false,
      builder.getSourceGroupIndex(triangleId)
    );
  }

  return builder.build();
};

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

export const getCentroid = (
  geometry: any,
  vertexIds: Set<number>
): { x: number, y: number, z: number } => {
  const position = geometry.getAttribute('position');
  const centroid = { x: 0, y: 0, z: 0 };
  if (!vertexIds.size) return centroid;
  vertexIds.forEach(vertexId => {
    centroid.x += position.getX(vertexId);
    centroid.y += position.getY(vertexId);
    centroid.z += position.getZ(vertexId);
  });
  centroid.x /= vertexIds.size;
  centroid.y /= vertexIds.size;
  centroid.z /= vertexIds.size;
  return centroid;
};

export type MeshBoundingBox = {|
  min: { x: number, y: number, z: number },
  max: { x: number, y: number, z: number },
|};

export const getSelectionBoundingBox = (
  geometry: any,
  vertexIds: Set<number>
): MeshBoundingBox => {
  const position = geometry.getAttribute('position');
  const box = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  vertexIds.forEach(vertexId => {
    box.min.x = Math.min(box.min.x, position.getX(vertexId));
    box.min.y = Math.min(box.min.y, position.getY(vertexId));
    box.min.z = Math.min(box.min.z, position.getZ(vertexId));
    box.max.x = Math.max(box.max.x, position.getX(vertexId));
    box.max.y = Math.max(box.max.y, position.getY(vertexId));
    box.max.z = Math.max(box.max.z, position.getZ(vertexId));
  });
  return box;
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Transform the selected vertices (positions and normals) by a matrix. */
export const transformVertices = (
  geometry: any,
  vertexIds: Set<number>,
  matrix: any
): any => {
  const builder = new GeometryBuilder(geometry);
  const remappedVertexIndices = new Map<number, number>();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);

  const remapVertex = (vertexIndex: number): number => {
    const existing = remappedVertexIndices.get(vertexIndex);
    if (existing !== undefined) return existing;
    const newIndex = builder.copyVertex(vertexIndex);
    remappedVertexIndices.set(vertexIndex, newIndex);
    return newIndex;
  };

  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const transformed = new THREE.Vector3();
  const transformedNormal = new THREE.Vector3();

  // First copy every vertex, moving the selected ones.
  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
    const newIndex = remapVertex(vertexIndex);
    if (!vertexIds.has(vertexIndex)) continue;

    transformed
      .set(
        position.getX(vertexIndex),
        position.getY(vertexIndex),
        position.getZ(vertexIndex)
      )
      .applyMatrix4(matrix);
    builder.setPosition(newIndex, {
      x: transformed.x,
      y: transformed.y,
      z: transformed.z,
    });

    if (normal) {
      const normalAttribute = geometry.getAttribute('normal');
      transformedNormal
        .set(
          normalAttribute.getX(vertexIndex),
          normalAttribute.getY(vertexIndex),
          normalAttribute.getZ(vertexIndex)
        )
        .applyMatrix3(normalMatrix)
        .normalize();
      const base = newIndex * normalAttribute.itemSize;
      builder._values.normal[base] = transformedNormal.x;
      builder._values.normal[base + 1] = transformedNormal.y;
      builder._values.normal[base + 2] = transformedNormal.z;
    }
  }

  const triangleCount = getTriangleCount(geometry);
  for (let triangleId = 0; triangleId < triangleCount; triangleId++) {
    const triangle = getTriangle(geometry, triangleId);
    builder.addTriangle(
      remapVertex(triangle[0]),
      remapVertex(triangle[1]),
      remapVertex(triangle[2])
    );
  }

  return builder.build();
};

/** Delete the selected triangles. */
export const deleteTriangles = (
  geometry: any,
  triangleIds: Set<number>
): any => {
  const kept = new Set<number>();
  const triangleCount = getTriangleCount(geometry);
  for (let triangleId = 0; triangleId < triangleCount; triangleId++)
    if (!triangleIds.has(triangleId)) kept.add(triangleId);
  return keepTriangles(geometry, kept);
};

/** Reverse the winding of the selected triangles (flip their faces). */
export const flipTriangles = (geometry: any, triangleIds: Set<number>): any => {
  const builder = new GeometryBuilder(geometry);
  const remappedVertexIndices = new Map<number, number>();
  const remapVertex = (vertexIndex: number): number => {
    const existing = remappedVertexIndices.get(vertexIndex);
    if (existing !== undefined) return existing;
    const newIndex = builder.copyVertex(vertexIndex);
    remappedVertexIndices.set(vertexIndex, newIndex);
    return newIndex;
  };

  const triangleCount = getTriangleCount(geometry);
  for (let triangleId = 0; triangleId < triangleCount; triangleId++) {
    const triangle = getTriangle(geometry, triangleId);
    const isSelected = triangleIds.has(triangleId);
    builder.addTriangle(
      remapVertex(triangle[0]),
      remapVertex(triangle[1]),
      remapVertex(triangle[2]),
      isSelected
    );
  }
  return builder.build();
};

/**
 * Subdivide the selected triangles in four, sharing the new vertices between
 * neighbouring triangles so that no crack appears.
 */
export const subdivideTriangles = (
  geometry: any,
  triangleIds: Set<number>
): any => {
  const builder = new GeometryBuilder(geometry);
  const remappedVertexIndices = new Map<number, number>();
  const midpointIndices = new Map<string, number>();

  const remapVertex = (vertexIndex: number): number => {
    const existing = remappedVertexIndices.get(vertexIndex);
    if (existing !== undefined) return existing;
    const newIndex = builder.copyVertex(vertexIndex);
    remappedVertexIndices.set(vertexIndex, newIndex);
    return newIndex;
  };

  const getMidpoint = (first: number, second: number): number => {
    const key = first < second ? `${first}:${second}` : `${second}:${first}`;
    const existing = midpointIndices.get(key);
    if (existing !== undefined) return existing;
    const newIndex = builder.interpolateVertex(first, second, 0.5);
    midpointIndices.set(key, newIndex);
    return newIndex;
  };

  const triangleCount = getTriangleCount(geometry);
  for (let triangleId = 0; triangleId < triangleCount; triangleId++) {
    const [first, second, third] = getTriangle(geometry, triangleId);
    const groupIndex = builder.getSourceGroupIndex(triangleId);
    if (!triangleIds.has(triangleId)) {
      builder.addTriangle(
        remapVertex(first),
        remapVertex(second),
        remapVertex(third),
        false,
        groupIndex
      );
      continue;
    }

    const firstNew = remapVertex(first);
    const secondNew = remapVertex(second);
    const thirdNew = remapVertex(third);
    const firstSecond = getMidpoint(first, second);
    const secondThird = getMidpoint(second, third);
    const thirdFirst = getMidpoint(third, first);

    builder.addTriangle(firstNew, firstSecond, thirdFirst, false, groupIndex);
    builder.addTriangle(firstSecond, secondNew, secondThird, false, groupIndex);
    builder.addTriangle(thirdFirst, secondThird, thirdNew, false, groupIndex);
    builder.addTriangle(
      firstSecond,
      secondThird,
      thirdFirst,
      false,
      groupIndex
    );
  }

  return builder.build();
};

const getVertexNormals = (
  geometry: any
): Array<{ x: number, y: number, z: number }> => {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const normals = [];
  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
    if (normal)
      normals.push({
        x: normal.getX(vertexIndex),
        y: normal.getY(vertexIndex),
        z: normal.getZ(vertexIndex),
      });
    else normals.push({ x: 0, y: 1, z: 0 });
  }

  if (!normal) {
    // No normals: use the average of the faces of each vertex.
    const sums = normals.map(() => ({ x: 0, y: 0, z: 0, count: 0 }));
    const triangleCount = getTriangleCount(geometry);
    const first = new THREE.Vector3();
    const second = new THREE.Vector3();
    const third = new THREE.Vector3();
    const faceNormal = new THREE.Vector3();
    for (let triangleId = 0; triangleId < triangleCount; triangleId++) {
      const triangle = getTriangle(geometry, triangleId);
      first.fromBufferAttribute(position, triangle[0]);
      second.fromBufferAttribute(position, triangle[1]);
      third.fromBufferAttribute(position, triangle[2]);
      faceNormal
        .subVectors(second, first)
        .cross(new THREE.Vector3().subVectors(third, first))
        .normalize();
      triangle.forEach(vertexIndex => {
        sums[vertexIndex].x += faceNormal.x;
        sums[vertexIndex].y += faceNormal.y;
        sums[vertexIndex].z += faceNormal.z;
        sums[vertexIndex].count++;
      });
    }
    sums.forEach((sum, vertexIndex) => {
      const length = Math.sqrt(sum.x * sum.x + sum.y * sum.y + sum.z * sum.z);
      normals[vertexIndex] =
        length > 0
          ? { x: sum.x / length, y: sum.y / length, z: sum.z / length }
          : { x: 0, y: 1, z: 0 };
    });
  }

  return normals;
};

/**
 * Extrude the selected triangles along the averaged normal of their vertices.
 * The extruded surface stays welded, and walls are added along the boundary of
 * the selection.
 */
export const extrudeTriangles = (
  geometry: any,
  triangleIds: Set<number>,
  distance: number
): any => {
  if (!triangleIds.size) return cloneGeometry(geometry);
  const vertexNormals = getVertexNormals(geometry);
  const builder = new GeometryBuilder(geometry);
  const remappedVertexIndices = new Map<number, number>();
  const extrudedVertexIndices = new Map<number, number>();

  const remapVertex = (vertexIndex: number): number => {
    const existing = remappedVertexIndices.get(vertexIndex);
    if (existing !== undefined) return existing;
    const newIndex = builder.copyVertex(vertexIndex);
    remappedVertexIndices.set(vertexIndex, newIndex);
    return newIndex;
  };

  // The moved copy of each vertex of the selection.
  const getExtrudedVertex = (vertexIndex: number): number => {
    const existing = extrudedVertexIndices.get(vertexIndex);
    if (existing !== undefined) return existing;
    const position = geometry.getAttribute('position');
    const normal = vertexNormals[vertexIndex];
    const newIndex = builder.copyVertexWithPosition(vertexIndex, {
      x: position.getX(vertexIndex) + normal.x * distance,
      y: position.getY(vertexIndex) + normal.y * distance,
      z: position.getZ(vertexIndex) + normal.z * distance,
    });
    extrudedVertexIndices.set(vertexIndex, newIndex);
    return newIndex;
  };

  const triangleCount = getTriangleCount(geometry);
  const boundaryEdges = new Map<
    string,
    {| first: number, second: number, groupIndex: number |}
  >();
  const addBoundaryEdge = (
    first: number,
    second: number,
    groupIndex: number
  ) => {
    const key = first < second ? `${first}:${second}` : `${second}:${first}`;
    // An edge shared by two selected triangles is interior: removing it keeps
    // only the boundary of the selection.
    if (boundaryEdges.has(key)) boundaryEdges.delete(key);
    else boundaryEdges.set(key, { first, second, groupIndex });
  };

  for (let triangleId = 0; triangleId < triangleCount; triangleId++) {
    const [first, second, third] = getTriangle(geometry, triangleId);
    const groupIndex = builder.getSourceGroupIndex(triangleId);
    if (!triangleIds.has(triangleId)) {
      builder.addTriangle(
        remapVertex(first),
        remapVertex(second),
        remapVertex(third),
        false,
        groupIndex
      );
      continue;
    }

    // The moved surface.
    builder.addTriangle(
      getExtrudedVertex(first),
      getExtrudedVertex(second),
      getExtrudedVertex(third),
      false,
      groupIndex
    );

    addBoundaryEdge(first, second, groupIndex);
    addBoundaryEdge(second, third, groupIndex);
    addBoundaryEdge(third, first, groupIndex);
  }

  // Walls along the boundary of the selection, so that the extruded part is a
  // closed volume (and not a floating patch).
  boundaryEdges.forEach(({ first, second, groupIndex }) => {
    const firstNew = remapVertex(first);
    const secondNew = remapVertex(second);
    const firstExtruded = getExtrudedVertex(first);
    const secondExtruded = getExtrudedVertex(second);
    builder.addTriangle(firstNew, secondNew, secondExtruded, false, groupIndex);
    builder.addTriangle(
      firstNew,
      secondExtruded,
      firstExtruded,
      false,
      groupIndex
    );
  });

  const extrudedGeometry = builder.build();
  return recomputeNormals(extrudedGeometry);
};

/** Recompute smooth vertex normals. */
export const recomputeNormals = (geometry: any): any => {
  const newGeometry = cloneGeometry(geometry);
  newGeometry.computeVertexNormals();
  return newGeometry;
};

/**
 * Weld vertices closer than a distance, which also makes normals smooth across
 * the welded edge.
 */
export const weldVertices = (geometry: any, distance: number = 0.0001): any => {
  const position = geometry.getAttribute('position');
  const cellSize = Math.max(distance, 1e-6);
  const cellToVertex = new Map<string, number>();
  const representative = new Map<number, number>();

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
    const x = position.getX(vertexIndex);
    const y = position.getY(vertexIndex);
    const z = position.getZ(vertexIndex);
    const cellKey = `${Math.round(x / cellSize)}:${Math.round(
      y / cellSize
    )}:${Math.round(z / cellSize)}`;
    const existing = cellToVertex.get(cellKey);
    if (existing !== undefined) representative.set(vertexIndex, existing);
    else {
      cellToVertex.set(cellKey, vertexIndex);
      representative.set(vertexIndex, vertexIndex);
    }
  }

  const builder = new GeometryBuilder(geometry);
  const remappedVertexIndices = new Map<number, number>();
  const remapVertex = (vertexIndex: number): number => {
    const representativeVertex =
      representative.get(vertexIndex) !== undefined
        ? representative.get(vertexIndex)
        : vertexIndex;
    // $FlowFixMe[incompatible-call] - defined just above.
    const existing = remappedVertexIndices.get(representativeVertex);
    if (existing !== undefined) return existing;
    const newIndex = builder.copyVertex(representativeVertex);
    remappedVertexIndices.set(representativeVertex, newIndex);
    return newIndex;
  };

  const triangleCount = getTriangleCount(geometry);
  for (let triangleId = 0; triangleId < triangleCount; triangleId++) {
    const triangle = getTriangle(geometry, triangleId);
    builder.addTriangle(
      remapVertex(triangle[0]),
      remapVertex(triangle[1]),
      remapVertex(triangle[2]),
      false,
      builder.getSourceGroupIndex(triangleId)
    );
  }

  return builder.build();
};

/** Apply a scale/offset/rotation to the UVs of a geometry. */
export const transformUVs = (
  geometry: any,
  {
    scale = 1,
    offsetU = 0,
    offsetV = 0,
    rotationDegrees = 0,
  }: {|
    scale?: number,
    offsetU?: number,
    offsetV?: number,
    rotationDegrees?: number,
  |}
): any => {
  const newGeometry = cloneGeometry(geometry);
  const uv = newGeometry.getAttribute('uv');
  if (!uv) return newGeometry;

  const rotation = (rotationDegrees / 180) * Math.PI;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (let index = 0; index < uv.count; index++) {
    const u = uv.getX(index) * scale;
    const v = uv.getY(index) * scale;
    uv.setXY(index, u * cos - v * sin + offsetU, u * sin + v * cos + offsetV);
  }
  uv.needsUpdate = true;
  return newGeometry;
};

/**
 * Move the selected vertices so that their bounding box center is at the given
 * point (used by the "set origin" and "center model" tools).
 */
export const moveVertices = (
  geometry: any,
  vertexIds: Set<number>,
  offset: { x: number, y: number, z: number }
): any => {
  const matrix = new THREE.Matrix4().makeTranslation(
    offset.x,
    offset.y,
    offset.z
  );
  return transformVertices(geometry, vertexIds, matrix);
};
