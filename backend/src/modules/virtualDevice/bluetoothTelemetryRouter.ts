import {
    getBluetoothGatewayInventoryVersion,
    getDeviceOrg
} from '../EventDistributor';
import * as Observability from '../Observability';
import type {BluetoothTelemetryArbiterPort} from '../redis/ports';
import type {BluetoothStatusRoute} from './bluetoothRepository';
import {
    bluetoothGatewayRouteCacheKey,
    getBluetoothStatusRoutesForGateways
} from './bluetoothStatusRouteCache';
import {acceptBluetoothTelemetryClaims} from './bluetoothTelemetryArbiter';

export interface BluetoothGatewayIdentity {
    deviceListId: number;
    externalId: string;
    organizationId: string;
}

export interface BluetoothTelemetryTarget {
    sourceDeviceListId: number;
    componentKey: string;
}

export interface RoutedBluetoothTelemetry {
    gatewayExternalId: string;
    route: BluetoothStatusRoute;
}

export interface BluetoothTelemetryRoutingResult {
    accepted: ReadonlyMap<string, RoutedBluetoothTelemetry>;
    suppressed: ReadonlySet<string>;
}

export interface BluetoothTelemetryRouterDeps {
    loadRoutes(
        sources: readonly BluetoothGatewayIdentity[]
    ): Promise<ReadonlyMap<number, ReadonlyMap<string, BluetoothStatusRoute>>>;
    arbiter?: BluetoothTelemetryArbiterPort;
}

const defaultDeps: BluetoothTelemetryRouterDeps = {
    loadRoutes: async (sources) => {
        const routes = await getBluetoothStatusRoutesForGateways(
            sources.map((source) => ({
                organizationId: source.organizationId,
                gatewayExternalId: source.externalId,
                inventoryVersion: getBluetoothGatewayInventoryVersion(
                    source.organizationId,
                    source.externalId
                )
            }))
        );
        return new Map(
            sources.map((source) => [
                source.deviceListId,
                routes.get(
                    bluetoothGatewayRouteCacheKey(
                        source.organizationId,
                        source.externalId
                    )
                ) ?? new Map<string, BluetoothStatusRoute>()
            ])
        );
    }
};

export async function routeBluetoothTelemetry(input: {
    sources: readonly BluetoothGatewayIdentity[];
    targets: readonly BluetoothTelemetryTarget[];
    deps?: Partial<BluetoothTelemetryRouterDeps>;
}): Promise<BluetoothTelemetryRoutingResult> {
    const deps = {...defaultDeps, ...input.deps};
    const sources = new Map(
        input.sources.map((source) => [source.deviceListId, source])
    );
    const routesBySource = await loadGatewayRoutes(
        sources,
        input.targets,
        deps
    );
    const matched = matchTargets(input.targets, sources, routesBySource);
    Observability.incrementCounter(
        'blu_telemetry_route_unmatched_total',
        Math.max(0, input.targets.length - matched.length)
    );
    const candidates = preferPrimaryGateways(matched);
    const acceptedGateways = await acceptCandidateGateways(
        candidates,
        deps.arbiter
    );
    return routingResult(matched, candidates, acceptedGateways);
}

export function gatewayIdentity(input: {
    deviceListId: number;
    externalId: string;
    organizationId?: string;
}): BluetoothGatewayIdentity | null {
    const organizationId =
        input.organizationId ?? getDeviceOrg(input.externalId);
    if (!organizationId) return null;
    return {
        deviceListId: input.deviceListId,
        externalId: input.externalId,
        organizationId
    };
}

async function loadGatewayRoutes(
    sources: ReadonlyMap<number, BluetoothGatewayIdentity>,
    targets: readonly BluetoothTelemetryTarget[],
    deps: BluetoothTelemetryRouterDeps
): Promise<ReadonlyMap<number, ReadonlyMap<string, BluetoothStatusRoute>>> {
    const required = new Set(
        targets.map((target) => target.sourceDeviceListId)
    );
    return deps.loadRoutes(
        [...required].flatMap((deviceListId) => {
            const source = sources.get(deviceListId);
            return source ? [source] : [];
        })
    );
}

interface MatchedTarget extends RoutedBluetoothTelemetry {
    key: string;
}

function matchTargets(
    targets: readonly BluetoothTelemetryTarget[],
    sources: ReadonlyMap<number, BluetoothGatewayIdentity>,
    routesBySource: ReadonlyMap<
        number,
        ReadonlyMap<string, BluetoothStatusRoute>
    >
): MatchedTarget[] {
    return targets.flatMap((target) => {
        const source = sources.get(target.sourceDeviceListId);
        const route = routesBySource
            .get(target.sourceDeviceListId)
            ?.get(target.componentKey);
        if (!source || !route) return [];
        return [
            {
                key: telemetryTargetKey(target),
                gatewayExternalId: source.externalId,
                route
            }
        ];
    });
}

function preferPrimaryGateways(
    matched: readonly MatchedTarget[]
): MatchedTarget[] {
    const primaryDevices = new Set(
        matched
            .filter((target) => target.route.primary)
            .map((target) => target.route.deviceListId)
    );
    const candidates = matched.filter(
        (target) =>
            target.route.primary ||
            !primaryDevices.has(target.route.deviceListId)
    );
    Observability.incrementCounter(
        'blu_telemetry_secondary_suppressed_total',
        matched.length - candidates.length
    );
    return candidates;
}

async function acceptCandidateGateways(
    candidates: readonly MatchedTarget[],
    arbiter?: BluetoothTelemetryArbiterPort
): Promise<ReadonlySet<string>> {
    const claims = [
        ...new Map(
            candidates.map((target) => [
                routeGatewayKey(target),
                {
                    organizationId: target.route.organizationId,
                    bluetoothDeviceListId: target.route.deviceListId,
                    gatewayExternalId: target.gatewayExternalId,
                    primary: target.route.primary
                }
            ])
        ).entries()
    ];
    if (claims.length === 0) return new Set();
    const accepted = await acceptBluetoothTelemetryClaims(
        claims.map(([, claim]) => claim),
        arbiter
    );
    return new Set(
        claims.flatMap(([key], index) => (accepted[index] ? [key] : []))
    );
}

function routingResult(
    matched: readonly MatchedTarget[],
    candidates: readonly MatchedTarget[],
    acceptedGateways: ReadonlySet<string>
): BluetoothTelemetryRoutingResult {
    const candidateKeys = new Set(candidates.map((target) => target.key));
    const accepted = new Map<string, RoutedBluetoothTelemetry>();
    const suppressed = new Set<string>();
    for (const target of matched) {
        if (
            candidateKeys.has(target.key) &&
            acceptedGateways.has(routeGatewayKey(target))
        ) {
            accepted.set(target.key, {
                gatewayExternalId: target.gatewayExternalId,
                route: target.route
            });
        } else {
            suppressed.add(target.key);
        }
    }
    return {accepted, suppressed};
}

function routeGatewayKey(target: RoutedBluetoothTelemetry): string {
    return `${target.route.deviceListId}\0${target.gatewayExternalId}`;
}

export function telemetryTargetKey(target: BluetoothTelemetryTarget): string {
    return `${target.sourceDeviceListId}\0${target.componentKey}`;
}
