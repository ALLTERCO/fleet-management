// Seeded watering history, replayed from the run model the device itself
// follows. Without it a fresh fleet has no record of any watering, so the Water
// page reports every zone as "did not run" until the next morning run, on a
// controller that has been watering correctly all along.
//
// Same shape as the seeded energy history: the simulator prints, the seed
// loads. One model, replayed — never a second set of times that can drift.
import {
    IRRIGATION_START_UTC_HOUR,
    IRRIGATION_ZONE_RUN_MIN,
    IRRIGATION_ZONE_STAGGER_MIN,
    irrigationZoneRun
} from './scenarios';
import {virtualRoles} from './telemetry';
import type {ExpandedDeviceProfile} from './types';

const SECONDS_PER_DAY = 24 * 3600;
const ZONE_ROLE = /^zone(\d+)$/;

/** One valve transition, as `device_sensor.events` stores it. */
export interface SimulatedWateringEvent {
    externalId: string;
    ts: number;
    kind: 'valve';
    /** Component id of the zone, e.g. 203. */
    channel: number;
    /** 1 opened, 0 closed. */
    state: 0 | 1;
}

/** Zone index -> component id, read off the device's own declared roles so a
 *  controller that numbers its channels differently still replays correctly. */
function zoneChannels(profile: ExpandedDeviceProfile): Map<number, number> {
    const out = new Map<number, number>();
    for (const [key, role] of Object.entries(virtualRoles(profile.config))) {
        const zone = ZONE_ROLE.exec(role);
        const componentId = Number(key.split(':')[1]);
        if (zone && Number.isSafeInteger(componentId)) {
            out.set(Number(zone[1]), componentId);
        }
    }
    return out;
}

/** When zone `zone` started on the UTC day containing `dayTs`. Asked of the run
 *  model rather than recomputed, so the schedule lives in one place. */
function startOfRun(zone: number, dayTs: number): number {
    const probe =
        Math.floor(dayTs / SECONDS_PER_DAY) * SECONDS_PER_DAY +
        IRRIGATION_START_UTC_HOUR * 3600 +
        zone * IRRIGATION_ZONE_STAGGER_MIN * 60;
    return irrigationZoneRun({zone, ts: probe}).startedAt;
}

export function* wateringHistoryRows(input: {
    profiles: readonly ExpandedDeviceProfile[];
    fromTs: number;
    toTs: number;
}): Generator<SimulatedWateringEvent> {
    if (input.fromTs > input.toTs) {
        throw new Error('watering history needs fromTs <= toTs');
    }
    const runSeconds = IRRIGATION_ZONE_RUN_MIN * 60;
    for (const profile of input.profiles) {
        const channels = zoneChannels(profile);
        if (channels.size === 0) continue;
        for (
            let dayTs =
                Math.floor(input.fromTs / SECONDS_PER_DAY) * SECONDS_PER_DAY;
            dayTs <= input.toTs;
            dayTs += SECONDS_PER_DAY
        ) {
            for (const [zone, channel] of channels) {
                const openedAt = startOfRun(zone, dayTs);
                const closedAt = openedAt + runSeconds;
                if (openedAt < input.fromTs || closedAt > input.toTs) continue;
                yield {
                    externalId: profile.shellyID,
                    ts: openedAt,
                    kind: 'valve',
                    channel,
                    state: 1
                };
                yield {
                    externalId: profile.shellyID,
                    ts: closedAt,
                    kind: 'valve',
                    channel,
                    state: 0
                };
            }
        }
    }
}

export function wateringRowTsv(row: SimulatedWateringEvent): string {
    return [row.externalId, row.ts, row.kind, row.channel, row.state].join(
        '\t'
    );
}
