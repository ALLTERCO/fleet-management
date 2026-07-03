// Back-compat shim. Callers should migrate to `import {deviceSignals}
// from './services'`.

import type {DeviceSignal} from './ports';
import {deviceSignals} from './services';

export type {DeviceSignal} from './ports';

export const publishDevice = (signal: Omit<DeviceSignal, 'instanceId'>) =>
    deviceSignals.publish(signal);

export const onDevice = (handler: (signal: DeviceSignal) => void) =>
    deviceSignals.on(handler);
