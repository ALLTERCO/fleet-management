/**
 * Cron timespec composers — pure helpers extracted so tests can import
 * them without pulling the log4js / Registry / config graph that lives
 * in component files.
 */

/**
 * BluTrv-style 6-field cron: "second minute hour dom month dow".
 * Days are integers 0-6 where 0=Sunday; empty or seven-day lists collapse
 * to `*`. Rejects out-of-range hour/minute and invalid day entries.
 */
export function composeTrvTimespec(
    hour: number,
    minute: number,
    days?: number[]
): string {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        throw new Error('hour must be an integer 0-23');
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
        throw new Error('minute must be an integer 0-59');
    }
    let dow = '*';
    if (Array.isArray(days) && days.length > 0) {
        for (const d of days) {
            if (!Number.isInteger(d) || d < 0 || d > 6) {
                throw new Error('days must be integers 0-6 (Sunday=0)');
            }
        }
        const unique = Array.from(new Set(days)).sort((a, b) => a - b);
        if (unique.length < 7) {
            dow = unique.join(',');
        }
    }
    return `0 ${minute} ${hour} * * ${dow}`;
}
