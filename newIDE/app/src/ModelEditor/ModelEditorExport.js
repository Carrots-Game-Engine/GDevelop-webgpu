// @flow
/**
 * Turning an edited model into the bytes to store in a resource file.
 *
 * Two files can hold a model:
 * - `.gdm`, the GDevelop container (`GDModelFormat`), holding the GLB *and* the
 *   manifest (sockets, colliders, LODs, animation events);
 * - `.glb`, a plain binary glTF, for interoperability with Blender and other
 *   tools. What the manifest holds is then kept in the **resource metadata** of
 *   the project (same mechanism as the Piskel data), so that nothing typed in
 *   the editor is lost when a user chooses a `.glb`.
 *
 * The exporter (Three.js `GLTFExporter`) is passed by the caller, so that this
 * module stays testable without WebGL or a `FileReader`.
 */
import {
  GD_MODEL_FILE_EXTENSION,
  GD_MODEL_RESOURCE_METADATA_KEY,
  isBinaryGLTF,
  normalizeManifest,
  packGDModel,
  type GDModelFileEntry,
  type GDModelManifest,
} from './GDModelFormat';
import { type GDModelDocument } from './GDModelDocument';

export const GLB_FILE_EXTENSION = '.glb';

/** Export the document to a binary glTF. Injected so that it can be faked. */
export type BinaryGLTFExporter = (
  document: GDModelDocument
) => Promise<ArrayBuffer>;

export type ModelFileToSave = {|
  bytes: Uint8Array,
  extension: string,
  manifest: GDModelManifest,
  isPacked: boolean,
|};

export const isPackedExtension = (extension: string): boolean =>
  !!extension && extension.toLowerCase() === GD_MODEL_FILE_EXTENSION;

/**
 * Choose the extension to save with: a model already stored as a `.gdm` stays
 * one (its manifest is inside the file), and a model holding engine specific
 * data is packed unless the user asked for a `.glb` (its data then goes to the
 * resource metadata).
 */
export const getModelFileExtensionForSave = ({
  document,
  currentFileExtension,
  saveAsPacked,
}: {|
  document: GDModelDocument,
  currentFileExtension?: string,
  saveAsPacked?: ?boolean,
|}): string => {
  if (isPackedExtension(currentFileExtension || ''))
    return GD_MODEL_FILE_EXTENSION;
  if (saveAsPacked === true) return GD_MODEL_FILE_EXTENSION;
  if (saveAsPacked === false) return GLB_FILE_EXTENSION;
  return document.hasEngineData()
    ? GD_MODEL_FILE_EXTENSION
    : GLB_FILE_EXTENSION;
};

export const buildModelFile = async ({
  document,
  exportDocumentToBinaryGLTF,
  extension,
  thumbnail,
  extraFiles,
  date,
}: {|
  document: GDModelDocument,
  exportDocumentToBinaryGLTF: BinaryGLTFExporter,
  extension: string,
  thumbnail?: ?Uint8Array,
  extraFiles?: Array<GDModelFileEntry>,
  date?: Date,
|}): Promise<ModelFileToSave> => {
  const exported = await exportDocumentToBinaryGLTF(document);
  const glb = new Uint8Array(exported);
  if (!isBinaryGLTF(glb))
    throw new Error(
      'The 3D model could not be exported: the exporter did not produce a binary glTF file.'
    );

  const manifest = document.buildManifest();
  if (!isPackedExtension(extension)) {
    return {
      bytes: glb,
      extension: GLB_FILE_EXTENSION,
      manifest,
      isPacked: false,
    };
  }

  return {
    bytes: packGDModel(
      {
        manifest,
        glb,
        thumbnail,
        extraFiles: extraFiles || document.getExtraFiles(),
      },
      date
    ),
    extension: GD_MODEL_FILE_EXTENSION,
    manifest,
    isPacked: true,
  };
};

/**
 * What to store in the resource metadata when the model is saved as a `.glb`
 * (or what the editor reads back to restore sockets and colliders).
 */
export const getManifestForResourceMetadata = (
  manifest: GDModelManifest
): { [string]: any } => ({ [GD_MODEL_RESOURCE_METADATA_KEY]: manifest });

export const readManifestFromResourceMetadata = (
  metadataAsString: ?string
): ?GDModelManifest => {
  if (!metadataAsString) return null;
  let metadata;
  try {
    metadata = JSON.parse(metadataAsString);
  } catch (error) {
    console.warn('Malformed metadata for a 3D model resource - ignoring it.');
    return null;
  }
  if (!metadata || typeof metadata !== 'object') return null;
  const rawManifest = metadata[GD_MODEL_RESOURCE_METADATA_KEY];
  if (!rawManifest) return null;
  try {
    return normalizeManifest(rawManifest);
  } catch (error) {
    console.warn('Malformed 3D model data in the resource metadata:', error);
    return null;
  }
};
