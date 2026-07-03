import log4js from 'log4js';
import createMdns from 'multicast-dns';
import {incrementCounter} from '../observability/counters';
import * as postgres from '../PostgresProvider';
import {type DeviceHostTarget, deviceHostFromInput} from './deviceHostGuard';
import {fetchDeviceInfoOrUnavailable} from './probeHost';

const logger = log4js.getLogger('discovery-scan');

const MDNS_HOST_REJECTED_COUNTER = 'discovery_mdns_host_rejected';

export interface ScanLanHit {
    ip: string;
    shellyId: string;
    model: string;
    gen: 1 | 2 | 3 | 4;
    mac: string;
    alreadyKnown: boolean;
    inWaitingRoom: boolean;
}

export interface ScanLanResult {
    hits: ScanLanHit[];
    scannedAt: string;
    durationMs: number;
    warnings: string[];
}

interface MdnsRecord {
    name?: string;
    type?: string;
    data?: unknown;
}

const SHELLY_SERVICE = '_shelly._tcp.local';
const HTTP_SERVICE = '_http._tcp.local';

function txtMap(records: MdnsRecord[]): Record<string, string> {
    const txt = records.find((r) => r.type === 'TXT');
    if (!txt || !Array.isArray(txt.data)) return {};
    const map: Record<string, string> = {};
    for (const entry of txt.data as Buffer[]) {
        const s = entry.toString('utf8');
        const eq = s.indexOf('=');
        if (eq > 0) map[s.slice(0, eq)] = s.slice(eq + 1);
    }
    return map;
}

function parseGen(raw: string | undefined): 1 | 2 | 3 | 4 | null {
    const n = Number(raw);
    if (n === 1 || n === 2 || n === 3 || n === 4) return n;
    return null;
}

export interface RawHit {
    shellyId: string;
    ip: string;
    model: string;
    gen: 1 | 2 | 3 | 4;
    mac: string;
}

// An mDNS A-record IP is attacker-controllable, so it must clear the same SSRF
// guard as every other discovery path; returns null on rejection.
export async function vetMdnsHost(
    ip: string
): Promise<DeviceHostTarget | null> {
    try {
        return await deviceHostFromInput(ip);
    } catch (err) {
        incrementCounter(MDNS_HOST_REJECTED_COUNTER);
        logger.warn('mDNS host %s rejected by SSRF guard: %s', ip, err);
        return null;
    }
}

// Soft-fail wrapper around probeHost: null on error so one slow host doesn't sink the scan.
async function fetchInfoForUnclassified(
    target: DeviceHostTarget,
    timeoutMs: number
): Promise<{id: string; gen: number; model: string; mac: string} | null> {
    try {
        const info = await fetchDeviceInfoOrUnavailable(target, timeoutMs);
        if (!info.id || !info.gen) return null;
        return {
            id: info.id,
            gen: info.gen,
            model: info.model ?? '',
            mac: info.mac ?? ''
        };
    } catch {
        return null;
    }
}

export interface CrossReferenceInput {
    orgId: string;
    hits: RawHit[];
}

export interface CrossReferenceResult {
    known: Set<string>;
    inWaiting: Set<string>;
}

// Org predicate is non-optional — without it a caller in org A would
// learn about org B's fleet and admission state from a shared LAN scan.
export async function crossReference(
    input: CrossReferenceInput
): Promise<CrossReferenceResult> {
    const {orgId, hits} = input;
    if (hits.length === 0) return {known: new Set(), inWaiting: new Set()};
    const ids = hits.map((h) => h.shellyId);
    const [known, inWaiting] = await Promise.all([
        fetchKnownExternalIds(ids, orgId),
        fetchInWaitingShellyIds(ids, orgId)
    ]);
    return {known, inWaiting};
}

// Fail closed: a DB outage must NOT silently flip a claimed device to
// admissible. Log + re-throw; the RPC boundary surfaces the failure.
async function logAndRethrow(label: string, err: unknown): Promise<never> {
    logger.warn('%s cross-ref failed: %s', label, err);
    throw err;
}

async function fetchKnownExternalIds(
    ids: string[],
    orgId: string
): Promise<Set<string>> {
    const rows = await postgres
        .queryRows<{external_id: string}>(
            `SELECT external_id
               FROM device.list
              WHERE external_id = ANY($1::text[])
                AND organization_id = $2`,
            [ids, orgId]
        )
        .catch((err) => logAndRethrow('device.list', err));
    return new Set(rows.map((r) => r.external_id));
}

async function fetchInWaitingShellyIds(
    ids: string[],
    orgId: string
): Promise<Set<string>> {
    const rows = await postgres
        .queryRows<{shelly_id: string}>(
            `SELECT shelly_id
               FROM organization.pending_admission
              WHERE shelly_id = ANY($1::text[])
                AND consumed_at IS NULL
                AND expires_at > now()
                AND organization_id = $2`,
            [ids, orgId]
        )
        .catch((err) => logAndRethrow('pending_admission', err));
    return new Set(rows.map((r) => r.shelly_id));
}

export interface ScanLanInput {
    orgId: string;
    timeoutMs?: number;
}

// Tenant-safe mapping: alreadyKnown derives only from org-scoped SQL.
// A process-global in-memory registry would leak cross-tenant existence.
export function composeFinalHits(
    hits: RawHit[],
    refs: CrossReferenceResult
): ScanLanHit[] {
    return hits.map((h) => ({
        ip: h.ip,
        shellyId: h.shellyId,
        model: h.model,
        gen: h.gen,
        mac: h.mac,
        alreadyKnown: refs.known.has(h.shellyId),
        inWaitingRoom: refs.inWaiting.has(h.shellyId)
    }));
}

export async function scanLan(input: ScanLanInput): Promise<ScanLanResult> {
    const {orgId, timeoutMs = 5_000} = input;
    const start = Date.now();
    const budget = Math.min(Math.max(timeoutMs, 500), 15_000);
    const warnings: string[] = [];
    const rawByShellyId = new Map<string, RawHit>();

    const mdns = createMdns();
    try {
        mdns.on(
            'response',
            (response: {
                answers?: MdnsRecord[];
                additionals?: MdnsRecord[];
            }) => {
                const all = [
                    ...(response.answers ?? []),
                    ...(response.additionals ?? [])
                ];
                const isShelly = all.some(
                    (r) =>
                        (r.type === 'PTR' &&
                            typeof r.data === 'string' &&
                            r.data.includes(SHELLY_SERVICE)) ||
                        (typeof r.name === 'string' &&
                            r.name.includes(SHELLY_SERVICE))
                );
                if (!isShelly) return;
                const aRec = all.find((r) => r.type === 'A');
                if (!aRec || typeof aRec.name !== 'string') return;
                const shellyId = aRec.name.replace('.local', '');
                const ip = String(aRec.data ?? '');
                if (!ip) return;
                const txt = txtMap(all);
                const gen = parseGen(txt.gen);
                if (gen === null) {
                    rawByShellyId.set(shellyId, {
                        shellyId,
                        ip,
                        model: txt.model ?? '',
                        gen: 2,
                        mac: txt.mac ?? ''
                    });
                    return;
                }
                rawByShellyId.set(shellyId, {
                    shellyId,
                    ip,
                    gen,
                    model: txt.model ?? '',
                    mac: txt.mac ?? ''
                });
            }
        );

        mdns.query([
            {name: SHELLY_SERVICE, type: 'PTR'},
            {name: HTTP_SERVICE, type: 'PTR'}
        ]);

        await new Promise((resolve) => setTimeout(resolve, budget));
    } finally {
        mdns.removeAllListeners();
        mdns.destroy();
    }

    // Cap per-host enrich budget so a slow device can't blow the SLA.
    const enrichTimeout = Math.min(1_500, Math.max(500, budget / 3));
    const hits: RawHit[] = [];
    for (const raw of rawByShellyId.values()) {
        if (raw.model && raw.mac) {
            hits.push(raw);
            continue;
        }
        const target = await vetMdnsHost(raw.ip);
        if (!target) {
            warnings.push(`host rejected for ${raw.shellyId}`);
            continue;
        }
        const info = await fetchInfoForUnclassified(target, enrichTimeout);
        if (info) {
            hits.push({
                shellyId: info.id,
                ip: raw.ip,
                gen: (info.gen as 1 | 2 | 3 | 4) ?? raw.gen,
                model: info.model || raw.model,
                mac: info.mac || raw.mac
            });
        } else {
            warnings.push(`enrichment failed for ${raw.shellyId}`);
            hits.push(raw);
        }
    }

    const refs = await crossReference({hits, orgId});
    return {
        hits: composeFinalHits(hits, refs),
        scannedAt: new Date(start).toISOString(),
        durationMs: Date.now() - start,
        warnings
    };
}
