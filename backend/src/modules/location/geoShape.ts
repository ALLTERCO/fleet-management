import RpcError from '../../rpc/RpcError';
import type {LocationGeoSource} from './kindSchemas';

export interface LocationGeoShape {
    lat: number;
    lng: number;
    source?: LocationGeoSource;
    matchedName?: string;
    geonameid?: number;
    verifiedAt?: string;
}

export function validateGeoShape(geo: LocationGeoShape | null): void {
    if (geo === null) return;
    const source = geo.source ?? 'manual';
    if (source === 'autocomplete') requireAutocompleteFields(geo);
    if (source === 'manual') rejectManualWithUpstreamRefs(geo);
}

function requireAutocompleteFields(geo: LocationGeoShape): void {
    if (!geo.verifiedAt) {
        throw RpcError.InvalidParams('autocomplete geo requires verifiedAt');
    }
}

function rejectManualWithUpstreamRefs(geo: LocationGeoShape): void {
    if (geo.geonameid !== undefined) {
        throw RpcError.InvalidParams('manual geo cannot carry geonameid');
    }
    if (geo.matchedName !== undefined) {
        throw RpcError.InvalidParams('manual geo cannot carry matchedName');
    }
}
