// @flow
import * as React from 'react';
import { Trans, t } from '@lingui/macro';
import Dialog from '../UI/Dialog';
import FlatButton from '../UI/FlatButton';
import RaisedButton from '../UI/RaisedButton';
import Text from '../UI/Text';
import AlertMessage from '../UI/AlertMessage';
import SelectField from '../UI/SelectField';
import SelectOption from '../UI/SelectOption';
import SemiControlledTextField from '../UI/SemiControlledTextField';
import { ColumnStackLayout } from '../UI/Layout';
import { type GDModelDocument } from './GDModelDocument';
import { exportModelDocumentToFile } from './ModelEditorResource';
import { GD_MODEL_FILE_EXTENSION } from './GDModelFormat';
import { GLB_FILE_EXTENSION } from './ModelEditorExport';

export type ModelExportFormat = 'gdm' | 'glb';

type Props = {|
  open: boolean,
  onClose: () => void,
  document: GDModelDocument,
  defaultFileName: string,
  defaultFormat: ModelExportFormat,
|};

const getExtensionForFormat = (format: ModelExportFormat): string =>
  format === 'gdm' ? GD_MODEL_FILE_EXTENSION : GLB_FILE_EXTENSION;

const ModelEditorExportDialog = ({
  open,
  onClose,
  document,
  defaultFileName,
  defaultFormat,
}: Props): React.Node => {
  const [fileName, setFileName] = React.useState<string>(defaultFileName);
  const [format, setFormat] = React.useState<ModelExportFormat>(defaultFormat);
  const [isExporting, setIsExporting] = React.useState<boolean>(false);
  const [error, setError] = React.useState<?string>(null);
  const [exportedFileName, setExportedFileName] = React.useState<?string>(null);

  React.useEffect(
    () => {
      if (!open) return;
      setFileName(defaultFileName);
      setFormat(defaultFormat);
      setError(null);
      setExportedFileName(null);
      setIsExporting(false);
    },
    [open, defaultFileName, defaultFormat]
  );

  const exportModel = async () => {
    if (isExporting) return;
    const trimmedFileName = fileName.trim();
    if (!trimmedFileName) {
      setError('Choose a name for the exported file.');
      return;
    }

    setIsExporting(true);
    setError(null);
    setExportedFileName(null);
    try {
      // Never add the extension twice: the exporter appends it.
      const baseFileName = trimmedFileName.replace(/\.(gdm|glb)$/i, '');
      const result = await exportModelDocumentToFile({
        document,
        extension: getExtensionForFormat(format),
        fileName: baseFileName,
      });
      setExportedFileName(`${baseFileName}${result.extension}`);
    } catch (exportError) {
      console.error('Unable to export the 3D model:', exportError);
      setError(exportError.message || 'Unable to export the 3D model.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onRequestClose={onClose}
      title={<Trans>Export the 3D model</Trans>}
      maxWidth="sm"
      actions={[
        <FlatButton
          key="close"
          label={<Trans>Close</Trans>}
          onClick={onClose}
        />,
        <RaisedButton
          key="export"
          primary
          label={
            isExporting ? (
              <Trans>Exporting…</Trans>
            ) : (
              <Trans>Export the file</Trans>
            )
          }
          disabled={isExporting}
          onClick={exportModel}
        />,
      ]}
    >
      <ColumnStackLayout noMargin>
        <Text noMargin>
          <Trans>
            Save a copy of this model to share it or to open it in another 3D
            tool. The model in the project is left unchanged.
          </Trans>
        </Text>
        <SemiControlledTextField
          margin="dense"
          fullWidth
          floatingLabelText={<Trans>File name</Trans>}
          value={fileName}
          onChange={setFileName}
        />
        <SelectField
          fullWidth
          floatingLabelText={<Trans>Format</Trans>}
          value={format}
          onChange={(event, index, value) =>
            setFormat(value === 'glb' ? 'glb' : 'gdm')
          }
        >
          <SelectOption value="gdm" label={t`GDevelop model (.gdm)`} />
          <SelectOption value="glb" label={t`glTF binary (.glb)`} />
        </SelectField>
        {error && <AlertMessage kind="error">{error}</AlertMessage>}
        {exportedFileName && (
          <AlertMessage kind="valid">
            {`Exported "${exportedFileName}".`}
          </AlertMessage>
        )}
      </ColumnStackLayout>
    </Dialog>
  );
};

export default ModelEditorExportDialog;
