// Back-compat shim — keeps the original named exports so callers
// already using `publishOrg`/`onAnyOrg` don't break. New code should
// import {orgSignals} from './services' and call .publish / .onAny.

import type {OrgSignal} from './ports';
import {orgSignals} from './services';

export type {OrgSignal} from './ports';

export const publishOrg = (signal: Omit<OrgSignal, 'instanceId'>) =>
    orgSignals.publish(signal);

export const onAnyOrg = (handler: (signal: OrgSignal) => void) =>
    orgSignals.onAny(handler);
