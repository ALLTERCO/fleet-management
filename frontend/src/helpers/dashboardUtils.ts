/**
 * Shared helpers for dashboard pages.
 *
 * classifyDeviceType — maps the Shelly `app` string to a broad device
 * category used in fleet summary breakdowns.
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
