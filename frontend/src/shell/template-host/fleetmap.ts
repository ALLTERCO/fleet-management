// Map pins on the Fleet transport, so no template builds pins from devices.

import {hostRpcAccess} from './api';
import {createFleetMapDomain} from './core/domains/fleetmap';

export const fleetmap = createFleetMapDomain(hostRpcAccess);
