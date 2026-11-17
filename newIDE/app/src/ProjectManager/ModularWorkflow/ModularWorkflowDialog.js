// @flow
import { Trans, t } from '@lingui/macro';
import * as React from 'react';
import Dialog from '../../UI/Dialog';
import FlatButton from '../../UI/FlatButton';
import RaisedButton from '../../UI/RaisedButton';
import { ColumnStackLayout, LineStackLayout } from '../../UI/Layout';
import Text from '../../UI/Text';
import TextField from '../../UI/TextField';
import SelectField from '../../UI/SelectField';
import SelectOption from '../../UI/SelectOption';
import Checkbox from '../../UI/Checkbox';
import Trash from '../../UI/CustomSvgIcons/Trash';
import {
  enumerateModuleResources,
  getDiagnostics,
  readModularWorkflow,
  renameModule,
  resourceKey,
  resourceLabel,
  writeModularWorkflow,
  type GameModule,
  type ModularWorkflowData,
  type ModuleResource,
} from './ModularWorkflow';

type Props = {|
  project: gdProject,
  onClose: () => void,
  onChange: () => void,
  onOpenLayout: (name: string) => void,
  onOpenExternalEvents: (name: string) => void,
  onOpenExtension: (
    name: string,
    initiallyFocusedFunctionName?: ?string,
    initiallyFocusedBehaviorName?: ?string,
    initiallyFocusedObjectName?: ?string
  ) => void,
  onOpenGlobalSearch: () => void,
|};

const emptyModule = (name: string): GameModule => ({
  name,
  dependencies: [],
  resources: [],
  publicResources: [],
});

const openResource = (
  resource: ModuleResource,
  {
    onOpenLayout,
    onOpenExternalEvents,
    onOpenExtension,
  }: {
    onOpenLayout: string => void,
    onOpenExternalEvents: string => void,
    onOpenExtension: (string, ?string, ?string, ?string) => void,
  }
) => {
  if (resource.kind === 'scene') onOpenLayout(resource.name);
  else if (resource.kind === 'external-events')
    onOpenExternalEvents(resource.name);
  else if (resource.kind === 'extension') onOpenExtension(resource.name);
  else if (resource.kind === 'function' && resource.extension)
    onOpenExtension(resource.extension, resource.name, null, null);
  else if (resource.kind === 'behavior' && resource.extension)
    onOpenExtension(resource.extension, null, resource.name, null);
  else if (resource.kind === 'object' && resource.extension)
    onOpenExtension(resource.extension, null, null, resource.name);
};

const ModularWorkflowDialog = ({
  project,
  onClose,
  onChange,
  onOpenLayout,
  onOpenExternalEvents,
  onOpenExtension,
  onOpenGlobalSearch,
}: Props) => {
  const [loaded, setLoaded] = React.useState<{
    data: ?ModularWorkflowData,
    error: ?string,
  }>({ data: null, error: null });
  const [selectedModuleName, setSelectedModuleName] = React.useState<?string>(
    null
  );
  const [newModuleName, setNewModuleName] = React.useState('');
  const [renameTo, setRenameTo] = React.useState('');
  const [resourceToAdd, setResourceToAdd] = React.useState('');

  React.useEffect(
    () => {
      try {
        const data = readModularWorkflow(project);
        setLoaded({ data, error: null });
        setSelectedModuleName(
          data.modules.length ? data.modules[0].name : null
        );
      } catch (error) {
        setLoaded({
          data: null,
          error: error && error.message ? error.message : String(error),
        });
      }
    },
    [project]
  );

  const data = loaded.data;
  const available = React.useMemo(() => enumerateModuleResources(project), [
    project,
  ]);
  const diagnostics = React.useMemo(
    () => (data ? getDiagnostics(data, available) : []),
    [data, available]
  );

  const save = React.useCallback(
    (next: ModularWorkflowData) => {
      writeModularWorkflow(project, next);
      setLoaded({ data: next, error: null });
      onChange();
    },
    [project, onChange]
  );

  const selectedModule: ?GameModule =
    data && selectedModuleName
      ? data.modules.find(m => m.name === selectedModuleName) || null
      : null;

  const updateModule = (updater: GameModule => GameModule) => {
    if (!data || !selectedModule) return;
    save({
      ...data,
      modules: data.modules.map(m =>
        m.name === selectedModule.name ? updater(m) : m
      ),
    });
  };

  const createModule = () => {
    if (!data) return;
    const name = newModuleName.trim();
    if (!name || data.modules.some(m => m.name === name)) return;
    const next = { ...data, modules: [...data.modules, emptyModule(name)] };
    save(next);
    setSelectedModuleName(name);
    setNewModuleName('');
  };

  const removeModule = () => {
    if (!data || !selectedModule) return;
    const removed = selectedModule.name;
    const next = {
      ...data,
      modules: data.modules
        .filter(m => m.name !== removed)
        .map(m => ({
          ...m,
          dependencies: m.dependencies.filter(d => d !== removed),
        })),
    };
    save(next);
    setSelectedModuleName(next.modules.length ? next.modules[0].name : null);
  };

  const renameSelectedModule = () => {
    if (!data || !selectedModule) return;
    const newName = renameTo.trim();
    if (
      !newName ||
      newName === selectedModule.name ||
      data.modules.some(m => m.name === newName)
    )
      return;
    const next = renameModule(data, selectedModule.name, newName);
    save(next);
    setSelectedModuleName(newName);
    setRenameTo('');
  };

  const ownedKeys = new Set(
    selectedModule ? selectedModule.resources.map(resourceKey) : []
  );
  const publicKeys = new Set(
    selectedModule ? selectedModule.publicResources.map(resourceKey) : []
  );
  const addableResources = available.filter(
    r => !ownedKeys.has(resourceKey(r))
  );

  return (
    <Dialog
      title={<Trans>Modular Workflow</Trans>}
      open
      maxWidth="lg"
      actions={[
        <FlatButton
          key="search"
          label={<Trans>Search event usages</Trans>}
          onClick={onOpenGlobalSearch}
          disabled={!data}
        />,
        <FlatButton
          key="close"
          label={<Trans>Close</Trans>}
          onClick={onClose}
          primary
        />,
      ]}
      secondaryActions={[
        <FlatButton
          key="remove"
          label={<Trans>Remove module</Trans>}
          leftIcon={<Trash />}
          onClick={removeModule}
          disabled={!selectedModule}
        />,
      ]}
      onRequestClose={onClose}
      flexColumnBody
    >
      <ColumnStackLayout noMargin expand>
        <Text size="body-small">
          <Trans>
            Organize project resources into modules without changing how events
            run. This metadata is saved in the project for the editor only.
          </Trans>
        </Text>
        {loaded.error && <Text color="error">{loaded.error}</Text>}
        {data && (
          <>
            <Text size="block-title">
              <Trans>Module Manager</Trans>
            </Text>
            <LineStackLayout noMargin alignItems="center">
              <TextField
                value={newModuleName}
                floatingLabelText={<Trans>New module name</Trans>}
                onChange={(e, value) => setNewModuleName(value)}
                fullWidth
              />
              <RaisedButton
                label={<Trans>Create</Trans>}
                onClick={createModule}
                primary
                disabled={!newModuleName.trim()}
              />
            </LineStackLayout>
            {data.modules.length > 0 ? (
              <SelectField
                floatingLabelText={<Trans>Module</Trans>}
                value={selectedModuleName || ''}
                onChange={(e, i, value: string) => setSelectedModuleName(value)}
                fullWidth
              >
                {data.modules.map(m => (
                  <SelectOption key={m.name} value={m.name} label={m.name} />
                ))}
              </SelectField>
            ) : (
              <Text>
                <Trans>No modules yet. Create one to start organizing.</Trans>
              </Text>
            )}
            {selectedModule && (
              <>
                <LineStackLayout noMargin alignItems="center">
                  <TextField
                    value={renameTo}
                    floatingLabelText={<Trans>Rename to</Trans>}
                    onChange={(e, value) => setRenameTo(value)}
                    fullWidth
                  />
                  <FlatButton
                    label={<Trans>Rename</Trans>}
                    onClick={renameSelectedModule}
                    disabled={!renameTo.trim()}
                  />
                </LineStackLayout>

                <Text size="sub-title">
                  <Trans>Resources</Trans>
                </Text>
                <LineStackLayout noMargin alignItems="center">
                  <SelectField
                    floatingLabelText={<Trans>Add resource</Trans>}
                    value={resourceToAdd}
                    onChange={(e, i, value: string) => setResourceToAdd(value)}
                    fullWidth
                  >
                    <SelectOption value="" label={t`Choose a resource`} />
                    {addableResources.map(r => (
                      <SelectOption
                        key={resourceKey(r)}
                        value={resourceKey(r)}
                        label={resourceLabel(r)}
                      />
                    ))}
                  </SelectField>
                  <RaisedButton
                    label={<Trans>Add</Trans>}
                    onClick={() => {
                      const r = addableResources.find(
                        ar => resourceKey(ar) === resourceToAdd
                      );
                      if (!r) return;
                      updateModule(m => ({
                        ...m,
                        resources: [...m.resources, r],
                      }));
                      setResourceToAdd('');
                    }}
                    disabled={!resourceToAdd}
                  />
                </LineStackLayout>
                {selectedModule.resources.length === 0 ? (
                  <Text>
                    <Trans>No resources bound to this module.</Trans>
                  </Text>
                ) : (
                  selectedModule.resources.map(r => {
                    const key = resourceKey(r);
                    const isPublic = publicKeys.has(key);
                    return (
                      <LineStackLayout key={key} noMargin alignItems="center">
                        <FlatButton
                          label={resourceLabel(r)}
                          onClick={() =>
                            openResource(r, {
                              onOpenLayout,
                              onOpenExternalEvents,
                              onOpenExtension,
                            })
                          }
                        />
                        <Checkbox
                          checked={isPublic}
                          label={<Trans>Public API</Trans>}
                          onCheck={(e, checked) => {
                            updateModule(m => ({
                              ...m,
                              publicResources: checked
                                ? [...m.publicResources, r]
                                : m.publicResources.filter(
                                    pr => resourceKey(pr) !== key
                                  ),
                            }));
                          }}
                        />
                        <FlatButton
                          label={<Trans>Remove</Trans>}
                          onClick={() => {
                            updateModule(m => ({
                              ...m,
                              resources: m.resources.filter(
                                mr => resourceKey(mr) !== key
                              ),
                              publicResources: m.publicResources.filter(
                                pr => resourceKey(pr) !== key
                              ),
                            }));
                          }}
                        />
                      </LineStackLayout>
                    );
                  })
                )}

                <Text size="sub-title">
                  <Trans>Dependencies</Trans>
                </Text>
                {data.modules.filter(m => m.name !== selectedModule.name)
                  .length === 0 ? (
                  <Text>
                    <Trans>No other modules available.</Trans>
                  </Text>
                ) : (
                  data.modules
                    .filter(m => m.name !== selectedModule.name)
                    .map(m => {
                      const checked = selectedModule.dependencies.includes(
                        m.name
                      );
                      return (
                        <Checkbox
                          key={m.name}
                          checked={checked}
                          label={m.name}
                          onCheck={(e, isChecked) => {
                            updateModule(mod => ({
                              ...mod,
                              dependencies: isChecked
                                ? [...mod.dependencies, m.name]
                                : mod.dependencies.filter(d => d !== m.name),
                            }));
                          }}
                        />
                      );
                    })
                )}
              </>
            )}

            {diagnostics.length > 0 && (
              <>
                <Text size="sub-title">
                  <Trans>Diagnostics</Trans>
                </Text>
                {diagnostics.map((d, i) => (
                  <Text key={i} color="error">
                    {d.message}
                  </Text>
                ))}
              </>
            )}
          </>
        )}
      </ColumnStackLayout>
    </Dialog>
  );
};

export default ModularWorkflowDialog;
