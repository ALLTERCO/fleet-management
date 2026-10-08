import {formatNumber} from './format';

const WATTS_OPTIONS: Intl.NumberFormatOptions = {maximumSignificantDigits: 2};

export function formatWatts(watts: number) {
    if (Math.abs(watts) >= 1000) {
        return `${formatNumber(watts / 1000, WATTS_OPTIONS)} kW`;
    }

    return `${formatNumber(watts, WATTS_OPTIONS)} W`;
}
