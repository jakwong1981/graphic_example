import { Painter, Region } from './atlas';
import { ModelMesh } from './builder';

export interface ModelDef {
  id: string;
  label: string;
  paint: string; // default paint color
  cameraDistance: number;
  regions: Record<string, Region>;
  painters: Record<string, Painter>;
  build(): ModelMesh;
}
