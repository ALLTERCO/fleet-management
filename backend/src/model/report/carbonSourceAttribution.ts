// Grid-side meters measure imports and exports, not on-site generation or
// self-consumption. Keep those measured directions separate so Scope 2 is
// never reduced by an unsupported generation estimate.

import {computeCarbonAccounting} from './carbonAccounting.js';

export interface CarbonSourceInput {
    readonly totalImportedKWh: number;
    readonly totalExportedKWh: number;
    readonly factorGPerKWh: number;
}

export interface CarbonSourceBreakdown {
    readonly importedKWh: number;
    readonly exportedKWh: number;
    readonly scope2KgCO2: number;
}

const EMPTY: CarbonSourceBreakdown = {
    importedKWh: 0,
    exportedKWh: 0,
    scope2KgCO2: 0
};

export function computeCarbonSourceBreakdown(
    input: CarbonSourceInput
): CarbonSourceBreakdown {
    if (!isValid(input)) return EMPTY;
    const accounted = computeCarbonAccounting({
        quantity: input.totalImportedKWh,
        factor: {
            id: null,
            factorKgPerUnit: input.factorGPerKWh / 1000,
            source: 'deployment_default',
            sourceReference: 'legacy:g-per-kwh',
            revision: null,
            accountingBasis: 'location_based',
            emissionsScope: 'scope2'
        }
    });
    return {
        importedKWh: +input.totalImportedKWh.toFixed(3),
        exportedKWh: +input.totalExportedKWh.toFixed(3),
        scope2KgCO2: +(accounted.scope2KgCO2e ?? 0).toFixed(2)
    };
}

function isValid(input: CarbonSourceInput): boolean {
    if (!Number.isFinite(input.totalImportedKWh) || input.totalImportedKWh < 0)
        return false;
    if (!Number.isFinite(input.totalExportedKWh) || input.totalExportedKWh < 0)
        return false;
    if (!Number.isFinite(input.factorGPerKWh) || input.factorGPerKWh <= 0)
        return false;
    return true;
}
