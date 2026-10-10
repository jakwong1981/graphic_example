import { car } from './car';
import { hkTaxi } from './hk-taxi';
import { kmbBus } from './kmb-bus';
import { building } from './building';
import { ship } from './ship';
import { airplane } from './airplane';
import { ModelDef } from './types';

export const MODELS: ModelDef[] = [car, hkTaxi, kmbBus, building, ship, airplane];
export type { ModelDef };
