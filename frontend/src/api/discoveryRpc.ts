import {sendRPC} from '@/tools/websocket';

const FM = 'FLEET_MANAGER';

export interface DiscoveryProbeResult {
    ip: string;
    shellyId: string;
    gen: 2 | 3 | 4;
    model: string;
    ver: string;
    mac: string;
    authRequired: boolean;
    authDomain: string | null;
    alreadyKnown: boolean;
    inWaitingRoom: boolean;
}

export interface DiscoveryAdmitResult {
    shellyId: string;
    gen: 2 | 3 | 4;
    rebootingMs: number;
    intentRecorded: true;
    expectedConnectionWithinSec: number;
}

export interface DiscoveryScanHit {
    ip: string;
    shellyId: string;
    model: string;
    gen: 1 | 2 | 3 | 4;
    mac: string;
    alreadyKnown: boolean;
    inWaitingRoom: boolean;
}

export interface DiscoveryScanResult {
    hits: DiscoveryScanHit[];
    scannedAt: string;
    durationMs: number;
    warnings: string[];
}

export function probeHost(host: string): Promise<DiscoveryProbeResult> {
    return sendRPC(FM, 'Discovery.Probe', {host});
}

export function admitByHost(
    host: string,
    password?: string
): Promise<DiscoveryAdmitResult> {
    const params: {host: string; password?: string} = {host};
    if (password) params.password = password;
    return sendRPC(FM, 'Discovery.AdmitDevice', params);
}

export function scanLan(timeoutMs?: number): Promise<DiscoveryScanResult> {
    const params: {timeoutMs?: number} = {};
    if (timeoutMs !== undefined) params.timeoutMs = timeoutMs;
    return sendRPC(FM, 'Discovery.ScanLan', params);
}
