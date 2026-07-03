// Picks the right hourly-carbon provider. Real-time when API key is set,
// otherwise a flat curve from the org's LBM factor.

import {buildElectricityMapsProvider} from './electricityMapsProvider';
import type {HourlyCarbonProvider} from './hourlyCarbonProvider';
import {buildStaticHourlyCarbonProvider} from './staticHourlyCarbonProvider';

export interface ProviderSelection {
    readonly apiKey: string;
    readonly url: string;
    readonly timeoutMs: number;
    readonly factorGPerKWh: number;
}

export function getHourlyCarbonProvider(
    selection: ProviderSelection
): HourlyCarbonProvider {
    if (selection.apiKey.length > 0) {
        return buildElectricityMapsProvider({
            apiKey: selection.apiKey,
            url: selection.url,
            timeoutMs: selection.timeoutMs
        });
    }
    return buildStaticHourlyCarbonProvider(selection.factorGPerKWh);
}
