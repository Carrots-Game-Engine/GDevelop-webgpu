namespace gdjs {
  /**
   * Reader of the `.gdm` 3D model container.
   *
   * A `.gdm` file is a ZIP archive holding a binary glTF (`model.glb`) and a
   * manifest (`gdevelop.model.json`) with what the engine knows about the model
   * but glTF cannot express: sockets, colliders, levels of detail and animation
   * events.
   *
   * This is the same format as `newIDE/app/src/ModelEditor/GDModelFormat.js`
   * (kept in sync by hand, like `Resource3DPreview.worker.js`), reduced to what
   * a game needs to read. Entries are stored (not deflated), which is what the
   * editor writes: reading a `.gdm` therefore needs no DEFLATE implementation.
   */
  export namespace GDModelFormat {
    export const FORMAT_NAME = 'gdevelop-3d-model';
    export const FORMAT_VERSION = 1;
    export const EXTENSION = 'gdm';
    export const MANIFEST_FILENAME = 'gdevelop.model.json';
    export const MAIN_MODEL_FILENAME = 'model.glb';
    export const THUMBNAIL_FILENAME = 'thumb.png';

    export type Vector3 = [number, number, number];

    export type Socket = {
      name: string;
      node: string;
      /** Offset from the node, in the node space. */
      position: Vector3;
      /** Rotation in degrees around each axis. */
      rotation: Vector3;
    };

    export type Collider = {
      name: string;
      type: 'box' | 'sphere' | 'capsule' | 'convex' | 'trimesh';
      /** Node (mesh) the collider is computed from, or '' for the whole model. */
      node: string;
      size: Vector3;
      center: Vector3;
    };

    export type LOD = {
      distance: number;
      file: string;
    };

    export type AnimationEvent = {
      clip: string;
      time: number;
      name: string;
    };

    export type Manifest = {
      format: string;
      version: number;
      generator: string;
      upAxis: string;
      unitScale: number;
      origin: Vector3;
      center: Vector3;
      sockets: Socket[];
      colliders: Collider[];
      lods: LOD[];
      animationEvents: AnimationEvent[];
      textureQualityHint: string;
      notes: string;
    };

    export type Archive = {
      manifest: Manifest;
      glb: Uint8Array;
      thumbnail: Uint8Array | null;
      entries: Array<FileEntry>;
    };

    export type FileEntry = {
      name: string;
      data: Uint8Array;
    };

    export const isGDModelFileName = (fileName: string): boolean =>
      !!fileName && fileName.toLowerCase().endsWith('.' + EXTENSION);

    const isVector3 = (value: any): boolean =>
      Array.isArray(value) &&
      value.length === 3 &&
      value.every((item) => typeof item === 'number' && isFinite(item));

    const toVector3 = (value: any, fallback: Vector3): Vector3 =>
      isVector3(value) ? [value[0], value[1], value[2]] : fallback;

    const toFiniteNumber = (value: any, fallback: number): number =>
      typeof value === 'number' && isFinite(value) ? value : fallback;

    const toStringOr = (value: any, fallback: string): string =>
      typeof value === 'string' ? value : fallback;

    export const createDefaultManifest = (): Manifest => ({
      format: FORMAT_NAME,
      version: FORMAT_VERSION,
      generator: 'gdevelop-model-editor/1',
      upAxis: 'Y',
      unitScale: 1,
      origin: [0, 0, 0],
      center: [0, 0, 0],
      sockets: [],
      colliders: [],
      lods: [],
      animationEvents: [],
      textureQualityHint: 'auto',
      notes: '',
    });

    /**
     * Read a manifest, filling what is missing and dropping what cannot be
     * understood. A model saved by a newer version is refused rather than
     * displayed wrongly.
     */
    export const normalizeManifest = (raw: any): Manifest => {
      if (!raw || typeof raw !== 'object')
        throw new Error('The model manifest is not an object.');

      if (raw.format !== undefined && raw.format !== FORMAT_NAME)
        throw new Error(`Unsupported model format "${String(raw.format)}".`);

      const version = toFiniteNumber(raw.version, FORMAT_VERSION);
      if (version > FORMAT_VERSION)
        throw new Error(
          `The model was saved by a newer version of GDevelop (manifest version ${version}).`
        );

      const sockets: Socket[] = Array.isArray(raw.sockets)
        ? raw.sockets
            .filter(
              (socket: any) =>
                socket &&
                typeof socket === 'object' &&
                socket.name &&
                socket.node
            )
            .map((socket: any) => ({
              name: String(socket.name),
              node: String(socket.node),
              position: toVector3(socket.position, [0, 0, 0]),
              rotation: toVector3(socket.rotation, [0, 0, 0]),
            }))
        : [];

      const colliderTypes = ['box', 'sphere', 'capsule', 'convex', 'trimesh'];
      const colliders: Collider[] = Array.isArray(raw.colliders)
        ? raw.colliders
            .filter((collider: any) => collider && typeof collider === 'object')
            .map((collider: any, index: number) => ({
              name: toStringOr(collider.name, `collider${index}`),
              type: colliderTypes.includes(collider.type)
                ? collider.type
                : 'box',
              node: toStringOr(collider.node, ''),
              size: toVector3(collider.size, [0, 0, 0]),
              center: toVector3(collider.center, [0, 0, 0]),
            }))
        : [];

      const lods: LOD[] = Array.isArray(raw.lods)
        ? raw.lods
            .filter(
              (lod: any) =>
                lod &&
                typeof lod === 'object' &&
                typeof lod.file === 'string' &&
                lod.file
            )
            .map((lod: any, index: number) => ({
              distance: toFiniteNumber(lod.distance, (index + 1) * 30),
              file: lod.file,
            }))
            .sort((first: LOD, second: LOD) => first.distance - second.distance)
        : [];

      const animationEvents: AnimationEvent[] = Array.isArray(
        raw.animationEvents
      )
        ? raw.animationEvents
            .filter(
              (event: any) =>
                event &&
                typeof event === 'object' &&
                typeof event.clip === 'string' &&
                typeof event.name === 'string'
            )
            .map((event: any) => ({
              clip: event.clip,
              time: Math.max(0, toFiniteNumber(event.time, 0)),
              name: event.name,
            }))
        : [];

      return {
        format: FORMAT_NAME,
        version: FORMAT_VERSION,
        generator: toStringOr(raw.generator, 'gdevelop-model-editor/1'),
        upAxis: toStringOr(raw.upAxis, 'Y'),
        unitScale:
          toFiniteNumber(raw.unitScale, 1) > 0
            ? toFiniteNumber(raw.unitScale, 1)
            : 1,
        origin: toVector3(raw.origin, [0, 0, 0]),
        center: toVector3(raw.center, [0, 0, 0]),
        sockets,
        colliders,
        lods,
        animationEvents,
        textureQualityHint: toStringOr(raw.textureQualityHint, 'auto'),
        notes: toStringOr(raw.notes, ''),
      };
    };

    /** Whether the manifest holds anything a plain glTF file cannot. */
    export const hasEngineData = (manifest: Manifest): boolean =>
      manifest.sockets.length > 0 ||
      manifest.colliders.length > 0 ||
      manifest.lods.length > 0 ||
      manifest.animationEvents.length > 0;

    // -----------------------------------------------------------------
    // ZIP (stored entries)
    // -----------------------------------------------------------------

    const CRC32_TABLE = (() => {
      const table = new Uint32Array(256);
      for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
          value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
      }
      return table;
    })();

    export const crc32 = (data: Uint8Array): number => {
      let crc = 0xffffffff;
      for (let index = 0; index < data.length; index++) {
        crc = CRC32_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
      }
      return (crc ^ 0xffffffff) >>> 0;
    };

    const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
      const DecompressionStreamImplementation =
        typeof (window as any).DecompressionStream !== 'undefined'
          ? (window as any).DecompressionStream
          : null;
      if (!DecompressionStreamImplementation)
        throw new Error(
          'This model contains deflated files, which this browser cannot read.'
        );
      const stream = new Blob([data])
        .stream()
        .pipeThrough(new DecompressionStreamImplementation('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };

    const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
    const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
    const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
    const ZIP_END_OF_CENTRAL_DIRECTORY_SIZE = 22;
    const ZIP_METHOD_STORED = 0;
    const ZIP_METHOD_DEFLATED = 8;

    /** Read every entry of a ZIP archive. */
    export const readZip = async (
      buffer: ArrayBuffer
    ): Promise<FileEntry[]> => {
      const view = new DataView(buffer);
      if (view.byteLength < ZIP_END_OF_CENTRAL_DIRECTORY_SIZE)
        throw new Error('This file is too small to be a model archive.');

      const minimumOffset = Math.max(
        0,
        view.byteLength - ZIP_END_OF_CENTRAL_DIRECTORY_SIZE - 0xffff
      );
      let endOfCentralDirectoryOffset = -1;
      for (
        let offset = view.byteLength - ZIP_END_OF_CENTRAL_DIRECTORY_SIZE;
        offset >= minimumOffset;
        offset--
      ) {
        if (
          view.getUint32(offset, true) ===
          ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE
        ) {
          endOfCentralDirectoryOffset = offset;
          break;
        }
      }
      if (endOfCentralDirectoryOffset < 0)
        throw new Error(
          'This file is not a valid model archive (no ZIP index).'
        );

      const entriesCount = view.getUint16(
        endOfCentralDirectoryOffset + 10,
        true
      );
      const centralDirectorySize = view.getUint32(
        endOfCentralDirectoryOffset + 12,
        true
      );
      const centralDirectoryOffset = view.getUint32(
        endOfCentralDirectoryOffset + 16,
        true
      );

      if (
        entriesCount === 0xffff ||
        centralDirectoryOffset === 0xffffffff ||
        centralDirectorySize === 0xffffffff
      )
        throw new Error('ZIP64 model archives are not supported.');

      const entries: FileEntry[] = [];
      const decoder = new TextDecoder('utf-8');
      let offset = centralDirectoryOffset;

      for (let index = 0; index < entriesCount; index++) {
        if (
          offset + 46 > view.byteLength ||
          view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
        )
          throw new Error('The model archive index is corrupted.');

        const method = view.getUint16(offset + 10, true);
        const crc = view.getUint32(offset + 16, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraFieldLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);

        const nameStart = offset + 46;
        const name = decoder
          .decode(new Uint8Array(buffer, nameStart, nameLength))
          .replace(/\\/g, '/');
        offset = nameStart + nameLength + extraFieldLength + commentLength;

        if (
          localHeaderOffset + 30 > view.byteLength ||
          view.getUint32(localHeaderOffset, true) !==
            ZIP_LOCAL_FILE_HEADER_SIGNATURE
        )
          throw new Error(
            `The entry "${name}" of the model archive is corrupted.`
          );

        const localNameLength = view.getUint16(localHeaderOffset + 26, true);
        const localExtraFieldLength = view.getUint16(
          localHeaderOffset + 28,
          true
        );
        const dataStart =
          localHeaderOffset + 30 + localNameLength + localExtraFieldLength;
        if (dataStart + compressedSize > view.byteLength)
          throw new Error(
            `The entry "${name}" of the model archive is corrupted.`
          );

        const rawData = new Uint8Array(buffer, dataStart, compressedSize);
        let data: Uint8Array;
        if (method === ZIP_METHOD_STORED) data = rawData;
        else if (method === ZIP_METHOD_DEFLATED)
          data = await inflateRaw(rawData);
        else
          throw new Error('The model archive uses an unsupported compression.');

        if (data.length !== uncompressedSize)
          throw new Error(
            `The entry "${name}" of the model archive is truncated.`
          );
        if (crc32(data) !== crc)
          throw new Error(
            `The entry "${name}" of the model archive is corrupted.`
          );

        entries.push({ name, data });
      }

      return entries;
    };

    const findEntry = (
      entries: FileEntry[],
      name: string
    ): FileEntry | undefined => entries.find((entry) => entry.name === name);

    /** Read a `.gdm` archive: its manifest, its model and its thumbnail. */
    export const unpack = async (buffer: ArrayBuffer): Promise<Archive> => {
      const entries = await readZip(buffer);
      const manifestEntry = findEntry(entries, MANIFEST_FILENAME);
      if (!manifestEntry)
        throw new Error(
          `The model archive has no "${MANIFEST_FILENAME}" manifest.`
        );
      const modelEntry = findEntry(entries, MAIN_MODEL_FILENAME);
      if (!modelEntry)
        throw new Error(
          `The model archive has no "${MAIN_MODEL_FILENAME}" model.`
        );

      const manifest = normalizeManifest(
        JSON.parse(new TextDecoder('utf-8').decode(manifestEntry.data))
      );
      const thumbnailEntry = findEntry(entries, THUMBNAIL_FILENAME);

      return {
        manifest,
        glb: modelEntry.data,
        thumbnail: thumbnailEntry ? thumbnailEntry.data : null,
        entries,
      };
    };

    // -----------------------------------------------------------------
    // What the engine reads from a manifest
    // -----------------------------------------------------------------

    export const findSocket = (
      manifest: Manifest,
      socketName: string
    ): Socket | null =>
      manifest.sockets.find((socket) => socket.name === socketName) || null;

    export const findCollider = (
      manifest: Manifest,
      colliderName: string
    ): Collider | null =>
      manifest.colliders.find((collider) => collider.name === colliderName) ||
      null;

    /** The events of an animation clip, sorted by time. */
    export const getAnimationEvents = (
      manifest: Manifest,
      clipName: string
    ): AnimationEvent[] =>
      manifest.animationEvents
        .filter((event) => event.clip === clipName)
        .sort((first, second) => first.time - second.time);

    /** Whether a buffer is a binary glTF (`glTF` magic bytes). */
    export const isBinaryGLTF = (data: Uint8Array): boolean =>
      data.length > 12 &&
      data[0] === 0x67 &&
      data[1] === 0x6c &&
      data[2] === 0x54 &&
      data[3] === 0x46;
  }
}
