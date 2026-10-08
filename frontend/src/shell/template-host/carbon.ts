// Legacy `@host` carbon namespace, bound to the Fleet application transport.

import {hostRpcAccess} from './api';
import {createCarbonDomain} from './core/domains/carbon';

export const carbon = createCarbonDomain(hostRpcAccess);
