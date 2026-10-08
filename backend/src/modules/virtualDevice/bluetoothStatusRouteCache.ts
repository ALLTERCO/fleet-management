import {tuning} from '../../config';
import type {BluetoothSourceComponentDto} from '../../types/api/virtualdevice';
import {BoundedMap} from '../boundedMap';
import * as Observability from '../Observability';
import type {BluetoothRouteCachePort} from '../redis/ports';
import {bluetoothRouteCache} from '../redis/services';
import {
    type BluetoothStatusRoute,
    listBluetoothStatusRoutesByGateway
} from './bluetoothRepository';

const ROUTE_CACHE_SCHEMA = 5;
const LOCAL_ROUTE_CACHE_TTL_SEC = 5 * 60;
// Redis is generation-fenced and invalidated on BLU inventory changes. Keep it
// warm longer than the process-local front cache so a routine local eviction
// does not turn telemetry processing into a PostgreSQL read. The TTL remains a
// bounded safety net if an invalidation signal is ever missed.
const SHARED_ROUTE_CACHE_TTL_SEC = 24 * 60 * 60;

export type BluetoothStatusRoutes = ReadonlyMap<string, BluetoothStatusRoute>;

export interface BluetoothGatewayRouteRequest {
    organizationId: string;
    gatewayExternalId: string;
    inventoryVersion: number;
}

export type BluetoothStatusRouteLoader = (
    organizationId: string,
    gatewayExternalIds: readonly string[]
) => Promise<Map<string, Map<string, BluetoothStatusRoute>>>;

interface LocalRouteEntry {
    inventoryVersion: number;
    routes: BluetoothStatusRoutes;
}

interface RouteLoadEntry {
    inventoryVersion: number;
    promise: Promise<BluetoothStatusRoutes>;
}

interface BluetoothStatusRouteCacheDeps {
    shared: BluetoothRouteCachePort;
    load: BluetoothStatusRouteLoader;
}

const defaultDeps: BluetoothStatusRouteCacheDeps = {
    shared: bluetoothRouteCache,
    load: listBluetoothStatusRoutesByGateway
};

const localRoutes = new BoundedMap<string, LocalRouteEntry>({
    maxSize: tuning.virtualDevice.bluRouteCacheMaxGateways,
    ttlMs: LOCAL_ROUTE_CACHE_TTL_SEC * 1000
});
const routeLoads = new BoundedMap<string, RouteLoadEntry>({
    maxSize: tuning.virtualDevice.bluRouteCacheMaxGateways,
    ttlMs: LOCAL_ROUTE_CACHE_TTL_SEC * 1000
});
const sharedBypassKeys = new BoundedMap<string, true>({
    maxSize: tuning.virtualDevice.bluRouteCacheMaxGateways,
    ttlMs: LOCAL_ROUTE_CACHE_TTL_SEC * 1000
});
const invalidations = new Map<string, Promise<void>>();

export function bluetoothGatewayRouteCacheKey(
    organizationId: string,
    gatewayExternalId: string
): string {
    return `${organizationId}|${gatewayExternalId}`;
}

export async function getBluetoothStatusRoutesForGateway(
    organizationId: string,
    gatewayExternalId: string,
    inventoryVersion: number,
    overrides: Partial<BluetoothStatusRouteCacheDeps> = {}
): Promise<BluetoothStatusRoutes> {
    const routes = await getBluetoothStatusRoutesForGateways(
        [{organizationId, gatewayExternalId, inventoryVersion}],
        overrides
    );
    return (
        routes.get(
            bluetoothGatewayRouteCacheKey(organizationId, gatewayExternalId)
        ) ?? new Map()
    );
}

export async function getBluetoothStatusRoutesForGateways(
    requests: readonly BluetoothGatewayRouteRequest[],
    overrides: Partial<BluetoothStatusRouteCacheDeps> = {}
): Promise<ReadonlyMap<string, BluetoothStatusRoutes>> {
    const unique = new Map(
        requests.map((request) => [
            bluetoothGatewayRouteCacheKey(
                request.organizationId,
                request.gatewayExternalId
            ),
            request
        ])
    );
    const result = new Map<string, BluetoothStatusRoutes>();
    const waiting: Array<Promise<void>> = [];
    const fresh: BluetoothGatewayRouteRequest[] = [];

    for (const [key, request] of unique) {
        const cached = localRoutes.get(key);
        if (cached?.inventoryVersion === request.inventoryVersion) {
            Observability.incrementCounter('blu_route_cache_local_hits_total');
            result.set(key, cached.routes);
            continue;
        }
        const loading = routeLoads.get(key);
        if (loading?.inventoryVersion === request.inventoryVersion) {
            Observability.incrementCounter(
                'blu_route_cache_local_load_coalesced_total'
            );
            waiting.push(
                loading.promise.then((routes) => {
                    result.set(key, routes);
                })
            );
            continue;
        }
        Observability.incrementCounter('blu_route_cache_local_misses_total');
        fresh.push(request);
    }

    if (fresh.length > 0) {
        const deps = {...defaultDeps, ...overrides};
        const batch = loadRouteBatch(fresh, deps);
        for (const request of fresh) {
            const key = bluetoothGatewayRouteCacheKey(
                request.organizationId,
                request.gatewayExternalId
            );
            const promise = batch.then(
                (routes) =>
                    routes.get(key) ?? new Map<string, BluetoothStatusRoute>()
            );
            routeLoads.set(key, {
                inventoryVersion: request.inventoryVersion,
                promise
            });
            waiting.push(
                promise.then((routes) => {
                    const current = localRoutes.get(key);
                    if (
                        !current ||
                        current.inventoryVersion <= request.inventoryVersion
                    ) {
                        localRoutes.set(key, {
                            inventoryVersion: request.inventoryVersion,
                            routes
                        });
                    }
                    result.set(key, routes);
                })
            );
            void promise
                .finally(() => {
                    const current = routeLoads.get(key);
                    if (current?.promise === promise) routeLoads.delete(key);
                })
                .catch(() => undefined);
        }
    }

    await Promise.all(waiting);
    return result;
}

async function loadRouteBatch(
    requests: readonly BluetoothGatewayRouteRequest[],
    deps: BluetoothStatusRouteCacheDeps
): Promise<Map<string, BluetoothStatusRoutes>> {
    const result = new Map<string, BluetoothStatusRoutes>();
    const authoritative: Array<{
        request: BluetoothGatewayRouteRequest;
        generation: string | null;
    }> = [];
    await Promise.all(
        requests.map(async (request) => {
            const key = bluetoothGatewayRouteCacheKey(
                request.organizationId,
                request.gatewayExternalId
            );
            const invalidation =
                invalidations.get(key) ??
                invalidations.get(request.organizationId);
            if (invalidation) await invalidation.catch(() => undefined);
        })
    );

    const sharedCandidates = new Map<string, BluetoothGatewayRouteRequest[]>();
    for (const request of requests) {
        const key = bluetoothGatewayRouteCacheKey(
            request.organizationId,
            request.gatewayExternalId
        );
        if (
            sharedBypassKeys.has(key) ||
            sharedBypassKeys.has(request.organizationId)
        ) {
            authoritative.push({request, generation: null});
            continue;
        }
        const entries = sharedCandidates.get(request.organizationId) ?? [];
        entries.push(request);
        sharedCandidates.set(request.organizationId, entries);
    }

    await Promise.all(
        [...sharedCandidates].map(async ([organizationId, candidates]) => {
            const shared = await readSharedRouteBatch(
                organizationId,
                candidates.map((candidate) => candidate.gatewayExternalId),
                deps.shared
            );
            for (const request of candidates) {
                const key = bluetoothGatewayRouteCacheKey(
                    request.organizationId,
                    request.gatewayExternalId
                );
                const entry = shared.get(request.gatewayExternalId) ?? {
                    generation: null,
                    routes: null
                };
                if (entry.routes) result.set(key, entry.routes);
                else {
                    authoritative.push({
                        request,
                        generation: entry.generation
                    });
                }
            }
        })
    );

    const byOrganization = new Map<
        string,
        Array<{
            request: BluetoothGatewayRouteRequest;
            generation: string | null;
        }>
    >();
    for (const miss of authoritative) {
        const entries = byOrganization.get(miss.request.organizationId) ?? [];
        entries.push(miss);
        byOrganization.set(miss.request.organizationId, entries);
    }

    await Promise.all(
        [...byOrganization].map(async ([organizationId, misses]) => {
            Observability.incrementCounter('blu_route_cache_db_loads_total');
            const loaded = await deps.load(
                organizationId,
                misses.map((miss) => miss.request.gatewayExternalId)
            );
            const cacheable: Array<{
                gatewayExternalId: string;
                generation: string;
                payload: string;
            }> = [];
            for (const {request, generation} of misses) {
                const routes =
                    loaded.get(request.gatewayExternalId) ??
                    new Map<string, BluetoothStatusRoute>();
                const key = bluetoothGatewayRouteCacheKey(
                    request.organizationId,
                    request.gatewayExternalId
                );
                result.set(key, routes);
                if (generation !== null) {
                    cacheable.push({
                        gatewayExternalId: request.gatewayExternalId,
                        generation,
                        payload: serializeRoutes(routes)
                    });
                }
            }
            if (cacheable.length === 0) return;
            try {
                const stored = await deps.shared.setManyIfCurrent(
                    organizationId,
                    cacheable,
                    SHARED_ROUTE_CACHE_TTL_SEC
                );
                for (const accepted of stored) {
                    Observability.incrementCounter(
                        accepted
                            ? 'blu_route_cache_fills_total'
                            : 'blu_route_cache_fill_races_total'
                    );
                }
            } catch {
                Observability.incrementCounter('blu_route_cache_errors_total');
            }
        })
    );
    return result;
}

async function readSharedRouteBatch(
    organizationId: string,
    gatewayExternalIds: readonly string[],
    shared: BluetoothRouteCachePort
): Promise<
    ReadonlyMap<
        string,
        {generation: string | null; routes: BluetoothStatusRoutes | null}
    >
> {
    try {
        const entries = await shared.readMany(
            organizationId,
            gatewayExternalIds
        );
        const decoded = new Map<
            string,
            {generation: string | null; routes: BluetoothStatusRoutes | null}
        >();
        for (const gatewayExternalId of gatewayExternalIds) {
            const entry = entries.get(gatewayExternalId);
            if (!entry || entry.payload === null) {
                Observability.incrementCounter('blu_route_cache_misses_total');
                decoded.set(gatewayExternalId, {
                    generation: entry?.generation ?? null,
                    routes: null
                });
                continue;
            }
            const routes = deserializeRoutes(entry.payload);
            if (routes) {
                Observability.incrementCounter('blu_route_cache_hits_total');
                decoded.set(gatewayExternalId, {
                    generation: entry.generation,
                    routes
                });
                continue;
            }
            Observability.incrementCounter('blu_route_cache_invalid_total');
            decoded.set(gatewayExternalId, {
                generation: entry.generation,
                routes: null
            });
        }
        return decoded;
    } catch {
        Observability.incrementCounter('blu_route_cache_errors_total');
        // PostgreSQL remains available as the authoritative fallback, but a
        // failed Redis read did not establish a generation fence. Do not try
        // to fill Redis without that proof.
        return new Map(
            gatewayExternalIds.map((gatewayExternalId) => [
                gatewayExternalId,
                {generation: null, routes: null}
            ])
        );
    }
}

export function invalidateLocalBluetoothStatusRoutes(
    organizationId: string
): void {
    const prefix = `${organizationId}|`;
    for (const key of localRoutes.keys()) {
        if (key.startsWith(prefix)) localRoutes.delete(key);
    }
    for (const key of routeLoads.keys()) {
        if (key.startsWith(prefix)) routeLoads.delete(key);
    }
}

export function invalidateLocalBluetoothStatusRoutesForGateway(
    organizationId: string,
    gatewayExternalId: string
): void {
    const key = bluetoothGatewayRouteCacheKey(
        organizationId,
        gatewayExternalId
    );
    localRoutes.delete(key);
    routeLoads.delete(key);
}

export function invalidateBluetoothStatusRoutesForGateway(
    organizationId: string,
    gatewayExternalId: string,
    shared: BluetoothRouteCachePort = bluetoothRouteCache
): Promise<number> {
    Observability.incrementCounter(
        'blu_route_cache_gateway_invalidations_total'
    );
    const key = bluetoothGatewayRouteCacheKey(
        organizationId,
        gatewayExternalId
    );
    invalidateLocalBluetoothStatusRoutesForGateway(
        organizationId,
        gatewayExternalId
    );
    sharedBypassKeys.set(key, true);
    const previous = invalidations.get(key) ?? Promise.resolve();
    const generation = previous
        .catch(() => undefined)
        .then(async () => {
            const next = await shared.invalidateGateway(
                organizationId,
                gatewayExternalId
            );
            sharedBypassKeys.delete(key);
            return next;
        });
    const current = generation.then(() => undefined);
    invalidations.set(key, current);
    void current
        .finally(() => {
            if (invalidations.get(key) === current) invalidations.delete(key);
        })
        .catch(() => undefined);
    return generation;
}

export function invalidateBluetoothStatusRoutes(
    organizationId: string,
    shared: BluetoothRouteCachePort = bluetoothRouteCache
): Promise<void> {
    Observability.incrementCounter('blu_route_cache_org_invalidations_total');
    invalidateLocalBluetoothStatusRoutes(organizationId);
    sharedBypassKeys.set(organizationId, true);
    const previous = invalidations.get(organizationId) ?? Promise.resolve();
    const current = previous
        .catch(() => undefined)
        .then(async () => {
            await shared.invalidateOrg(organizationId);
            sharedBypassKeys.delete(organizationId);
        });
    invalidations.set(organizationId, current);
    void current
        .finally(() => {
            if (invalidations.get(organizationId) === current) {
                invalidations.delete(organizationId);
            }
        })
        .catch(() => undefined);
    return current;
}

export function __resetBluetoothStatusRouteCacheForTests(): void {
    localRoutes.clear();
    routeLoads.clear();
    sharedBypassKeys.clear();
    invalidations.clear();
}

function serializeRoutes(routes: BluetoothStatusRoutes): string {
    const devices = new Map<string, BluetoothStatusRoute>();
    for (const route of routes.values()) devices.set(route.externalId, route);
    return JSON.stringify({
        schema: ROUTE_CACHE_SCHEMA,
        devices: [...devices.values()]
    });
}

function deserializeRoutes(payload: string): BluetoothStatusRoutes | null {
    try {
        const parsed = JSON.parse(payload) as {
            schema?: unknown;
            devices?: unknown;
        };
        if (
            parsed.schema !== ROUTE_CACHE_SCHEMA ||
            !Array.isArray(parsed.devices)
        ) {
            return null;
        }
        const routes = new Map<string, BluetoothStatusRoute>();
        for (const candidate of parsed.devices) {
            const route = parseRoute(candidate);
            if (!route) return null;
            for (const component of route.components) {
                routes.set(component.componentKey, route);
            }
        }
        return routes;
    } catch {
        return null;
    }
}

function parseRoute(value: unknown): BluetoothStatusRoute | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const candidate = value as {
        deviceListId?: unknown;
        externalId?: unknown;
        organizationId?: unknown;
        transportId?: unknown;
        primary?: unknown;
        components?: unknown;
        modelId?: unknown;
        productName?: unknown;
        bleAddress?: unknown;
    };
    if (
        !Number.isInteger(candidate.deviceListId) ||
        typeof candidate.externalId !== 'string' ||
        typeof candidate.organizationId !== 'string' ||
        typeof candidate.transportId !== 'string' ||
        typeof candidate.primary !== 'boolean' ||
        !Array.isArray(candidate.components) ||
        !isNullableString(candidate.modelId) ||
        !isNullableString(candidate.productName) ||
        !isNullableString(candidate.bleAddress)
    ) {
        return null;
    }
    const components: BluetoothSourceComponentDto[] = [];
    for (const component of candidate.components) {
        if (!isSourceComponent(component)) return null;
        components.push(component);
    }
    return {
        deviceListId: candidate.deviceListId as number,
        externalId: candidate.externalId,
        organizationId: candidate.organizationId,
        transportId: candidate.transportId,
        primary: candidate.primary,
        components,
        modelId: candidate.modelId as string | null,
        productName: candidate.productName as string | null,
        bleAddress: candidate.bleAddress as string | null
    };
}

function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function isSourceComponent(
    value: unknown
): value is BluetoothSourceComponentDto {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const component = value as Record<string, unknown>;
    return (
        typeof component.componentKey === 'string' &&
        ['device', 'sensor', 'control', 'trv'].includes(
            String(component.kind)
        ) &&
        ['identity', 'telemetry', 'event_control', 'writable_control'].includes(
            String(component.role)
        ) &&
        (component.objectId === null ||
            typeof component.objectId === 'number') &&
        (component.index === null || typeof component.index === 'number') &&
        (component.name === null || typeof component.name === 'string') &&
        typeof component.canWrite === 'boolean'
    );
}
