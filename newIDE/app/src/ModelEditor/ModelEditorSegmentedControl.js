// @flow
import * as React from 'react';
import classNames from 'classnames';
import classes from './ModelEditor.module.css';

export type SegmentedControlOption = {|
  value: string,
  label: React.Node,
  title?: string,
|};

type Props = {|
  value: string,
  options: Array<SegmentedControlOption>,
  onChange: (value: any) => void,
  ariaLabel: string,
  small?: boolean,
|};

/**
 * A small segmented control used for the editing modes of the 3D model editor.
 * It stays simple on purpose: a handful of short labels in a single pill.
 */
const ModelEditorSegmentedControl = ({
  value,
  options,
  onChange,
  ariaLabel,
  small,
}: Props): React.Node => (
  <div
    className={classNames(classes.segmentedControl, {
      [classes.segmentedControlSmall]: small,
    })}
    role="group"
    aria-label={ariaLabel}
  >
    {options.map(option => {
      const isActive = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          className={classNames(classes.segmentedButton, {
            [classes.segmentedButtonActive]: isActive,
          })}
          onClick={() => onChange(option.value)}
          aria-pressed={isActive}
          title={option.title}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

export default ModelEditorSegmentedControl;
