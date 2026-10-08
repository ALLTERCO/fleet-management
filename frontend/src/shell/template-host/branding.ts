// Branding on the Fleet transport, reads only: templates show it, never set it.

import {hostRpcAccess} from './api';
import {
    createBrandingDomain,
    createBrandingReadView
} from './core/domains/branding';

export const branding = createBrandingReadView(
    createBrandingDomain(hostRpcAccess)
);
