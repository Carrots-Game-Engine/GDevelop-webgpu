// @flow
import * as React from 'react';
import { Trans } from '@lingui/macro';
import * as THREE from 'three';
import {
  type GDModelDocument,
  type GDModelMaterialProperties,
  type GDModelMaterialSlot,
} from './GDModelDocument';
import {
  deleteTriangles,
  extrudeTriangles,
  flipTriangles,
  getGeometryStats,
  recomputeNormals,
  subdivideTriangles,
  transformUVs,
  transformVertices,
  weldVertices,
} from './MeshEditing';
import {
  ColumnStackLayout,
  LineStackLayout,
  ResponsiveLineStackLayout,
} from '../UI/Layout';
import { Line } from '../UI/Grid';
import Text from '../UI/Text';
import Subheader from '../UI/Subheader';
import SemiControlledTextField from '../UI/SemiControlledTextField';
import ColorField from '../UI/ColorField';
import Checkbox from '../UI/Checkbox';
import TextButton from '../UI/TextButton';
import SelectField from '../UI/SelectField';
import SelectOption from '../UI/SelectOption';
import { Accordion, AccordionBody, AccordionHeader } from '../UI/Accordion';
import Object3d from '../UI/CustomSvgIcons/Object3d';
import { type ModelEditorCommand } from './ModelEditorHistory';
import { type EditorMode } from './ModelEditorEngine';
import classes from './ModelEditor.module.css';

const round = (value: number): number => Math.round(value * 1000) / 1000;

const AXIS_LABELS = ['X', 'Y', 'Z'];

const accordionBodyStyle = { padding: '4px 0 10px' };

type NumberFieldProps = {|
  label: React.Node,
  value: number,
  onChange: (value: number) => void,
  disabled?: boolean,
|};

const NumberField = ({
  label,
  value,
  onChange,
  disabled,
}: NumberFieldProps) => (
  <SemiControlledTextField
    margin="dense"
    floatingLabelText={label}
    type="number"
    disabled={disabled}
    value={String(round(value))}
    commitOnBlur
    onChange={text => {
      const parsedValue = parseFloat(text);
      if (!isNaN(parsedValue) && isFinite(parsedValue)) onChange(parsedValue);
    }}
  />
);

type Props = {|
  document: GDModelDocument,
  selectedNodeName: ?string,
  geometryRevision: number,
  mode: EditorMode,
  vertexSelectionCount: number,
  triangleSelectionCount: number,
  getSelection: () => {| vertexIds: Set<number>, triangleIds: Set<number> |},
  onEditedChange: (command: ModelEditorCommand) => void,
  onGeometryChanged: () => void,
  onEditMesh: () => void,
  onSelectAll: () => void,
  onClearSelection: () => void,
|};

const ModelEditorInspector = ({
  document,
  selectedNodeName,
  geometryRevision,
  mode,
  vertexSelectionCount,
  triangleSelectionCount,
  getSelection,
  onEditedChange,
  onGeometryChanged,
  onEditMesh,
  onSelectAll,
  onClearSelection,
}: Props): React.Node => {
  const [materialSlotIndex, setMaterialSlotIndex] = React.useState<number>(0);
  const [extrudeDistance, setExtrudeDistance] = React.useState<number>(1);
  const [scaleFactor, setScaleFactor] = React.useState<number>(1.5);
  const [uvScale, setUvScale] = React.useState<number>(1);
  const [uvRotation, setUvRotation] = React.useState<number>(0);

  const node = selectedNodeName
    ? document.findNodeByName(selectedNodeName)
    : null;

  React.useEffect(
    () => {
      setMaterialSlotIndex(0);
    },
    [selectedNodeName]
  );

  // The panels are re-rendered from the document; `geometryRevision` makes the
  // geometry statistics follow an edit.
  const transform = React.useMemo(
    () => (node ? document.getNodeTransform(node) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node, geometryRevision]
  );
  const materialSlots: Array<GDModelMaterialSlot> = React.useMemo(
    () => (node ? document.getMaterialSlots(node) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node, geometryRevision, selectedNodeName]
  );
  const stats = React.useMemo(
    () =>
      node && node.isMesh && node.geometry
        ? getGeometryStats(node.geometry)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node, geometryRevision]
  );

  const material =
    materialSlots[Math.min(materialSlotIndex, materialSlots.length - 1)];
  const materialProperties = material
    ? document.getMaterialProperties(material.material)
    : null;

  const changeTransform = (
    key: 'position' | 'rotation' | 'scale',
    values: Array<number>
  ) => {
    if (!node || !transform) return;
    const before = document.getNodeTransform(node);
    // $FlowFixMe[incompatible-call] - the three arrays have three elements.
    document.setNodeTransform(node, { [key]: values });
    const after = document.getNodeTransform(node);
    onEditedChange({
      label: `Change ${key}`,
      undo: () => document.setNodeTransform(node, before),
      redo: () => document.setNodeTransform(node, after),
    });
    onGeometryChanged();
  };

  const changeMaterial = (changes: $Shape<GDModelMaterialProperties>) => {
    if (!material) return;
    const properties = material.material;
    const before = document.getMaterialProperties(properties);
    document.applyMaterialProperties(properties, changes);
    const after = document.getMaterialProperties(properties);
    onEditedChange({
      label: 'Change material',
      undo: () => document.applyMaterialProperties(properties, before),
      redo: () => document.applyMaterialProperties(properties, after),
    });
    onGeometryChanged();
  };

  const runMeshOperation = (
    label: string,
    operation: (
      geometry: any,
      vertexIds: Set<number>,
      triangleIds: Set<number>
    ) => any,
    options?: {| requiresSelection?: boolean |}
  ) => {
    if (!node || !node.isMesh || !node.geometry) return;
    const { vertexIds, triangleIds } = getSelection();
    const requiresSelection = !options || options.requiresSelection !== false;
    if (requiresSelection && !vertexIds.size && !triangleIds.size) return;

    const before = node.geometry;
    const after = operation(before, vertexIds, triangleIds);
    document.replaceMeshGeometry(node, after);
    onEditedChange({
      label,
      undo: () => {
        document.replaceMeshGeometry(node, before);
        onGeometryChanged();
      },
      redo: () => {
        document.replaceMeshGeometry(node, after);
        onGeometryChanged();
      },
    });
    onGeometryChanged();
  };

  const hasSelection = vertexSelectionCount > 0 || triangleSelectionCount > 0;

  return (
    <ColumnStackLayout noMargin>
      {!node && (
        <div className={classes.inspectorEmpty}>
          <span className={classes.inspectorEmptyIcon}>
            <Object3d />
          </span>
          <Text noMargin size="body-small" color="secondary">
            <Trans>
              Select a node in the list or in the viewport to edit it.
            </Trans>
          </Text>
        </div>
      )}

      {node && transform && (
        <React.Fragment>
          <ColumnStackLayout noMargin>
            <Text noMargin size="block-title">
              {node.name}
            </Text>
            <Text noMargin size="body-small" color="secondary">
              {node.isSkinnedMesh
                ? 'Skinned mesh'
                : node.isMesh
                ? 'Mesh'
                : 'Group'}{' '}
              · {node.children.length} children
            </Text>
          </ColumnStackLayout>

          <Accordion defaultExpanded noMargin>
            <AccordionHeader noMargin>
              <Text size="sub-title">
                <Trans>Transform</Trans>
              </Text>
            </AccordionHeader>
            <AccordionBody style={accordionBodyStyle}>
              <ColumnStackLayout noMargin>
                <Subheader>
                  <Trans>Position</Trans>
                </Subheader>
                <ResponsiveLineStackLayout
                  noResponsiveLandscape
                  expand
                  noColumnMargin
                >
                  {AXIS_LABELS.map((axis, index) => (
                    <NumberField
                      key={`position-${axis}`}
                      label={axis}
                      value={transform.position[index]}
                      onChange={value => {
                        const values = transform.position.slice();
                        values[index] = value;
                        changeTransform('position', values);
                      }}
                    />
                  ))}
                </ResponsiveLineStackLayout>

                <Subheader>
                  <Trans>Rotation (degrees)</Trans>
                </Subheader>
                <ResponsiveLineStackLayout
                  noResponsiveLandscape
                  expand
                  noColumnMargin
                >
                  {AXIS_LABELS.map((axis, index) => (
                    <NumberField
                      key={`rotation-${axis}`}
                      label={axis}
                      value={transform.rotation[index]}
                      onChange={value => {
                        const values = transform.rotation.slice();
                        values[index] = value;
                        changeTransform('rotation', values);
                      }}
                    />
                  ))}
                </ResponsiveLineStackLayout>

                <Subheader>
                  <Trans>Scale</Trans>
                </Subheader>
                <ResponsiveLineStackLayout
                  noResponsiveLandscape
                  expand
                  noColumnMargin
                >
                  {AXIS_LABELS.map((axis, index) => (
                    <NumberField
                      key={`scale-${axis}`}
                      label={axis}
                      value={transform.scale[index]}
                      onChange={value => {
                        const values = transform.scale.slice();
                        values[index] = value;
                        changeTransform('scale', values);
                      }}
                    />
                  ))}
                </ResponsiveLineStackLayout>
                <Line noMargin>
                  <TextButton
                    label={<Trans>Reset transform</Trans>}
                    onClick={() => {
                      const before = document.getNodeTransform(node);
                      document.setNodeTransform(node, {
                        position: [0, 0, 0],
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1],
                      });
                      const after = document.getNodeTransform(node);
                      onEditedChange({
                        label: 'Reset transform',
                        undo: () => document.setNodeTransform(node, before),
                        redo: () => document.setNodeTransform(node, after),
                      });
                      onGeometryChanged();
                    }}
                  />
                </Line>
              </ColumnStackLayout>
            </AccordionBody>
          </Accordion>
        </React.Fragment>
      )}

      {node && materialSlots.length > 0 && material && materialProperties && (
        <Accordion noMargin>
          <AccordionHeader noMargin>
            <Text size="sub-title">
              <Trans>Material</Trans>
            </Text>
          </AccordionHeader>
          <AccordionBody style={accordionBodyStyle}>
            <ColumnStackLayout noMargin>
              {materialSlots.length > 1 && (
                <SelectField
                  value={String(materialSlotIndex)}
                  onChange={(event, index, value) =>
                    setMaterialSlotIndex(parseInt(value, 10) || 0)
                  }
                  fullWidth
                  floatingLabelText={<Trans>Material slot</Trans>}
                >
                  {materialSlots.map(slot => (
                    <SelectOption
                      key={slot.index}
                      value={String(slot.index)}
                      label={`${slot.index} — ${slot.material.name ||
                        'material'}`}
                      shouldNotTranslate
                    />
                  ))}
                </SelectField>
              )}
              <ColorField
                fullWidth
                disableAlpha
                floatingLabelText="Base color"
                color={materialProperties.color}
                onChange={color => changeMaterial({ color })}
              />
              <ResponsiveLineStackLayout
                noResponsiveLandscape
                expand
                noColumnMargin
              >
                <NumberField
                  label="Metalness"
                  value={materialProperties.metalness}
                  onChange={value => changeMaterial({ metalness: value })}
                />
                <NumberField
                  label="Roughness"
                  value={materialProperties.roughness}
                  onChange={value => changeMaterial({ roughness: value })}
                />
              </ResponsiveLineStackLayout>
              <ColorField
                fullWidth
                disableAlpha
                floatingLabelText="Emissive color"
                color={materialProperties.emissive}
                onChange={color => changeMaterial({ emissive: color })}
              />
              <NumberField
                label="Opacity"
                value={materialProperties.opacity}
                onChange={value => changeMaterial({ opacity: value })}
              />
              <LineStackLayout noMargin>
                <Checkbox
                  label={<Trans>Transparent</Trans>}
                  checked={materialProperties.transparent}
                  onCheck={(event, checked) =>
                    changeMaterial({ transparent: checked })
                  }
                />
                <Checkbox
                  label={<Trans>Wireframe</Trans>}
                  checked={materialProperties.wireframe}
                  onCheck={(event, checked) =>
                    changeMaterial({ wireframe: checked })
                  }
                />
              </LineStackLayout>
              <LineStackLayout noMargin>
                <Checkbox
                  label={<Trans>Flat shading</Trans>}
                  checked={materialProperties.flatShading}
                  onCheck={(event, checked) =>
                    changeMaterial({ flatShading: checked })
                  }
                />
              </LineStackLayout>

              <Accordion noMargin>
                <AccordionHeader noMargin>
                  <Text size="body-small" color="secondary">
                    <Trans>Advanced material</Trans>
                  </Text>
                </AccordionHeader>
                <AccordionBody style={accordionBodyStyle}>
                  <ColumnStackLayout noMargin>
                    <ResponsiveLineStackLayout
                      noResponsiveLandscape
                      expand
                      noColumnMargin
                    >
                      <NumberField
                        label="Alpha test"
                        value={materialProperties.alphaTest}
                        onChange={value => changeMaterial({ alphaTest: value })}
                      />
                      <NumberField
                        label="Emissive intensity"
                        value={materialProperties.emissiveIntensity}
                        onChange={value =>
                          changeMaterial({ emissiveIntensity: value })
                        }
                      />
                    </ResponsiveLineStackLayout>
                    <NumberField
                      label="Environment intensity"
                      value={materialProperties.envMapIntensity}
                      onChange={value =>
                        changeMaterial({ envMapIntensity: value })
                      }
                    />
                    <SelectField
                      value={materialProperties.side}
                      onChange={(event, index, value) =>
                        // $FlowFixMe[incompatible-type] - one of the three sides.
                        changeMaterial({ side: value })
                      }
                      fullWidth
                      floatingLabelText={<Trans>Drawn faces</Trans>}
                    >
                      <SelectOption
                        value="front"
                        label="Front"
                        shouldNotTranslate
                      />
                      <SelectOption
                        value="back"
                        label="Back"
                        shouldNotTranslate
                      />
                      <SelectOption
                        value="double"
                        label="Both"
                        shouldNotTranslate
                      />
                    </SelectField>
                    {material.material.isMeshPhysicalMaterial && (
                      <React.Fragment>
                        <ResponsiveLineStackLayout
                          noResponsiveLandscape
                          expand
                          noColumnMargin
                        >
                          <NumberField
                            label="Clear coat"
                            value={materialProperties.clearcoat}
                            onChange={value =>
                              changeMaterial({ clearcoat: value })
                            }
                          />
                          <NumberField
                            label="Clear coat roughness"
                            value={materialProperties.clearcoatRoughness}
                            onChange={value =>
                              changeMaterial({
                                clearcoatRoughness: value,
                              })
                            }
                          />
                        </ResponsiveLineStackLayout>
                        <ResponsiveLineStackLayout
                          noResponsiveLandscape
                          expand
                          noColumnMargin
                        >
                          <NumberField
                            label="Index of refraction"
                            value={materialProperties.ior}
                            onChange={value => changeMaterial({ ior: value })}
                          />
                          <NumberField
                            label="Transmission"
                            value={materialProperties.transmission}
                            onChange={value =>
                              changeMaterial({ transmission: value })
                            }
                          />
                        </ResponsiveLineStackLayout>
                      </React.Fragment>
                    )}
                  </ColumnStackLayout>
                </AccordionBody>
              </Accordion>

              <Line noMargin>
                <TextButton
                  label={<Trans>Make the materials of this node unique</Trans>}
                  fullWidth
                  onClick={() => {
                    document.makeMaterialsUnique(node);
                    onGeometryChanged();
                  }}
                />
              </Line>
            </ColumnStackLayout>
          </AccordionBody>
        </Accordion>
      )}

      {node && node.isMesh && stats && (
        <Accordion defaultExpanded noMargin>
          <AccordionHeader noMargin>
            <Text size="sub-title">
              <Trans>Geometry</Trans>
            </Text>
          </AccordionHeader>
          <AccordionBody style={accordionBodyStyle}>
            <ColumnStackLayout noMargin>
              <Text noMargin size="body-small" color="secondary">
                {stats.vertexCount} vertices · {stats.triangleCount} triangles
                {stats.hasUVs ? ' · UVs' : ''}
              </Text>
              <Line noMargin>
                <TextButton
                  label={
                    mode === 'mesh' ? (
                      <Trans>Editing this mesh</Trans>
                    ) : (
                      <Trans>Edit this mesh</Trans>
                    )
                  }
                  onClick={onEditMesh}
                  disabled={mode === 'mesh'}
                />
              </Line>
              {mode === 'mesh' && (
                <React.Fragment>
                  <Text noMargin size="body-small" color="secondary">
                    {vertexSelectionCount} vertices · {triangleSelectionCount}{' '}
                    faces selected
                  </Text>
                  <LineStackLayout noMargin>
                    <TextButton
                      label={<Trans>Select all</Trans>}
                      onClick={onSelectAll}
                    />
                    <TextButton
                      label={<Trans>Clear selection</Trans>}
                      onClick={onClearSelection}
                      disabled={!hasSelection}
                    />
                  </LineStackLayout>

                  <ResponsiveLineStackLayout
                    noResponsiveLandscape
                    expand
                    noColumnMargin
                  >
                    <NumberField
                      label="Extrude distance"
                      value={extrudeDistance}
                      onChange={setExtrudeDistance}
                    />
                    <Line noMargin alignItems="center">
                      <TextButton
                        label={<Trans>Extrude</Trans>}
                        disabled={!triangleSelectionCount}
                        onClick={() =>
                          runMeshOperation(
                            'Extrude',
                            (geometry, vertexIds, triangleIds) =>
                              extrudeTriangles(
                                geometry,
                                triangleIds,
                                extrudeDistance
                              )
                          )
                        }
                      />
                    </Line>
                  </ResponsiveLineStackLayout>

                  <ResponsiveLineStackLayout
                    noResponsiveLandscape
                    expand
                    noColumnMargin
                  >
                    <NumberField
                      label="Scale selection"
                      value={scaleFactor}
                      onChange={setScaleFactor}
                    />
                    <Line noMargin alignItems="center">
                      <TextButton
                        label={<Trans>Scale</Trans>}
                        disabled={!hasSelection}
                        onClick={() =>
                          runMeshOperation(
                            'Scale selection',
                            (geometry, vertexIds) => {
                              const center = new THREE.Vector3();
                              const position = geometry.getAttribute(
                                'position'
                              );
                              vertexIds.forEach(vertexId => {
                                center.x += position.getX(vertexId);
                                center.y += position.getY(vertexId);
                                center.z += position.getZ(vertexId);
                              });
                              center.divideScalar(vertexIds.size || 1);
                              const matrix = new THREE.Matrix4()
                                .makeTranslation(center.x, center.y, center.z)
                                .multiply(
                                  new THREE.Matrix4().makeScale(
                                    scaleFactor,
                                    scaleFactor,
                                    scaleFactor
                                  )
                                )
                                .multiply(
                                  new THREE.Matrix4().makeTranslation(
                                    -center.x,
                                    -center.y,
                                    -center.z
                                  )
                                );
                              return transformVertices(
                                geometry,
                                vertexIds,
                                matrix
                              );
                            }
                          )
                        }
                      />
                    </Line>
                  </ResponsiveLineStackLayout>

                  <LineStackLayout noMargin>
                    <TextButton
                      label={<Trans>Subdivide</Trans>}
                      disabled={!triangleSelectionCount}
                      onClick={() =>
                        runMeshOperation(
                          'Subdivide',
                          (geometry, vertexIds, triangleIds) =>
                            subdivideTriangles(geometry, triangleIds)
                        )
                      }
                    />
                    <TextButton
                      label={<Trans>Flip faces</Trans>}
                      disabled={!triangleSelectionCount}
                      onClick={() =>
                        runMeshOperation(
                          'Flip faces',
                          (geometry, vertexIds, triangleIds) =>
                            flipTriangles(geometry, triangleIds)
                        )
                      }
                    />
                    <TextButton
                      label={<Trans>Delete faces</Trans>}
                      disabled={!triangleSelectionCount}
                      onClick={() =>
                        runMeshOperation(
                          'Delete faces',
                          (geometry, vertexIds, triangleIds) =>
                            deleteTriangles(geometry, triangleIds)
                        )
                      }
                    />
                  </LineStackLayout>

                  <LineStackLayout noMargin>
                    <TextButton
                      label={<Trans>Weld vertices</Trans>}
                      onClick={() =>
                        runMeshOperation(
                          'Weld vertices',
                          geometry => weldVertices(geometry),
                          { requiresSelection: false }
                        )
                      }
                    />
                    <TextButton
                      label={<Trans>Recompute normals</Trans>}
                      onClick={() =>
                        runMeshOperation(
                          'Recompute normals',
                          geometry => recomputeNormals(geometry),
                          { requiresSelection: false }
                        )
                      }
                    />
                  </LineStackLayout>

                  <Accordion noMargin>
                    <AccordionHeader noMargin>
                      <Text size="body-small" color="secondary">
                        <Trans>UV mapping</Trans>
                      </Text>
                    </AccordionHeader>
                    <AccordionBody style={accordionBodyStyle}>
                      <ColumnStackLayout noMargin>
                        <ResponsiveLineStackLayout
                          noResponsiveLandscape
                          expand
                          noColumnMargin
                        >
                          <NumberField
                            label="Scale"
                            value={uvScale}
                            onChange={setUvScale}
                          />
                          <NumberField
                            label="Rotation"
                            value={uvRotation}
                            onChange={setUvRotation}
                          />
                        </ResponsiveLineStackLayout>
                        <Line noMargin>
                          <TextButton
                            label={<Trans>Apply to the whole mesh</Trans>}
                            disabled={!stats.hasUVs}
                            onClick={() =>
                              runMeshOperation(
                                'Transform UVs',
                                geometry =>
                                  transformUVs(geometry, {
                                    scale: uvScale,
                                    rotationDegrees: uvRotation,
                                  }),
                                { requiresSelection: false }
                              )
                            }
                          />
                        </Line>
                      </ColumnStackLayout>
                    </AccordionBody>
                  </Accordion>
                </React.Fragment>
              )}
            </ColumnStackLayout>
          </AccordionBody>
        </Accordion>
      )}
    </ColumnStackLayout>
  );
};

export default ModelEditorInspector;
