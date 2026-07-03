/** Map each LocationKind to one of four "tiers" that share a detail shape.
 *  Geographic kinds get an identity row + child grid.
 *  Site kinds get address + contacts + hours + child buildings.
 *  Building gets the 3D-stack hero + structural stats.
 *  Indoor kinds get capacity + environmental setpoint + spatial hero. */

import type {LocationKind} from '@api/location';

export type LocationTier = 'geographic' | 'site' | 'building' | 'indoor';

const KIND_TIER: Record<LocationKind, LocationTier> = {
    continent: 'geographic',
    country: 'geographic',
    region: 'geographic',
    county: 'geographic',
    city: 'geographic',
    neighborhood: 'geographic',
    campus: 'site',
    site: 'site',
    building: 'building',
    office: 'indoor',
    floor: 'indoor',
    area: 'indoor',
    room: 'indoor',
    zone: 'indoor'
};

export function tierForKind(
    kind: LocationKind | null | undefined
): LocationTier {
    if (!kind) return 'geographic';
    return KIND_TIER[kind];
}
