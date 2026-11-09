// @flow
import * as THREE from 'three';
import { GDModelDocument } from './GDModelDocument';
import {
  GD_MODEL_RESOURCE_METADATA_KEY,
  createDefaultManifest,
  unpackGDModel,
  type GDModelManifest,
} from './GDModelFormat';
import {
  buildModelFile,
  getManifestForResourceMetadata,
  getModelFileExtensionForSave,
  readManifestFromResourceMetadata,
} from './ModelEditorExport';

const GLB_BYTES = new Uint8Array([
  0x67,
  0x6c,
  0x54,
  0x46,
  0x02,
  0x00,
  0x00,
  0x00,
  0x0c,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
]);

const makeDocument = (): GDModelDocument => {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial()
  );
  mesh.name = 'Box';
  scene.add(mesh);
  return GDModelDocument.fromGLTF({ scene, animations: [] });
};

const stubExporter = async () => GLB_BYTES.buffer.slice(0);

describe('ModelEditorExport', () => {
  describe('choosing the extension', () => {
    it('keeps a model that is already packed', () => {
      const document = makeDocument();
      expect(
        getModelFileExtensionForSave({
          document,
          currentFileExtension: '.gdm',
          saveAsPacked: false,
        })
      ).toBe('.gdm');
    });

    it('packs a model holding engine specific data', () => {
      const document = makeDocument();
      expect(getModelFileExtensionForSave({ document })).toBe('.glb');

      document.addSocketForNode(document.findNodeByName('Box'), {
        name: 'muzzle',
      });
      expect(getModelFileExtensionForSave({ document })).toBe('.gdm');
    });

    it('follows what the user asked for', () => {
      const document = makeDocument();
      expect(
        getModelFileExtensionForSave({ document, saveAsPacked: true })
      ).toBe('.gdm');
      document.addColliderFromNode(null, 'box');
      expect(
        getModelFileExtensionForSave({ document, saveAsPacked: false })
      ).toBe('.glb');
    });
  });

  describe('building the file', () => {
    it('writes a plain GLB when not packed', async () => {
      const document = makeDocument();
      const modelFile = await buildModelFile({
        document,
        exportDocumentToBinaryGLTF: stubExporter,
        extension: '.glb',
      });

      expect(modelFile.isPacked).toBe(false);
      expect(modelFile.extension).toBe('.glb');
      expect(Array.from(modelFile.bytes)).toEqual(Array.from(GLB_BYTES));
      expect(modelFile.manifest.sockets).toEqual([]);
    });

    it('writes a .gdm with the manifest inside', async () => {
      const document = makeDocument();
      const node = document.findNodeByName('Box');
      document.addSocketForNode(node, {
        name: 'muzzle',
        position: [0, 1, 0],
      });
      document.addLOD('lod1.glb', 30);

      const modelFile = await buildModelFile({
        document,
        exportDocumentToBinaryGLTF: stubExporter,
        extension: '.gdm',
        thumbnail: new Uint8Array([1, 2, 3]),
        date: new Date(Date.UTC(2024, 0, 1)),
      });

      expect(modelFile.isPacked).toBe(true);
      const unpacked = await unpackGDModel(modelFile.bytes.buffer);
      expect(unpacked.manifest.sockets[0].name).toBe('muzzle');
      expect(unpacked.manifest.lods).toEqual([
        { distance: 30, file: 'lod1.glb' },
      ]);
      expect(Array.from(unpacked.thumbnail || [])).toEqual([1, 2, 3]);
      expect(Array.from(unpacked.glb)).toEqual(Array.from(GLB_BYTES));
    });

    it('reports an exporter that does not produce a GLB', async () => {
      const document = makeDocument();
      await expect(
        buildModelFile({
          document,
          exportDocumentToBinaryGLTF: async () =>
            new Uint8Array([1, 2, 3, 4]).buffer,
          extension: '.glb',
        })
      ).rejects.toThrow(/did not produce a binary glTF/);
    });
  });

  describe('engine data in the resource metadata (GLB files)', () => {
    it('round-trips a manifest through the resource metadata', () => {
      const manifest: GDModelManifest = {
        ...createDefaultManifest(),
        sockets: [
          {
            name: 'muzzle',
            node: 'Box',
            position: [0, 1, 0],
            rotation: [0, 0, 0],
          },
        ],
      };
      const metadata = JSON.stringify({
        extension: '.glb',
        ...getManifestForResourceMetadata(manifest),
      });

      const readManifest = readManifestFromResourceMetadata(metadata);
      expect(readManifest && readManifest.sockets).toEqual(manifest.sockets);
      expect(metadata).toContain(GD_MODEL_RESOURCE_METADATA_KEY);
    });

    it('ignores missing or malformed metadata', () => {
      expect(readManifestFromResourceMetadata(null)).toBe(null);
      expect(readManifestFromResourceMetadata('')).toBe(null);
      expect(readManifestFromResourceMetadata('{not json')).toBe(null);
      expect(readManifestFromResourceMetadata('{"extension":".glb"}')).toBe(
        null
      );
      expect(
        readManifestFromResourceMetadata(
          JSON.stringify({ gdm: { format: 'something-else' } })
        )
      ).toBe(null);
    });

    it('keeps the rest of the resource metadata untouched', () => {
      const metadata = JSON.stringify({
        localFilePath: 'assets/robot.glb',
        extension: '.glb',
        ...getManifestForResourceMetadata(createDefaultManifest()),
      });
      const parsed = JSON.parse(metadata);
      expect(parsed.localFilePath).toBe('assets/robot.glb');
      expect(parsed.gdm.version).toBe(1);
    });
  });
});
