// @flow
/**
 * Undo/redo of the model editor.
 *
 * Every edit pushes a command with the two functions that apply it in both
 * directions, so an operation that touches several things (a node rename that
 * also renames sockets, a mesh edit that replaces a whole geometry) is undone
 * as one step, exactly as it was applied.
 */

export type ModelEditorCommand = {|
  label: string,
  undo: () => void,
  redo: () => void,
|};

export class ModelEditorHistory {
  _undoStack: Array<ModelEditorCommand> = [];
  _redoStack: Array<ModelEditorCommand> = [];
  _maxEntries: number;

  constructor(maxEntries: number = 100) {
    this._maxEntries = Math.max(1, maxEntries);
  }

  push(command: ModelEditorCommand): void {
    this._undoStack.push(command);
    if (this._undoStack.length > this._maxEntries) this._undoStack.shift();
    // Any new edit invalidates what was undone.
    this._redoStack = [];
  }

  canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  getUndoLabel(): ?string {
    const command = this._undoStack[this._undoStack.length - 1];
    return command ? command.label : null;
  }

  getRedoLabel(): ?string {
    const command = this._redoStack[this._redoStack.length - 1];
    return command ? command.label : null;
  }

  /** Undo the last command, returning what was undone. */
  undo(): ?string {
    const command = this._undoStack.pop();
    if (!command) return null;
    command.undo();
    this._redoStack.push(command);
    return command.label;
  }

  /** Redo the last undone command, returning what was redone. */
  redo(): ?string {
    const command = this._redoStack.pop();
    if (!command) return null;
    command.redo();
    this._undoStack.push(command);
    return command.label;
  }

  getLength(): number {
    return this._undoStack.length;
  }

  clear(): void {
    this._undoStack = [];
    this._redoStack = [];
  }
}
