// Two separate trusts. Address and scheme (X-Forwarded-For, X-Forwarded-Proto)
// are believed from a peer in the trusted proxy CIDRs. Certificate headers are
// believed only from such a peer AND only when device mTLS is on; an install
// that never issued certificates cannot be talked into accepting one.

import type {IncomingMessage} from 'node:http';
import {BlockList, isIPv4} from 'node:net';
import type {TLSSocket} from 'node:tls';
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

export function proxyPeerTrusted(
    request: IncomingMessage,
    trustedProxyCidrs: string[]
): boolean {
    return isTrustedProxyAddress(
        request.socket.remoteAddress,
        trustedProxyCidrs
    );
}

// Certificate headers need both: a trusted proxy peer and mTLS switched on.
export function certificateHeadersTrusted(
    request: IncomingMessage,
    trustedProxyCidrs: string[],
    mtlsEnabled: boolean
): boolean {
    return mtlsEnabled && proxyPeerTrusted(request, trustedProxyCidrs);
}

// How the socket really arrived: TLS on this process, or a trusted proxy
// saying https or wss (Traefik sends wss on a TLS WebSocket upgrade).
// Everything else is plain ws, whatever headers it carries.
export type ObservedSocketTransport = 'ws' | 'wss';

export function observedTransport(
    request: IncomingMessage,
    trustedProxyCidrs: string[]
): ObservedSocketTransport {
    if ((request.socket as TLSSocket).encrypted === true) return 'wss';
    if (!proxyPeerTrusted(request, trustedProxyCidrs)) return 'ws';
    const proto = forwardedProto(request);
    return proto === 'https' || proto === 'wss' ? 'wss' : 'ws';
}

function forwardedProto(request: IncomingMessage): string | undefined {
    const header = request.headers['x-forwarded-proto'];
    const raw = Array.isArray(header) ? header[header.length - 1] : header;
    if (!raw) return undefined;
    const hops = raw
        .split(',')
        .map((hop) => hop.trim().toLowerCase())
        .filter(Boolean);
    return hops.length > 0 ? hops[hops.length - 1] : undefined;
}

// Boot check. An install that fronts /shelly with a proxy but trusts no
// proxy address would see every device as the proxy: one shared budget, and
// every proxied socket as plain ws. Refuse to start rather than run like that.
export function assertProxyTrustConfigured(input: {
    proxyRequired: boolean;
    trustedProxyCidrs: string[];
}): void {
    if (!input.proxyRequired) return;
    const valid = input.trustedProxyCidrs.filter(isWellFormedCidr);
    if (valid.length === 0) {
        throw new Error(
            'FM_DEVICE_INGRESS_PROXY_REQUIRED is true but FM_DEVICE_INGRESS_TRUSTED_PROXY_CIDRS holds no valid CIDR; set it to the proxy subnet (compose derives it from FM_EDGE_SUBNET)'
        );
    }
    if (valid.length !== input.trustedProxyCidrs.length) {
        throw new Error(
            'FM_DEVICE_INGRESS_TRUSTED_PROXY_CIDRS holds a malformed entry; fix it, a proxy that is not trusted hides every device behind one address'
        );
    }
}

function isWellFormedCidr(cidr: string): boolean {
    const [net, prefix] = cidr.split('/');
    if (!net || prefix === undefined || !/^\d+$/.test(prefix)) return false;
    const normalized = normalizeAddress(net.trim());
    const bits = isIPv4(normalized) ? 32 : 128;
    if (Number(prefix) > bits) return false;
    try {
        new BlockList().addSubnet(
            normalized,
            Number(prefix),
            isIPv4(normalized) ? 'ipv4' : 'ipv6'
        );
        return true;
    } catch {
        return false;
    }
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
