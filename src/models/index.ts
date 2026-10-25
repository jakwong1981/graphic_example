import { car } from './car';
import { hkTaxi } from './hk-taxi';
import { kmbBus } from './kmb-bus';
import { hkTram } from './hk-tram';
import { building } from './building';
import { ship } from './ship';
import { airplane } from './airplane';
import { ModelDef } from './types';

export const MODELS: ModelDef[] = [car, hkTaxi, kmbBus, hkTram, building, ship, airplane];
export type { ModelDef };
