// Back-compat shim. Append delegates through the deviceIngest port;
// lane helpers re-export from the shared registry (used by the
// Redis-only drainer).

import {
    getLane,
    laneCount,
    laneIndexFor,
    resetLaneRegistryForTests
} from '../redis/ports.shared';
import {deviceIngest} from '../redis/services';

export const appendDeviceFrame = (
    shellyID: string,
    fields: Record<string, string>
) => deviceIngest.appendFrame(shellyID, fields);

export {getLane, laneCount};

export const _laneIndexForTesting = laneIndexFor;

export const resetForTests = resetLaneRegistryForTests;
