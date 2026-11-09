// @flow
import {
  GD_MODEL_FORMAT_NAME,
  GD_MODEL_FORMAT_VERSION,
  GD_MODEL_MANIFEST_FILENAME,
  GD_MODEL_MAIN_MODEL_FILENAME,
  GD_MODEL_THUMBNAIL_FILENAME,
  createDefaultManifest,
  createZip,
  crc32,
  decodeUtf8,
  encodeUtf8,
  isBinaryGLTF,
  isGDModelFileName,
  manifestHasEngineData,
  normalizeManifest,
  packGDModel,
  parseManifest,
  readGDModelManifest,
  readZip,
  unpackGDModel,
} from './GDModelFormat';

const makeBytes = (length: number, seed: number = 0): Uint8Array => {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index++)
    bytes[index] = (index * 31 + seed) & 0xff;
  return bytes;
};

const GLB_BYTES = new Uint8Array([
  0x67,
  0x6c,
  0x54,
  0x46, // "glTF"
  0x02,
  0x00,
  0x00,
  0x00, // version 2
  0x10,
  0x00,
  0x00,
  0x00, // length
  0x00,
  0x00,
  0x00,
  0x00, // 4 bytes of content
]);

describe('GDModelFormat', () => {
  describe('file names', () => {
    it('recognizes .gdm files in any case', () => {
      expect(isGDModelFileName('robot.gdm')).toBe(true);
      expect(isGDModelFileName('ROBOT.GDM')).toBe(true);
      expect(isGDModelFileName('/assets/robot.gdm')).toBe(true);
      expect(isGDModelFileName('robot.glb')).toBe(false);
      expect(isGDModelFileName('')).toBe(false);
    });

    it('recognizes binary glTF files', () => {
      expect(isBinaryGLTF(GLB_BYTES)).toBe(true);
      expect(isBinaryGLTF(makeBytes(32))).toBe(false);
      expect(isBinaryGLTF(new Uint8Array(4))).toBe(false);
    });
  });

  describe('manifest', () => {
    it('creates a manifest with nothing engine specific', () => {
      const manifest = createDefaultManifest();
      expect(manifest.format).toBe(GD_MODEL_FORMAT_NAME);
      expect(manifest.version).toBe(GD_MODEL_FORMAT_VERSION);
      expect(manifest.sockets).toEqual([]);
      expect(manifest.lods).toEqual([]);
      expect(manifestHasEngineData(manifest)).toBe(false);
    });

    it('fills what a minimal manifest omits', () => {
      const manifest = normalizeManifest({
        format: GD_MODEL_FORMAT_NAME,
        version: 1,
      });
      expect(manifest.sockets).toEqual([]);
      expect(manifest.colliders).toEqual([]);
      expect(manifest.lods).toEqual([]);
      expect(manifest.animationEvents).toEqual([]);
      expect(manifest.origin).toEqual([0, 0, 0]);
      expect(manifest.unitScale).toBe(1);
      expect(manifest.upAxis).toBe('Y');
      expect(manifest.textureQualityHint).toBe('auto');
    });

    it('rejects a manifest of another format', () => {
      expect(() => normalizeManifest({ format: 'gltf', version: 1 })).toThrow(
        /Unsupported model format/
      );
      expect(() => normalizeManifest(null)).toThrow(/not an object/);
    });

    it('rejects a manifest written by a newer version', () => {
      expect(() =>
        normalizeManifest({
          format: GD_MODEL_FORMAT_NAME,
          version: GD_MODEL_FORMAT_VERSION + 1,
        })
      ).toThrow(/newer version of GDevelop/);
    });

    it('drops the sockets, colliders, events and LODs it cannot use', () => {
      const manifest = normalizeManifest({
        format: GD_MODEL_FORMAT_NAME,
        version: 1,
        sockets: [
          { name: 'muzzle', node: 'Tip', position: [1, 2, 3] },
          { name: 'no-node' },
          null,
          'nope',
        ],
        colliders: [{ type: 'made-up', node: 'Body' }, { name: 'b' }],
        animationEvents: [
          { clip: 'Run', time: 0.5, name: 'footstep' },
          { clip: 'Run', name: 'no-time' },
          { name: 'no-clip' },
        ],
        lods: [
          { distance: 60, file: 'lod2.glb' },
          { distance: 20, file: 'lod1.glb' },
          { file: '' },
        ],
      });

      expect(manifest.sockets).toEqual([
        {
          name: 'muzzle',
          node: 'Tip',
          position: [1, 2, 3],
          rotation: [0, 0, 0],
        },
      ]);
      // An unknown collider type falls back to a box, and a nameless collider
      // is named after its index.
      expect(manifest.colliders).toEqual([
        {
          name: 'collider0',
          type: 'box',
          node: 'Body',
          size: [0, 0, 0],
          center: [0, 0, 0],
        },
        {
          name: 'b',
          type: 'box',
          node: '',
          size: [0, 0, 0],
          center: [0, 0, 0],
        },
      ]);
      // An event without a time is at the start of its clip.
      expect(manifest.animationEvents).toEqual([
        { clip: 'Run', time: 0.5, name: 'footstep' },
        { clip: 'Run', time: 0, name: 'no-time' },
      ]);
      // Levels of detail are sorted by distance and the empty one is dropped.
      expect(manifest.lods).toEqual([
        { distance: 20, file: 'lod1.glb' },
        { distance: 60, file: 'lod2.glb' },
      ]);
      expect(manifestHasEngineData(manifest)).toBe(true);
    });

    it('reports invalid JSON of a manifest', () => {
      expect(() => parseManifest('{ not json')).toThrow(/not valid JSON/);
    });
  });

  describe('ZIP', () => {
    it('writes an archive that it can read back', async () => {
      const entries = [
        { name: GD_MODEL_MANIFEST_FILENAME, data: makeBytes(64, 1) },
        { name: GD_MODEL_MAIN_MODEL_FILENAME, data: makeBytes(1024, 2) },
        { name: 'Đặc biệt/模型.glb', data: makeBytes(0) },
      ];
      const archive = createZip(entries);
      const readEntries = await readZip(archive.buffer);

      expect(readEntries.map(entry => entry.name)).toEqual([
        GD_MODEL_MANIFEST_FILENAME,
        GD_MODEL_MAIN_MODEL_FILENAME,
        'Đặc biệt/模型.glb',
      ]);
      expect(Array.from(readEntries[1].data)).toEqual(
        Array.from(entries[1].data)
      );
      expect(readEntries[2].data.length).toBe(0);
    });

    it('writes a ZIP that other tools can read', async () => {
      // Structure checks: local header, then an index, then the end record.
      const archive = createZip([{ name: 'a.txt', data: makeBytes(3, 7) }]);
      const view = new DataView(archive.buffer);
      expect(view.getUint32(0, true)).toBe(0x04034b50); // Local file header.
      expect(view.getUint32(archive.length - 22, true)).toBe(0x06054b50); // EOCD.
      // The stored data follows the local header and its file name.
      expect(archive[30 + 'a.txt'.length]).toBe(makeBytes(3, 7)[0]);
    });

    it('computes the CRC32 of data', () => {
      // Well known value of "123456789".
      expect(
        crc32(
          new Uint8Array([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39])
        )
      ).toBe(0xcbf43926);
    });

    it('reports a corrupted archive instead of returning wrong data', async () => {
      const archive = createZip([
        { name: 'a.txt', data: makeBytes(16, 3) },
        { name: 'b.txt', data: makeBytes(16, 4) },
      ]);
      // Corrupt one byte of the data of the first entry (after its header).
      const corrupted = new Uint8Array(archive);
      corrupted[30 + 'a.txt'.length + 4] ^= 0xff;

      await expect(readZip(corrupted.buffer)).rejects.toThrow(/corrupted/);
    });

    it('reports a file that is not an archive', async () => {
      await expect(readZip(new Uint8Array(4).buffer)).rejects.toThrow(
        /too small/
      );
      await expect(readZip(makeBytes(256).buffer)).rejects.toThrow(
        /not a valid/
      );
    });

    it('reads deflated entries when the environment supports it', async () => {
      if (typeof DecompressionStream === 'undefined') return;

      // Build an archive with a deflated entry, as another tool would.
      const content = encodeUtf8('{"a":1}');
      const zlib = require('zlib');
      const deflated = new Uint8Array(
        zlib.deflateRawSync(Buffer.from(content))
      );
      const name = encodeUtf8('x.json');

      const size = 30 + name.length + deflated.length + 46 + name.length + 22;
      const output = new Uint8Array(size);
      const view = new DataView(output.buffer);
      let offset = 0;
      view.setUint32(offset, 0x04034b50, true);
      view.setUint16(offset + 4, 20, true);
      view.setUint16(offset + 8, 8, true); // Deflated.
      view.setUint32(offset + 14, crc32(content), true);
      view.setUint32(offset + 18, deflated.length, true);
      view.setUint32(offset + 22, content.length, true);
      view.setUint16(offset + 26, name.length, true);
      offset += 30;
      output.set(name, offset);
      offset += name.length;
      output.set(deflated, offset);
      offset += deflated.length;
      const centralDirectoryOffset = offset;
      view.setUint32(offset, 0x02014b50, true);
      view.setUint16(offset + 4, 20, true);
      view.setUint16(offset + 6, 20, true);
      view.setUint16(offset + 10, 8, true);
      view.setUint32(offset + 16, crc32(content), true);
      view.setUint32(offset + 20, deflated.length, true);
      view.setUint32(offset + 24, content.length, true);
      view.setUint16(offset + 28, name.length, true);
      offset += 46;
      output.set(name, offset);
      offset += name.length;
      view.setUint32(offset, 0x06054b50, true);
      view.setUint16(offset + 8, 1, true);
      view.setUint16(offset + 10, 1, true);
      view.setUint32(
        offset + 12,
        offset - 46 - name.length - centralDirectoryOffset,
        true
      );
      view.setUint32(offset + 16, centralDirectoryOffset, true);

      const entries = await readZip(output.buffer);
      expect(entries).toHaveLength(1);
      expect(decodeUtf8(entries[0].data)).toBe('{"a":1}');
    });
  });

  describe('packing a model', () => {
    const buildArchive = (overrides = {}) =>
      packGDModel(
        {
          manifest: {
            ...createDefaultManifest(),
            sockets: [
              {
                name: 'muzzle',
                node: 'Tip',
                position: [0, 1, 0],
                rotation: [0, 0, 0],
              },
            ],
            ...overrides,
          },
          glb: GLB_BYTES,
        },
        new Date(Date.UTC(2024, 0, 1))
      );

    it('reads back the manifest and the model it was packed with', async () => {
      const archive = buildArchive();
      const unpacked = await unpackGDModel(archive.buffer);

      expect(unpacked.glb.length).toBe(GLB_BYTES.length);
      expect(Array.from(unpacked.glb)).toEqual(Array.from(GLB_BYTES));
      expect(unpacked.manifest.sockets).toEqual([
        {
          name: 'muzzle',
          node: 'Tip',
          position: [0, 1, 0],
          rotation: [0, 0, 0],
        },
      ]);
      expect(unpacked.thumbnail).toBe(null);
    });

    it('keeps the thumbnail and the extra files', async () => {
      const thumbnail = makeBytes(8, 5);
      const lod = makeBytes(32, 6);
      const archive = packGDModel({
        manifest: createDefaultManifest(),
        glb: GLB_BYTES,
        thumbnail,
        extraFiles: [{ name: 'lod1.glb', data: lod }],
      });
      const unpacked = await unpackGDModel(archive.buffer);

      expect(Array.from(unpacked.thumbnail || [])).toEqual(
        Array.from(thumbnail)
      );
      const lodEntry = unpacked.entries.find(
        entry => entry.name === 'lod1.glb'
      );
      expect(Array.from((lodEntry && lodEntry.data) || [])).toEqual(
        Array.from(lod)
      );
      expect(unpacked.entries.map(entry => entry.name)).toEqual([
        GD_MODEL_MANIFEST_FILENAME,
        GD_MODEL_MAIN_MODEL_FILENAME,
        GD_MODEL_THUMBNAIL_FILENAME,
        'lod1.glb',
      ]);
    });

    it('refuses an extra file replacing the manifest or the model', () => {
      expect(() =>
        packGDModel({
          manifest: createDefaultManifest(),
          glb: GLB_BYTES,
          extraFiles: [
            { name: GD_MODEL_MAIN_MODEL_FILENAME, data: makeBytes(4) },
          ],
        })
      ).toThrow(/already contains a file/);
    });

    it('reads only the manifest without decoding the model', async () => {
      const archive = buildArchive();
      const manifest = await readGDModelManifest(archive.buffer);
      expect(manifest.sockets).toHaveLength(1);
    });

    it('reports an archive without manifest or model', async () => {
      const withoutManifest = createZip([
        { name: GD_MODEL_MAIN_MODEL_FILENAME, data: GLB_BYTES },
      ]);
      await expect(unpackGDModel(withoutManifest.buffer)).rejects.toThrow(
        /no "gdevelop.model.json"/
      );

      const withoutModel = createZip([
        {
          name: GD_MODEL_MANIFEST_FILENAME,
          data: encodeUtf8(JSON.stringify(createDefaultManifest())),
        },
      ]);
      await expect(unpackGDModel(withoutModel.buffer)).rejects.toThrow(
        /no "model.glb"/
      );
    });
  });
});
