// PV summary section: generation, self-consumption, export, grid import, and
// true house consumption per the configured PV mode.

import {
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';
import type {PvEnergyResult, PvMode} from './pvEnergy';

const SECTION = 'PV SUMMARY';

const MODE_LABEL: Record<PvMode, string> = {
    parallel: 'Parallel (grid-tied)',
    backup: 'Backup',
    balcony: 'Balcony PV'
};

function pvRow(
    label: string,
    kWh: number | '',
    notes: string
): EnergyReportRow {
    return energyRow({
        section: SECTION,
        device: label,
        consumption_kwh: kWh,
        notes
    });
}

// Renders the section; returns false when there is nothing measured.
export function appendPvSection(req: {
    rows: EnergyReportRow[];
    mode: PvMode;
    result: PvEnergyResult;
}): boolean {
    const r = req.result;
    if (r.pvGenerationKWh <= 0 && r.gridImportKWh <= 0) return false;
    req.rows.push(pvRow('PV mode', '', MODE_LABEL[req.mode]));
    req.rows.push(
        pvRow(
            'PV generation',
            r.pvGenerationKWh,
            `${r.selfConsumptionRatePct}% self-consumed`
        )
    );
    req.rows.push(pvRow('Self-consumed', r.selfConsumedKWh, ''));
    if (req.mode !== 'balcony') {
        req.rows.push(pvRow('Exported', r.exportedKWh, ''));
    }
    req.rows.push(pvRow('Grid import', r.gridImportKWh, ''));
    req.rows.push(
        pvRow(
            'House consumption',
            r.houseConsumptionKWh,
            `${r.selfSufficiencyRatePct}% from PV`
        )
    );
    // The headline "Total consumption" sums every meter, so it differs from
    // this PV-adjusted house figure — make that explicit rather than confusing.
    req.rows.push(
        pvRow(
            '',
            '',
            'House = grid + PV − export; differs from Total consumption (all meters)'
        )
    );
    req.rows.push({...energyRowBlank()});
    return true;
}
