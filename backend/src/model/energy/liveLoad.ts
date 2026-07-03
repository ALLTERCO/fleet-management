// Sum of live active power (W) across online metered components. Shared by the
// fleet summary + map so both report the same number. Gross load: an exporting
// channel (negative power) must not subtract from what the rest is drawing.
// Channel extraction + the field->power mapping live in livePowerChannels.

import type AbstractDevice from '../AbstractDevice';
import {devicePowerChannels} from './livePowerChannels';

export function sumLiveLoad(devices: readonly AbstractDevice[]): number {
    let total = 0;
    for (const dev of devices) {
        for (const channel of devicePowerChannels(dev)) {
            if (channel.watts > 0) total += channel.watts;
        }
    }
    return total;
}
