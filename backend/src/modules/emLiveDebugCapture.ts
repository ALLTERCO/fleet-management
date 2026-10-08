// The switch lives in the database so every process sees it; frames never reach device_em.stats.

import * as log4js from 'log4js';
import {hasDeviceRecordedHistory} from './energyClassifier';
import * as Observability from './Observability';
import * as PostgresProvider from './PostgresProvider';

const logger = log4js.getLogger('em-live-debug');
const REFRESH_INTERVAL_MS = 15_000;
const FLUSH_INTERVAL_MS = 5_000;

export type EmLiveDebugCallDb = (
    method: string,
    params: Record<string, unknown>
) => Promise<{rows: unknown[]} | undefined>;

export interface EmLiveDebugDeps {
    callDb: EmLiveDebugCallDb;
    nowMs?: () => number;
}

export interface EmLiveDebugValue {
    deviceId: number;
    componentKey: string;
    fieldName: string;
    value: number;
    ts: number;
}

export interface EmLiveDebugFrame {
    id: number;
    ts: string;
    component: string;
    field: string;
    value: number;
}

interface CaptureRow {
    device: number;
    expires_at: string | Date | null;
}

interface FrameRow {
    id: string | number;
    ts: string | Date;
    component: string;
    field: string;
    val: number;
}

interface FrameBuffer {
    p_device: number[];
    p_ts: number[];
    p_component: string[];
    p_field: string[];
    p_val: number[];
}

function emptyBuffer(): FrameBuffer {
    return {p_device: [], p_ts: [], p_component: [], p_field: [], p_val: []};
}

function expiryMs(value: string | Date | null): number | null {
    return value === null ? null : new Date(value).getTime();
}

export class EmLiveDebugCapture {
    // One process holds at most this many unsent values; more are dropped.
    static readonly BUFFER_MAX_ROWS = 20_000;

    readonly #deps: EmLiveDebugDeps;
    #activeUntil = new Map<number, number>();
    #buffer = emptyBuffer();
    // Starts and stops made while a refresh reads, so its older read cannot undo them.
    #setsDuringRefresh: Map<number, number | null> | null = null;
    #refreshTimer: ReturnType<typeof setInterval> | undefined;
    #flushTimer: ReturnType<typeof setInterval> | undefined;

    constructor(deps: EmLiveDebugDeps) {
        this.#deps = deps;
    }

    #now(): number {
        return this.#deps.nowMs?.() ?? Date.now();
    }

    #isCapturing(deviceId: number): boolean {
        const until = this.#activeUntil.get(deviceId);
        return until !== undefined && until > this.#now();
    }

    record(input: EmLiveDebugValue): void {
        if (!hasDeviceRecordedHistory(input.componentKey)) return;
        if (!this.#isCapturing(input.deviceId)) return;
        if (
            this.#buffer.p_device.length >= EmLiveDebugCapture.BUFFER_MAX_ROWS
        ) {
            Observability.incrementCounter('em_live_debug_values_dropped');
            return;
        }
        this.#buffer.p_device.push(input.deviceId);
        this.#buffer.p_ts.push(Math.trunc(input.ts));
        this.#buffer.p_component.push(input.componentKey);
        this.#buffer.p_field.push(input.fieldName);
        this.#buffer.p_val.push(input.value);
    }

    /** Sends the buffered values; returns how many were sent. */
    async flush(): Promise<number> {
        const batch = this.#buffer;
        if (batch.p_device.length === 0) return 0;
        this.#buffer = emptyBuffer();
        await this.#deps.callDb('device_em.fn_live_debug_append', {...batch});
        return batch.p_device.length;
    }

    async refresh(): Promise<void> {
        this.#setsDuringRefresh = new Map();
        try {
            const result = await this.#deps.callDb(
                'device_em.fn_live_debug_active',
                {}
            );
            const next = new Map<number, number>();
            for (const row of (result?.rows ?? []) as CaptureRow[]) {
                const until = expiryMs(row.expires_at);
                if (until !== null) next.set(Number(row.device), until);
            }
            for (const [device, until] of this.#setsDuringRefresh) {
                if (until === null) next.delete(device);
                else next.set(device, until);
            }
            this.#activeUntil = next;
        } finally {
            this.#setsDuringRefresh = null;
        }
    }

    /** hours = 0 stops the capture and deletes what it captured. */
    async set(input: {
        organizationId: string;
        shellyId: string;
        hours: number;
        userId?: string;
    }): Promise<{until: string | null}> {
        const result = await this.#deps.callDb('device_em.fn_live_debug_set', {
            p_organization_id: input.organizationId,
            p_shelly_id: input.shellyId,
            p_hours: input.hours,
            p_user_id: input.userId ?? null
        });
        const row = result?.rows?.[0] as CaptureRow | undefined;
        if (!row) return {until: null};
        const until = expiryMs(row.expires_at);
        this.#remember(Number(row.device), until);
        return {until: until === null ? null : new Date(until).toISOString()};
    }

    #remember(device: number, until: number | null): void {
        this.#setsDuringRefresh?.set(device, until);
        if (until === null) this.#activeUntil.delete(device);
        else this.#activeUntil.set(device, until);
    }

    async read(input: {
        organizationId: string;
        shellyId: string;
        after: number;
        limit: number;
    }): Promise<{
        until: string | null;
        frames: EmLiveDebugFrame[];
        hasMore: boolean;
    } | null> {
        const found = await this.#deps.callDb('device_em.fn_live_debug_get', {
            p_organization_id: input.organizationId,
            p_shelly_id: input.shellyId
        });
        const capture = found?.rows?.[0] as CaptureRow | undefined;
        if (!capture) return null;
        const result = await this.#deps.callDb('device_em.fn_live_debug_read', {
            p_organization_id: input.organizationId,
            p_device: capture.device,
            p_after_id: input.after,
            p_limit: input.limit + 1
        });
        const rows = (result?.rows ?? []) as FrameRow[];
        const until = expiryMs(capture.expires_at);
        return {
            until: until === null ? null : new Date(until).toISOString(),
            frames: rows.slice(0, input.limit).map((row) => ({
                id: Number(row.id),
                ts: new Date(row.ts).toISOString(),
                component: row.component,
                field: row.field,
                value: row.val
            })),
            hasMore: rows.length > input.limit
        };
    }

    start(): void {
        if (this.#refreshTimer) return;
        void this.#runSafely('refresh', () => this.refresh());
        this.#refreshTimer = setInterval(
            () => void this.#runSafely('refresh', () => this.refresh()),
            REFRESH_INTERVAL_MS
        );
        this.#flushTimer = setInterval(
            () => void this.#runSafely('flush', () => this.flush()),
            FLUSH_INTERVAL_MS
        );
        this.#refreshTimer.unref?.();
        this.#flushTimer.unref?.();
    }

    async stop(): Promise<void> {
        clearInterval(this.#refreshTimer);
        clearInterval(this.#flushTimer);
        this.#refreshTimer = undefined;
        this.#flushTimer = undefined;
        await this.#runSafely('flush', () => this.flush());
    }

    // Best effort: a failed debug write is counted and logged, never thrown into the live path.
    async #runSafely(
        step: 'refresh' | 'flush',
        run: () => Promise<unknown>
    ): Promise<void> {
        try {
            await run();
        } catch (error) {
            Observability.incrementCounter('em_live_debug_errors');
            logger.warn(
                'em live debug %s failed: %s',
                step,
                error instanceof Error ? error.message : String(error)
            );
        }
    }
}

export const emLiveDebugCapture = new EmLiveDebugCapture({
    callDb: (method, params) => PostgresProvider.callMethod(method, params)
});
