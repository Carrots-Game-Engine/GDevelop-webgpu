// @flow
import { mapFor } from '../../Utils/MapFor';

// Editor-only metadata stored using the existing project serialization mechanism.
// It never changes the underlying resources or how events are executed.
const EXTENSION_KEY = 'GDevelopModularWorkflow';
const PROPERTY_KEY = 'modules';

export type ResourceKind =
  | 'scene'
  | 'external-events'
  | 'extension'
  | 'function'
  | 'behavior'
  | 'object';
export type ModuleResource = {|
  kind: ResourceKind,
  name: string,
  extension?: string,
|};
export type GameModule = {|
  name: string,
  dependencies: Array<string>,
  resources: Array<ModuleResource>,
  publicResources: Array<ModuleResource>,
|};
export type ModularWorkflowData = {| version: 1, modules: Array<GameModule> |};
export type Diagnostic = {| code: string, message: string |};

export const resourceKey = (resource: ModuleResource): string =>
  JSON.stringify([resource.kind, resource.extension || '', resource.name]);

const isResource = (value: any): boolean =>
  !!value &&
  [
    'scene',
    'external-events',
    'extension',
    'function',
    'behavior',
    'object',
  ].includes(value.kind) &&
  typeof value.name === 'string' &&
  value.name.length > 0 &&
  (['function', 'behavior', 'object'].includes(value.kind)
    ? typeof value.extension === 'string' && value.extension.length > 0
    : value.extension === undefined);

// Refuse to overwrite malformed or future-version data rather than silently
// discarding it. An absent property is the only legacy-project default.
export const readModularWorkflow = (
  project: gdProject
): ModularWorkflowData => {
  const raw = project
    .getExtensionProperties()
    .getValue(EXTENSION_KEY, PROPERTY_KEY);
  if (!raw) {
    if (
      project.getExtensionProperties().hasProperty(EXTENSION_KEY, PROPERTY_KEY)
    )
      throw new Error(
        'Invalid modular workflow data. It has not been modified.'
      );
    return { version: 1, modules: [] };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid modular workflow data. It has not been modified.');
  }
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.modules) ||
    !data.modules.every(
      module =>
        module &&
        typeof module.name === 'string' &&
        module.name.trim() === module.name &&
        module.name.length > 0 &&
        Array.isArray(module.dependencies) &&
        module.dependencies.every(
          name => typeof name === 'string' && name.length > 0
        ) &&
        Array.isArray(module.resources) &&
        module.resources.every(isResource) &&
        Array.isArray(module.publicResources) &&
        module.publicResources.every(isResource)
    ) ||
    new Set(data.modules.map(module => module.name)).size !==
      data.modules.length
  ) {
    throw new Error(
      'Unsupported or invalid modular workflow data. It has not been modified.'
    );
  }
  return data;
};

export const writeModularWorkflow = (
  project: gdProject,
  data: ModularWorkflowData
): void => {
  project
    .getExtensionProperties()
    .setValue(EXTENSION_KEY, PROPERTY_KEY, JSON.stringify(data));
};

export const enumerateModuleResources = (
  project: gdProject
): Array<ModuleResource> => {
  const resources: Array<ModuleResource> = [];
  mapFor(0, project.getLayoutsCount(), i => {
    resources.push({ kind: 'scene', name: project.getLayoutAt(i).getName() });
  });
  mapFor(0, project.getExternalEventsCount(), i => {
    resources.push({
      kind: 'external-events',
      name: project.getExternalEventsAt(i).getName(),
    });
  });
  mapFor(0, project.getEventsFunctionsExtensionsCount(), i => {
    const extension = project.getEventsFunctionsExtensionAt(i);
    const extensionName = extension.getName();
    resources.push({ kind: 'extension', name: extensionName });
    const functions = extension.getEventsFunctions();
    mapFor(0, functions.getEventsFunctionsCount(), j => {
      resources.push({
        kind: 'function',
        extension: extensionName,
        name: functions.getEventsFunctionAt(j).getName(),
      });
    });
    const behaviors = extension.getEventsBasedBehaviors();
    mapFor(0, behaviors.getCount(), j => {
      resources.push({
        kind: 'behavior',
        extension: extensionName,
        name: behaviors.getAt(j).getName(),
      });
    });
    const objects = extension.getEventsBasedObjects();
    mapFor(0, objects.getCount(), j => {
      resources.push({
        kind: 'object',
        extension: extensionName,
        name: objects.getAt(j).getName(),
      });
    });
  });
  return resources;
};

export const resourceLabel = (resource: ModuleResource): string =>
  `${resource.kind}: ${resource.extension ? `${resource.extension} / ` : ''}${
    resource.name
  }`;

export const renameModule = (
  data: ModularWorkflowData,
  oldName: string,
  newName: string
): ModularWorkflowData => ({
  ...data,
  modules: data.modules.map(module => ({
    ...module,
    name: module.name === oldName ? newName : module.name,
    dependencies: module.dependencies.map(name =>
      name === oldName ? newName : name
    ),
  })),
});

// Keep bindings in sync when a project item is renamed in the editor. An
// unreadable future format is never modified or allowed to block the rename.
// For resources that live inside an extension (function, behavior, object),
// pass the owning extension name so only the matching binding is renamed.
export const renameProjectResource = (
  project: gdProject,
  kind:
    | 'scene'
    | 'external-events'
    | 'extension'
    | 'function'
    | 'behavior'
    | 'object',
  oldName: string,
  newName: string,
  extensionName?: string
): void => {
  let data;
  try {
    data = readModularWorkflow(project);
  } catch (error) {
    return;
  }
  let changed = false;
  const rename = (resource: ModuleResource): ModuleResource => {
    if (
      resource.kind === kind &&
      resource.name === oldName &&
      (kind === 'scene' ||
        kind === 'external-events' ||
        kind === 'extension' ||
        resource.extension === extensionName)
    ) {
      changed = true;
      return { ...resource, name: newName };
    }
    if (kind === 'extension' && resource.extension === oldName) {
      changed = true;
      return { ...resource, extension: newName };
    }
    return resource;
  };
  const modules = data.modules.map(module => ({
    ...module,
    resources: module.resources.map(rename),
    publicResources: module.publicResources.map(rename),
  }));
  if (changed) writeModularWorkflow(project, { ...data, modules });
};

export const getDiagnostics = (
  data: ModularWorkflowData,
  available: Array<ModuleResource>
): Array<Diagnostic> => {
  const diagnostics: Array<Diagnostic> = [];
  const names = new Set();
  const availableKeys = new Set(available.map(resourceKey));
  const owners = new Map();
  data.modules.forEach(module => {
    if (names.has(module.name))
      diagnostics.push({
        code: 'duplicate-module',
        message: `Duplicate module: ${module.name}`,
      });
    names.add(module.name);
    const ownKeys = new Set();
    module.resources.forEach(resource => {
      const key = resourceKey(resource);
      if (
        ownKeys.has(key) ||
        (owners.has(key) && owners.get(key) !== module.name)
      ) {
        diagnostics.push({
          code: 'resource-conflict',
          message: `${resourceLabel(resource)} is bound more than once.`,
        });
      }
      ownKeys.add(key);
      owners.set(key, module.name);
      if (!availableKeys.has(key))
        diagnostics.push({
          code: 'missing-resource',
          message: `${module.name}: missing ${resourceLabel(resource)}.`,
        });
    });
    module.publicResources.forEach(resource => {
      if (!ownKeys.has(resourceKey(resource)))
        diagnostics.push({
          code: 'invalid-api',
          message: `${module.name}: public ${resourceLabel(
            resource
          )} is not bound to the module.`,
        });
    });
  });
  data.modules.forEach(module => {
    module.dependencies.forEach(dependency => {
      if (!names.has(dependency))
        diagnostics.push({
          code: 'missing-dependency',
          message: `${module.name}: missing dependency ${dependency}.`,
        });
    });
  });
  // Strongly connected components report every cycle, including self-dependencies.
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const byName = new Map(data.modules.map(module => [module.name, module]));
  const visit = (name: string) => {
    const index = nextIndex++;
    indices.set(name, index);
    lowLinks.set(name, index);
    stack.push(name);
    onStack.add(name);
    const module = byName.get(name);
    if (!module) return;
    module.dependencies.forEach(dependency => {
      if (!byName.has(dependency)) return;
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(
          name,
          Math.min(lowLinks.get(name), lowLinks.get(dependency))
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          name,
          Math.min(lowLinks.get(name), indices.get(dependency))
        );
      }
    });
    if (lowLinks.get(name) === indices.get(name)) {
      const component = [];
      let current;
      do {
        current = stack.pop();
        onStack.delete(current);
        component.push(current);
      } while (current !== name);
      if (component.length > 1 || module.dependencies.includes(name)) {
        diagnostics.push({
          code: 'circular-dependency',
          message: `Circular dependency: ${component.sort().join(', ')}.`,
        });
      }
    }
  };
  data.modules.forEach(module => {
    if (!indices.has(module.name)) visit(module.name);
  });
  if (data.modules.length)
    available.forEach(resource => {
      if (!owners.has(resourceKey(resource)))
        diagnostics.push({
          code: 'unbound-resource',
          message: `Unbound ${resourceLabel(resource)}.`,
        });
    });
  return diagnostics;
};
