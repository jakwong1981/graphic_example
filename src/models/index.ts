import { car } from './car';
import { hkTaxi } from './hk-taxi';
import { building } from './building';
import { ship } from './ship';
import { airplane } from './airplane';
import { ModelDef } from './types';

export const MODELS: ModelDef[] = [car, hkTaxi, building, ship, airplane];
export type { ModelDef };
