import * as THREE from 'three';
import { WebGPURenderer as WebGPURendererClass } from 'three/webgpu';

declare global {
  namespace THREE {
    type WebGPURenderer = WebGPURendererClass;
    const WebGPURenderer: typeof WebGPURendererClass;
  }
}

export as namespace THREE;
