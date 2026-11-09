// @flow
import * as React from 'react';
import { Trans } from '@lingui/macro';
import classNames from 'classnames';
import Dialog from '../UI/Dialog';
import PlaceholderLoader from '../UI/PlaceholderLoader';
import AlertMessage from '../UI/AlertMessage';
import { Column, Line } from '../UI/Grid';
import Text from '../UI/Text';
import { type ResourceManagementProps } from '../ResourcesList/ResourceSource';
import { createNewResource } from '../ResourcesList/ResourceSource';
import { applyResourceDefaults } from '../ResourcesList/ResourceUtils';
import newNameGenerator from '../Utils/NewNameGenerator';
import useForceUpdate from '../Utils/UseForceUpdate';
import CollapsibleSidePanel from '../UI/CollapsibleSidePanel';
import ScrollView from '../UI/ScrollView';

import { GDModelDocument } from './GDModelDocument';
import { deleteTriangles } from './MeshEditing';
import {
  ModelEditorHistory,
  type ModelEditorCommand,
} from './ModelEditorHistory';
import {
  ModelEditorEngine,
  type EditorMode,
  type EngineSelectionState,
  type MeshSelectionMode,
  type TransformMode,
} from './ModelEditorEngine';
import ModelEditorToolbar from './ModelEditorToolbar';
import ModelEditorViewport from './ModelEditorViewport';
import ModelEditorOutliner from './ModelEditorOutliner';
import ModelEditorInspector from './ModelEditorInspector';
import ModelEditorExportDialog from './ModelEditorExportDialog';
import {
  createEmptyModelDocument,
  getFileExtension,
  loadModelDocument,
  saveModelDocument,
} from './ModelEditorResource';
import { isGDModelFileName } from './GDModelFormat';
import classes from './ModelEditor.module.css';

const OUTLINER_WIDTH = 250;
const INSPECTOR_WIDTH = 320;

type Props = {|
  open: boolean,
  project: gdProject,
  /** The model resource to edit, or an empty string for a new model. */
  resourceName: string,
  resourceManagementProps: ResourceManagementProps,
  onClose: () => void,
  /** Called after a save, with the (possibly newly created) resource name. */
  onSaved: (resourceName: string) => void,
|};

const isTypingInAnInput = (): boolean => {
  const activeElement = document.activeElement;
  if (!activeElement) return false;
  const tagName = activeElement.tagName;
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    activeElement.isContentEditable === true
  );
};

const ModelEditorDialog = ({
  open,
  project,
  resourceName,
  resourceManagementProps,
  onClose,
  onSaved,
}: Props): React.Node => {
  const forceUpdate = useForceUpdate();

  const historyRef = React.useRef<ModelEditorHistory>(
    new ModelEditorHistory(200)
  );
  const engineRef = React.useRef<?ModelEditorEngine>(null);
  const documentRef = React.useRef<?GDModelDocument>(null);

  const [currentResourceName, setCurrentResourceName] = React.useState<string>(
    resourceName
  );
  const [savedResourceName, setSavedResourceName] = React.useState<?string>(
    null
  );
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [loadError, setLoadError] = React.useState<?string>(null);
  const [saveError, setSaveError] = React.useState<?string>(null);
  const [lastSavedFile, setLastSavedFile] = React.useState<?string>(null);
  const [isSaving, setIsSaving] = React.useState<boolean>(false);
  const [saveAsPacked, setSaveAsPacked] = React.useState<boolean>(true);
  const [geometryRevision, setGeometryRevision] = React.useState<number>(0);

  const [mode, setMode] = React.useState<EditorMode>('object');
  const [
    meshSelectionMode,
    setMeshSelectionMode,
  ] = React.useState<MeshSelectionMode>('vertex');
  const [transformMode, setTransformMode] = React.useState<TransformMode>(
    'translate'
  );
  const [isSnappingEnabled, setIsSnappingEnabled] = React.useState<boolean>(
    false
  );
  const [isOutlinerOpen, setIsOutlinerOpen] = React.useState<boolean>(true);
  const [isInspectorOpen, setIsInspectorOpen] = React.useState<boolean>(true);
  const [isExportDialogOpen, setIsExportDialogOpen] = React.useState<boolean>(
    false
  );
  const [selection, setSelection] = React.useState<EngineSelectionState>({
    selectedNodeName: null,
    selectedMeshName: null,
    editedMeshName: null,
    selectedVertexCount: 0,
    selectedTriangleCount: 0,
  });

  const bumpGeometry = React.useCallback(
    () => {
      setGeometryRevision(revision => revision + 1);
      forceUpdate();
    },
    [forceUpdate]
  );

  // ---------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------

  React.useEffect(
    () => {
      if (!open) return;

      let isCancelled = false;
      setLoadError(null);
      setLastSavedFile(null);
      setCurrentResourceName(resourceName);
      setSavedResourceName(null);

      if (!resourceName) {
        documentRef.current = createEmptyModelDocument();
        historyRef.current.clear();
        setSaveAsPacked(true);
        setIsLoading(false);
        setGeometryRevision(revision => revision + 1);
        return;
      }

      setIsLoading(true);
      (async () => {
        try {
          const loaded = await loadModelDocument({ project, resourceName });
          if (isCancelled) return;
          documentRef.current = loaded.document;
          historyRef.current.clear();
          setSaveAsPacked(loaded.isPacked);
          setGeometryRevision(revision => revision + 1);
        } catch (error) {
          console.error('Unable to load the 3D model:', error);
          if (!isCancelled) setLoadError(error.message);
        } finally {
          if (!isCancelled) setIsLoading(false);
        }
      })();

      return () => {
        isCancelled = true;
      };
    },
    // Reload only when opening the dialog on another model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, resourceName]
  );

  React.useEffect(
    () => {
      // Release the GPU resources of the model when the dialog is closed.
      return () => {
        const document = documentRef.current;
        if (document) document.dispose();
        documentRef.current = null;
      };
    },
    [open]
  );

  const document = documentRef.current;

  // ---------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------

  const record = React.useCallback(
    (command: ModelEditorCommand) => {
      historyRef.current.push(command);
      bumpGeometry();
    },
    [bumpGeometry]
  );

  const undo = React.useCallback(
    () => {
      historyRef.current.undo();
      bumpGeometry();
    },
    [bumpGeometry]
  );

  const redo = React.useCallback(
    () => {
      historyRef.current.redo();
      bumpGeometry();
    },
    [bumpGeometry]
  );

  const selectNode = React.useCallback((nodeName: ?string) => {
    const engine = engineRef.current;
    if (engine) engine.selectNodeByName(nodeName);
  }, []);

  const addPrimitive = React.useCallback(
    (primitive: string) => {
      const currentDocument = documentRef.current;
      if (!currentDocument) return;
      // $FlowFixMe[incompatible-call] - the toolbar only lists known primitives.
      const mesh = currentDocument.addPrimitive(primitive);
      record({
        label: 'Add a shape',
        undo: () => {
          currentDocument.deleteNode(mesh);
          bumpGeometry();
        },
        redo: () => {
          currentDocument.restoreNode(mesh, currentDocument.getRoot());
          bumpGeometry();
        },
      });
      selectNode(mesh.name);
    },
    [record, selectNode, bumpGeometry]
  );

  const deleteNode = React.useCallback(
    (node: any) => {
      const currentDocument = documentRef.current;
      if (!currentDocument || !node || !node.parent) return;
      const parent = node.parent;
      const index = parent.children.indexOf(node);
      const name = node.name;
      currentDocument.deleteNode(node);
      record({
        label: `Delete "${name}"`,
        undo: () => {
          currentDocument.restoreNode(node, parent, index);
          bumpGeometry();
        },
        redo: () => {
          currentDocument.deleteNode(node);
          bumpGeometry();
        },
      });
      if (selection.selectedNodeName === name) selectNode(null);
    },
    [record, selectNode, selection.selectedNodeName, bumpGeometry]
  );

  const duplicateNode = React.useCallback(
    (node: any) => {
      const currentDocument = documentRef.current;
      if (!currentDocument || !node) return;
      const parent = node.parent || currentDocument.getRoot();
      const clone = currentDocument.duplicateNode(node);
      record({
        label: `Duplicate "${node.name}"`,
        undo: () => {
          currentDocument.deleteNode(clone);
          bumpGeometry();
        },
        redo: () => {
          currentDocument.restoreNode(clone, parent);
          bumpGeometry();
        },
      });
      selectNode(clone.name);
    },
    [record, selectNode, bumpGeometry]
  );

  const renameNode = React.useCallback(
    (node: any, newName: string) => {
      const currentDocument = documentRef.current;
      if (!currentDocument || !node) return;
      const previousName = node.name;
      if (!currentDocument.renameNode(node, newName)) return;
      const updatedName = node.name;
      record({
        label: `Rename "${previousName}"`,
        undo: () => {
          currentDocument.renameNode(node, previousName);
          bumpGeometry();
        },
        redo: () => {
          currentDocument.renameNode(node, updatedName);
          bumpGeometry();
        },
      });
      selectNode(updatedName);
    },
    [record, selectNode, bumpGeometry]
  );

  const deleteSelection = React.useCallback(
    () => {
      const currentDocument = documentRef.current;
      const engine = engineRef.current;
      if (!currentDocument) return;

      if (mode === 'mesh' && engine) {
        const mesh = engine.getEditedMesh();
        const triangleIds = engine.getSelectedTriangleIds();
        if (mesh && triangleIds.size) {
          const before = mesh.geometry;
          const after = deleteTriangles(before, triangleIds);
          currentDocument.replaceMeshGeometry(mesh, after);
          record({
            label: 'Delete faces',
            undo: () => {
              currentDocument.replaceMeshGeometry(mesh, before);
              bumpGeometry();
            },
            redo: () => {
              currentDocument.replaceMeshGeometry(mesh, after);
              bumpGeometry();
            },
          });
          engine.clearSelection();
        }
        return;
      }

      const node = selection.selectedNodeName
        ? currentDocument.findNodeByName(selection.selectedNodeName)
        : null;
      if (node) deleteNode(node);
    },
    [mode, selection.selectedNodeName, record, deleteNode, bumpGeometry]
  );

  // ---------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------

  const save = React.useCallback(
    async () => {
      const currentDocument = documentRef.current;
      if (!currentDocument || isSaving) return;

      setIsSaving(true);
      setSaveError(null);
      try {
        let resourceNameToSave = currentResourceName || savedResourceName;
        if (!resourceNameToSave) {
          // A model created from the editor: create the resource now, so that
          // the file has a name in the project.
          const resourcesManager = project.getResourcesManager();
          const name = newNameGenerator('New3DModel', tentativeName =>
            resourcesManager.hasResource(tentativeName)
          );
          const resource = createNewResource('model3D');
          if (!resource)
            throw new Error('Unable to create a 3D model resource.');
          resource.setName(name);
          applyResourceDefaults(project, resource);
          resourcesManager.addResource(resource);
          resource.delete();
          resourceNameToSave = name;
          setCurrentResourceName(name);
          setSavedResourceName(name);
        }

        const engine = engineRef.current;
        const thumbnail = engine ? await engine.captureThumbnail(256) : null;
        const saved = await saveModelDocument({
          project,
          resourceName: resourceNameToSave,
          document: currentDocument,
          saveAsPacked,
          thumbnail,
          resourceManagementProps,
        });

        setLastSavedFile(saved.file);
        onSaved(resourceNameToSave);

        // The document now matches the saved file: nothing to undo back to.
        historyRef.current.clear();
        forceUpdate();
      } catch (error) {
        console.error('Unable to save the 3D model:', error);
        setSaveError(error.message || 'Unable to save the 3D model.');
      } finally {
        setIsSaving(false);
      }
    },
    [
      currentResourceName,
      savedResourceName,
      project,
      isSaving,
      saveAsPacked,
      resourceManagementProps,
      onSaved,
      forceUpdate,
    ]
  );

  // ---------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------

  React.useEffect(
    () => {
      if (!open) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (isTypingInAnInput()) return;
        const isCtrlOrCmd = event.ctrlKey || event.metaKey;

        if (isCtrlOrCmd && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if (isCtrlOrCmd && event.key.toLowerCase() === 'y') {
          event.preventDefault();
          redo();
          return;
        }
        if (isCtrlOrCmd && event.key.toLowerCase() === 's') {
          event.preventDefault();
          save();
          return;
        }
        if (isCtrlOrCmd && event.key.toLowerCase() === 'd') {
          event.preventDefault();
          const currentDocument = documentRef.current;
          const node =
            currentDocument && selection.selectedNodeName
              ? currentDocument.findNodeByName(selection.selectedNodeName)
              : null;
          if (node) duplicateNode(node);
          return;
        }
        if (isCtrlOrCmd && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          const engine = engineRef.current;
          if (engine) engine.selectAllMeshElements();
          return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          deleteSelection();
          return;
        }
        if (event.key === 'Escape') {
          const engine = engineRef.current;
          if (engine) engine.clearSelection();
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          setMode(previousMode =>
            previousMode === 'object' ? 'mesh' : 'object'
          );
          return;
        }
        if (event.key.toLowerCase() === 'w') setTransformMode('translate');
        if (event.key.toLowerCase() === 'e') setTransformMode('rotate');
        if (event.key.toLowerCase() === 'r') setTransformMode('scale');
        if (event.key.toLowerCase() === 'f') {
          const engine = engineRef.current;
          if (engine) engine.focusSelection();
        }
      };

      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    },
    [
      open,
      undo,
      redo,
      save,
      deleteSelection,
      duplicateNode,
      selection.selectedNodeName,
    ]
  );

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const hasSelectedNode = !!selection.selectedNodeName;
  const isPackedModel =
    isGDModelFileName(savedResourceName || '') ||
    (!!currentResourceName &&
      getFileExtension(
        project.getResourcesManager().hasResource(currentResourceName)
          ? project
              .getResourcesManager()
              .getResource(currentResourceName)
              .getFile()
          : ''
      ) === '.gdm');

  const exportFileName = (() => {
    const name = (currentResourceName || '').split(/[\\/]/).pop() || 'model';
    const withoutExtension = name.replace(/\.[^.]+$/, '');
    return withoutExtension || 'model';
  })();

  return (
    <React.Fragment>
      <Dialog
        open={open}
        onRequestClose={onClose}
        title={<Trans>3D model editor</Trans>}
        subtitle={
          currentResourceName ? (
            <Text noMargin size="body-small" color="secondary">
              {currentResourceName}
              {lastSavedFile ? ` · saved as ${lastSavedFile}` : ''}
            </Text>
          ) : (
            <Trans>A new model, saved as a .gdm file</Trans>
          )
        }
        fullscreen="always-even-on-desktop"
        flexBody
        noPadding
        maxWidth={false}
      >
        <Column noMargin expand useFullHeight>
          {isLoading && (
            <Column expand justifyContent="center" alignItems="center">
              <PlaceholderLoader />
            </Column>
          )}
          {loadError && (
            <Column noMargin>
              <AlertMessage kind="error">{loadError}</AlertMessage>
            </Column>
          )}
          {!isLoading && !loadError && document && (
            <Column noMargin expand useFullHeight>
              {saveError && (
                <AlertMessage kind="error">{saveError}</AlertMessage>
              )}
              <ModelEditorToolbar
                mode={mode}
                onChangeMode={setMode}
                transformMode={transformMode}
                onChangeTransformMode={setTransformMode}
                isSnappingEnabled={isSnappingEnabled}
                onChangeSnappingEnabled={setIsSnappingEnabled}
                canUndo={historyRef.current.canUndo()}
                canRedo={historyRef.current.canRedo()}
                undoLabel={historyRef.current.getUndoLabel()}
                redoLabel={historyRef.current.getRedoLabel()}
                onUndo={undo}
                onRedo={redo}
                hasSelectedNode={hasSelectedNode}
                onAddPrimitive={addPrimitive}
                onDuplicateSelected={() => {
                  const currentDocument = documentRef.current;
                  const node =
                    currentDocument && selection.selectedNodeName
                      ? currentDocument.findNodeByName(
                          selection.selectedNodeName
                        )
                      : null;
                  if (node) duplicateNode(node);
                }}
                onDeleteSelected={deleteSelection}
                onFocusSelection={() => {
                  const engine = engineRef.current;
                  if (engine) engine.focusSelection();
                }}
                onFocusAll={() => {
                  const engine = engineRef.current;
                  if (engine) engine.focusAll();
                }}
                isOutlinerOpen={isOutlinerOpen}
                onToggleOutliner={() => setIsOutlinerOpen(open => !open)}
                isInspectorOpen={isInspectorOpen}
                onToggleInspector={() => setIsInspectorOpen(open => !open)}
                isPackedModel={isPackedModel}
                saveAsPacked={saveAsPacked}
                onChangeSaveAsPacked={setSaveAsPacked}
                isSaving={isSaving}
                onSave={save}
                onExport={() => setIsExportDialogOpen(true)}
              />
              <Line noMargin expand useFullHeight>
                <CollapsibleSidePanel
                  open={isOutlinerOpen}
                  width={OUTLINER_WIDTH}
                  anchor="left"
                >
                  <div
                    className={classNames(
                      classes.sidePanel,
                      classes.sidePanelLeft,
                      classes.sidePanelPadded
                    )}
                  >
                    <ModelEditorOutliner
                      document={document}
                      selectedNodeName={selection.selectedNodeName}
                      geometryRevision={geometryRevision}
                      onSelectNode={selectNode}
                      onRenameNode={renameNode}
                      onDeleteNode={deleteNode}
                      onDuplicateNode={duplicateNode}
                    />
                  </div>
                </CollapsibleSidePanel>

                <ModelEditorViewport
                  document={document}
                  mode={mode}
                  meshSelectionMode={meshSelectionMode}
                  onChangeMeshSelectionMode={setMeshSelectionMode}
                  transformMode={transformMode}
                  isSnappingEnabled={isSnappingEnabled}
                  geometryRevision={geometryRevision}
                  onEngineReady={engine => {
                    engineRef.current = engine;
                  }}
                  onSelectionChanged={setSelection}
                  onObjectTransformCommitted={() => forceUpdate()}
                  onMeshEditCommitted={() => bumpGeometry()}
                  onMeshEditingEntered={() => forceUpdate()}
                  onAddPrimitive={addPrimitive}
                />

                <CollapsibleSidePanel
                  open={isInspectorOpen}
                  width={INSPECTOR_WIDTH}
                  anchor="right"
                >
                  <div
                    className={classNames(
                      classes.sidePanel,
                      classes.sidePanelRight
                    )}
                  >
                    <div className={classes.panelHeader}>
                      <Text noMargin size="sub-title">
                        <Trans>Properties</Trans>
                      </Text>
                    </div>
                    <ScrollView style={{ padding: '4px 12px 18px' }}>
                      <ModelEditorInspector
                        document={document}
                        selectedNodeName={selection.selectedNodeName}
                        geometryRevision={geometryRevision}
                        mode={mode}
                        vertexSelectionCount={selection.selectedVertexCount}
                        triangleSelectionCount={selection.selectedTriangleCount}
                        getSelection={() => {
                          const engine = engineRef.current;
                          return {
                            vertexIds: engine
                              ? engine.getSelectedVertexIds()
                              : new Set(),
                            triangleIds: engine
                              ? engine.getSelectedTriangleIds()
                              : new Set(),
                          };
                        }}
                        onEditedChange={record}
                        onGeometryChanged={bumpGeometry}
                        onEditMesh={() => setMode('mesh')}
                        onSelectAll={() => {
                          const engine = engineRef.current;
                          if (engine) engine.selectAllMeshElements();
                        }}
                        onClearSelection={() => {
                          const engine = engineRef.current;
                          if (engine) engine.clearSelection();
                        }}
                      />
                    </ScrollView>
                  </div>
                </CollapsibleSidePanel>
              </Line>
            </Column>
          )}
        </Column>
      </Dialog>
      {document && (
        <ModelEditorExportDialog
          open={isExportDialogOpen}
          onClose={() => setIsExportDialogOpen(false)}
          document={document}
          defaultFileName={exportFileName}
          defaultFormat={isPackedModel || saveAsPacked ? 'gdm' : 'glb'}
        />
      )}
    </React.Fragment>
  );
};

export default ModelEditorDialog;
