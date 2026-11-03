// @flow
import * as React from 'react';
import { Trans } from '@lingui/macro';
import MemoryIcon from '@material-ui/icons/Memory';
import CompactToggleButtons from '../UI/CompactToggleButtons';
import PreferencesContext from '../MainFrame/Preferences/PreferencesContext';

/**
 * Toggle the 3D rendering backend used by the in-game scene editor and new
 * previews. WebGPU is experimental: the runtime falls back to WebGL when the
 * browser cannot create a WebGPU device.
 */
const ThreeBackendToggle = (): React.MixedElement => {
  const { values, setThreeBackend } = React.useContext(PreferencesContext);
  const isWebGPU = values.threeBackend === 'webgpu';

  return (
    <CompactToggleButtons
      id="three-renderer-toggle"
      noSeparator
      buttons={[
        {
          id: 'three-renderer-toggle-button',
          renderIcon: className => <MemoryIcon className={className} />,
          tooltip: isWebGPU ? (
            <Trans>
              3D renderer: WebGPU (experimental). Click to switch to WebGL.
            </Trans>
          ) : (
            <Trans>
              3D renderer: WebGL. Click to switch to WebGPU (experimental).
            </Trans>
          ),
          label: isWebGPU ? 'WebGPU' : 'WebGL',
          onClick: () => setThreeBackend(isWebGPU ? 'webgl' : 'webgpu'),
          isActive: isWebGPU,
        },
      ]}
    />
  );
};

export default ThreeBackendToggle;
