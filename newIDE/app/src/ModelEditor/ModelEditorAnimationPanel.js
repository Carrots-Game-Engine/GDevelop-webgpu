// @flow
import * as React from 'react';
import { Trans } from '@lingui/macro';
import classNames from 'classnames';
import { type GDModelDocument } from './GDModelDocument';
import { ColumnStackLayout, ResponsiveLineStackLayout } from '../UI/Layout';
import { Column, Line, Spacer } from '../UI/Grid';
import Text from '../UI/Text';
import Subheader from '../UI/Subheader';
import SemiControlledTextField from '../UI/SemiControlledTextField';
import Slider from '../UI/Slider';
import IconButton from '../UI/IconButton';
import Play from '../UI/CustomSvgIcons/Play';
import Pause from '../UI/CustomSvgIcons/Pause';
import Stop from '../UI/CustomSvgIcons/Stop';
import Add from '../UI/CustomSvgIcons/Add';
import Trash from '../UI/CustomSvgIcons/Trash';
import { type ModelEditorCommand } from './ModelEditorHistory';
import classes from './ModelEditor.module.css';

const round = (value: number): number => Math.round(value * 100) / 100;

const rowActionStyle = {
  width: 24,
  height: 24,
  padding: 2,
  margin: 0,
};

type Props = {|
  document: GDModelDocument,
  geometryRevision: number,
  currentClipIndex: ?number,
  isPlaying: boolean,
  currentTime: number,
  onPlayClip: (clipIndex: number) => void,
  onPause: () => void,
  onResume: () => void,
  onStop: () => void,
  onSeek: (time: number) => void,
  onEditedChange: (command: ModelEditorCommand) => void,
  onGeometryChanged: () => void,
|};

const ModelEditorAnimationPanel = ({
  document,
  geometryRevision,
  currentClipIndex,
  isPlaying,
  currentTime,
  onPlayClip,
  onPause,
  onResume,
  onStop,
  onSeek,
  onEditedChange,
  onGeometryChanged,
}: Props): React.Node => {
  const [newEventName, setNewEventName] = React.useState<string>('');
  const [renamingClipIndex, setRenamingClipIndex] = React.useState<?number>(
    null
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clips = React.useMemo(() => document.getAnimationClips(), [
    document,
    geometryRevision,
  ]);
  const events = React.useMemo(
    () => document.getAnimationEvents().map(event => ({ ...event })),
    [document]
  );

  const currentClip =
    currentClipIndex === null || currentClipIndex === undefined
      ? null
      : clips[currentClipIndex] || null;

  const changeClipName = (index: number, newName: string) => {
    const before = document.getAnimationClips().map(clip => clip.name);
    if (!document.renameAnimationClip(index, newName)) return;
    const after = document.getAnimationClips().map(clip => clip.name);
    onEditedChange({
      label: 'Rename animation',
      undo: () => {
        document.renameAnimationClip(index, before[index]);
        onGeometryChanged();
      },
      redo: () => {
        document.renameAnimationClip(index, after[index]);
        onGeometryChanged();
      },
    });
    onGeometryChanged();
  };

  return (
    <ColumnStackLayout noMargin>
      <Line noMargin alignItems="center">
        <Subheader>
          <Trans>Animations</Trans>
        </Subheader>
        <Spacer />
        <Text noMargin size="body-small" color="secondary">
          {clips.length}
        </Text>
      </Line>
      {clips.length === 0 && (
        <Text noMargin size="body-small" color="secondary">
          <Trans>
            The model has no animation. Animations are authored in the file
            itself (in Blender for example) and played in GDevelop.
          </Trans>
        </Text>
      )}
      {clips.map(clip => {
        const isCurrentClip = currentClipIndex === clip.index;
        return (
          <div
            key={`${clip.index}-${clip.name}`}
            className={classNames(classes.listRow, {
              [classes.listRowSelected]: isCurrentClip,
            })}
          >
            <IconButton
              size="small"
              selected={isCurrentClip && isPlaying}
              onClick={() =>
                isCurrentClip && isPlaying
                  ? onPause()
                  : isCurrentClip
                  ? onResume()
                  : onPlayClip(clip.index)
              }
              aria-label="Play the animation"
            >
              {isCurrentClip && isPlaying ? <Pause /> : <Play />}
            </IconButton>
            {renamingClipIndex === clip.index ? (
              <SemiControlledTextField
                margin="none"
                commitOnBlur
                autoFocus="desktop"
                value={clip.name}
                onChange={newName => changeClipName(clip.index, newName)}
                onBlur={() => setRenamingClipIndex(null)}
                fullWidth
              />
            ) : (
              <span
                className={classes.listRowName}
                onDoubleClick={() => setRenamingClipIndex(clip.index)}
                title="Double-click to rename"
              >
                <Text noMargin size="body-small" displayInlineAsSpan>
                  {clip.name}
                </Text>
              </span>
            )}
            <Spacer />
            <Text noMargin size="body-small" color="secondary">
              {round(clip.duration)}s · {clip.trackCount} tracks
            </Text>
            <span className={classes.listRowActions}>
              <IconButton
                size="small"
                style={rowActionStyle}
                onClick={() => {
                  const clipToRemove = document.removeAnimationClip(clip.index);
                  if (!clipToRemove) return;
                  onEditedChange({
                    label: 'Delete animation',
                    undo: () => {
                      document.restoreAnimationClip(clipToRemove, clip.index);
                      onGeometryChanged();
                    },
                    redo: () => {
                      document.removeAnimationClip(clip.index);
                      onGeometryChanged();
                    },
                  });
                  onGeometryChanged();
                }}
                aria-label="Delete the animation"
              >
                <Trash />
              </IconButton>
            </span>
          </div>
        );
      })}

      {currentClip && (
        <Column noMargin>
          <Slider
            value={Math.min(currentTime, currentClip.duration)}
            min={0}
            max={Math.max(currentClip.duration, 0.001)}
            step={0.01}
            valueLabelDisplay="auto"
            onChange={time => onSeek(time)}
          />
          <Line noMargin alignItems="center">
            <Text noMargin size="body-small" color="secondary">
              {round(currentTime)} / {round(currentClip.duration)} s
            </Text>
            <Spacer />
            <IconButton size="small" onClick={onStop} aria-label="Stop">
              <Stop />
            </IconButton>
          </Line>
        </Column>
      )}

      <Subheader>
        <Trans>Animation events</Trans>
      </Subheader>
      {events.length === 0 && (
        <Text noMargin size="body-small" color="secondary">
          <Trans>
            An event is an instant of an animation, to trigger something at the
            right time (a footstep, a hit...).
          </Trans>
        </Text>
      )}
      {events.map((event, index) => (
        <div
          key={`${event.clip}-${event.time}-${index}`}
          className={classes.listRow}
        >
          <Text noMargin size="body-small">
            {event.name}
          </Text>
          <Spacer />
          <Text noMargin size="body-small" color="secondary">
            {event.clip} · {round(event.time)}s
          </Text>
          <span className={classes.listRowActions}>
            <IconButton
              size="small"
              style={rowActionStyle}
              onClick={() => {
                const before = document
                  .getAnimationEvents()
                  .map(item => ({ ...item }));
                document.removeAnimationEvent(index);
                const after = document
                  .getAnimationEvents()
                  .map(item => ({ ...item }));
                onEditedChange({
                  label: 'Delete animation event',
                  undo: () => {
                    document.getManifest().animationEvents = before;
                    onGeometryChanged();
                  },
                  redo: () => {
                    document.getManifest().animationEvents = after;
                    onGeometryChanged();
                  },
                });
                onGeometryChanged();
              }}
              aria-label="Delete the animation event"
            >
              <Trash />
            </IconButton>
          </span>
        </div>
      ))}
      {currentClip && (
        <ResponsiveLineStackLayout noResponsiveLandscape expand noColumnMargin>
          <SemiControlledTextField
            margin="none"
            floatingLabelText={<Trans>Event name</Trans>}
            value={newEventName}
            onChange={setNewEventName}
            fullWidth
          />
          <Line noMargin alignItems="center">
            <IconButton
              size="small"
              disabled={!newEventName.trim()}
              onClick={() => {
                const before = document
                  .getAnimationEvents()
                  .map(item => ({ ...item }));
                document.addAnimationEvent(
                  currentClip.name,
                  currentTime,
                  newEventName
                );
                const after = document
                  .getAnimationEvents()
                  .map(item => ({ ...item }));
                onEditedChange({
                  label: 'Add animation event',
                  undo: () => {
                    document.getManifest().animationEvents = before;
                    onGeometryChanged();
                  },
                  redo: () => {
                    document.getManifest().animationEvents = after;
                    onGeometryChanged();
                  },
                });
                setNewEventName('');
                onGeometryChanged();
              }}
              aria-label="Add an animation event here"
            >
              <Add />
            </IconButton>
            <Text noMargin size="body-small" color="secondary">
              <Trans>at {round(currentTime)}s</Trans>
            </Text>
          </Line>
        </ResponsiveLineStackLayout>
      )}
    </ColumnStackLayout>
  );
};

export default ModelEditorAnimationPanel;
