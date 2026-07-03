// SSRF guard for Discovery.AdmitDevice — IPv4-only, resolves DNS in-process.

import dns from 'node:dns/promises';
import {envBool} from '../../config/envReader';
import RpcError from '../../rpc/RpcError';

export interface DeviceHostTarget {
    host: string;
    ip: string;
    normalized: string;
}

const IPV4_RE =
    /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const HOSTNAME_RE =
    /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const DNS_LOOKUP_TIMEOUT_MS = 2_000;

function isPrivateRangesAllowed(): boolean {
    return envBool('FM_DISCOVERY_ALLOW_PRIVATE', true);
}

function rejectNotShelly(reason: string): never {
    throw RpcError.Domain('NotAShellyDevice', {details: {reason}});
}

function rejectHostNotAllowed(reason: string, target: string): never {
    throw RpcError.Domain('HostNotAllowed', {details: {reason, host: target}});
}

function ipv4ToInt(ip: string): number {
    const parts = ip.split('.').map(Number);
    return (
        ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
    );
}

function inCidrV4(ip: string, cidr: string): boolean {
    const [network, bitsStr] = cidr.split('/');
    const bits = Number(bitsStr);
    if (bits === 0) return true;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
}

const BLOCKED_V4_CIDRS = [
    '127.0.0.0/8',
    '169.254.0.0/16',
    '224.0.0.0/4',
    '240.0.0.0/4',
    '0.0.0.0/8',
    '100.64.0.0/10',
    '255.255.255.255/32'
];

const PRIVATE_V4_CIDRS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

function classifyV4(ip: string): 'blocked' | 'private' | 'public' {
    for (const cidr of BLOCKED_V4_CIDRS) {
        if (inCidrV4(ip, cidr)) return 'blocked';
    }
    for (const cidr of PRIVATE_V4_CIDRS) {
        if (inCidrV4(ip, cidr)) return 'private';
    }
    return 'public';
}

function rejectIpv6Resolved(rawHost: string): never {
    rejectHostNotAllowed('ipv6-not-supported', rawHost);
}

function enforceV4Policy(ip: string, rawHost: string): void {
    const verdict = classifyV4(ip);
    if (verdict === 'blocked') {
        rejectHostNotAllowed('reserved-range', rawHost);
    }
    if (verdict === 'private' && !isPrivateRangesAllowed()) {
        rejectHostNotAllowed('private-range', rawHost);
    }
}

function lookupTimeout(): Promise<never> {
    return new Promise((_resolve, reject) => {
        setTimeout(
            () => reject(new Error('dns-lookup-timeout')),
            DNS_LOOKUP_TIMEOUT_MS
        ).unref();
    });
}

async function resolveHostname(
    host: string
): Promise<{ip: string; family: 4 | 6}> {
    try {
        const lookup = await Promise.race([
            dns.lookup(host, {verbatim: true}),
            lookupTimeout()
        ]);
        return {ip: lookup.address, family: lookup.family as 4 | 6};
    } catch {
        rejectNotShelly('unresolvable');
    }
}

function trimmedHost(raw: unknown): string {
    if (typeof raw !== 'string') rejectNotShelly('invalid-host');
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > 253) {
        rejectNotShelly('invalid-host');
    }
    return trimmed;
}

function looksLikeIpv6Literal(host: string): boolean {
    if (host.startsWith('[') && host.endsWith(']')) return true;
    return host.includes(':');
}

function classifyInput(host: string): 'ipv4' | 'hostname' {
    if (looksLikeIpv6Literal(host)) rejectIpv6Resolved(host);
    if (IPV4_RE.test(host)) return 'ipv4';
    if (HOSTNAME_RE.test(host)) return 'hostname';
    rejectNotShelly('invalid-host');
}

// Validates `rawHost` then ANSWERS the vetted target. Resolution happens
// here so the caller can connect by IP without a second DNS lookup that
// could race.
export async function deviceHostFromInput(
    rawHost: unknown
): Promise<DeviceHostTarget> {
    const host = trimmedHost(rawHost);
    const kind = classifyInput(host);
    if (kind === 'ipv4') {
        enforceV4Policy(host, host);
        return {host, ip: host, normalized: host};
    }
    const resolved = await resolveHostname(host);
    if (resolved.family === 6) rejectIpv6Resolved(host);
    enforceV4Policy(resolved.ip, host);
    return {host, ip: resolved.ip, normalized: host.toLowerCase()};
}
