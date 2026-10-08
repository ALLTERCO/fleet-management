import {getLogger} from 'log4js';
import type {OperationJobKind} from '../../types/api/job';
import * as Observability from '../Observability';
import type {CounterName} from '../observability/counters';
import * as PostgresProvider from '../PostgresProvider';
import {
    startJournalDebugRefresh,
    stopJournalDebugRefresh
} from './eventJournalDebug';

const logger = getLogger('mcp-event-journal');
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
// Device and resource rows queue per tenant and go to the database in batches:
// a tenant's writes run one at a time on its watermark lock, so one batch per
// tenant at a time keeps order and holds one connection, not one per row.
export const JOURNAL_BATCH_MAX = 200;
export const JOURNAL_MAX_WRITERS = 4;
// Floor of the queue bound; it grows with the devices this process holds,
// so a fleet-wide disconnect and reconnect always fit.
export const JOURNAL_MAX_QUEUED = 20_000;
const JOURNAL_ROWS_PER_DEVICE = 5;
const JOURNAL_RETRY_MAX_MS = 30_000;
// A lost connection or a busy database is retried; an input the database
// rejects is not (SQLSTATE classes 08, 40, 53, 57).
const RETRYABLE_SQLSTATE = /^(08|40|53|57)/;
// The database refused the input (row checks raise P0001, limits 22023), so a
// resource batch is written row by row and only the bad row is lost.
const INVALID_ROW_SQLSTATES = new Set(['22023', 'P0001']);

export type JournalResourceKind = 'device' | 'group' | 'job' | 'job-unit';

export interface JournalRow {
    id: string;
    eventType: string;
    resourceKind: JournalResourceKind;
    resourceId: string;
    jobId?: string;
    deviceIds: string[];
    jobKind?: OperationJobKind;
    userId?: string;
    payload: Record<string, unknown>;
    timestamp: string;
}

export interface ReadJournalPageInput {
    organizationId: string;
    afterId?: string;
    deviceIds?: string[];
    groupIds?: string[];
    jobIds?: string[];
    limit?: number;
}

export interface JournalPage {
    rows: JournalRow[];
    nextAfterId: string;
    highwaterId: string;
    gap: boolean;
    firstAvailableId?: string;
}

interface JournalDbRow {
    id: string | number;
    event_type: string;
    resource_kind: JournalResourceKind;
    resource_id: string;
    job_id: string | null;
    device_ids: string[] | null;
    job_kind: OperationJobKind | null;
    user_id: string | null;
    payload: Record<string, unknown> | null;
    occurred_at: string | Date;
}

interface JournalPageDbRow {
    rows: JournalDbRow[];
    next_after_id: string | number;
    highwater_id: string | number;
    pruned_through_id: string | number;
    first_available_id: string | number;
}

export interface DeviceJournalObservation {
    organizationId: string;
    deviceId: string;
    eventType: string;
    payload?: Record<string, unknown>;
    deduplicationKey?: string;
    userId?: string;
}

export interface ResourceJournalObservation {
    organizationId: string;
    resourceKind: 'device' | 'group';
    resourceId: string;
    eventType: string;
    payload?: Record<string, unknown>;
    deduplicationKey?: string;
    userId?: string;
}

type QueuedJournalRow =
    | {kind: 'device'; row: DeviceJournalObservation}
    | {kind: 'resource'; row: ResourceJournalObservation};
type QueuedRowKind = QueuedJournalRow['kind'];
type RowOf<K extends QueuedRowKind> = Extract<
    QueuedJournalRow,
    {kind: K}
>['row'];

interface BatchWriter<K extends QueuedRowKind> {
    method: string;
    params(organizationId: string, rows: RowOf<K>[]): Record<string, unknown>;
    droppedCounter: CounterName;
    label: string;
    writesRowByRowWhenRefused: boolean;
}

const BATCH_WRITERS: {[K in QueuedRowKind]: BatchWriter<K>} = {
    device: {
        method: 'fm.fn_event_journal_append_device_batch',
        params: (organizationId, rows) => ({
            p_organization_id: organizationId,
            p_device_ids: rows.map((row) => row.deviceId),
            p_event_types: rows.map((row) => row.eventType),
            p_user_ids: rows.map((row) => row.userId ?? null),
            p_payloads: rows.map((row) => row.payload ?? {})
        }),
        droppedCounter: 'mcp_event_journal_device_capture_dropped',
        label: 'device',
        writesRowByRowWhenRefused: false
    },
    resource: {
        method: 'fm.fn_event_journal_append_resource_batch',
        params: (organizationId, rows) => ({
            p_organization_id: organizationId,
            p_resource_kinds: rows.map((row) => row.resourceKind),
            p_resource_ids: rows.map((row) => row.resourceId),
            p_event_types: rows.map((row) => row.eventType),
            p_user_ids: rows.map((row) => row.userId ?? null),
            p_payloads: rows.map((row) => row.payload ?? {}),
            p_deduplication_keys: rows.map(
                (row) => row.deduplicationKey ?? null
            )
        }),
        droppedCounter: 'mcp_event_journal_resource_capture_dropped',
        label: 'resource',
        writesRowByRowWhenRefused: true
    }
};

type CallMethod = typeof PostgresProvider.callMethod;
let retentionTimer: ReturnType<typeof setInterval> | undefined;
let started = false;
let activePrune: Promise<void> | undefined;
const queuedByOrganization = new Map<string, QueuedJournalRow[]>();
const writingOrganizations = new Set<string>();
let queuedRows = 0;
let writersScheduled = false;
let retryBaseMs = 1_000;
let connectedDevices: () => number = () => 0;
let stopping = false;
let wakeRetries: () => void = () => {};
let retryWake = new Promise<void>((resolve) => {
    wakeRetries = resolve;
});
let drainIdle: Promise<void> = Promise.resolve();
let resolveDrainIdle: (() => void) | undefined;

function boundedLimit(value: number | undefined): number {
    if (value === undefined) return DEFAULT_LIMIT;
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
        throw new RangeError(
            `event journal limit must be between 1 and ${MAX_LIMIT}`
        );
    }
    return value;
}

function decimalId(
    value: string | undefined,
    name: string
): string | undefined {
    if (value === undefined) return undefined;
    if (!/^(0|[1-9]\d{0,19})$/.test(value)) {
        throw new TypeError(`${name} must be a decimal event ID`);
    }
    return value;
}

function boundedIds(
    values: string[] | undefined,
    name: string
): string[] | undefined {
    if (values === undefined) return undefined;
    if (
        values.length > 200 ||
        values.some((value) => !value || value.length > 160)
    ) {
        throw new RangeError(`${name} exceeds event journal filter limits`);
    }
    return [...new Set(values)];
}

function mapRow(row: JournalDbRow): JournalRow {
    return {
        id: String(row.id),
        eventType: row.event_type,
        resourceKind: row.resource_kind,
        resourceId: row.resource_id,
        ...(row.job_id ? {jobId: row.job_id} : {}),
        deviceIds: row.device_ids ?? [],
        ...(row.job_kind ? {jobKind: row.job_kind} : {}),
        ...(row.user_id ? {userId: row.user_id} : {}),
        payload: row.payload ?? {},
        timestamp:
            row.occurred_at instanceof Date
                ? row.occurred_at.toISOString()
                : new Date(row.occurred_at).toISOString()
    };
}

export function createEventJournal(
    callMethod: CallMethod = PostgresProvider.callMethod
) {
    return {
        async readJournalPage(
            input: ReadJournalPageInput
        ): Promise<JournalPage> {
            if (!input.organizationId || input.organizationId.length > 160) {
                throw new TypeError('organizationId is required');
            }
            const afterId = decimalId(input.afterId, 'afterId');
            const result = await callMethod('fm.fn_event_journal_read_scoped', {
                p_organization_id: input.organizationId,
                p_after_id: afterId ?? null,
                p_device_ids: boundedIds(input.deviceIds, 'deviceIds') ?? null,
                p_group_ids: boundedIds(input.groupIds, 'groupIds') ?? null,
                p_job_ids: boundedIds(input.jobIds, 'jobIds') ?? null,
                p_limit: boundedLimit(input.limit)
            });
            const page = (result?.rows?.[0] ?? {
                rows: [],
                next_after_id: afterId ?? '0',
                highwater_id: '0',
                pruned_through_id: '0',
                first_available_id: '1'
            }) as JournalPageDbRow;
            const dbRows = page.rows ?? [];
            const rows = dbRows.map(mapRow);
            const highwaterId = String(page.highwater_id);
            const prunedThroughId = String(page.pruned_through_id);
            const historyGap =
                afterId !== undefined &&
                BigInt(afterId) < BigInt(prunedThroughId);
            return {
                rows,
                nextAfterId: String(page.next_after_id),
                highwaterId,
                gap: historyGap,
                ...(historyGap
                    ? {firstAvailableId: String(page.first_available_id)}
                    : {})
            };
        },

        async recordDeviceObservation(
            input: DeviceJournalObservation
        ): Promise<string | undefined> {
            if (!input.organizationId || !input.deviceId || !input.eventType) {
                throw new TypeError(
                    'organizationId, deviceId and eventType are required'
                );
            }
            const result = await callMethod(
                'fm.fn_event_journal_append_device',
                {
                    p_organization_id: input.organizationId,
                    p_device_id: input.deviceId,
                    p_event_type: input.eventType,
                    p_user_id: input.userId ?? null,
                    p_payload: input.payload ?? {},
                    p_deduplication_key: input.deduplicationKey ?? null
                }
            );
            const value = result?.rows?.[0];
            if (!value) return undefined;
            const id = Object.values(value)[0];
            return id === null || id === undefined ? undefined : String(id);
        },

        async recordResourceObservation(
            input: ResourceJournalObservation
        ): Promise<string | undefined> {
            if (
                !input.organizationId ||
                !input.resourceId ||
                !input.eventType
            ) {
                throw new TypeError(
                    'organizationId, resourceId and eventType are required'
                );
            }
            const result = await callMethod(
                'fm.fn_event_journal_append_resource',
                {
                    p_organization_id: input.organizationId,
                    p_resource_kind: input.resourceKind,
                    p_resource_id: input.resourceId,
                    p_event_type: input.eventType,
                    p_user_id: input.userId ?? null,
                    p_payload: input.payload ?? {},
                    p_deduplication_key: input.deduplicationKey ?? null
                }
            );
            const value = result?.rows?.[0];
            if (!value) return undefined;
            const id = Object.values(value)[0];
            return id === null || id === undefined ? undefined : String(id);
        },

        async prune(): Promise<void> {
            await callMethod('fm.fn_event_journal_prune', {});
        }
    };
}

const eventJournal = createEventJournal();
export const readJournalPage = eventJournal.readJournalPage;
export const recordDeviceObservation = eventJournal.recordDeviceObservation;

export function journalQueueBound(devices: number): number {
    return Math.max(JOURNAL_MAX_QUEUED, devices * JOURNAL_ROWS_PER_DEVICE);
}

// Queues one device row; never waits for the database. False when shed.
export function enqueueDeviceObservation(
    input: DeviceJournalObservation
): boolean {
    return enqueueRow(input.organizationId, {kind: 'device', row: input});
}

// Queues one inventory or group lifecycle row; never waits for the database.
// False when shed.
export function enqueueResourceObservation(
    input: ResourceJournalObservation
): boolean {
    return enqueueRow(input.organizationId, {kind: 'resource', row: input});
}

function enqueueRow(organizationId: string, entry: QueuedJournalRow): boolean {
    if (
        queuedRows >= JOURNAL_MAX_QUEUED &&
        queuedRows >= journalQueueBound(connectedDevices())
    ) {
        Observability.incrementCounter('mcp_event_journal_capture_shed');
        return false;
    }
    const queue = queuedByOrganization.get(organizationId);
    if (queue) queue.push(entry);
    else queuedByOrganization.set(organizationId, [entry]);
    queuedRows += 1;
    if (!resolveDrainIdle) {
        drainIdle = new Promise((resolve) => {
            resolveDrainIdle = resolve;
        });
    }
    if (!writersScheduled) {
        // Rows queued in the same tick go out together.
        writersScheduled = true;
        queueMicrotask(() => {
            writersScheduled = false;
            startWriters();
        });
    }
    return true;
}

function startWriters(): void {
    for (const organizationId of queuedByOrganization.keys()) {
        if (writingOrganizations.size >= JOURNAL_MAX_WRITERS) return;
        if (writingOrganizations.has(organizationId)) continue;
        writingOrganizations.add(organizationId);
        void writeTenant(organizationId);
    }
}

async function writeTenant(organizationId: string): Promise<void> {
    let attempt = 0;
    for (;;) {
        const queue = queuedByOrganization.get(organizationId);
        if (!queue || queue.length === 0) break;
        const batch = queue.splice(0, JOURNAL_BATCH_MAX);
        queuedRows -= batch.length;
        if (queue.length === 0) queuedByOrganization.delete(organizationId);
        const unwritten = await writeBatch(organizationId, batch);
        if (unwritten.length === 0) {
            attempt = 0;
            continue;
        }
        // Back to the front, so the tenant's order is kept.
        const rest = queuedByOrganization.get(organizationId) ?? [];
        queuedByOrganization.set(organizationId, [...unwritten, ...rest]);
        queuedRows += unwritten.length;
        Observability.incrementCounter('mcp_event_journal_batch_retried');
        attempt += 1;
        await Promise.race([
            new Promise((resolve) =>
                setTimeout(
                    resolve,
                    Math.min(
                        retryBaseMs * 2 ** (attempt - 1),
                        JOURNAL_RETRY_MAX_MS
                    )
                ).unref?.()
            ),
            retryWake
        ]);
    }
    writingOrganizations.delete(organizationId);
    startWriters();
    if (writingOrganizations.size === 0 && queuedRows === 0) {
        resolveDrainIdle?.();
        resolveDrainIdle = undefined;
    }
}

// One call per row kind; order holds within a kind. Returns the rows still to
// write when a call must be retried, so written rows are never written twice.
async function writeBatch(
    organizationId: string,
    batch: QueuedJournalRow[]
): Promise<QueuedJournalRow[]> {
    const groups = groupByKind(batch);
    for (let i = 0; i < groups.length; i += 1) {
        const unwritten = await writeGroup(organizationId, groups[i]);
        if (unwritten.length > 0) {
            return [...unwritten, ...groups.slice(i + 1).flatMap(queuedRowsOf)];
        }
    }
    return [];
}

type KindGroup =
    | {kind: 'device'; rows: DeviceJournalObservation[]}
    | {kind: 'resource'; rows: ResourceJournalObservation[]};

// Kinds go out in the order their first row was queued.
function groupByKind(batch: QueuedJournalRow[]): KindGroup[] {
    const devices: DeviceJournalObservation[] = [];
    const resources: ResourceJournalObservation[] = [];
    const order: QueuedRowKind[] = [];
    for (const entry of batch) {
        if (!order.includes(entry.kind)) order.push(entry.kind);
        if (entry.kind === 'device') devices.push(entry.row);
        else resources.push(entry.row);
    }
    return order.map(
        (kind): KindGroup =>
            kind === 'device' ? {kind, rows: devices} : {kind, rows: resources}
    );
}

function queuedRowsOf(group: KindGroup): QueuedJournalRow[] {
    return group.kind === 'device'
        ? group.rows.map((row) => ({kind: 'device', row}))
        : group.rows.map((row) => ({kind: 'resource', row}));
}

type BatchOutcome = 'written' | 'dropped' | 'retry' | 'refused';

// Returns the rows still to write; empty when every row was written or dropped.
async function writeGroup(
    organizationId: string,
    group: KindGroup
): Promise<QueuedJournalRow[]> {
    if (group.kind === 'device') {
        const outcome = await callBatchWriter(
            organizationId,
            BATCH_WRITERS.device,
            group.rows
        );
        return outcome === 'retry' ? queuedRowsOf(group) : [];
    }
    const outcome = await callBatchWriter(
        organizationId,
        BATCH_WRITERS.resource,
        group.rows
    );
    if (outcome === 'retry') return queuedRowsOf(group);
    if (outcome === 'refused') {
        return writeResourceRowsOneByOne(organizationId, group.rows);
    }
    return [];
}

async function callBatchWriter<K extends QueuedRowKind>(
    organizationId: string,
    writer: BatchWriter<K>,
    rows: RowOf<K>[]
): Promise<BatchOutcome> {
    try {
        await PostgresProvider.callMethod(
            writer.method,
            writer.params(organizationId, rows)
        );
        return 'written';
    } catch (error) {
        return handleBatchFailure(organizationId, writer, rows.length, error);
    }
}

function handleBatchFailure<K extends QueuedRowKind>(
    organizationId: string,
    writer: BatchWriter<K>,
    rowCount: number,
    error: unknown
): Exclude<BatchOutcome, 'written'> {
    const message = errorMessage(error);
    if (isTransientFailure(error)) {
        logger.warn(
            '%s event journal batch will be retried rows=%d org=%s err=%s',
            writer.label,
            rowCount,
            organizationId,
            message
        );
        return 'retry';
    }
    if (writer.writesRowByRowWhenRefused && isRefusedInput(error)) {
        logger.warn(
            '%s event journal batch refused, writing row by row rows=%d org=%s err=%s',
            writer.label,
            rowCount,
            organizationId,
            message
        );
        return 'refused';
    }
    Observability.incrementCounter(writer.droppedCounter, rowCount);
    logger.warn(
        '%s event journal batch failed rows=%d org=%s err=%s',
        writer.label,
        rowCount,
        organizationId,
        message
    );
    return 'dropped';
}

// Stops at a transient failure and returns that row and the rest, so rows
// already written are never written again.
async function writeResourceRowsOneByOne(
    organizationId: string,
    rows: ResourceJournalObservation[]
): Promise<QueuedJournalRow[]> {
    for (let i = 0; i < rows.length; i += 1) {
        if ((await writeResourceRow(organizationId, rows[i])) === 'retry') {
            return rows.slice(i).map((row) => ({kind: 'resource', row}));
        }
    }
    return [];
}

async function writeResourceRow(
    organizationId: string,
    row: ResourceJournalObservation
): Promise<'written' | 'dropped' | 'retry'> {
    try {
        await eventJournal.recordResourceObservation(row);
        return 'written';
    } catch (error) {
        if (isTransientFailure(error)) {
            logger.warn(
                'resource event journal row will be retried org=%s err=%s',
                organizationId,
                errorMessage(error)
            );
            return 'retry';
        }
        Observability.incrementCounter(
            'mcp_event_journal_resource_capture_dropped'
        );
        logger.warn(
            'resource event journal capture failed event=%s kind=%s resource=%s org=%s err=%s',
            row.eventType,
            row.resourceKind,
            row.resourceId,
            organizationId,
            errorMessage(error)
        );
        return 'dropped';
    }
}

// A lost connection or a busy database; a local input error is never retried.
function isTransientFailure(error: unknown): boolean {
    if (stopping || error instanceof TypeError) return false;
    const code = (error as {code?: unknown})?.code;
    return typeof code !== 'string' || RETRYABLE_SQLSTATE.test(code);
}

function isRefusedInput(error: unknown): boolean {
    const code = (error as {code?: unknown})?.code;
    return typeof code === 'string' && INVALID_ROW_SQLSTATES.has(code);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function __setJournalRetryDelayForTests(ms: number | undefined): void {
    retryBaseMs = ms ?? 1_000;
}

// Resolves once every queued row has been written or dropped.
export function flushEventJournal(): Promise<void> {
    return resolveDrainIdle ? drainIdle : Promise.resolve();
}

async function pruneBestEffort(): Promise<void> {
    try {
        await eventJournal.prune();
    } catch (error) {
        Observability.incrementCounter('mcp_event_journal_prune_errors');
        logger.warn(
            'event journal retention failed: %s',
            error instanceof Error ? error.message : String(error)
        );
    }
}

function schedulePrune(): Promise<void> {
    if (activePrune) return activePrune;
    activePrune = pruneBestEffort().finally(() => {
        activePrune = undefined;
    });
    return activePrune;
}

export function startEventJournal(
    options: {connectedDevices?: () => number} = {}
): void {
    started = true;
    if (options.connectedDevices) connectedDevices = options.connectedDevices;
    startJournalDebugRefresh();
    if (retentionTimer) return;
    void schedulePrune();
    retentionTimer = setInterval(
        () => void schedulePrune(),
        RETENTION_INTERVAL_MS
    );
    retentionTimer.unref?.();
}

export async function stopEventJournal(): Promise<void> {
    started = false;
    // Retries stop: rows still failing at shutdown are dropped and counted.
    stopping = true;
    wakeRetries();
    if (retentionTimer) {
        clearInterval(retentionTimer);
        retentionTimer = undefined;
    }
    await Promise.allSettled([
        ...(activePrune ? [activePrune] : []),
        flushEventJournal(),
        stopJournalDebugRefresh()
    ]);
    stopping = false;
    retryWake = new Promise<void>((resolve) => {
        wakeRetries = resolve;
    });
}

export function isEventJournalStarted(): boolean {
    return started;
}
