// In-memory mirror of fm.energy_classification for the classifier's tier-1
// lookup. Loaded lazily on first miss per (device, componentKey); invalidated
// by upsert/delete. Separate from energyClassifierCache (tier 3/4, config-
// derived) — this one caches what the operator declared.

import type {EnergyClassificationRow} from '../types/api/energy';
import {NullableDeviceCache} from './util/nullableDeviceCache';

export interface ClassificationOverride {
    tag: string;
    domain: string;
    channel: number;
}

export class EnergyOverrideCache extends NullableDeviceCache<
    number,
    ClassificationOverride
> {
    // Replace a device's overrides wholesale — after a bulk preset apply or a
    // list refresh so stale entries don't linger.
    seedDevice(
        deviceId: number,
        rows: ReadonlyArray<EnergyClassificationRow>
    ): void {
        this.seed(
            deviceId,
            rows.map((r): readonly [string, ClassificationOverride] => [
                r.componentKey,
                {tag: r.tag, domain: r.domain, channel: r.channel}
            ])
        );
    }
}

export const energyOverrideCache = new EnergyOverrideCache();
