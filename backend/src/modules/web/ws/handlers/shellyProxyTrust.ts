// Forwarded cert/XFF headers are trusted only from explicit proxy CIDRs.

import type {IncomingMessage} from 'node:http';
import {BlockList, isIPv4} from 'node:net';
import {getLogger} from 'log4js';

const logger = getLogger('shelly-proxy-trust');
// Warn once per malformed entry — this runs on every handshake.
const warnedCidrs = new Set<string>();

export function isTrustedProxyAddress(
    address: string | undefined,
    trustedProxyCidrs: string[]
): boolean {
    if (!address) return false;
    if (trustedProxyCidrs.length === 0) return false;
    const normalized = normalizeAddress(address);
    const list = blockListFromCidrs(trustedProxyCidrs);
    try {
        return list.check(normalized, isIPv4(normalized) ? 'ipv4' : 'ipv6');
    } catch {
        return false;
    }
}

// The device's own IP: the last XFF hop the trusted proxy appended, or the
// socket peer when the connection did not arrive through a trusted proxy.
export function clientAddress(
    request: IncomingMessage,
    trustedProxyCidrs: string[]
): string | undefined {
    const peer = request.socket.remoteAddress;
    if (!isTrustedProxyAddress(peer, trustedProxyCidrs)) return peer;
    return forwardedClientIp(request) ?? peer;
}

export function resolveClientSourceIp(
    request: IncomingMessage,
    trustedProxyCidrs: string[]
): string | undefined {
    const peer = request.socket.remoteAddress;
    if (!isTrustedProxyAddress(peer, trustedProxyCidrs)) return peer;
    return originalForwardedClientIp(request) ?? peer;
}

export function forwardedCertHeaderTrusted(
    request: IncomingMessage,
    trustedProxyCidrs: string[]
): boolean {
    return isTrustedProxyAddress(
        request.socket.remoteAddress,
        trustedProxyCidrs
    );
}

function forwardedClientIp(request: IncomingMessage): string | undefined {
    const header = request.headers['x-forwarded-for'];
    const raw = Array.isArray(header) ? header[header.length - 1] : header;
    if (!raw) return undefined;
    const hops = raw
        .split(',')
        .map((hop) => hop.trim())
        .filter(Boolean);
    return hops.length > 0 ? hops[hops.length - 1] : undefined;
}

function originalForwardedClientIp(
    request: IncomingMessage
): string | undefined {
    const header = request.headers['x-forwarded-for'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) return undefined;
    const hops = raw
        .split(',')
        .map((hop) => hop.trim())
        .filter(Boolean);
    return hops.length > 0 ? hops[0] : undefined;
}

function normalizeAddress(address: string): string {
    return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function blockListFromCidrs(cidrs: string[]): BlockList {
    const list = new BlockList();
    for (const cidr of cidrs) addCidr(list, cidr);
    return list;
}

function addCidr(list: BlockList, cidr: string): void {
    const [net, prefix] = cidr.split('/');
    if (!net || prefix === undefined) {
        warnMalformedCidr(cidr);
        return;
    }
    const normalized = normalizeAddress(net.trim());
    try {
        list.addSubnet(
            normalized,
            Number(prefix),
            isIPv4(normalized) ? 'ipv4' : 'ipv6'
        );
    } catch {
        // Dropped rather than failing the whole allowlist — but a typo here
        // silently distrusts the proxy, so it must be visible.
        warnMalformedCidr(cidr);
    }
}

function warnMalformedCidr(cidr: string): void {
    if (warnedCidrs.has(cidr)) return;
    warnedCidrs.add(cidr);
    logger.error(
        'malformed trusted-proxy CIDR %s dropped — forwarded cert/XFF headers from that proxy are NOT trusted',
        cidr
    );
}
