// @flow
/**
 * Reading a 3D model resource into an editable document, and writing it back.
 *
 * Loading is done from the file itself, never from the cache used by the scene
 * editor (`PixiResourcesLoader`): the editor mutates the nodes and the
 * geometries of what it displays, so it must own its own copy of the model.
 *
 * Saving writes the file through the same mechanism as the other resource
 * editors (a blob URL given to the resource, then stored by the storage
 * provider), which works for local and cloud projects alike.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import ResourcesLoader from '../ResourcesLoader';
import PixiResourcesLoader from '../ObjectsRendering/PixiResourcesLoader';
import { dracoDecoderPath } from '../Utils/DracoDecoder';
import { checkIfCredentialsRequired } from '../Utils/CrossOrigin';
import optionalRequire from '../Utils/OptionalRequire';
import { openBlobDownloadUrl } from '../Utils/BlobDownloadUrlHolder';
import { triggerOnResourceExternallyChanged } from '../MainFrame/ResourcesWatcher';
import {
  isURL,
  updateResourceJsonMetadata,
} from '../ResourcesList/ResourceUtils';
import { type ResourceManagementProps } from '../ResourcesList/ResourceSource';
import { GDModelDocument } from './GDModelDocument';
import {
  GD_MODEL_FILE_EXTENSION,
  isGDModelFileName,
  unpackGDModel,
} from './GDModelFormat';
import {
  GLB_FILE_EXTENSION,
  buildModelFile,
  getManifestForResourceMetadata,
  getModelFileExtensionForSave,
  readManifestFromResourceMetadata,
} from './ModelEditorExport';

const path = optionalRequire('path');

export type LoadedModelDocument = {|
  document: GDModelDocument,
  isPacked: boolean,
  fileExtension: string,
|};

export type SavedModelFile = {|
  extension: string,
  isPacked: boolean,
  file: string,
|};

/** Extension of the file of a resource, without its query string. */
export const getFileExtension = (file: string): string => {
  const cleanFile = (file || '').split('?')[0].split('#')[0];
  const lastDotIndex = cleanFile.lastIndexOf('.');
  if (lastDotIndex === -1) return '';
  return cleanFile.substring(lastDotIndex).toLowerCase();
};

const createGLTFLoader = (): any => {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(dracoDecoderPath);
  loader.setDRACOLoader(dracoLoader);
  return loader;
};

const fetchResourceArrayBuffer = async (
  project: gdProject,
  resourceName: string
): Promise<ArrayBuffer> => {
  const url = ResourcesLoader.getResourceFullUrl(project, resourceName, {
    isResourceForPixi: true,
  });
  const response = await fetch(url, {
    credentials: checkIfCredentialsRequired(url) ? 'include' : 'same-origin',
  });
  if (!response.ok)
    throw new Error(
      `Unable to read the 3D model "${resourceName}" (HTTP ${response.status}).`
    );
  return response.arrayBuffer();
};

/**
 * Load the model of a resource, with the data the engine knows about it.
 * A `.gdm` carries its own data; a `.glb` reads it from the resource metadata.
 */
export const loadModelDocument = async ({
  project,
  resourceName,
}: {|
  project: gdProject,
  resourceName: string,
|}): Promise<LoadedModelDocument> => {
  const resourcesManager = project.getResourcesManager();
  if (!resourcesManager.hasResource(resourceName))
    throw new Error(`The resource "${resourceName}" does not exist.`);

  const resource = resourcesManager.getResource(resourceName);
  if (resource.getKind() !== 'model3D')
    throw new Error(
      `The resource "${resourceName}" is not a 3D model (it is a "${resource.getKind()}").`
    );

  const file = resource.getFile();
  const arrayBuffer = await fetchResourceArrayBuffer(project, resourceName);
  const isPacked = isGDModelFileName(file);

  let glbBytes;
  let manifest = readManifestFromResourceMetadata(resource.getMetadata());
  if (isPacked) {
    const archive = await unpackGDModel(arrayBuffer);
    glbBytes = archive.glb;
    manifest = archive.manifest;
  } else {
    glbBytes = new Uint8Array(arrayBuffer);
  }

  const loader = createGLTFLoader();
  let gltf;
  try {
    gltf = await loader.parseAsync(
      glbBytes.buffer.slice(
        glbBytes.byteOffset,
        glbBytes.byteOffset + glbBytes.byteLength
      ),
      ''
    );
  } catch (error) {
    throw new Error(
      `Unable to read the 3D model "${resourceName}": ${error.message}`
    );
  }

  return {
    document: GDModelDocument.fromGLTF(gltf, manifest),
    isPacked,
    fileExtension: getFileExtension(file),
  };
};

/**
 * Read the binary glTF of a model resource, whatever its file is (a `.glb`, or
 * a `.gdm` holding one). Used to embed another model as a level of detail.
 */
export const readModelGLBBytes = async ({
  project,
  resourceName,
}: {|
  project: gdProject,
  resourceName: string,
|}): Promise<Uint8Array> => {
  const resourcesManager = project.getResourcesManager();
  if (!resourcesManager.hasResource(resourceName))
    throw new Error(`The resource "${resourceName}" does not exist.`);

  const resource = resourcesManager.getResource(resourceName);
  const arrayBuffer = await fetchResourceArrayBuffer(project, resourceName);
  if (isGDModelFileName(resource.getFile())) {
    const archive = await unpackGDModel(arrayBuffer);
    return archive.glb;
  }
  return new Uint8Array(arrayBuffer);
};

/** A new, empty model, for a model created from the editor. */
export const createEmptyModelDocument = (): GDModelDocument => {
  const root = new THREE.Group();
  root.name = 'Model';
  return new GDModelDocument({ root, animations: [], manifest: null });
};

/**
 * Export the document as a binary glTF. Three.js needs the animations to be
 * given explicitly: they are not part of the scene graph.
 */
export const exportDocumentToBinaryGLTF = async (
  document: GDModelDocument
): Promise<ArrayBuffer> => {
  const root = document.getRoot();
  root.updateMatrixWorld(true);

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, {
    binary: true,
    animations: document.getAnimations(),
    onlyVisible: false,
    includeCustomExtensions: false,
    truncateDrawRange: false,
  });
  if (!(result instanceof ArrayBuffer))
    throw new Error('The 3D model exporter did not return a binary glTF.');
  return result;
};

/**
 * Where the file must be written, when the project is stored locally.
 *
 * The storage provider overwrites the file given by `localFilePath` instead of
 * generating a new name, so that saving a model ten times leaves one file. When
 * the extension changes (a `.glb` model saved as a `.gdm`), the new file is
 * created next to the previous one, which is left untouched.
 */
export const getLocalFilePathForSave = ({
  project,
  currentFile,
  extension,
}: {|
  project: gdProject,
  currentFile: string,
  extension: string,
|}): ?string => {
  if (!path || !currentFile || isURL(currentFile)) return null;
  if (!project.getProjectFile()) return null;

  const currentExtension = getFileExtension(currentFile);
  if (!currentExtension) return null;
  if (currentExtension === extension) return currentFile;
  return (
    currentFile.substring(0, currentFile.length - currentExtension.length) +
    extension
  );
};

/**
 * Save the document into the resource file, store that file in the project and
 * make everything displaying the model load it again.
 */
export const saveModelDocument = async ({
  project,
  resourceName,
  document,
  saveAsPacked,
  thumbnail,
  resourceManagementProps,
}: {|
  project: gdProject,
  resourceName: string,
  document: GDModelDocument,
  saveAsPacked?: ?boolean,
  thumbnail?: ?Uint8Array,
  resourceManagementProps: ResourceManagementProps,
|}): Promise<SavedModelFile> => {
  const resourcesManager = project.getResourcesManager();
  if (!resourcesManager.hasResource(resourceName))
    throw new Error(`The resource "${resourceName}" does not exist.`);

  const resource = resourcesManager.getResource(resourceName);
  const currentFile = resource.getFile();
  const extension = getModelFileExtensionForSave({
    document,
    currentFileExtension: getFileExtension(currentFile),
    saveAsPacked,
  });

  const modelFile = await buildModelFile({
    document,
    exportDocumentToBinaryGLTF,
    extension,
    thumbnail,
  });

  const blob = new Blob([modelFile.bytes], {
    type: modelFile.isPacked ? 'application/zip' : 'model/gltf-binary',
  });
  const blobUrl = URL.createObjectURL(blob);
  resource.setFile(blobUrl);

  const localFilePath = getLocalFilePathForSave({
    project,
    currentFile,
    extension: modelFile.extension,
  });
  updateResourceJsonMetadata(resource, {
    extension: modelFile.extension,
    ...(localFilePath ? { localFilePath } : {}),
    // A `.gdm` carries the manifest itself; a `.glb` keeps it in the metadata
    // so that sockets and colliders are not lost when saving a standard file.
    ...(modelFile.isPacked
      ? {}
      : getManifestForResourceMetadata(modelFile.manifest)),
  });

  try {
    await resourceManagementProps.onFetchNewlyAddedResources();
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  // What displays the model (the scene editor, the object editor preview, the
  // resource thumbnail) caches the *parsed* model by resource name.
  PixiResourcesLoader.burst3DModelCacheForResource(resourceName);
  ResourcesLoader.burstUrlsCacheForResources(project, [resourceName]);
  triggerOnResourceExternallyChanged({ identifier: resource.getFile() });

  return {
    extension: modelFile.extension,
    isPacked: modelFile.isPacked,
    file: resource.getFile(),
  };
};

export { GD_MODEL_FILE_EXTENSION, GLB_FILE_EXTENSION };

/**
 * Export the document to a file the user can keep outside the project.
 *
 * Unlike `saveModelDocument`, this does not change the resource of the
 * project: it is a plain download, so the user can share the model or open it
 * in another 3D tool without touching the game.
 */
export const exportModelDocumentToFile = async ({
  document,
  extension,
  fileName,
}: {|
  document: GDModelDocument,
  extension: string,
  fileName: string,
|}): Promise<{| extension: string, isPacked: boolean |}> => {
  const modelFile = await buildModelFile({
    document,
    exportDocumentToBinaryGLTF,
    extension,
  });

  const blob = new Blob([modelFile.bytes], {
    type: modelFile.isPacked ? 'application/zip' : 'model/gltf-binary',
  });
  const blobUrl = URL.createObjectURL(blob);
  openBlobDownloadUrl(blobUrl, `${fileName}${modelFile.extension}`);

  // The browser needs the URL to stay alive while the download starts.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60 * 1000);

  return { extension: modelFile.extension, isPacked: modelFile.isPacked };
};
