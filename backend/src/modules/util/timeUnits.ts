// Pure time-unit constants. Domain policies (TTLs, ranges, windows) keep
// their own named constants — these are only the units they multiply.
export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = 24 * 60;
