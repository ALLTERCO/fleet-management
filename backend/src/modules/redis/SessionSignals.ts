// Back-compat shim. Callers should migrate to `import {sessionSignals}
// from './services'`.

import type {SessionSignal} from './ports';
import {sessionSignals} from './services';

export type {SessionSignal} from './ports';

export const publishSession = (signal: Omit<SessionSignal, 'instanceId'>) =>
    sessionSignals.publish(signal);

export const onSession = (handler: (signal: SessionSignal) => void) =>
    sessionSignals.on(handler);
