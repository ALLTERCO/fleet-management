// One home for turning a number into locale-aware display text. Report cells
// (model/report/semanticTypes), anomaly sentences and the PDF truncation note
// all write their digits through here, so a figure reads the same everywhere.
// Deliberately dependency-free: importing it must never drag metrics or config
// into a pure module.

/** Used when the organization has no region of its own, and as the retry
 *  locale for prose that must not lose its number. */
export const DEFAULT_LOCALE = 'en-US';

/** Bare number, no unit. Throws on a locale Intl rejects — a table cell
 *  degrades that to empty, prose retries below. */
export function formatDecimal(
    value: number,
    locale: string,
    options: Intl.NumberFormatOptions
): string {
    return new Intl.NumberFormat(locale, options).format(value);
}

/** A sentence cannot drop its number the way a cell can go blank, so an
 *  unusable locale falls back instead of throwing the render. */
export function formatProseNumber(
    value: number,
    locale: string,
    options: Intl.NumberFormatOptions
): string {
    try {
        return formatDecimal(value, locale, options);
    } catch {
        return formatDecimal(value, DEFAULT_LOCALE, options);
    }
}
