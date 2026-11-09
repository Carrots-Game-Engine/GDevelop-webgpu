// @flow
import * as React from 'react';
import { Trans, t } from '@lingui/macro';
import { Toolbar, ToolbarGroup } from '../UI/Toolbar';
import ToolbarSeparator from '../UI/ToolbarSeparator';
import IconButton from '../UI/IconButton';
import RaisedButton from '../UI/RaisedButton';
import Checkbox from '../UI/Checkbox';
import SelectField from '../UI/SelectField';
import SelectOption from '../UI/SelectOption';
import Undo from '../UI/CustomSvgIcons/Undo';
import Redo from '../UI/CustomSvgIcons/Redo';
import Add from '../UI/CustomSvgIcons/Add';
import Trash from '../UI/CustomSvgIcons/Trash';
import Copy from '../UI/CustomSvgIcons/Copy';
import CenterAlignment from '../UI/CustomSvgIcons/CenterAlignment';
import ZoomIn from '../UI/CustomSvgIcons/ZoomIn';
import Layers from '../UI/CustomSvgIcons/Layers';
import Tune from '../UI/CustomSvgIcons/Tune';
import ModelEditorSegmentedControl from './ModelEditorSegmentedControl';
import { GD_MODEL_PRIMITIVES } from './GDModelDocument';
import { type EditorMode, type TransformMode } from './ModelEditorEngine';
import classes from './ModelEditor.module.css';

type Props = {|
  mode: EditorMode,
  onChangeMode: (mode: EditorMode) => void,
  transformMode: TransformMode,
  onChangeTransformMode: (mode: TransformMode) => void,
  isSnappingEnabled: boolean,
  onChangeSnappingEnabled: (enabled: boolean) => void,

  canUndo: boolean,
  canRedo: boolean,
  undoLabel: ?string,
  redoLabel: ?string,
  onUndo: () => void,
  onRedo: () => void,

  hasSelectedNode: boolean,
  onAddPrimitive: (primitive: string) => void,
  onDuplicateSelected: () => void,
  onDeleteSelected: () => void,
  onFocusSelection: () => void,
  onFocusAll: () => void,

  isOutlinerOpen: boolean,
  onToggleOutliner: () => void,
  isInspectorOpen: boolean,
  onToggleInspector: () => void,

  isPackedModel: boolean,
  saveAsPacked: boolean,
  onChangeSaveAsPacked: (saveAsPacked: boolean) => void,
  isSaving: boolean,
  onSave: () => void,
  onExport: () => void,
|};

const ModelEditorToolbar = ({
  mode,
  onChangeMode,
  transformMode,
  onChangeTransformMode,
  isSnappingEnabled,
  onChangeSnappingEnabled,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  hasSelectedNode,
  onAddPrimitive,
  onDuplicateSelected,
  onDeleteSelected,
  onFocusSelection,
  onFocusAll,
  isOutlinerOpen,
  onToggleOutliner,
  isInspectorOpen,
  onToggleInspector,
  isPackedModel,
  saveAsPacked,
  onChangeSaveAsPacked,
  isSaving,
  onSave,
  onExport,
}: Props): React.Node => {
  const [primitive, setPrimitive] = React.useState<string>('box');

  return (
    <Toolbar>
      <ToolbarGroup firstChild>
        <div className={classes.toolbarCluster}>
          <IconButton
            selected={isOutlinerOpen}
            onClick={onToggleOutliner}
            tooltip={t`Show or hide the model nodes`}
            aria-label="Show or hide the model nodes"
          >
            <Layers />
          </IconButton>

          <ToolbarSeparator />

          <IconButton
            onClick={onUndo}
            disabled={!canUndo}
            tooltip={t`Undo`}
            acceleratorString="Ctrl+Z"
            aria-label={undoLabel ? `Undo ${undoLabel}` : 'Undo'}
          >
            <Undo />
          </IconButton>
          <IconButton
            onClick={onRedo}
            disabled={!canRedo}
            tooltip={t`Redo`}
            acceleratorString="Ctrl+Y"
            aria-label={redoLabel ? `Redo ${redoLabel}` : 'Redo'}
          >
            <Redo />
          </IconButton>

          <ToolbarSeparator />

          <ModelEditorSegmentedControl
            value={mode}
            onChange={onChangeMode}
            ariaLabel="Editing mode"
            options={[
              {
                value: 'object',
                label: <Trans>Object</Trans>,
                title: 'Object mode (Tab)',
              },
              {
                value: 'mesh',
                label: <Trans>Mesh</Trans>,
                title: 'Mesh editing (Tab)',
              },
            ]}
          />

          <ModelEditorSegmentedControl
            value={transformMode}
            onChange={onChangeTransformMode}
            ariaLabel="Transform mode"
            options={[
              {
                value: 'translate',
                label: <Trans>Move</Trans>,
                title: 'Move (W)',
              },
              {
                value: 'rotate',
                label: <Trans>Rotate</Trans>,
                title: 'Rotate (E)',
              },
              {
                value: 'scale',
                label: <Trans>Scale</Trans>,
                title: 'Scale (R)',
              },
            ]}
          />

          <Checkbox
            label={<Trans>Snap</Trans>}
            checked={isSnappingEnabled}
            onCheck={(event, checked) => onChangeSnappingEnabled(checked)}
          />

          <ToolbarSeparator />

          <IconButton
            onClick={onFocusSelection}
            tooltip={t`Focus the selection`}
            acceleratorString="F"
            aria-label="Focus the selection"
          >
            <ZoomIn />
          </IconButton>
          <IconButton
            onClick={onFocusAll}
            tooltip={t`Frame the whole model`}
            aria-label="Frame the whole model"
          >
            <CenterAlignment />
          </IconButton>
        </div>
      </ToolbarGroup>

      <ToolbarGroup lastChild>
        <div className={classes.toolbarCluster}>
          <div style={{ width: 104 }}>
            <SelectField
              value={primitive}
              onChange={(event, index, value) => setPrimitive(value)}
              margin="none"
              fullWidth
            >
              {GD_MODEL_PRIMITIVES.map(primitiveName => (
                <SelectOption
                  key={primitiveName}
                  value={primitiveName}
                  label={primitiveName}
                  shouldNotTranslate
                />
              ))}
            </SelectField>
          </div>
          <IconButton
            onClick={() => onAddPrimitive(primitive)}
            tooltip={t`Add this shape to the model`}
            aria-label="Add this shape to the model"
          >
            <Add />
          </IconButton>
          <IconButton
            onClick={onDuplicateSelected}
            disabled={!hasSelectedNode}
            tooltip={t`Duplicate the selection`}
            acceleratorString="Ctrl+D"
            aria-label="Duplicate the selection"
          >
            <Copy />
          </IconButton>
          <IconButton
            onClick={onDeleteSelected}
            disabled={!hasSelectedNode}
            tooltip={t`Delete the selection`}
            acceleratorString="Delete"
            aria-label="Delete the selection"
          >
            <Trash />
          </IconButton>

          <ToolbarSeparator />

          <IconButton
            selected={isInspectorOpen}
            onClick={onToggleInspector}
            tooltip={t`Show or hide the properties panel`}
            aria-label="Show or hide the properties panel"
          >
            <Tune />
          </IconButton>

          <ToolbarSeparator />

          <div style={{ width: 164 }}>
            <SelectField
              value={saveAsPacked ? 'gdm' : 'glb'}
              disabled={isPackedModel}
              onChange={(event, index, value) =>
                onChangeSaveAsPacked(value === 'gdm')
              }
              margin="none"
              fullWidth
            >
              <SelectOption value="gdm" label={t`GDevelop model (.gdm)`} />
              <SelectOption value="glb" label={t`glTF binary (.glb)`} />
            </SelectField>
          </div>
          <RaisedButton label={<Trans>Export</Trans>} onClick={onExport} />
          <RaisedButton
            label={isSaving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
            primary
            disabled={isSaving}
            onClick={onSave}
          />
        </div>
      </ToolbarGroup>
    </Toolbar>
  );
};

export default ModelEditorToolbar;
