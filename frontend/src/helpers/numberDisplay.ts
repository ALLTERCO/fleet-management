/** Preserve the numeric value but do not render rounded zero as -0.0. */
export function formatRoundedNumber(value: number, decimals: number): string {
    const rendered = value.toFixed(decimals);
    return Number(rendered) === 0 ? (0).toFixed(decimals) : rendered;
}
