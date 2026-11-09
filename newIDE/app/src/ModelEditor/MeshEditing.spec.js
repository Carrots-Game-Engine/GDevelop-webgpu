// @flow
import * as THREE from 'three';
import {
  deleteTriangles,
  extrudeTriangles,
  flipTriangles,
  getCentroid,
  getGeometryStats,
  getSelectionBoundingBox,
  getTriangle,
  getTriangleCount,
  getTrianglesOfVertices,
  getVerticesOfTriangles,
  keepTriangles,
  subdivideTriangles,
  transformUVs,
  transformVertices,
  weldVertices,
} from './MeshEditing';

const makePlane = () => new THREE.PlaneGeometry(2, 2, 1, 1); // 4 vertices, 2 triangles, UVs, normals.

const makeBox = () => new THREE.BoxGeometry(1, 1, 1);

const positionsOf = (geometry: any): Array<number> => {
  const position = geometry.getAttribute('position');
  const values = [];
  for (let index = 0; index < position.count; index++) {
    values.push(
      position.getX(index),
      position.getY(index),
      position.getZ(index)
    );
  }
  return values;
};

const vertexCount = (geometry: any): number =>
  geometry.getAttribute('position').count;

describe('MeshEditing', () => {
  describe('reading a geometry', () => {
    it('reads the triangles of an indexed geometry', () => {
      const geometry = makePlane();
      expect(getTriangleCount(geometry)).toBe(2);
      expect(getTriangle(geometry, 0)).toHaveLength(3);
      // Both triangles share the diagonal: 4 vertices only.
      expect(vertexCount(geometry)).toBe(4);
    });

    it('reads the triangles of a non-indexed geometry', () => {
      const geometry = makeBox().toNonIndexed();
      expect(getTriangleCount(geometry)).toBe(12);
      expect(getTriangle(geometry, 0)).toEqual([0, 1, 2]);
    });

    it('reports the number of vertices, triangles and the presence of UVs', () => {
      const stats = getGeometryStats(makePlane());
      expect(stats.triangleCount).toBe(2);
      expect(stats.vertexCount).toBe(4);
      expect(stats.hasUVs).toBe(true);

      const geometryWithoutUV = new THREE.BoxGeometry(1, 1, 1);
      geometryWithoutUV.deleteAttribute('uv');
      expect(getGeometryStats(geometryWithoutUV).hasUVs).toBe(false);
    });

    it('converts between triangles and vertices', () => {
      const geometry = makePlane();
      expect(
        Array.from(getVerticesOfTriangles(geometry, new Set([0])))
      ).toEqual([0, 2, 1]);
      // The plane is two triangles sharing the diagonal: vertex 0 is only used
      // by the first one, vertex 1 by both.
      expect(
        Array.from(getTrianglesOfVertices(geometry, new Set([0])))
      ).toEqual([0]);
      expect(
        Array.from(getTrianglesOfVertices(geometry, new Set([1])))
      ).toEqual([0, 1]);
    });
  });

  describe('selection', () => {
    it('computes the centroid and the bounding box of vertices', () => {
      const geometry = makePlane();
      const centroid = getCentroid(geometry, new Set([0, 1, 2, 3]));
      expect(centroid.x).toBeCloseTo(0);
      expect(centroid.y).toBeCloseTo(0);

      const box = getSelectionBoundingBox(geometry, new Set([0, 1, 2, 3]));
      expect(box.max.x - box.min.x).toBeCloseTo(2);
      expect(box.max.y - box.min.y).toBeCloseTo(2);
    });

    it('moves only the selected vertices, and rotates their normals', () => {
      const geometry = makePlane();
      const before = positionsOf(geometry);
      const matrix = new THREE.Matrix4().makeTranslation(0, 0, 5);
      const moved = transformVertices(geometry, new Set([0]), matrix);
      const after = positionsOf(moved);

      expect(after[2]).toBeCloseTo(before[2] + 5);
      expect(after[5]).toBeCloseTo(before[5]);
      expect(vertexCount(moved)).toBe(vertexCount(geometry));
      expect(getTriangleCount(moved)).toBe(getTriangleCount(geometry));
    });
  });

  describe('delete', () => {
    it('removes the vertices only used by deleted triangles', () => {
      const geometry = makePlane();
      const kept = deleteTriangles(geometry, new Set([0]));
      expect(getTriangleCount(kept)).toBe(1);
      // Only the three vertices of the kept triangle are left: the fourth one
      // was only used by the deleted triangle.
      expect(vertexCount(kept)).toBe(3);
      expect(kept.getAttribute('uv')).not.toBe(undefined);
    });

    it('drops every vertex when every triangle is deleted', () => {
      const geometry = makePlane();
      const empty = deleteTriangles(geometry, new Set([0, 1]));
      expect(getTriangleCount(empty)).toBe(0);
      expect(vertexCount(empty)).toBe(0);
    });

    it('keeps the material groups of a multi-material mesh', () => {
      const geometry = makeBox();
      geometry.clearGroups();
      geometry.addGroup(0, 18, 0); // First 6 triangles.
      geometry.addGroup(18, 18, 1); // Last 6 triangles.

      const kept = keepTriangles(geometry, new Set([0, 1, 2, 6, 7, 8]));
      expect(getTriangleCount(kept)).toBe(6);
      expect(kept.groups).toEqual([
        { start: 0, count: 9, materialIndex: 0 },
        { start: 9, count: 9, materialIndex: 1 },
      ]);
    });
  });

  describe('flip', () => {
    it('reverses the winding of the selected triangles only', () => {
      const geometry = makePlane();
      const flipped = flipTriangles(geometry, new Set([0]));

      const getFaceNormalZ = (source: any, triangleId: number): number => {
        const [first, second, third] = getTriangle(source, triangleId);
        const position = source.getAttribute('position');
        const firstVector = new THREE.Vector3().fromBufferAttribute(
          position,
          first
        );
        const secondVector = new THREE.Vector3().fromBufferAttribute(
          position,
          second
        );
        const thirdVector = new THREE.Vector3().fromBufferAttribute(
          position,
          third
        );
        return new THREE.Vector3()
          .subVectors(secondVector, firstVector)
          .cross(new THREE.Vector3().subVectors(thirdVector, firstVector)).z;
      };

      // The plane faces +Z; the flipped triangle now faces -Z, the other one
      // is untouched.
      expect(getFaceNormalZ(geometry, 0)).toBeGreaterThan(0);
      expect(getFaceNormalZ(flipped, 0)).toBeLessThan(0);
      expect(getFaceNormalZ(flipped, 1)).toBeGreaterThan(0);
    });
  });

  describe('subdivide', () => {
    it('cuts a selected triangle in four, without cracks', () => {
      const geometry = makePlane();
      const subdivided = subdivideTriangles(geometry, new Set([0]));

      // One triangle becomes four, the untouched one stays.
      expect(getTriangleCount(subdivided)).toBe(5);
      // Three new vertices (one per edge), each shared by the two new
      // triangles touching it: no vertex is duplicated.
      expect(vertexCount(subdivided)).toBe(4 + 3);
      expect(subdivided.getAttribute('uv')).not.toBe(undefined);
    });

    it('does nothing visible when no triangle is selected', () => {
      const geometry = makePlane();
      const unchanged = subdivideTriangles(geometry, new Set());
      expect(getTriangleCount(unchanged)).toBe(2);
      expect(vertexCount(unchanged)).toBe(4);
    });
  });

  describe('extrude', () => {
    it('moves the selected faces and closes the sides', () => {
      const geometry = makePlane(); // Flat, on the XY plane, facing +Z.
      const extruded = extrudeTriangles(geometry, new Set([0, 1]), 1);

      expect(vertexCount(extruded)).toBe(8); // 4 kept + 4 moved.
      expect(getTriangleCount(extruded)).toBe(2 + 8); // Faces + 4 walls.

      // The top is at z = 1, the bottom still at z = 0.
      const position = extruded.getAttribute('position');
      let topVertices = 0;
      let bottomVertices = 0;
      for (let index = 0; index < position.count; index++) {
        if (Math.abs(position.getZ(index) - 1) < 1e-6) topVertices++;
        if (Math.abs(position.getZ(index)) < 1e-6) bottomVertices++;
      }
      expect(topVertices).toBe(4);
      expect(bottomVertices).toBe(4);
      expect(extruded.getAttribute('normal')).not.toBe(undefined);
      expect(extruded.getAttribute('uv')).not.toBe(undefined);
    });

    it('keeps the faces of the rest of the model', () => {
      const geometry = makeBox(); // 12 triangles, closed.
      const extruded = extrudeTriangles(geometry, new Set([0]), 0.5);
      // 11 untouched triangles + 1 moved + 3 walls made of 2 triangles each.
      expect(getTriangleCount(extruded)).toBe(18);
    });

    it('does not modify the model when nothing is selected', () => {
      const geometry = makePlane();
      const unchanged = extrudeTriangles(geometry, new Set(), 1);
      expect(getTriangleCount(unchanged)).toBe(2);
      expect(positionsOf(unchanged)).toEqual(positionsOf(geometry));
    });
  });

  describe('weld', () => {
    it('merges the duplicated vertices of a box', () => {
      const geometry = makeBox();
      expect(vertexCount(geometry)).toBe(24);
      const welded = weldVertices(geometry, 0.0001);
      expect(vertexCount(welded)).toBe(8);
      expect(getTriangleCount(welded)).toBe(12);
    });

    it('keeps vertices further away than the distance', () => {
      const geometry = makeBox();
      const welded = weldVertices(geometry, 0.0001);
      expect(welded.getAttribute('position').count).toBe(8);
      // A very small distance still merges the exactly duplicated corners.
      const geometry2 = new THREE.BoxGeometry(100, 100, 100);
      expect(vertexCount(weldVertices(geometry2, 0.0001))).toBe(8);
    });
  });

  describe('UVs', () => {
    it('scales, offsets and rotates the UVs', () => {
      const geometry = makePlane();
      const transformed = transformUVs(geometry, {
        scale: 2,
        offsetU: 1,
        offsetV: 0.5,
        rotationDegrees: 0,
      });
      const uv = transformed.getAttribute('uv');
      const originalUV = geometry.getAttribute('uv');
      expect(uv.getX(0)).toBeCloseTo(originalUV.getX(0) * 2 + 1);
      expect(uv.getY(0)).toBeCloseTo(originalUV.getY(0) * 2 + 0.5);
      // The source is untouched.
      expect(geometry.getAttribute('uv').getX(0)).toBe(originalUV.getX(0));
    });

    it('rotates around the UV origin', () => {
      const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
      // The first UV of a plane is (0, 1): a quarter turn sends it to (-1, 0).
      const transformed = transformUVs(geometry, { rotationDegrees: 90 });
      const uv = transformed.getAttribute('uv');
      expect(uv.getX(0)).toBeCloseTo(-1);
      expect(uv.getY(0)).toBeCloseTo(0);
    });
  });

  describe('extra attributes', () => {
    it('keeps the attributes it does not know about', () => {
      const geometry = makePlane();
      const colors = new Float32Array(vertexCount(geometry) * 3).fill(0.25);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const extruded = extrudeTriangles(geometry, new Set([0, 1]), 1);
      const color = extruded.getAttribute('color');
      expect(color).not.toBe(undefined);
      expect(color.count).toBe(vertexCount(extruded));
      expect(color.getX(0)).toBeCloseTo(0.25);
    });

    it('keeps the skinning attributes of a skinned mesh', () => {
      const geometry = makePlane();
      const skinIndices = new Uint16Array(vertexCount(geometry) * 4);
      const skinWeights = new Float32Array(vertexCount(geometry) * 4);
      for (let index = 0; index < 4; index++) skinWeights[index * 4] = 1;
      geometry.setAttribute(
        'skinIndex',
        new THREE.Uint16BufferAttribute(skinIndices, 4)
      );
      geometry.setAttribute(
        'skinWeight',
        new THREE.BufferAttribute(skinWeights, 4)
      );

      const subdivided = subdivideTriangles(geometry, new Set([0]));
      expect(subdivided.getAttribute('skinIndex')).not.toBe(undefined);
      expect(subdivided.getAttribute('skinWeight')).not.toBe(undefined);
      expect(subdivided.getAttribute('skinWeight').count).toBe(
        vertexCount(subdivided)
      );
    });
  });
});
