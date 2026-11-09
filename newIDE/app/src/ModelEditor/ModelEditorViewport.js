// @flow
import * as React from 'react';
import { Trans } from '@lingui/macro';
import { GD_MODEL_PRIMITIVES, type GDModelDocument } from './GDModelDocument';
import {
  ModelEditorEngine,
  type EditorMode,
  type EngineSelectionState,
  type MeshSelectionMode,
  type TransformMode,
} from './ModelEditorEngine';
import Text from '../UI/Text';
import TextButton from '../UI/TextButton';
import Object3d from '../UI/CustomSvgIcons/Object3d';
import ModelEditorSegmentedControl from './ModelEditorSegmentedControl';
import classes from './ModelEditor.module.css';

const styles = {
  container: {
    position: 'relative',
    flex: 1,
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  },
  canvas: {
    display: 'block',
    width: '100%',
    height: '100%',
    outline: 'none',
    touchAction: 'none',
  },
};

type Props = {|
  document: GDModelDocument,
  mode: EditorMode,
  meshSelectionMode: MeshSelectionMode,
  onChangeMeshSelectionMode: (mode: MeshSelectionMode) => void,
  transformMode: TransformMode,
  isSnappingEnabled: boolean,
  /** Incremented when the geometry of the model changed. */
  geometryRevision: number,
  onEngineReady: (?ModelEditorEngine) => void,
  onSelectionChanged: (state: EngineSelectionState) => void,
  onObjectTransformCommitted: (
    node: any,
    before: Object,
    after: Object
  ) => void,
  onMeshEditCommitted: (mesh: any, before: any, after: any) => void,
  onMeshEditingEntered: (mesh: ?any) => void,
  onAddPrimitive: (primitive: string) => void,
|};

const ModelEditorViewport = ({
  document,
  mode,
  meshSelectionMode,
  onChangeMeshSelectionMode,
  transformMode,
  isSnappingEnabled,
  geometryRevision,
  onEngineReady,
  onSelectionChanged,
  onObjectTransformCommitted,
  onMeshEditCommitted,
  onMeshEditingEntered,
  onAddPrimitive,
}: Props): React.Node => {
  const canvasRef = React.useRef<?HTMLCanvasElement>(null);
  const containerRef = React.useRef<?HTMLDivElement>(null);
  const engineRef = React.useRef<?ModelEditorEngine>(null);
  const [error, setError] = React.useState<?string>(null);
  const [selection, setSelection] = React.useState<EngineSelectionState>({
    selectedNodeName: null,
    selectedMeshName: null,
    editedMeshName: null,
    selectedVertexCount: 0,
    selectedTriangleCount: 0,
  });

  // Keep the latest callbacks without recreating the engine (which would lose
  // the camera and the selection).
  const callbacksRef = React.useRef({
    onSelectionChanged,
    onObjectTransformCommitted,
    onMeshEditCommitted,
    onMeshEditingEntered,
  });
  callbacksRef.current = {
    onSelectionChanged,
    onObjectTransformCommitted,
    onMeshEditCommitted,
    onMeshEditingEntered,
  };

  React.useEffect(
    () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      let engine = null;
      try {
        engine = new ModelEditorEngine({
          canvas,
          onSelectionChanged: newSelection => {
            setSelection(newSelection);
            callbacksRef.current.onSelectionChanged(newSelection);
          },
          onObjectTransformCommitted: (node, before, after) =>
            callbacksRef.current.onObjectTransformCommitted(
              node,
              before,
              after
            ),
          onMeshEditCommitted: (mesh, before, after) =>
            callbacksRef.current.onMeshEditCommitted(mesh, before, after),
          onMeshEditingEntered: mesh =>
            callbacksRef.current.onMeshEditingEntered(mesh),
        });
      } catch (engineError) {
        console.error('Unable to start the 3D viewport:', engineError);
        setError(
          'The 3D viewport could not be started (no WebGL support in this environment?).'
        );
        return;
      }

      engineRef.current = engine;
      onEngineReady(engine);

      const container = containerRef.current;
      let resizeObserver = null;
      if (container && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => engine.resize());
        resizeObserver.observe(container);
      }
      return () => {
        if (resizeObserver) resizeObserver.disconnect();
        onEngineReady(null);
        engineRef.current = null;
        engine.dispose();
      };
    },
    // The engine lives for the whole life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  React.useEffect(
    () => {
      const engine = engineRef.current;
      if (engine) engine.setDocument(document);
    },
    [document]
  );

  React.useEffect(
    () => {
      const engine = engineRef.current;
      if (engine) engine.setMode(mode);
    },
    [mode]
  );

  React.useEffect(
    () => {
      const engine = engineRef.current;
      if (engine) engine.setMeshSelectionMode(meshSelectionMode);
    },
    [meshSelectionMode]
  );

  React.useEffect(
    () => {
      const engine = engineRef.current;
      if (engine) engine.setTransformMode(transformMode);
    },
    [transformMode]
  );

  React.useEffect(
    () => {
      const engine = engineRef.current;
      if (engine) engine.setSnappingEnabled(isSnappingEnabled);
    },
    [isSnappingEnabled]
  );

  React.useEffect(
    () => {
      const engine = engineRef.current;
      if (engine) engine.refreshAfterGeometryChange();
    },
    [geometryRevision]
  );

  const hint = (() => {
    if (error) return error;
    if (mode === 'mesh') {
      if (!selection.editedMeshName) {
        return `Click a mesh to edit its ${meshSelectionMode}s.`;
      }
      return meshSelectionMode === 'face'
        ? `Editing "${selection.editedMeshName}" · ${
            selection.selectedTriangleCount
          } faces selected`
        : `Editing "${selection.editedMeshName}" · ${
            selection.selectedVertexCount
          } vertices selected`;
    }
    if (!selection.selectedNodeName) return 'Click a node to select it.';
    return `Selected "${selection.selectedNodeName}"`;
  })();

  const isEmpty = document.getNodeEntries().length === 0;

  return (
    <div style={styles.container} ref={containerRef}>
      <canvas
        style={styles.canvas}
        ref={canvasRef}
        aria-label="3D model viewport"
      />
      {mode === 'mesh' && (
        <div className={classes.viewportOverlay}>
          <ModelEditorSegmentedControl
            small
            value={meshSelectionMode}
            onChange={onChangeMeshSelectionMode}
            ariaLabel="Mesh selection mode"
            options={[
              { value: 'vertex', label: <Trans>Vertices</Trans> },
              { value: 'edge', label: <Trans>Edges</Trans> },
              { value: 'face', label: <Trans>Faces</Trans> },
            ]}
          />
        </div>
      )}
      <div className={classes.hint}>
        <Text noMargin size="body-small" color="secondary">
          {hint}
        </Text>
      </div>
      {isEmpty && (
        <div className={classes.emptyState}>
          <div className={classes.emptyStateContent}>
            <span className={classes.emptyStateIcon}>
              <Object3d />
            </span>
            <Text noMargin size="block-title">
              <Trans>The model is empty</Trans>
            </Text>
            <Text noMargin size="body-small" color="secondary">
              <Trans>Add a shape to start building your model.</Trans>
            </Text>
            <div className={classes.emptyStateShapes}>
              {GD_MODEL_PRIMITIVES.map(primitive => (
                <TextButton
                  key={primitive}
                  label={primitive.charAt(0).toUpperCase() + primitive.slice(1)}
                  onClick={() => onAddPrimitive(primitive)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelEditorViewport;
