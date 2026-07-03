import {tuning} from '../../config/tuning';
import type {
    DeviceIngressRiskLevel,
    DeviceIngressSecurityModel,
    DeviceIngressTransport
} from '../../types/api/deviceIngress';
import type {WaitingRoomListParams} from '../../types/api/waitingroom';
import {
    type DeviceIngressWaitingRoomEntry,
    getWaitingRoom,
    listWaitingRoom
} from '../deviceIngress/deviceIngressRepository';
import {statusFromSafeDetail} from '../deviceIngress/waitingRoomSafeDetail';
import type {WaitingEntry} from '../redis/ports';
import {gatelessDeviceOrg, operatorOwnsGatelessOrg} from './defaultOrg';
import * as WaitingRoomModule from './index';
import {listPending} from './redisWaitingStore';

const DEVICE_INGRESS_KEY_PREFIX = 'deviceIngress:';
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

export interface UnifiedWaitingRoomQuery extends WaitingRoomListParams {
    organizationId: string;
}

export type UnifiedWaitingRoomSource = 'legacy' | 'device_ingress';

export interface UnifiedWaitingRoomEntry extends Record<string, unknown> {
    source: UnifiedWaitingRoomSource;
    waitingRoomKind: UnifiedWaitingRoomSource;
    entryId: string;
    shellyID: string;
    status: unknown;
    sortTime: number;
}

export interface UnifiedWaitingRoomList {
    items: UnifiedWaitingRoomEntry[];
    total: number;
    limit: number;
    offset: number;
}

export interface ParsedWaitingRoomEntryId {
    source: UnifiedWaitingRoomSource;
    id: string;
}

export async function listUnifiedWaitingRoom(
    query: UnifiedWaitingRoomQuery
): Promise<UnifiedWaitingRoomList> {
    const normalized = normalizeQuery(query);
    const items = await matchingItems(normalized);
    const paged = items.slice(
        normalized.offset,
        normalized.offset + normalized.limit
    );
    return {
        items: paged,
        total: items.length,
        limit: normalized.limit,
        offset: normalized.offset
    };
}

// Every open pending entry, unpaged — for accept-all and the full list view.
export async function listAllOpenWaitingRoom(
    organizationId: string
): Promise<UnifiedWaitingRoomEntry[]> {
    return matchingItems(normalizeQuery({organizationId, state: 'open'}));
}

export async function listAllOpenExternalIds(
    organizationId: string
): Promise<string[]> {
    const items = await listAllOpenWaitingRoom(organizationId);
    return items.map((item) => item.shellyID);
}

export async function getUnifiedWaitingRoomEntry(
    query: UnifiedWaitingRoomQuery & {entryId: string}
): Promise<UnifiedWaitingRoomEntry | null> {
    const parsed = parseWaitingRoomEntryId(query.entryId);
    if (parsed.source === 'device_ingress') {
        return getIngressEntry(query.organizationId, parsed.id);
    }
    return getLegacyEntry(query.organizationId, parsed.id);
}

export function parseWaitingRoomEntryId(
    entryId: string
): ParsedWaitingRoomEntryId {
    if (entryId.startsWith(DEVICE_INGRESS_KEY_PREFIX)) {
        return {
            source: 'device_ingress',
            id: entryId.slice(DEVICE_INGRESS_KEY_PREFIX.length)
        };
    }
    return {source: 'legacy', id: entryId};
}

function normalizeQuery(
    query: UnifiedWaitingRoomQuery
): Required<Pick<WaitingRoomListParams, 'limit' | 'offset'>> &
    Omit<UnifiedWaitingRoomQuery, 'limit' | 'offset'> {
    return {
        ...query,
        limit: Math.min(query.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
        offset: query.offset ?? 0
    };
}

async function matchingItems(
    query: ReturnType<typeof normalizeQuery>
): Promise<UnifiedWaitingRoomEntry[]> {
    const [legacy, ingress] = await Promise.all([
        legacyEntries(query),
        ingressEntries(query)
    ]);
    return [...legacy, ...ingress]
        .filter((item) => entryMatches(item, query))
        .sort((a, b) => b.sortTime - a.sortTime);
}

// Legacy source is now only the DB denied list; open devices come from Redis.
async function legacyEntries(
    query: ReturnType<typeof normalizeQuery>
): Promise<UnifiedWaitingRoomEntry[]> {
    if (query.source === 'device_ingress') return [];
    if (query.state !== undefined && query.state !== 'rejected') return [];
    const dict = await WaitingRoomModule.getDenied();
    return Object.values(dict).map(legacyWaitingRoomItem);
}

async function ingressEntries(
    query: ReturnType<typeof normalizeQuery>
): Promise<UnifiedWaitingRoomEntry[]> {
    if (query.source === 'legacy') return [];
    // Open: Redis (sole source). Other states: DB history.
    if (query.state === 'open') return openStoreEntries(query.organizationId);
    const page = await listWaitingRoom({
        organizationId: query.organizationId,
        state: query.state,
        observedTransport: query.observedTransport,
        securityModel: query.securityModel,
        riskLevel: query.riskLevel,
        limit: ingressFetchLimit(),
        offset: 0
    });
    const history = page.items.map(ingressWaitingRoomItem);
    if (query.state === undefined) {
        const open = await openStoreEntries(query.organizationId);
        return [...open, ...history];
    }
    return history;
}

async function openStoreEntries(
    organizationId: string
): Promise<UnifiedWaitingRoomEntry[]> {
    const entries = await listPending(organizationId);
    const legacy = await legacyDefaultOrgEntries(organizationId);
    return [...entries, ...legacy].map(storeWaitingRoomItem);
}

// Surface default-org legacy entries to every operator.
async function legacyDefaultOrgEntries(
    operatorOrganizationId: string
): Promise<WaitingEntry[]> {
    const defaultOrg = gatelessDeviceOrg();
    if (!defaultOrg || operatorOwnsGatelessOrg(operatorOrganizationId)) {
        return [];
    }
    const entries = await listPending(defaultOrg);
    return entries.filter((entry) => entry.authMethod === 'none');
}

async function getIngressEntry(
    organizationId: string,
    waitingRoomId: string
): Promise<UnifiedWaitingRoomEntry | null> {
    const row = await getWaitingRoom({
        organizationId,
        waitingRoomId
    });
    return row ? ingressWaitingRoomItem(row) : null;
}

// A bare shellyID classifies as 'legacy' but open entries live in Redis; check
// the store first, then the DB denied list.
async function getLegacyEntry(
    organizationId: string,
    shellyId: string
): Promise<UnifiedWaitingRoomEntry | null> {
    const openMatch = await findOpenStoreEntry(organizationId, shellyId);
    if (openMatch) return storeWaitingRoomItem(openMatch);
    const denied = await WaitingRoomModule.getDenied();
    return denied[shellyId] ? legacyWaitingRoomItem(denied[shellyId]) : null;
}

async function findOpenStoreEntry(
    organizationId: string,
    shellyId: string
): Promise<WaitingEntry | undefined> {
    const own = await listPending(organizationId);
    const match = own.find((entry) => entry.shellyID === shellyId);
    if (match) return match;
    const defaultOrg = await legacyDefaultOrgEntries(organizationId);
    return defaultOrg.find((entry) => entry.shellyID === shellyId);
}

function legacyWaitingRoomItem(item: {
    shellyID: string;
    status: unknown;
    addedAt?: number;
    touchedAt?: number;
}): UnifiedWaitingRoomEntry {
    return {
        ...item,
        source: 'legacy',
        waitingRoomKind: 'legacy',
        entryId: item.shellyID,
        shellyID: item.shellyID,
        status: item.status,
        sortTime: item.touchedAt ?? item.addedAt ?? 0
    };
}

function ingressWaitingRoomItem(
    item: DeviceIngressWaitingRoomEntry
): UnifiedWaitingRoomEntry {
    const firstSeenMs = isoTimestampMs(item.firstSeenAt);
    const lastSeenMs = isoTimestampMs(item.lastSeenAt);
    return {
        source: 'device_ingress',
        waitingRoomKind: 'device_ingress',
        entryId: `${DEVICE_INGRESS_KEY_PREFIX}${item.id}`,
        waitingRoomId: item.id,
        shellyID: item.reportedExternalId,
        state: item.state,
        status: statusFromSafeDetail(item.safeDetail),
        organizationId: item.organizationId,
        observedTransport: item.observedTransport,
        securityModel: item.securityModel,
        riskLevel: item.riskLevel,
        profileId: item.profileId,
        trustedCa: item.trustedCa,
        firstSeenAt: item.firstSeenAt,
        lastSeenAt: item.lastSeenAt,
        addedAt: firstSeenMs,
        touchedAt: lastSeenMs,
        attemptCount: item.attemptCount,
        sortTime: lastSeenMs
    };
}

// Open store entries are keyed by shellyID — the shape the frontend expects
// for these cards (same key contract as legacy pending entries).
function storeWaitingRoomItem(entry: WaitingEntry): UnifiedWaitingRoomEntry {
    return {
        source: 'device_ingress',
        waitingRoomKind: 'device_ingress',
        entryId: entry.shellyID,
        shellyID: entry.shellyID,
        state: 'open',
        status: entry.jdoc,
        organizationId: entry.organizationId,
        securityModel: securityModelForAuthMethod(entry.authMethod),
        authMethod: entry.authMethod,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        addedAt: entry.firstSeenAt,
        touchedAt: entry.lastSeenAt,
        sortTime: entry.lastSeenAt
    };
}

function securityModelForAuthMethod(
    authMethod: WaitingEntry['authMethod']
): DeviceIngressSecurityModel | undefined {
    if (authMethod === 'certificate') return 'certificate';
    if (authMethod === 'token') return 'direct_token';
    return undefined;
}

function isoTimestampMs(value: string): number {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function entryMatches(
    item: UnifiedWaitingRoomEntry,
    query: ReturnType<typeof normalizeQuery>
): boolean {
    return (
        matchesSource(item, query.source) &&
        matchesTransport(item, query.observedTransport) &&
        matchesSecurityModel(item, query.securityModel) &&
        matchesRisk(item, query.riskLevel)
    );
}

function matchesSource(
    item: UnifiedWaitingRoomEntry,
    source: WaitingRoomListParams['source']
): boolean {
    return !source || item.source === source;
}

function matchesTransport(
    item: UnifiedWaitingRoomEntry,
    transport: DeviceIngressTransport | undefined
): boolean {
    return !transport || item.observedTransport === transport;
}

function matchesSecurityModel(
    item: UnifiedWaitingRoomEntry,
    securityModel: DeviceIngressSecurityModel | undefined
): boolean {
    return !securityModel || item.securityModel === securityModel;
}

function matchesRisk(
    item: UnifiedWaitingRoomEntry,
    riskLevel: DeviceIngressRiskLevel | undefined
): boolean {
    return !riskLevel || item.riskLevel === riskLevel;
}

function ingressFetchLimit(): number {
    return Math.max(tuning.waitingRoom.max, MAX_LIST_LIMIT);
}
