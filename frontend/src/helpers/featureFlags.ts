/** Frontend feature-flag registry — single source of truth.
 *
 *  The backend has `FM_COMPONENT_<NAME>` env flags (see
 *  `backend/src/config/featureFlags.ts`). This module mirrors that pattern
 *  for the frontend: every flag is a `boolCfg` constant in constants.ts;
 *  this registry exposes them through a typed lookup so consumers don't
 *  scatter raw `import` statements across the codebase.
 *
 *  Usage:
 *      import {isFeatureEnabled} from '@/helpers/featureFlags';
 *      if (isFeatureEnabled('locationsRedesignV2')) { … } */

import {LOCATIONS_REDESIGN_V2_ENABLED} from '@/constants';

const FLAGS = {
    locationsRedesignV2: LOCATIONS_REDESIGN_V2_ENABLED
} as const;

export type FeatureFlag = keyof typeof FLAGS;

/** Ask whether a feature is enabled. Flag values are resolved at module
 *  load time from runtime config → Vite env → default, in that order. */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
    return FLAGS[flag];
}

/** Read the full registry (useful for diagnostics surfaces).
 *  Returned object is frozen so callers can't accidentally mutate it. */
export function listFeatureFlags(): Readonly<Record<FeatureFlag, boolean>> {
    return Object.freeze({...FLAGS});
}
