export const numberFormatter = new Intl.NumberFormat('en-US', {
    maximumSignificantDigits: 2
});

export function formatWatts(watts: number) {
    if (Math.abs(watts) >= 1000) {
        return numberFormatter.format(watts / 1000) + ' kW';
    }

    return numberFormatter.format(watts) + ' W';
}
