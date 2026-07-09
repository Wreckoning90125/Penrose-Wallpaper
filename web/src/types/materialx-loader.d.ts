import type { MeshPhysicalNodeMaterial } from 'three/webgpu';

declare module 'three/examples/jsm/loaders/MaterialXLoader.js' {
  interface MaterialXLoader {
    parse(text: string): {
      materials: Record<string, MeshPhysicalNodeMaterial>;
    };
  }
}
