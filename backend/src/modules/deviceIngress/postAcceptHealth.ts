// Post-accept sanity check: after a device is admitted, confirm it came up OK
// — it reported status, built at least one component, and no component carries
// an error. Pure — the flow flags an unhealthy result, it doesn't fail admit.

export interface DeviceHealth {
    ok: boolean;
    issues: string[];
}

export function assessDeviceHealth(
    status: Record<string, unknown> | undefined,
    entityCount: number
): DeviceHealth {
    const issues: string[] = [];
    if (entityCount === 0) issues.push('no components');
    if (!status || Object.keys(status).length === 0) issues.push('no status');
    for (const [key, value] of Object.entries(status ?? {})) {
        const errors = (value as {errors?: unknown} | null)?.errors;
        if (Array.isArray(errors) && errors.length > 0) {
            issues.push(`${key}: ${errors.join(',')}`);
        }
    }
    return {ok: issues.length === 0, issues};
}
