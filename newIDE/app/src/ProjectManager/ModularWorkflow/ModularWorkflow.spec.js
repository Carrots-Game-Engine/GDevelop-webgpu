// @flow
import { makeTestProject } from '../../fixtures/TestProject';
import {
  serializeToJSObject,
  unserializeFromJSObject,
} from '../../Utils/Serializer';
import {
  readModularWorkflow,
  writeModularWorkflow,
  enumerateModuleResources,
  getDiagnostics,
  renameModule,
  renameProjectResource,
} from './ModularWorkflow';

const gd: libGDevelop = global.gd;
const scene = { kind: 'scene', name: 'Level' };
const ext = { kind: 'extension', name: 'Combat' };
const moduleData = (
  name,
  dependencies = [],
  resources = [],
  publicResources = []
) => ({ name, dependencies, resources, publicResources });

describe('modular workflow', () => {
  it('loads old projects as empty and persists metadata through project serialization', () => {
    const { project } = makeTestProject(gd);
    expect(readModularWorkflow(project)).toEqual({ version: 1, modules: [] });
    const data = {
      version: 1,
      modules: [
        moduleData('Player', ['Combat'], [scene], [scene]),
        moduleData('Combat'),
      ],
    };
    writeModularWorkflow(project, data);
    const json = serializeToJSObject(project);
    const restored = gd.ProjectHelper.createNewGDJSProject();
    unserializeFromJSObject(restored, json);
    expect(readModularWorkflow(restored)).toEqual(data);
    restored.delete();
    project.delete();
  });

  it('rejects malformed and future data without overwriting it', () => {
    const { project } = makeTestProject(gd);
    const properties = project.getExtensionProperties();
    for (const raw of [
      '',
      '{',
      '{"version":2,"modules":[]}',
      '{"version":1,"modules":[{}]}',
    ]) {
      properties.setValue('GDevelopModularWorkflow', 'modules', raw);
      expect(() => readModularWorkflow(project)).toThrow();
      expect(properties.getValue('GDevelopModularWorkflow', 'modules')).toBe(
        raw
      );
    }
    project.delete();
  });

  it('enumerates actual project events and extension resources', () => {
    const {
      project,
      testLayout,
      testExternalEvents1,
      testEventsFunctionsExtension,
      testEventsFunction,
    } = makeTestProject(gd);
    const testEventsBasedBehavior = testEventsFunctionsExtension
      .getEventsBasedBehaviors()
      .insertNew('ExampleBehavior', 0);
    const testEventsBasedObject = testEventsFunctionsExtension
      .getEventsBasedObjects()
      .insertNew('ExampleObject', 0);
    const resources = enumerateModuleResources(project);
    expect(resources).toContainEqual({
      kind: 'scene',
      name: testLayout.getName(),
    });
    expect(resources).toContainEqual({
      kind: 'external-events',
      name: testExternalEvents1.getName(),
    });
    const extension = testEventsFunctionsExtension.getName();
    expect(resources).toContainEqual({ kind: 'extension', name: extension });
    expect(resources).toContainEqual({
      kind: 'function',
      extension,
      name: testEventsFunction.getName(),
    });
    expect(resources).toContainEqual({
      kind: 'behavior',
      extension,
      name: testEventsBasedBehavior.getName(),
    });
    expect(resources).toContainEqual({
      kind: 'object',
      extension,
      name: testEventsBasedObject.getName(),
    });
    project.delete();
  });

  it('keeps project-item bindings and public API in sync on rename', () => {
    const { project } = makeTestProject(gd);
    const fn = { kind: 'function', extension: 'Combat', name: 'Attack' };
    const behavior = { kind: 'behavior', extension: 'Combat', name: 'Fighter' };
    const object = { kind: 'object', extension: 'Combat', name: 'Weapon' };
    const data = {
      version: 1,
      modules: [
        moduleData(
          'Player',
          [],
          [scene, ext, fn, behavior, object],
          [scene, fn]
        ),
      ],
    };
    writeModularWorkflow(project, data);
    renameProjectResource(project, 'scene', 'Level', 'NewLevel');
    renameProjectResource(project, 'function', 'Attack', 'Strike', 'Combat');
    renameProjectResource(project, 'behavior', 'Fighter', 'Warrior', 'Combat');
    renameProjectResource(project, 'object', 'Weapon', 'Blade', 'Combat');
    renameProjectResource(project, 'extension', 'Combat', 'Battle');
    expect(readModularWorkflow(project).modules[0]).toEqual(
      moduleData(
        'Player',
        [],
        [
          { kind: 'scene', name: 'NewLevel' },
          { kind: 'extension', name: 'Battle' },
          { kind: 'function', extension: 'Battle', name: 'Strike' },
          { kind: 'behavior', extension: 'Battle', name: 'Warrior' },
          { kind: 'object', extension: 'Battle', name: 'Blade' },
        ],
        [
          { kind: 'scene', name: 'NewLevel' },
          { kind: 'function', extension: 'Battle', name: 'Strike' },
        ]
      )
    );
    project
      .getExtensionProperties()
      .setValue('GDevelopModularWorkflow', 'modules', '{"version":2}');
    renameProjectResource(project, 'scene', 'Level', 'Other');
    expect(
      project
        .getExtensionProperties()
        .getValue('GDevelopModularWorkflow', 'modules')
    ).toBe('{"version":2}');
    project.delete();
  });
  it('renames dependencies and finds cycles, missing items, conflicts and unbound resources', () => {
    const missing = { kind: 'external-events', name: 'Deleted' };
    const data = {
      version: 1,
      modules: [
        moduleData('A', ['B', 'Missing'], [scene, missing], [ext]),
        moduleData('B', ['A'], [scene]),
        moduleData('C', ['C']),
      ],
    };
    const renamed = renameModule(data, 'A', 'Player');
    expect(renamed.modules[1].dependencies).toEqual(['Player']);
    const issues = getDiagnostics(renamed, [scene, ext]);
    const codes = issues.map(issue => issue.code);
    expect(codes).toContain('missing-resource');
    expect(codes).toContain('missing-dependency');
    expect(codes).toContain('resource-conflict');
    expect(codes).toContain('invalid-api');
    expect(codes).toContain('unbound-resource');
    expect(codes.filter(code => code === 'circular-dependency')).toHaveLength(
      2
    );
    expect(getDiagnostics({ version: 1, modules: [] }, [scene])).toEqual([]);
  });
});
