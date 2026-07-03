// Batched today/yesterday energy loader. Every card that asks within the
// same tick is coalesced into ONE energy.query for all their devices, so
// opening a dashboard with N switch cards costs one round trip, not N.
// Reads the 1-day rollup (fast, precomputed); no client cache to keep
// fresh — the rollup is the source of truth the reports use too.

import type {EnergyQueryResponse, EnergyQueryRow} from '@api/energy';
import {sendRPC} from './websocket';

export interface DailyEnergy {
    today: number;
    yesterday: number;
}

interface Waiter {
    resolve: (v: DailyEnergy) => void;
    reject: (e: unknown) => void;
}

const pending = new Map<string, Waiter[]>();
let scheduled = false;

// Returns this device's today/yesterday kWh. Calls in the same tick batch.
export function loadDailyEnergy(shellyID: string): Promise<DailyEnergy> {
    return new Promise<DailyEnergy>((resolve, reject) => {
        const waiters = pending.get(shellyID) ?? [];
        waiters.push({resolve, reject});
        pending.set(shellyID, waiters);
        schedule();
    });
}

function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
}

async function flush(): Promise<void> {
    scheduled = false;
    const batch = new Map(pending);
    pending.clear();
    const shellyIDs = [...batch.keys()];
    if (shellyIDs.length === 0) return;
    try {
        const env = await fetchDailyEnergy(shellyIDs);
        const byDevice = splitByDevice(env?.items ?? []);
        for (const [id, waiters] of batch) {
            const value = byDevice.get(id) ?? {today: 0, yesterday: 0};
            for (const w of waiters) w.resolve(value);
        }
    } catch (err) {
        for (const waiters of batch.values()) {
            for (const w of waiters) w.reject(err);
        }
    }
}

function fetchDailyEnergy(shellyIDs: string[]): Promise<EnergyQueryResponse> {
    const {from, to} = dayRange();
    return sendRPC<EnergyQueryResponse>('FLEET_MANAGER', 'energy.query', {
        devices: shellyIDs,
        from,
        to,
        tags: ['total_act_energy'],
        bucket: '1 day',
        perDevice: true
    });
}

// Yesterday-start .. now, UTC. The 1-day rollup is UTC-midnight aligned,
// so a row's UTC day decides whether it is today or yesterday.
function dayRange(): {from: string; to: string} {
    const now = new Date();
    const todayStart = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
    );
    const yesterdayStart = todayStart - 86_400_000;
    return {
        from: new Date(yesterdayStart).toISOString(),
        to: now.toISOString()
    };
}

function splitByDevice(items: EnergyQueryRow[]): Map<string, DailyEnergy> {
    const {todayKey, yesterdayKey} = dayKeys();
    const byDevice = new Map<string, DailyEnergy>();
    for (const row of items) {
        if (!row.shellyID) continue;
        const key = utcDay(row.bucket);
        const cur = byDevice.get(row.shellyID) ?? {today: 0, yesterday: 0};
        if (key === todayKey) cur.today += row.value;
        else if (key === yesterdayKey) cur.yesterday += row.value;
        byDevice.set(row.shellyID, cur);
    }
    return byDevice;
}

function dayKeys(): {todayKey: string; yesterdayKey: string} {
    const now = Date.now();
    return {
        todayKey: utcDay(new Date(now).toISOString()),
        yesterdayKey: utcDay(new Date(now - 86_400_000).toISOString())
    };
}

function utcDay(iso: string): string {
    return new Date(iso).toISOString().slice(0, 10);
}
