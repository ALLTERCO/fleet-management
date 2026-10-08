import type {DeviceProfile} from '../types';
import {makeProfile, smokeComponents} from './shared';

// Gen2 "Plus" line. The catalog is otherwise Gen3/Gen4/Pro, because those are
// the lines a new install buys; a Plus device earns a profile only when the
// component it carries exists nowhere else. Shelly Plus Smoke is the only
// device page in the whole Gen2+ API that lists the Smoke component, so a fleet
// without it can never report a fire.
const DOC_ROOT = 'https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen2';

export const PLUS_PROFILES: readonly DeviceProfile[] = Object.freeze([
    makeProfile({
        identity: {
            key: 'shelly-plus-smoke',
            displayName: 'Shelly Plus Smoke',
            idPrefix: 'shellyplussmoke',
            macPrefix: 'A2030100',
            // Model code for the shellyplussmoke prefix, from the backend's own
            // prefix catalog (backend/src/config/shellyIdPrefixModels.ts).
            model: 'SNSN-0031Z',
            gen: 2,
            app: 'PlusSmoke',
            sourceUrl: `${DOC_ROOT}/ShellyPlusSmoke/`
        },
        components: smokeComponents()
    })
]);
