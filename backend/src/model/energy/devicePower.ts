/**
 * Which energy tags are a DEVICE total rather than a per-phase mean.
 *
 * `fn_report_stats` sends power to the same `ELSE AVG(...)` branch as voltage,
 * current and power factor. Averaging is right for those and wrong for power:
 * a three-phase meter reads about a third of its load. These tags route to the
 * device-power ladder (`device_em.fn_device_power_avg`, migration 20046)
 * instead; every other tag keeps the generic reader untouched.
 */

/** Per-phase tag -> the meter's own device total, the ladder's fallback. */
export const DEVICE_POWER_TAG_PAIRS: Readonly<Record<string, string>> =
    Object.freeze({
        power: 'total_power',
        apparent_power: 'total_apparent_power'
    });

/** The only domain the ladder reads; any other domain stays on the generic reader. */
export const DEVICE_POWER_DOMAIN = 'ac_mains';

export interface DevicePowerRouting {
    readonly tags: readonly string[];
    /** Undefined means "every commodity", which still includes AC mains. */
    readonly commodity?: string;
    readonly electricalSource?: string;
    readonly bucket: string;
}

/**
 * The requested tags the device-power ladder answers. Empty means the caller
 * reads exactly what it read before.
 */
export function devicePowerTags(request: DevicePowerRouting): string[] {
    // The repository selects the raw or rollup implementation by bucket. Both
    // share the same coincident device-total rule and AC-mains scope.
    if (
        request.commodity !== undefined &&
        request.commodity !== 'electricity'
    ) {
        return [];
    }
    if (
        request.electricalSource !== undefined &&
        request.electricalSource !== DEVICE_POWER_DOMAIN
    ) {
        return [];
    }
    return request.tags.filter((tag) => tag in DEVICE_POWER_TAG_PAIRS);
}
