// After-hours section (report engine v2): how much energy a device burns while
// its site is closed. Each hourly reading is classified open/closed by the
// location's operating hours (Phase 13), so the split reflects the real
// schedule, not a flat time ratio. A new section with no v1 equivalent, so it
// carries no row-for-row parity constraint — it only appears when at least one
// in-scope device has operating hours set.

import {isOpenAt, type OperatingHours} from '../../modules/operatingHours';

export interface HourlyReading {
    at: Date;
    kwh: number;
}

export interface AfterHoursInput {
    devices: ReadonlyArray<{
        deviceId: string;
        hourly: ReadonlyArray<HourlyReading>;
        hours: OperatingHours | null;
    }>;
    costPerKwh: number;
}

export interface AfterHoursRow {
    deviceId: string;
    openKwh: number;
    closedKwh: number;
    closedShare: number;
    closedCost: number;
}

export interface AfterHoursSection {
    rows: AfterHoursRow[];
    totalClosedKwh: number;
    totalClosedCost: number;
}

interface Split {
    openKwh: number;
    closedKwh: number;
}

function splitBySchedule(
    hourly: ReadonlyArray<HourlyReading>,
    hours: OperatingHours
): Split {
    const split: Split = {openKwh: 0, closedKwh: 0};
    for (const reading of hourly) {
        if (isOpenAt(hours, reading.at)) split.openKwh += reading.kwh;
        else split.closedKwh += reading.kwh;
    }
    return split;
}

function rowFor(
    device: AfterHoursInput['devices'][number],
    costPerKwh: number
): AfterHoursRow | null {
    if (!device.hours) return null;
    const {openKwh, closedKwh} = splitBySchedule(device.hourly, device.hours);
    const total = openKwh + closedKwh;
    return {
        deviceId: device.deviceId,
        openKwh,
        closedKwh,
        closedShare: total > 0 ? closedKwh / total : 0,
        closedCost: closedKwh * costPerKwh
    };
}

// Null when no in-scope device has operating hours — the section is omitted
// rather than rendered empty.
export function buildAfterHoursSection(
    input: AfterHoursInput
): AfterHoursSection | null {
    const rows = input.devices
        .map((device) => rowFor(device, input.costPerKwh))
        .filter((row): row is AfterHoursRow => row !== null);
    if (rows.length === 0) return null;
    return {
        rows,
        totalClosedKwh: rows.reduce((sum, row) => sum + row.closedKwh, 0),
        totalClosedCost: rows.reduce((sum, row) => sum + row.closedCost, 0)
    };
}
