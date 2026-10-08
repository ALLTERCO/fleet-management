import {tuning} from '../../config';
import {BoundedMap} from '../boundedMap';
import * as Observability from '../Observability';
import {SingleFlight} from '../singleFlight';
import type {VirtualEntityBinding} from './virtualEntityBinding';

const ROUTE_CACHE_TTL_MS = 5 * 60_000;
const NO_OWNERS: readonly string[] = Object.freeze([]);
const NO_BINDINGS: readonly VirtualEntityBinding[] = Object.freeze([]);

type OwnersBySource = ReadonlyMap<string, readonly string[]>;
export type ProjectionBindingLoader = (
    organizationId: string
) => Promise<readonly VirtualEntityBinding[]>;

export interface ProjectionBindings {
    /** Changes on every binding or grant change; compare it, do not order it. */
    version: number;
    owners: readonly string[];
    /** Every binding of every owner, in listVirtualEntities order. */
    bindings: readonly VirtualEntityBinding[];
}

interface BindingIndex {
    version: number;
    ownersBySource: OwnersBySource;
    bindingsByOwner: ReadonlyMap<string, readonly VirtualEntityBinding[]>;
}

const projectionVersionByOrg = new BoundedMap<string, number>({
    maxSize: tuning.virtualDevice.bluRouteCacheMaxGateways
});

// One entry per organization: a binding change drops every source at
// once, so one reload must refill them all instead of one reload per source.
class OrganizationIndexCache<T> {
    readonly #entries = new BoundedMap<string, {version: number; value: T}>({
        maxSize: tuning.virtualDevice.bluRouteCacheMaxGateways,
        ttlMs: ROUTE_CACHE_TTL_MS
    });
    readonly #loads: SingleFlight<string, T>;
    readonly #activeLoads = new Map<string, {invalidated: boolean}>();
    readonly #countsRoutes: boolean;

    // Only the owner index feeds the route-cache counters.
    constructor(label: string, countsRoutes: boolean) {
        this.#loads = new SingleFlight<string, T>(label);
        this.#countsRoutes = countsRoutes;
    }

    #count(
        name:
            | 'virtual_projection_route_cache_hits_total'
            | 'virtual_projection_route_cache_coalesced_total'
            | 'virtual_projection_route_cache_misses_total'
            | 'virtual_projection_route_cache_db_loads_total'
    ): void {
        if (this.#countsRoutes) Observability.incrementCounter(name);
    }

    async get(
        organizationId: string,
        load: (version: number) => Promise<T>
    ): Promise<T> {
        const version = projectionVersion(organizationId);
        const cached = this.#entries.get(organizationId);
        if (cached?.version === version) {
            this.#count('virtual_projection_route_cache_hits_total');
            return cached.value;
        }
        this.#count(
            this.#loads.peek(organizationId)
                ? 'virtual_projection_route_cache_coalesced_total'
                : 'virtual_projection_route_cache_misses_total'
        );
        return this.#loads.run(organizationId, async () => {
            const active = {invalidated: false};
            this.#activeLoads.set(organizationId, active);
            this.#count('virtual_projection_route_cache_db_loads_total');
            try {
                const value = await load(version);
                // A load that started before a binding change must not be kept.
                if (!active.invalidated) {
                    this.#entries.set(organizationId, {version, value});
                }
                return value;
            } finally {
                if (this.#activeLoads.get(organizationId) === active) {
                    this.#activeLoads.delete(organizationId);
                }
            }
        });
    }

    forget(organizationId: string): void {
        const active = this.#activeLoads.get(organizationId);
        if (active) active.invalidated = true;
        this.#loads.forget(organizationId);
        this.#entries.delete(organizationId);
    }

    clear(): void {
        this.#entries.clear();
        this.#activeLoads.clear();
    }
}

const bindingIndexes = new OrganizationIndexCache<BindingIndex>(
    'virtual_projection_bindings',
    true
);
const storedProjectionFlags = new OrganizationIndexCache<boolean>(
    'virtual_projection_stored_flags',
    false
);

function projectionVersion(organizationId: string): number {
    return projectionVersionByOrg.get(organizationId) ?? 0;
}

// The virtual devices that project a source plus all their binding rows, from
// one versioned read per organization.
export async function projectionBindingsForSource(
    organizationId: string,
    sourceExternalId: string,
    load: ProjectionBindingLoader
): Promise<ProjectionBindings> {
    const index = await bindingIndexes.get(organizationId, async (version) =>
        buildBindingIndex(version, await load(organizationId))
    );
    const owners = index.ownersBySource.get(sourceExternalId) ?? NO_OWNERS;
    return {
        version: index.version,
        owners,
        bindings:
            owners.length === 0
                ? NO_BINDINGS
                : owners.flatMap(
                      (owner) => index.bindingsByOwner.get(owner) ?? NO_BINDINGS
                  )
    };
}

// Whether an organization has any materialized or derived binding, so a status
// batch can skip the per-batch binding lookup. Same version and invalidation as
// the owner index; a missed signal is bounded by the cache TTL.
export function organizationHasStoredProjections(
    organizationId: string,
    load: (organizationId: string) => Promise<boolean>
): Promise<boolean> {
    return storedProjectionFlags.get(organizationId, () =>
        load(organizationId)
    );
}

function buildBindingIndex(
    version: number,
    rows: readonly VirtualEntityBinding[]
): BindingIndex {
    const owners = new Map<string, string[]>();
    const bindingsByOwner = new Map<string, VirtualEntityBinding[]>();
    for (const row of rows) {
        const sourceOwners = owners.get(row.source_external_id) ?? [];
        sourceOwners.push(row.external_id);
        owners.set(row.source_external_id, sourceOwners);
        const ownerRows = bindingsByOwner.get(row.external_id) ?? [];
        ownerRows.push(row);
        bindingsByOwner.set(row.external_id, ownerRows);
    }
    const sortedOwners = new Map(
        [...owners].map(([source, ids]) => [source, [...ids].sort()])
    );
    return {
        version,
        ownersBySource: freezeOwnerIndex(sortedOwners),
        bindingsByOwner: new Map(
            [...bindingsByOwner].map(([owner, ownerRows]) => [
                owner,
                Object.freeze(ownerRows)
            ])
        )
    };
}

function freezeOwnerIndex(index: OwnersBySource): OwnersBySource {
    return new Map(
        [...index].map(([source, owners]) => [
            source,
            Object.freeze([...new Set(owners)])
        ])
    );
}

export function invalidateVirtualProjectionRoutes(
    organizationId: string
): void {
    projectionVersionByOrg.set(
        organizationId,
        projectionVersion(organizationId) + 1
    );
    // A load started before this change must not serve later lookups either.
    bindingIndexes.forget(organizationId);
    storedProjectionFlags.forget(organizationId);
    Observability.incrementCounter(
        'virtual_projection_route_cache_invalidations_total'
    );
}

export function __resetVirtualProjectionRouteCacheForTests(): void {
    bindingIndexes.clear();
    storedProjectionFlags.clear();
}
