import Supercluster from 'supercluster';
import type {MapPin} from '@/types/map';

export interface ClusterPoint {
    id: string;
    lng: number;
    lat: number;
    count: number;
    pinIds: readonly string[];
}

export interface ClusterResult {
    clusters: readonly ClusterPoint[];
    /** Pins not absorbed into a cluster at the current zoom level. */
    loose: readonly MapPin[];
}

export interface PinClusterOptions {
    radius?: number; // pixel radius for cluster grouping
    minPoints?: number; // smallest cluster size; pins below this stay loose
    maxZoom?: number;
}

interface PinFeature {
    type: 'Feature';
    properties: {pinId: string};
    geometry: {type: 'Point'; coordinates: [number, number]};
}

function toFeatures(pins: readonly MapPin[]): PinFeature[] {
    return pins.map((p) => ({
        type: 'Feature',
        properties: {pinId: p.id},
        geometry: {type: 'Point', coordinates: [p.lng, p.lat]}
    }));
}

function buildIndex(
    pins: readonly MapPin[],
    options: PinClusterOptions
): Supercluster<{pinId: string}, ClusterFeatureProperties> {
    const index = new Supercluster<{pinId: string}, ClusterFeatureProperties>({
        radius: options.radius ?? 60,
        minPoints: options.minPoints ?? 3,
        maxZoom: options.maxZoom ?? 18
    });
    index.load(toFeatures(pins));
    return index;
}

interface ClusterFeatureProperties {
    cluster: true;
    cluster_id: number;
    point_count: number;
}

function isClusterFeature(
    f:
        | Supercluster.PointFeature<{pinId: string}>
        | Supercluster.ClusterFeature<ClusterFeatureProperties>
): f is Supercluster.ClusterFeature<ClusterFeatureProperties> {
    return (f.properties as {cluster?: boolean}).cluster === true;
}

function clusterFromFeature(
    f: Supercluster.ClusterFeature<ClusterFeatureProperties>,
    index: Supercluster<{pinId: string}, ClusterFeatureProperties>
): ClusterPoint {
    const childIds = index
        .getLeaves(f.properties.cluster_id, Infinity)
        .map((leaf) => leaf.properties.pinId);
    return {
        id: `cluster:${f.properties.cluster_id}`,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        count: f.properties.point_count ?? childIds.length,
        pinIds: childIds
    };
}

// Pure transformer — same pins + same viewport ⇒ same partition.
export function clusterPins(
    pins: readonly MapPin[],
    viewport: {bbox: [number, number, number, number]; zoom: number},
    options: PinClusterOptions = {}
): ClusterResult {
    if (pins.length === 0) return {clusters: [], loose: []};
    const index = buildIndex(pins, options);
    const features = index.getClusters(
        viewport.bbox,
        Math.floor(viewport.zoom)
    );
    const clusters: ClusterPoint[] = [];
    const loosePinIds = new Set<string>();
    for (const f of features) {
        if (isClusterFeature(f)) {
            clusters.push(clusterFromFeature(f, index));
        } else {
            loosePinIds.add(f.properties.pinId);
        }
    }
    return {
        clusters,
        loose: pins.filter((p) => loosePinIds.has(p.id))
    };
}
