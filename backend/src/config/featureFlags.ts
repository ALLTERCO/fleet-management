/**
 * Per-component feature flags — read at startup so ops can disable a
 * misbehaving namespace without a code deploy.
 *
 * Usage from `app.ts`:
 *   if (isComponentEnabled('schedule')) {
 *       Commander.registerComponent(new ScheduleComponent());
 *   }
 *
 * Env var convention: `FM_COMPONENT_<NAME_UPPER>`. Default ON when unset.
 * Accepted "off" values (case-insensitive): `0`, `false`, `off`, `no`.
 */

const OFF_VALUES = new Set(['0', 'false', 'off', 'no']);

export function isComponentEnabled(name: string): boolean {
    const key = `FM_COMPONENT_${name.toUpperCase()}`;
    const raw = process.env[key];
    if (raw === undefined) return true;
    return !OFF_VALUES.has(raw.trim().toLowerCase());
}
