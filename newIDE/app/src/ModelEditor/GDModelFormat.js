// @flow
/**
 * The `.gdm` ("GDevelop 3D Model") container.
 *
 * A `.gdm` file is a ZIP archive holding a binary glTF (`model.glb`) and a
 * manifest (`gdevelop.model.json`) with everything the engine knows about the
 * model but glTF cannot express: sockets, colliders, levels of detail and
 * animation events.
 *
 * The archive entries are *stored* (not deflated): a GLB already compresses its
 * mesh data, and keeping entries stored means the runtime can read a `.gdm`
 * without shipping a DEFLATE implementation.
 *
 * This module has no dependency on purpose: it is used by the editor, by the
 * game runtime (see `GDJS/Runtime/GDModelFormat.ts`, kept in sync by hand) and
 * by tests.
 */

export const GD_MODEL_FORMAT_NAME = 'gdevelop-3d-model';
export const GD_MODEL_FORMAT_VERSION = 1;
export const GD_MODEL_GENERATOR = 'gdevelop-model-editor/1';

export const GD_MODEL_EXTENSION = 'gdm';
/** Used both as a resource file extension and in the resource metadata. */
export const GD_MODEL_FILE_EXTENSION = '.gdm';
export const GD_MODEL_MANIFEST_FILENAME = 'gdevelop.model.json';
export const GD_MODEL_MAIN_MODEL_FILENAME = 'model.glb';
export const GD_MODEL_THUMBNAIL_FILENAME = 'thumb.png';
/** Key of the resource metadata holding what is not in the model file itself. */
export const GD_MODEL_RESOURCE_METADATA_KEY = 'gdm';

export const GD_MODEL_COLLIDER_TYPES = [
  'box',
  'sphere',
  'capsule',
  'convex',
  'trimesh',
];

export type GDModelVector3 = [number, number, number];

export type GDModelSocket = {|
  name: string,
  node: string,
  /** Offset from the node, in the node space. */
  position: GDModelVector3,
  /** Rotation in degrees around each axis, in the parent space. */
  rotation: GDModelVector3,
|};

export type GDModelCollider = {|
  name: string,
  type: 'box' | 'sphere' | 'capsule' | 'convex' | 'trimesh',
  /** Node (mesh) the collider is computed from, or '' for the whole model. */
  node: string,
  /** Size override, in model units. `[0, 0, 0]` means "measure the node". */
  size: GDModelVector3,
  /** Center of the collider in model space. */
  center: GDModelVector3,
|};

export type GDModelLOD = {|
  distance: number,
  file: string,
|};

export type GDModelAnimationEvent = {|
  clip: string,
  time: number,
  name: string,
|};

export type GDModelManifest = {|
  format: string,
  version: number,
  generator: string,
  upAxis: string,
  unitScale: number,
  origin: GDModelVector3,
  center: GDModelVector3,
  sockets: Array<GDModelSocket>,
  colliders: Array<GDModelCollider>,
  lods: Array<GDModelLOD>,
  animationEvents: Array<GDModelAnimationEvent>,
  textureQualityHint: string,
  notes: string,
|};

export type GDModelFileEntry = {|
  name: string,
  data: Uint8Array,
|};

export type GDModelArchive = {|
  manifest: GDModelManifest,
  glb: Uint8Array,
  thumbnail: ?Uint8Array,
  /** Every entry of the archive, so that unknown ones can be preserved. */
  entries: Array<GDModelFileEntry>,
|};

/** File extensions a model resource can use. */
export const GD_MODEL_EXTENSIONS = ['glb', GD_MODEL_EXTENSION];

export const isGDModelFileName = (fileName: string): boolean =>
  !!fileName && fileName.toLowerCase().endsWith(GD_MODEL_FILE_EXTENSION);

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const isVector3 = (value: any): boolean =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(item => typeof item === 'number' && isFinite(item));

const toVector3 = (value: any, fallback: GDModelVector3): GDModelVector3 =>
  isVector3(value) ? [value[0], value[1], value[2]] : fallback;

const toFiniteNumber = (value: any, fallback: number): number =>
  typeof value === 'number' && isFinite(value) ? value : fallback;

const toStringOr = (value: any, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

export const createDefaultManifest = (): GDModelManifest => ({
  format: GD_MODEL_FORMAT_NAME,
  version: GD_MODEL_FORMAT_VERSION,
  generator: GD_MODEL_GENERATOR,
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
 * Read a manifest object coming from a file (or from a resource metadata),
 * filling what is missing and dropping what cannot be understood, so that a
 * file written by another version still opens.
 */
export const normalizeManifest = (raw: any): GDModelManifest => {
  if (!raw || typeof raw !== 'object')
    throw new Error('The model manifest is not an object.');

  if (raw.format !== undefined && raw.format !== GD_MODEL_FORMAT_NAME)
    throw new Error(
      `Unsupported model format "${String(
        raw.format
      )}" (expected "${GD_MODEL_FORMAT_NAME}").`
    );

  const version = toFiniteNumber(raw.version, NaN);
  if (raw.version !== undefined) {
    if (!isFinite(version))
      throw new Error('The model manifest version is not a number.');
    if (version > GD_MODEL_FORMAT_VERSION)
      throw new Error(
        `The model was saved by a newer version of GDevelop (manifest version ${version}, this version reads ${GD_MODEL_FORMAT_VERSION}).`
      );
    if (version < 1)
      throw new Error(`Unsupported model manifest version ${version}.`);
  }

  const sockets: Array<GDModelSocket> = Array.isArray(raw.sockets)
    ? raw.sockets
        .filter(
          (socket: any) =>
            socket && typeof socket === 'object' && socket.name && socket.node
        )
        .map((socket: any) => ({
          name: String(socket.name),
          node: String(socket.node),
          position: toVector3(socket.position, [0, 0, 0]),
          rotation: toVector3(socket.rotation, [0, 0, 0]),
        }))
    : [];

  const colliders: Array<GDModelCollider> = Array.isArray(raw.colliders)
    ? raw.colliders
        .filter((collider: any) => collider && typeof collider === 'object')
        .map((collider: any, index: number) => ({
          name: toStringOr(collider.name, `collider${index}`),
          // $FlowFixMe[incompatible-type] - filtered by the list above.
          type: GD_MODEL_COLLIDER_TYPES.includes(collider.type)
            ? collider.type
            : 'box',
          node: toStringOr(collider.node, ''),
          size: toVector3(collider.size, [0, 0, 0]),
          center: toVector3(collider.center, [0, 0, 0]),
        }))
    : [];

  const lods: Array<GDModelLOD> = Array.isArray(raw.lods)
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
        .sort((a, b) => a.distance - b.distance)
    : [];

  const animationEvents: Array<GDModelAnimationEvent> = Array.isArray(
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
    format: GD_MODEL_FORMAT_NAME,
    version: GD_MODEL_FORMAT_VERSION,
    generator: toStringOr(raw.generator, GD_MODEL_GENERATOR),
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

/** Whether the manifest holds anything that a plain glTF file cannot. */
export const manifestHasEngineData = (manifest: GDModelManifest): boolean =>
  manifest.sockets.length > 0 ||
  manifest.colliders.length > 0 ||
  manifest.lods.length > 0 ||
  manifest.animationEvents.length > 0 ||
  manifest.upAxis !== 'Y' ||
  manifest.unitScale !== 1;

export const serializeManifest = (manifest: GDModelManifest): string =>
  JSON.stringify(manifest, null, 2);

export const parseManifest = (json: string): GDModelManifest => {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`The model manifest is not valid JSON: ${error.message}`);
  }
  return normalizeManifest(parsed);
};

// ---------------------------------------------------------------------------
// ZIP (stored entries)
// ---------------------------------------------------------------------------

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

export const encodeUtf8 = (text: string): Uint8Array => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  // Fallback for environments without TextEncoder (old jsdom).
  const encoded = unescape(encodeURIComponent(text));
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index++)
    bytes[index] = encoded.charCodeAt(index);
  return bytes;
};

export const decodeUtf8 = (bytes: Uint8Array): string => {
  if (typeof TextDecoder !== 'undefined')
    return new TextDecoder('utf-8').decode(bytes);
  let text = '';
  for (let index = 0; index < bytes.length; index++)
    text += String.fromCharCode(bytes[index]);
  // eslint-disable-next-line no-undef
  return decodeURIComponent(escape(text));
};

const getDosDateTime = (date: Date): {| time: number, date: number |} => {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2) & 0x1f),
    date:
      ((year - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      (date.getDate() & 0x1f),
  };
};

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const ZIP_VERSION = 20; // 2.0: readable by every unzip implementation.
const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATED = 8;
const ZIP_UTF8_FLAG = 0x800;

/** Build a ZIP archive with stored (uncompressed) entries. */
export const createZip = (
  entries: Array<GDModelFileEntry>,
  date: Date = new Date()
): Uint8Array => {
  const { time, date: dosDate } = getDosDateTime(date);

  const normalizedEntries = entries.map((entry, index) => ({
    index,
    name: entry.name,
    nameBytes: encodeUtf8(entry.name),
    data: entry.data,
    crc: crc32(entry.data),
  }));

  const localHeadersSize = normalizedEntries.reduce(
    (total, entry) => total + 30 + entry.nameBytes.length + entry.data.length,
    0
  );
  const centralDirectorySize = normalizedEntries.reduce(
    (total, entry) => total + 46 + entry.nameBytes.length,
    0
  );

  const output = new Uint8Array(
    localHeadersSize + centralDirectorySize + ZIP_END_OF_CENTRAL_DIRECTORY_SIZE
  );
  const view = new DataView(output.buffer);
  let offset = 0;
  const localHeaderOffsets = [];

  normalizedEntries.forEach(entry => {
    localHeaderOffsets.push(offset);
    view.setUint32(offset, ZIP_LOCAL_FILE_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, ZIP_VERSION, true);
    view.setUint16(offset + 6, ZIP_UTF8_FLAG, true);
    view.setUint16(offset + 8, ZIP_METHOD_STORED, true);
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true); // Extra field length.
    offset += 30;
    output.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
    output.set(entry.data, offset);
    offset += entry.data.length;
  });

  const centralDirectoryOffset = offset;

  normalizedEntries.forEach(entry => {
    view.setUint32(offset, ZIP_CENTRAL_DIRECTORY_SIGNATURE, true);
    view.setUint16(offset + 4, ZIP_VERSION, true);
    view.setUint16(offset + 6, ZIP_VERSION, true);
    view.setUint16(offset + 8, ZIP_UTF8_FLAG, true);
    view.setUint16(offset + 10, ZIP_METHOD_STORED, true);
    view.setUint16(offset + 12, time, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true); // Extra field length.
    view.setUint16(offset + 32, 0, true); // Comment length.
    view.setUint16(offset + 34, 0, true); // Disk number.
    view.setUint16(offset + 36, 0, true); // Internal attributes.
    view.setUint32(offset + 38, 0, true); // External attributes.
    view.setUint32(offset + 42, localHeaderOffsets[entry.index], true);
    offset += 46;
    output.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
  });

  view.setUint32(offset, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(offset + 4, 0, true); // This disk.
  view.setUint16(offset + 6, 0, true); // Disk of the central directory.
  view.setUint16(offset + 8, normalizedEntries.length, true);
  view.setUint16(offset + 10, normalizedEntries.length, true);
  view.setUint32(offset + 12, centralDirectorySize, true);
  view.setUint32(offset + 16, centralDirectoryOffset, true);
  view.setUint16(offset + 20, 0, true); // Comment length.

  return output;
};

const findEndOfCentralDirectory = (view: DataView): number => {
  const minimumOffset = Math.max(
    0,
    view.byteLength - ZIP_END_OF_CENTRAL_DIRECTORY_SIZE - 0xffff
  );
  for (
    let offset = view.byteLength - ZIP_END_OF_CENTRAL_DIRECTORY_SIZE;
    offset >= minimumOffset;
    offset--
  ) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE)
      return offset;
  }
  return -1;
};

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  // `DecompressionStream` is available in Electron and in every browser
  // supported by GDevelop, but not in older test environments.
  const DecompressionStreamImplementation =
    typeof DecompressionStream !== 'undefined' ? DecompressionStream : null;
  if (!DecompressionStreamImplementation)
    throw new Error(
      'This model contains deflated files, which this environment cannot read.'
    );

  const stream = new Blob([data])
    .stream()
    // $FlowFixMe[incompatible-call] - `deflate-raw` is a valid format.
    .pipeThrough(new DecompressionStreamImplementation('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
};

/** Read every entry of a ZIP archive. */
export const readZip = async (
  buffer: ArrayBuffer
): Promise<Array<GDModelFileEntry>> => {
  const view = new DataView(buffer);
  if (view.byteLength < ZIP_END_OF_CENTRAL_DIRECTORY_SIZE)
    throw new Error('This file is too small to be a model archive.');

  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(view);
  if (endOfCentralDirectoryOffset < 0)
    throw new Error('This file is not a valid model archive (no ZIP index).');

  const entriesCount = view.getUint16(endOfCentralDirectoryOffset + 10, true);
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

  if (
    centralDirectoryOffset + centralDirectorySize >
    endOfCentralDirectoryOffset
  )
    throw new Error('The model archive index is corrupted.');

  const entries = [];
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
    const name = decodeUtf8(
      new Uint8Array(buffer, nameStart, nameLength)
    ).replace(/\\/g, '/');

    offset = nameStart + nameLength + extraFieldLength + commentLength;

    if (
      localHeaderOffset + 30 > view.byteLength ||
      view.getUint32(localHeaderOffset, true) !==
        ZIP_LOCAL_FILE_HEADER_SIGNATURE
    )
      throw new Error(`The entry "${name}" of the model archive is corrupted.`);

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraFieldLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart =
      localHeaderOffset + 30 + localNameLength + localExtraFieldLength;

    if (dataStart + compressedSize > view.byteLength)
      throw new Error(`The entry "${name}" of the model archive is corrupted.`);

    const rawData = new Uint8Array(buffer, dataStart, compressedSize);

    let data: Uint8Array;
    if (method === ZIP_METHOD_STORED) data = rawData;
    else if (method === ZIP_METHOD_DEFLATED) data = await inflateRaw(rawData);
    else throw new Error(`The model archive uses an unsupported compression.`);

    if (data.length !== uncompressedSize)
      throw new Error(`The entry "${name}" of the model archive is truncated.`);
    if (crc32(data) !== crc)
      throw new Error(`The entry "${name}" of the model archive is corrupted.`);

    entries.push({ name, data });
  }

  return entries;
};

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

const findEntry = (
  entries: Array<GDModelFileEntry>,
  name: string
): ?GDModelFileEntry => entries.find(entry => entry.name === name);

/**
 * Pack a model, its manifest and optional extra files (thumbnail, LODs) into a
 * `.gdm` archive.
 */
export const packGDModel = (
  {
    manifest,
    glb,
    thumbnail,
    extraFiles,
  }: {|
    manifest: GDModelManifest,
    glb: Uint8Array,
    thumbnail?: ?Uint8Array,
    extraFiles?: Array<GDModelFileEntry>,
  |},
  date?: Date
): Uint8Array => {
  const entries: Array<GDModelFileEntry> = [
    {
      name: GD_MODEL_MANIFEST_FILENAME,
      data: encodeUtf8(serializeManifest(normalizeManifest(manifest))),
    },
    { name: GD_MODEL_MAIN_MODEL_FILENAME, data: glb },
  ];
  if (thumbnail)
    entries.push({ name: GD_MODEL_THUMBNAIL_FILENAME, data: thumbnail });
  (extraFiles || []).forEach(extraFile => {
    if (entries.some(entry => entry.name === extraFile.name)) {
      // Never silently drop a file that would replace the manifest or the model.
      throw new Error(
        `The model archive already contains a file named "${extraFile.name}".`
      );
    }
    entries.push(extraFile);
  });

  return createZip(entries, date);
};

/** Read a `.gdm` archive. */
export const unpackGDModel = async (
  buffer: ArrayBuffer
): Promise<GDModelArchive> => {
  const entries = await readZip(buffer);
  const manifestEntry = findEntry(entries, GD_MODEL_MANIFEST_FILENAME);
  if (!manifestEntry)
    throw new Error(
      `The model archive has no "${GD_MODEL_MANIFEST_FILENAME}" manifest.`
    );
  const modelEntry = findEntry(entries, GD_MODEL_MAIN_MODEL_FILENAME);
  if (!modelEntry)
    throw new Error(
      `The model archive has no "${GD_MODEL_MAIN_MODEL_FILENAME}" model.`
    );

  return {
    manifest: parseManifest(decodeUtf8(manifestEntry.data)),
    glb: modelEntry.data,
    thumbnail:
      (findEntry(entries, GD_MODEL_THUMBNAIL_FILENAME) || {}).data || null,
    entries,
  };
};

/** Only extract the manifest, without decoding the model. */
export const readGDModelManifest = async (
  buffer: ArrayBuffer
): Promise<GDModelManifest> => {
  const entries = await readZip(buffer);
  const manifestEntry = findEntry(entries, GD_MODEL_MANIFEST_FILENAME);
  if (!manifestEntry)
    throw new Error(
      `The model archive has no "${GD_MODEL_MANIFEST_FILENAME}" manifest.`
    );
  return parseManifest(decodeUtf8(manifestEntry.data));
};

/**
 * Check that a buffer is a glTF binary (`glTF` magic bytes), so that a damaged
 * file is reported as such instead of failing inside the loader.
 */
export const isBinaryGLTF = (data: Uint8Array): boolean =>
  data.length > 12 &&
  data[0] === 0x67 && // g
  data[1] === 0x6c && // l
  data[2] === 0x54 && // T
  data[3] === 0x46; // F
