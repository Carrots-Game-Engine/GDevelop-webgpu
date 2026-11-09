// @flow
import * as React from 'react';
import { Trans } from '@lingui/macro';
import {
  type GDModelDocument,
  type GDModelCollider,
  type GDModelSocket,
} from './GDModelDocument';
import { GD_MODEL_COLLIDER_TYPES } from './GDModelFormat';
import {
  ColumnStackLayout,
  LineStackLayout,
  ResponsiveLineStackLayout,
} from '../UI/Layout';
import { Line, Spacer } from '../UI/Grid';
import Text from '../UI/Text';
import Subheader from '../UI/Subheader';
import SemiControlledTextField from '../UI/SemiControlledTextField';
import SelectField from '../UI/SelectField';
import SelectOption from '../UI/SelectOption';
import IconButton from '../UI/IconButton';
import TextButton from '../UI/TextButton';
import Add from '../UI/CustomSvgIcons/Add';
import Trash from '../UI/CustomSvgIcons/Trash';
import { type ModelEditorCommand } from './ModelEditorHistory';
import classes from './ModelEditor.module.css';

const round = (value: number): number => Math.round(value * 1000) / 1000;

type Props = {|
  document: GDModelDocument,
  geometryRevision: number,
  /** The model resources of the project that can be used as a level of detail. */
  availableModelResources: Array<{| name: string, file: string |}>,
  onEditedChange: (command: ModelEditorCommand) => void,
  onGeometryChanged: () => void,
  onAddLODFromResource: (resourceName: string, distance: number) => void,
  onRemoveLODAsset: (file: string) => void,
|};

const ModelEditorExtrasPanel = ({
  document,
  geometryRevision,
  availableModelResources,
  onEditedChange,
  onGeometryChanged,
  onAddLODFromResource,
  onRemoveLODAsset,
}: Props): React.Node => {
  const [newLODResourceName, setNewLODResourceName] = React.useState<string>(
    ''
  );
  const [newLODDistance, setNewLODDistance] = React.useState<number>(30);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nodeNames = React.useMemo(() => document.getNodeNames(), [
    document,
    geometryRevision,
  ]);
  const sockets: Array<GDModelSocket> = React.useMemo(
    () => document.getSockets().slice(),
    [document]
  );
  const colliders: Array<GDModelCollider> = React.useMemo(
    () => document.getColliders().slice(),
    [document]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lods = React.useMemo(() => document.getLODs().slice(), [
    document,
    geometryRevision,
  ]);

  const updateSocket = (name: string, changes: $Shape<GDModelSocket>) => {
    const before = document.getSockets().map(socket => ({ ...socket }));
    document.updateSocket(name, changes);
    const after = document.getSockets().map(socket => ({ ...socket }));
    onEditedChange({
      label: 'Change socket',
      undo: () => {
        document.getManifest().sockets = before;
        onGeometryChanged();
      },
      redo: () => {
        document.getManifest().sockets = after;
        onGeometryChanged();
      },
    });
    onGeometryChanged();
  };

  const removeSocket = (name: string) => {
    const before = document.getSockets().map(socket => ({ ...socket }));
    document.removeSocket(name);
    const after = document.getSockets().map(socket => ({ ...socket }));
    onEditedChange({
      label: 'Delete socket',
      undo: () => {
        document.getManifest().sockets = before;
        onGeometryChanged();
      },
      redo: () => {
        document.getManifest().sockets = after;
        onGeometryChanged();
      },
    });
    onGeometryChanged();
  };

  const updateCollider = (name: string, changes: $Shape<GDModelCollider>) => {
    const before = document.getColliders().map(collider => ({ ...collider }));
    document.updateCollider(name, changes);
    const after = document.getColliders().map(collider => ({ ...collider }));
    onEditedChange({
      label: 'Change collider',
      undo: () => {
        document.getManifest().colliders = before;
        onGeometryChanged();
      },
      redo: () => {
        document.getManifest().colliders = after;
        onGeometryChanged();
      },
    });
    onGeometryChanged();
  };

  const removeCollider = (name: string) => {
    const before = document.getColliders().map(collider => ({ ...collider }));
    document.removeCollider(name);
    const after = document.getColliders().map(collider => ({ ...collider }));
    onEditedChange({
      label: 'Delete collider',
      undo: () => {
        document.getManifest().colliders = before;
        onGeometryChanged();
      },
      redo: () => {
        document.getManifest().colliders = after;
        onGeometryChanged();
      },
    });
    onGeometryChanged();
  };

  return (
    <ColumnStackLayout noMargin>
      <Subheader>
        <Trans>Sockets (attachment points)</Trans>
      </Subheader>
      {sockets.length === 0 && (
        <Text noMargin size="body-small" color="secondary">
          <Trans>
            A socket is a point of a node, to attach an object to at runtime.
            Select a node in the list and use its link action to add one.
          </Trans>
        </Text>
      )}
      {sockets.map(socket => (
        <div key={socket.name} className={classes.card}>
          <Line noMargin>
            <SemiControlledTextField
              margin="none"
              commitOnBlur
              floatingLabelText={<Trans>Socket name</Trans>}
              value={socket.name}
              onChange={newName => updateSocket(socket.name, { name: newName })}
              fullWidth
            />
            <IconButton
              size="small"
              onClick={() => removeSocket(socket.name)}
              aria-label="Delete socket"
            >
              <Trash />
            </IconButton>
          </Line>
          <SelectField
            value={socket.node}
            onChange={(event, index, value) =>
              updateSocket(socket.name, { node: value })
            }
            fullWidth
            floatingLabelText={<Trans>Node</Trans>}
          >
            {nodeNames.map(nodeName => (
              <SelectOption
                key={nodeName}
                value={nodeName}
                label={nodeName}
                shouldNotTranslate
              />
            ))}
          </SelectField>
          <ResponsiveLineStackLayout
            noResponsiveLandscape
            expand
            noColumnMargin
          >
            {[0, 1, 2].map(axis => (
              <SemiControlledTextField
                key={`socket-position-${axis}`}
                margin="dense"
                type="number"
                commitOnBlur
                floatingLabelText={`Offset ${['X', 'Y', 'Z'][axis]}`}
                value={String(round(socket.position[axis]))}
                onChange={text => {
                  const value = parseFloat(text);
                  if (isNaN(value) || !isFinite(value)) return;
                  const position = socket.position.slice();
                  position[axis] = value;
                  updateSocket(socket.name, { position });
                }}
              />
            ))}
          </ResponsiveLineStackLayout>
        </div>
      ))}

      <Subheader>
        <Trans>Collision shapes</Trans>
      </Subheader>
      {colliders.length === 0 && (
        <Text noMargin size="body-small" color="secondary">
          <Trans>
            A collision shape is measured from a mesh, for the 3D physics.
          </Trans>
        </Text>
      )}
      {colliders.map(collider => (
        <div key={collider.name} className={classes.card}>
          <Line noMargin>
            <SemiControlledTextField
              margin="none"
              commitOnBlur
              floatingLabelText={<Trans>Name</Trans>}
              value={collider.name}
              onChange={newName =>
                updateCollider(collider.name, { name: newName })
              }
              fullWidth
            />
            <IconButton
              size="small"
              onClick={() => removeCollider(collider.name)}
              aria-label="Delete collider"
            >
              <Trash />
            </IconButton>
          </Line>
          <ResponsiveLineStackLayout
            noResponsiveLandscape
            expand
            noColumnMargin
          >
            <SelectField
              value={collider.type}
              onChange={(event, index, value) =>
                updateCollider(collider.name, {
                  // $FlowFixMe[incompatible-type] - one of the known types.
                  type: value,
                })
              }
              fullWidth
              floatingLabelText={<Trans>Shape</Trans>}
            >
              {GD_MODEL_COLLIDER_TYPES.map(type => (
                <SelectOption
                  key={type}
                  value={type}
                  label={type}
                  shouldNotTranslate
                />
              ))}
            </SelectField>
            <SelectField
              value={collider.node}
              onChange={(event, index, value) =>
                updateCollider(collider.name, { node: value })
              }
              fullWidth
              floatingLabelText={<Trans>From mesh</Trans>}
            >
              <SelectOption value="" label="Whole model" />
              {nodeNames.map(nodeName => (
                <SelectOption
                  key={nodeName}
                  value={nodeName}
                  label={nodeName}
                  shouldNotTranslate
                />
              ))}
            </SelectField>
          </ResponsiveLineStackLayout>
          <Text noMargin size="body-small" color="secondary">
            {collider.size.map(value => round(value)).join(' × ')}
          </Text>
        </div>
      ))}

      <Subheader>
        <Trans>Levels of detail</Trans>
      </Subheader>
      {lods.length === 0 && (
        <Text noMargin size="body-small" color="secondary">
          <Trans>
            The model itself is the first level. Add a lighter model to show
            when it is far from the camera.
          </Trans>
        </Text>
      )}
      {lods.map((lod, index) => (
        <Line key={`${lod.file}-${index}`} noMargin alignItems="center">
          <Text noMargin size="body-small">
            {lod.file}
          </Text>
          <Spacer />
          <div style={{ width: 90 }}>
            <SemiControlledTextField
              margin="none"
              type="number"
              commitOnBlur
              floatingLabelText={<Trans>Distance</Trans>}
              value={String(round(lod.distance))}
              onChange={text => {
                const value = parseFloat(text);
                if (isNaN(value) || !isFinite(value)) return;
                const before = document.getLODs().map(item => ({ ...item }));
                document.updateLOD(index, { distance: value });
                const after = document.getLODs().map(item => ({ ...item }));
                onEditedChange({
                  label: 'Change level of detail',
                  undo: () => {
                    document.getManifest().lods = before;
                    onGeometryChanged();
                  },
                  redo: () => {
                    document.getManifest().lods = after;
                    onGeometryChanged();
                  },
                });
                onGeometryChanged();
              }}
            />
          </div>
          <IconButton
            size="small"
            onClick={() => {
              const before = document.getLODs().map(item => ({ ...item }));
              const file = document.getLODs()[index].file;
              document.removeLOD(index);
              const after = document.getLODs().map(item => ({ ...item }));
              onRemoveLODAsset(file);
              onEditedChange({
                label: 'Delete level of detail',
                undo: () => {
                  document.getManifest().lods = before;
                  onGeometryChanged();
                },
                redo: () => {
                  document.getManifest().lods = after;
                  onGeometryChanged();
                },
              });
              onGeometryChanged();
            }}
            aria-label="Delete level of detail"
          >
            <Trash />
          </IconButton>
        </Line>
      ))}
      {availableModelResources.length > 0 && (
        <Line noMargin alignItems="center">
          <SelectField
            value={newLODResourceName}
            onChange={(event, index, value) => setNewLODResourceName(value)}
            fullWidth
            floatingLabelText={<Trans>Add a model as a level</Trans>}
          >
            {availableModelResources.map(resource => (
              <SelectOption
                key={resource.name}
                value={resource.name}
                label={resource.name}
                shouldNotTranslate
              />
            ))}
          </SelectField>
          <div style={{ width: 90 }}>
            <SemiControlledTextField
              margin="none"
              type="number"
              commitOnBlur
              floatingLabelText={<Trans>Distance</Trans>}
              value={String(round(newLODDistance))}
              onChange={text => {
                const value = parseFloat(text);
                if (!isNaN(value) && isFinite(value)) setNewLODDistance(value);
              }}
            />
          </div>
          <IconButton
            size="small"
            disabled={!newLODResourceName}
            onClick={() => {
              onAddLODFromResource(newLODResourceName, newLODDistance);
              setNewLODResourceName('');
            }}
            aria-label="Add level of detail"
          >
            <Add />
          </IconButton>
        </Line>
      )}
      <LineStackLayout noMargin>
        <TextButton
          label={<Trans>Add a collision shape from the whole model</Trans>}
          onClick={() => {
            const collider = document.addColliderFromNode(null, 'box');
            onEditedChange({
              label: 'Add collider',
              undo: () => {
                document.removeCollider(collider.name);
                onGeometryChanged();
              },
              redo: () => {
                document.addColliderFromNode(null, 'box');
                onGeometryChanged();
              },
            });
            onGeometryChanged();
          }}
          fullWidth
        />
      </LineStackLayout>
    </ColumnStackLayout>
  );
};

export default ModelEditorExtrasPanel;
