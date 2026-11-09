// @flow
import * as React from 'react';
import { Trans, t } from '@lingui/macro';
import classNames from 'classnames';
import { type GDModelDocument, type GDModelNodeEntry } from './GDModelDocument';
import { Line, Column, Spacer } from '../UI/Grid';
import Text from '../UI/Text';
import IconButton from '../UI/IconButton';
import SemiControlledTextField from '../UI/SemiControlledTextField';
import ScrollView from '../UI/ScrollView';
import Subheader from '../UI/Subheader';
import Object3d from '../UI/CustomSvgIcons/Object3d';
import Folder from '../UI/CustomSvgIcons/Folder';
import Trash from '../UI/CustomSvgIcons/Trash';
import Copy from '../UI/CustomSvgIcons/Copy';
import classes from './ModelEditor.module.css';

const rowActionStyle = {
  width: 24,
  height: 24,
  padding: 2,
  margin: 0,
};

type Props = {|
  document: GDModelDocument,
  selectedNodeName: ?string,
  geometryRevision: number,
  onSelectNode: (nodeName: ?string) => void,
  onRenameNode: (node: any, newName: string) => void,
  onDeleteNode: (node: any) => void,
  onDuplicateNode: (node: any) => void,
|};

const ModelEditorOutliner = ({
  document,
  selectedNodeName,
  geometryRevision,
  onSelectNode,
  onRenameNode,
  onDeleteNode,
  onDuplicateNode,
}: Props): React.Node => {
  const [renamingNodeName, setRenamingNodeName] = React.useState<?string>(null);

  // The entries are read from the document: `geometryRevision` forces a read
  // after an edit that changed the tree.
  const entries: Array<GDModelNodeEntry> = React.useMemo(
    () => document.getNodeEntries(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document, geometryRevision, selectedNodeName]
  );

  return (
    <Column noMargin expand>
      <Line noMargin alignItems="center">
        <Subheader>
          <Trans>Model nodes</Trans>
        </Subheader>
        <Spacer />
        <Text noMargin size="body-small" color="secondary">
          {entries.length}
        </Text>
      </Line>
      <ScrollView>
        {entries.length === 0 && (
          <Text noMargin size="body-small" color="secondary">
            <Trans>
              The model has no node yet. Add a shape from the toolbar.
            </Trans>
          </Text>
        )}
        {entries.map(({ node, depth }) => {
          const isSelected = node.name === selectedNodeName;
          const isRenaming = node.name === renamingNodeName;
          return (
            <div
              key={node.uuid}
              className={classNames(classes.outlinerRow, {
                [classes.outlinerRowSelected]: isSelected,
              })}
              style={{ paddingLeft: 4 + depth * 12 }}
              onClick={() => onSelectNode(node.name)}
            >
              <span className={classes.outlinerNodeIcon}>
                {node.isMesh ? <Object3d /> : <Folder />}
              </span>
              {isRenaming ? (
                <SemiControlledTextField
                  margin="none"
                  commitOnBlur
                  fullWidth
                  autoFocus="desktop"
                  value={node.name}
                  onChange={newName => onRenameNode(node, newName)}
                  onBlur={() => setRenamingNodeName(null)}
                />
              ) : (
                <span
                  className={classes.outlinerName}
                  title={`${node.name} (${
                    node.isMesh ? 'mesh' : 'group'
                  }) — double-click to rename`}
                  onDoubleClick={() => setRenamingNodeName(node.name)}
                >
                  <Text noMargin size="body-small" displayInlineAsSpan>
                    {node.name}
                  </Text>
                </span>
              )}
              {!isRenaming && (
                <span className={classes.outlinerActions}>
                  <IconButton
                    size="small"
                    style={rowActionStyle}
                    onClick={event => {
                      event.stopPropagation();
                      onDuplicateNode(node);
                    }}
                    tooltip={t`Duplicate this node`}
                    aria-label="Duplicate this node"
                  >
                    <Copy />
                  </IconButton>
                  <IconButton
                    size="small"
                    style={rowActionStyle}
                    onClick={event => {
                      event.stopPropagation();
                      onDeleteNode(node);
                    }}
                    tooltip={t`Delete this node`}
                    aria-label="Delete this node"
                  >
                    <Trash />
                  </IconButton>
                </span>
              )}
            </div>
          );
        })}
      </ScrollView>
    </Column>
  );
};

export default ModelEditorOutliner;
