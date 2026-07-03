/** Shared HTTP helpers for webhook-style adapters. */
import {lookup as dnsLookup} from 'node:dns/promises';
import * as net from 'node:net';
import {Agent, type Dispatcher} from 'undici';
import {envBool, envInt} from '../../../config/envReader';
import * as breaker from './httpBreaker';

type ResolvedAddress = {address: string; family: number};
type DnsLookupAll = (host: string) => Promise<ResolvedAddress[]>;
type FetchLike = typeof fetch;
type FetchInitWithDispatcher = RequestInit & {dispatcher?: Dispatcher};
type LookupCallback = (
    err: Error | null,
    address: string | ResolvedAddress[],
    family?: number
) => void;

interface PublicHostResolution {
    dispatcher?: Dispatcher;
    close(): Promise<void>;
}

const defaultLookupAll: DnsLookupAll = async (host) =>
    (await dnsLookup(host, {all: true})) as ResolvedAddress[];
let lookupAll: DnsLookupAll = defaultLookupAll;

export function __setDnsLookupForTests(impl: DnsLookupAll | null): void {
    lookupAll = impl ?? defaultLookupAll;
}

function pinnedLookup(address: string, family: number) {
    return (
        _hostname: string,
        options: {all?: boolean} | undefined,
        callback: LookupCallback
    ) => {
        if (options?.all) {
            callback(null, [{address, family}]);
            return;
        }
        callback(null, address, family);
    };
}

export function __pinnedLookupForTests(address: string, family: number) {
    return pinnedLookup(address, family);
}

function pinnedDispatcher(address: string, family: number): Dispatcher {
    return new Agent({
        connect: {
            lookup: pinnedLookup(address, family)
        }
    });
}

// SSRF guard: reject loopback / link-local / private RFC1918 / unique-
// local IPv6 / metadata IPs. Tenant integration admins set arbitrary
// URLs; without this they could probe internal services through FM as
// the proxy. Operators with a legitimate internal target whitelist
// FM_DELIVERY_ALLOW_PRIVATE_HOSTS=true at deploy time.
function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) {
        return true; // bad parse → reject
    }
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, AWS/GCP metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast + reserved
    return false;
}

// Expand an IPv6 literal (incl. '::' compression and an embedded IPv4 tail)
// to its 16 bytes. null on anything net.isIPv6 wouldn't accept — callers
// fail closed on null.
function ipv6ToBytes(ip: string): number[] | null {
    let text = ip.toLowerCase();
    // A dotted tail (e.g. ::ffff:1.2.3.4) becomes two hex groups.
    const lastColon = text.lastIndexOf(':');
    if (text.slice(lastColon + 1).includes('.')) {
        const v4 = text
            .slice(lastColon + 1)
            .split('.')
            .map((p) => Number(p));
        if (
            v4.length !== 4 ||
            v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
        ) {
            return null;
        }
        const hi = ((v4[0] << 8) | v4[1]).toString(16);
        const lo = ((v4[2] << 8) | v4[3]).toString(16);
        text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
    }
    const halves = text.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const groups =
        halves.length === 2
            ? [
                  ...head,
                  ...Array(8 - head.length - tail.length).fill('0'),
                  ...tail
              ]
            : head;
    if (groups.length !== 8) return null;
    const bytes: number[] = [];
    for (const g of groups) {
        const v = Number.parseInt(g, 16);
        if (!Number.isInteger(v) || v < 0 || v > 0xffff || g === '')
            return null;
        bytes.push((v >> 8) & 0xff, v & 0xff);
    }
    return bytes;
}

// Pull any embedded IPv4 out of an IPv6 address so the v4 rules apply:
// IPv4-mapped (::ffff:v4), IPv4-compatible (::v4), NAT64 (64:ff9b::v4),
// and 6to4 (2002:v4::). Returns null when none is embedded.
function embeddedIPv4(b: number[]): string | null {
    const tail = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
    const first10Zero = b.slice(0, 10).every((x) => x === 0);
    if (first10Zero && b[10] === 0xff && b[11] === 0xff) return tail; // mapped
    if (b.slice(0, 12).every((x) => x === 0)) return tail; // compatible / ::1 / ::
    if (
        b[0] === 0x00 &&
        b[1] === 0x64 &&
        b[2] === 0xff &&
        b[3] === 0x9b &&
        b.slice(4, 12).every((x) => x === 0)
    ) {
        return tail; // NAT64 64:ff9b::/96
    }
    if (b[0] === 0x20 && b[1] === 0x02) {
        return `${b[2]}.${b[3]}.${b[4]}.${b[5]}`; // 6to4 2002::/16
    }
    return null;
}

export function isPrivateIPv6(ip: string): boolean {
    const b = ipv6ToBytes(ip);
    if (!b) return true; // unparseable → reject (fail closed)
    if (b.every((x, i) => x === (i === 15 ? 1 : 0))) return true; // ::1 loopback
    if (b.every((x) => x === 0)) return true; // :: unspecified
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
    if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
    const v4 = embeddedIPv4(b);
    return v4 !== null && isPrivateIPv4(v4);
}

export async function resolvePublicHost(
    url: string
): Promise<PublicHostResolution> {
    if (envBool('FM_DELIVERY_ALLOW_PRIVATE_HOSTS', false)) {
        return {async close() {}};
    }
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        throw new Error('invalid URL');
    }
    // URL.hostname keeps the brackets on an IPv6 literal; strip them so the
    // literal-IP classifier below actually runs instead of failing as DNS.
    host = host.replace(/^\[|\]$/g, '');
    // localhost variants resolve to loopback — reject.
    if (host === 'localhost' || host.endsWith('.localhost')) {
        throw new Error(`SSRF: refused to send to ${host} (loopback)`);
    }
    // Literal IP — skip DNS.
    if (net.isIP(host) !== 0) {
        if (
            (net.isIPv4(host) && isPrivateIPv4(host)) ||
            (net.isIPv6(host) && isPrivateIPv6(host))
        ) {
            throw new Error(
                `SSRF: refused to send to private/loopback IP ${host}`
            );
        }
        return {async close() {}};
    }
    let resolved: Array<{address: string; family: number}>;
    try {
        resolved = await lookupAll(host);
    } catch (err) {
        throw new Error(
            `DNS lookup failed for ${host}: ${err instanceof Error ? err.message : String(err)}`
        );
    }
    for (const r of resolved) {
        if (r.family === 4 && isPrivateIPv4(r.address)) {
            throw new Error(
                `SSRF: ${host} resolves to private/loopback IPv4 ${r.address}`
            );
        }
        if (r.family === 6 && isPrivateIPv6(r.address)) {
            throw new Error(
                `SSRF: ${host} resolves to private/loopback IPv6 ${r.address}`
            );
        }
    }
    const selected = resolved[0];
    if (!selected) throw new Error(`DNS lookup failed for ${host}: no records`);
    const dispatcher = pinnedDispatcher(selected.address, selected.family);
    return {
        dispatcher,
        async close() {
            await dispatcher.close();
        }
    };
}

export async function assertPublicHost(url: string): Promise<void> {
    const resolution = await resolvePublicHost(url);
    await resolution.close();
}

export async function withPublicFetch<T>(
    url: string,
    init: RequestInit,
    useResponse: (res: Response) => Promise<T>,
    fetchImpl: FetchLike = fetch
): Promise<T> {
    const resolution = await resolvePublicHost(url);
    try {
        const res = await fetchImpl(url, {
            ...init,
            dispatcher: resolution.dispatcher
        } as FetchInitWithDispatcher);
        return await useResponse(res);
    } finally {
        await resolution.close();
    }
}

export interface HttpPostResult {
    ok: boolean;
    status: number;
    bodyText: string;
    bodySnippet: string;
    /** Response headers — lowercased names. Adapters use this to surface
     *  Retry-After, workflow-run correlation URLs, etc. */
    headers: Record<string, string>;
}

export interface HttpPostOptions {
    headers?: Record<string, string>;
    timeoutMs?: number;
    /** Tenant scope for the per-(host, org) circuit breaker. Adapters
     *  pass `context.message.organizationId` through. */
    organizationId: string;
}

interface HttpPostRequest {
    url: string;
    body: string;
    headers: Record<string, string>;
    timeoutMs?: number;
    organizationId: string;
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

/** POST JSON with timeout + per-(host, org) circuit breaker.
 *  SSRF-guarded: rejects loopback / link-local / RFC1918 / ULA targets
 *  unless FM_DELIVERY_ALLOW_PRIVATE_HOSTS=true. */
export async function postJsonWithTimeout(
    url: string,
    body: unknown,
    options: HttpPostOptions
): Promise<HttpPostResult | {error: string}> {
    return postRawWithTimeout({
        url,
        body: JSON.stringify(body),
        headers: options.headers ?? {'content-type': 'application/json'},
        timeoutMs: options.timeoutMs,
        organizationId: options.organizationId
    });
}

/** POST pre-serialized bytes with the same guard/breaker path as JSON posts.
 *  Signed webhook uses this so the HMAC covers the exact body sent. */
export async function postRawWithTimeout(
    input: HttpPostRequest
): Promise<HttpPostResult | {error: string}> {
    const host = hostOf(input.url);
    const scope = {host, organizationId: input.organizationId};
    const decision = breaker.beforeRequest(scope);
    if (!decision.allow) {
        return {error: decision.reason ?? `CircuitOpen: ${host}`};
    }

    const effectiveTimeout =
        input.timeoutMs ?? envInt('FM_DELIVERY_HTTP_TIMEOUT_MS', 10_000);
    const snippetMax = envInt('FM_DELIVERY_ERROR_SNIPPET_MAX', 500);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);
    try {
        return await withPublicFetch(
            input.url,
            {
                method: 'POST',
                headers: input.headers,
                body: input.body,
                redirect: 'error',
                signal: controller.signal
            },
            async (res) => {
                const text = await res.text().catch(() => '');
                const responseHeaders: Record<string, string> = {};
                res.headers.forEach((value, key) => {
                    responseHeaders[key.toLowerCase()] = value;
                });
                // 5xx counts as upstream failure for the breaker; 4xx is caller-owned.
                if (res.ok || res.status < 500) {
                    breaker.onSuccess(scope);
                } else {
                    breaker.onFailure(scope);
                }
                return {
                    ok: res.ok,
                    status: res.status,
                    bodyText: text,
                    bodySnippet: text.slice(0, snippetMax),
                    headers: responseHeaders
                };
            }
        );
    } catch (err) {
        breaker.onFailure(scope);
        return {error: err instanceof Error ? err.message : String(err)};
    } finally {
        clearTimeout(timeout);
    }
}

/** Parse Retry-After header (seconds or HTTP date). Returns undefined
 *  when header missing or unparseable. */
export function parseRetryAfterSec(
    headers: Record<string, string>
): number | undefined {
    const raw = headers['retry-after'];
    if (!raw) return undefined;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.floor(numeric);
    const dateMs = Date.parse(raw);
    if (Number.isFinite(dateMs)) {
        const diff = Math.floor((dateMs - Date.now()) / 1000);
        return diff > 0 ? diff : 0;
    }
    return undefined;
}

/** Read a non-empty string off the merged endpoint config. */
export function readConfigString(
    config: Record<string, unknown>,
    key: string
): string | null {
    const v = config[key];
    return typeof v === 'string' && v.length > 0 ? v : null;
}
