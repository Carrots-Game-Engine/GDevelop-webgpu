/**
 * Tests of the reader of the `.gdm` 3D model container (`GDModelFormat.ts`),
 * which is what a game uses to read a model authored with the 3D model editor.
 *
 * The fixtures are written here with the same rules as the editor
 * (`newIDE/app/src/ModelEditor/GDModelFormat.js`), so a change of format that
 * would break the reader breaks these tests.
 */
describe('gdjs.GDModelFormat', () => {
  const encodeUtf8 = (text) => new TextEncoder().encode(text);
  const decodeUtf8 = (bytes) => new TextDecoder('utf-8').decode(bytes);

  const crc32 = (data) => {
    let crc = 0xffffffff;
    for (let index = 0; index < data.length; index++) {
      let value = (crc ^ data[index]) & 0xff;
      for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crc = (crc >>> 8) ^ value;
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  /** Write a ZIP with stored entries, as the editor does. */
  const createZip = (entries) => {
    const totalSize =
      entries.reduce(
        (total, entry) =>
          total + 30 + encodeUtf8(entry.name).length + entry.data.length,
        0
      ) +
      entries.reduce(
        (total, entry) => total + 46 + encodeUtf8(entry.name).length,
        0
      ) +
      22;
    const output = new Uint8Array(totalSize);
    const view = new DataView(output.buffer);
    let offset = 0;
    const localHeaderOffsets = [];

    entries.forEach((entry) => {
      const nameBytes = encodeUtf8(entry.name);
      localHeaderOffsets.push(offset);
      view.setUint32(offset, 0x04034b50, true);
      view.setUint16(offset + 4, 20, true);
      view.setUint16(offset + 8, 0, true); // Stored.
      view.setUint32(offset + 14, crc32(entry.data), true);
      view.setUint32(offset + 18, entry.data.length, true);
      view.setUint32(offset + 22, entry.data.length, true);
      view.setUint16(offset + 26, nameBytes.length, true);
      offset += 30;
      output.set(nameBytes, offset);
      offset += nameBytes.length;
      output.set(entry.data, offset);
      offset += entry.data.length;
    });

    const centralDirectoryOffset = offset;
    entries.forEach((entry, index) => {
      const nameBytes = encodeUtf8(entry.name);
      view.setUint32(offset, 0x02014b50, true);
      view.setUint16(offset + 4, 20, true);
      view.setUint16(offset + 6, 20, true);
      view.setUint32(offset + 16, crc32(entry.data), true);
      view.setUint32(offset + 20, entry.data.length, true);
      view.setUint32(offset + 24, entry.data.length, true);
      view.setUint16(offset + 28, nameBytes.length, true);
      view.setUint32(offset + 42, localHeaderOffsets[index], true);
      offset += 46;
      output.set(nameBytes, offset);
      offset += nameBytes.length;
    });

    view.setUint32(offset, 0x06054b50, true);
    view.setUint16(offset + 8, entries.length, true);
    view.setUint16(offset + 10, entries.length, true);
    view.setUint32(offset + 12, offset - centralDirectoryOffset, true);
    view.setUint32(offset + 16, centralDirectoryOffset, true);
    return output.buffer;
  };

  const GLB = new Uint8Array([
    0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);

  const makeArchive = (manifest, extraEntries = []) =>
    createZip([
      {
        name: gdjs.GDModelFormat.MANIFEST_FILENAME,
        data: encodeUtf8(JSON.stringify(manifest)),
      },
      { name: gdjs.GDModelFormat.MAIN_MODEL_FILENAME, data: GLB },
      ...extraEntries,
    ]);

  const makeManifest = () => ({
    ...gdjs.GDModelFormat.createDefaultManifest(),
    sockets: [
      {
        name: 'muzzle',
        node: 'Weapon',
        position: [0, 1, 0],
        rotation: [0, 0, 0],
      },
    ],
    colliders: [
      {
        name: 'body',
        type: 'box',
        node: 'Body',
        size: [1, 2, 1],
        center: [0, 1, 0],
      },
    ],
    animationEvents: [
      { clip: 'Run', time: 0.5, name: 'footstep' },
      { clip: 'Run', time: 0.1, name: 'jump' },
      { clip: 'Idle', time: 0.2, name: 'blink' },
    ],
  });

  it('recognizes model archive file names', () => {
    expect(gdjs.GDModelFormat.isGDModelFileName('robot.gdm')).to.be(true);
    expect(gdjs.GDModelFormat.isGDModelFileName('ROBOT.GDM')).to.be(true);
    expect(gdjs.GDModelFormat.isGDModelFileName('robot.glb')).to.be(false);
  });

  it('reads the manifest and the model of an archive', async () => {
    const archive = await gdjs.GDModelFormat.unpack(
      makeArchive(makeManifest())
    );

    expect(archive.glb.length).to.be(GLB.length);
    expect(archive.manifest.sockets.length).to.be(1);
    expect(archive.manifest.sockets[0].name).to.be('muzzle');
    expect(archive.manifest.colliders[0].type).to.be('box');
    expect(archive.thumbnail).to.be(null);
  });

  it('reads the thumbnail when there is one', async () => {
    const archive = await gdjs.GDModelFormat.unpack(
      makeArchive(makeManifest(), [
        {
          name: gdjs.GDModelFormat.THUMBNAIL_FILENAME,
          data: new Uint8Array([1, 2, 3]),
        },
      ])
    );
    expect(archive.thumbnail ? archive.thumbnail.length : 0).to.be(3);
  });

  it('fills what a minimal manifest omits', () => {
    const manifest = gdjs.GDModelFormat.normalizeManifest({
      format: gdjs.GDModelFormat.FORMAT_NAME,
      version: 1,
    });
    expect(manifest.sockets).to.eql([]);
    expect(manifest.colliders).to.eql([]);
    expect(manifest.lods).to.eql([]);
    expect(manifest.animationEvents).to.eql([]);
    expect(manifest.upAxis).to.be('Y');
    expect(gdjs.GDModelFormat.hasEngineData(manifest)).to.be(false);
  });

  it('refuses a manifest of another format or of a newer version', () => {
    expect(() =>
      gdjs.GDModelFormat.normalizeManifest({ format: 'gltf', version: 1 })
    ).to.throwError(/Unsupported model format/);
    expect(() =>
      gdjs.GDModelFormat.normalizeManifest({
        format: gdjs.GDModelFormat.FORMAT_NAME,
        version: gdjs.GDModelFormat.FORMAT_VERSION + 1,
      })
    ).to.throwError(/newer version/);
  });

  it('drops the sockets and colliders it cannot use', () => {
    const manifest = gdjs.GDModelFormat.normalizeManifest({
      format: gdjs.GDModelFormat.FORMAT_NAME,
      version: 1,
      sockets: [{ name: 'no-node' }, { name: 'ok', node: 'Node' }],
      colliders: [{ type: 'made-up', node: 'Body' }],
      lods: [
        { distance: 60, file: 'lod2.glb' },
        { distance: 20, file: 'lod1.glb' },
      ],
    });
    expect(manifest.sockets.length).to.be(1);
    expect(manifest.sockets[0].name).to.be('ok');
    expect(manifest.colliders[0].type).to.be('box');
    expect(manifest.lods.map((lod) => lod.file)).to.eql([
      'lod1.glb',
      'lod2.glb',
    ]);
  });

  it('reports a corrupted archive instead of returning wrong data', async () => {
    const archive = makeArchive(makeManifest());
    const corrupted = new Uint8Array(archive);
    // Flip a byte of the data of the first entry ("gdevelop.model.json").
    corrupted[30 + gdjs.GDModelFormat.MANIFEST_FILENAME.length + 4] ^= 0xff;
    let error = null;
    try {
      await gdjs.GDModelFormat.unpack(corrupted.buffer);
    } catch (thrownError) {
      error = thrownError;
    }
    expect(error).not.to.be(null);
    expect(error.message).to.match(/corrupted/);
  });

  it('reports an archive without model', async () => {
    const withoutModel = createZip([
      {
        name: gdjs.GDModelFormat.MANIFEST_FILENAME,
        data: encodeUtf8(
          JSON.stringify(gdjs.GDModelFormat.createDefaultManifest())
        ),
      },
    ]);
    let error = null;
    try {
      await gdjs.GDModelFormat.unpack(withoutModel);
    } catch (thrownError) {
      error = thrownError;
    }
    expect(error.message).to.match(/model\.glb/);
  });

  it('finds the sockets and the events of a clip', () => {
    const manifest = gdjs.GDModelFormat.normalizeManifest(makeManifest());

    expect(gdjs.GDModelFormat.findSocket(manifest, 'muzzle').node).to.be(
      'Weapon'
    );
    expect(gdjs.GDModelFormat.findSocket(manifest, 'unknown')).to.be(null);
    expect(gdjs.GDModelFormat.findCollider(manifest, 'body').size).to.eql([
      1, 2, 1,
    ]);

    const events = gdjs.GDModelFormat.getAnimationEvents(manifest, 'Run');
    expect(events.map((event) => event.name)).to.eql(['jump', 'footstep']);
    expect(gdjs.GDModelFormat.getAnimationEvents(manifest, 'Unknown')).to.eql(
      []
    );
  });

  it('decodes a manifest saved with non ASCII text', async () => {
    const manifest = {
      ...gdjs.GDModelFormat.createDefaultManifest(),
      notes: 'نموذج ثلاثي الأبعاد',
      sockets: [
        {
          name: 'فوهة',
          node: 'Weapon',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        },
      ],
    };
    const archive = await gdjs.GDModelFormat.unpack(makeArchive(manifest));
    expect(archive.manifest.sockets[0].name).to.be('فوهة');
    expect(decodeUtf8(encodeUtf8(archive.manifest.notes))).to.be(
      archive.manifest.notes
    );
  });
});
