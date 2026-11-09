// @flow
import { ModelEditorHistory } from './ModelEditorHistory';

describe('ModelEditorHistory', () => {
  it('undoes and redoes in order', () => {
    const history = new ModelEditorHistory();
    const calls = [];
    history.push({
      label: 'Move node',
      undo: () => calls.push('undo move'),
      redo: () => calls.push('redo move'),
    });
    history.push({
      label: 'Delete node',
      undo: () => calls.push('undo delete'),
      redo: () => calls.push('redo delete'),
    });

    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
    expect(history.getUndoLabel()).toBe('Delete node');

    expect(history.undo()).toBe('Delete node');
    expect(history.undo()).toBe('Move node');
    expect(history.undo()).toBe(null);
    expect(calls).toEqual(['undo delete', 'undo move']);

    expect(history.getRedoLabel()).toBe('Move node');
    expect(history.redo()).toBe('Move node');
    expect(calls).toEqual(['undo delete', 'undo move', 'redo move']);
  });

  it('forgets what was undone when an edit happens', () => {
    const history = new ModelEditorHistory();
    history.push({ label: 'A', undo: () => {}, redo: () => {} });
    history.undo();
    expect(history.canRedo()).toBe(true);

    history.push({ label: 'B', undo: () => {}, redo: () => {} });
    expect(history.canRedo()).toBe(false);
    expect(history.getLength()).toBe(1);
  });

  it('keeps a bounded number of entries', () => {
    const history = new ModelEditorHistory(3);
    for (let index = 0; index < 5; index++)
      history.push({ label: `Edit ${index}`, undo: () => {}, redo: () => {} });

    expect(history.getLength()).toBe(3);
    expect(history.getUndoLabel()).toBe('Edit 4');
    history.undo();
    history.undo();
    history.undo();
    expect(history.undo()).toBe(null);
  });

  it('is emptied by clear', () => {
    const history = new ModelEditorHistory();
    history.push({ label: 'A', undo: () => {}, redo: () => {} });
    history.undo();
    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
