/**
 * Shared helpers for dashboard pages.
 *
 * classifyDeviceType — maps the Shelly `app` string to a broad device
 * category used in fleet summary breakdowns.
 *
 * formatUptime — converts a raw uptime in seconds to a compact
 * human-readable string (e.g. "2d 3h", "45m", "30s").
 */

/** Classify device type from the Shelly `app` string */
export function classifyDeviceType(app: string): string {
    const lower = app.toLowerCase();
    if (lower.includes('pro3em') || lower.includes('proem-50')) return '3ph_em';
    if (lower.includes('em') || lower.includes('proem')) return 'mono_em';
    if (lower.includes('pm') || lower.includes('plug')) return 'pm';
    if (
        lower.includes('ht') ||
        lower.includes('motion') ||
        lower.includes('door') ||
        lower.includes('flood')
    )
        return 'sensor';
    return 'switch';
}

/** Format uptime seconds to a compact human-readable string */
export function formatUptime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${h}h ${m}m`;
    }
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    return `${d}d ${h}h`;
}
