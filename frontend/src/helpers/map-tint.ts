/** Apple-Maps tint for OpenMapTiles dark style + optional 3D buildings. */

import type {
    DataDrivenPropertyValueSpecification,
    LayerSpecification,
    Map as MapLibreMap
} from 'maplibre-gl';

// iOS 26 Apple Maps Dark palette. Water MUST be darker than land —
// that contrast is what makes continents read at world zoom.
const PALETTE = {
    land: '#1c1d20',
    water: '#0a0d14',
    park: '#1a2520',
    building: '#262930',
    roadMajor: '#454950',
    roadMinor: '#333740',
    boundaryCountry: 'rgba(210,220,235,0.34)',
    boundaryState: 'rgba(210,220,235,0.16)',
    coastline: 'rgba(210,220,235,0.10)',
    labelText: '#e8eaef',
    labelHalo: '#1c1d20'
} as const;

const PARK_KEYWORDS = [
    'park',
    'wood',
    'forest',
    'grass',
    'meadow',
    'pitch',
    'garden',
    'cemetery'
];

export interface MapTintOptions {
    /** Add 3D building extrusion above zoom 14. Off for small insets. */
    readonly buildings?: boolean;
    /** Mute POI/road-name labels — keep ≤60% label coverage (Mapbox rule). */
    readonly suppressMinorLabels?: boolean;
}

export function applyAppleMapsTint(
    instance: MapLibreMap,
    options: MapTintOptions = {}
): void {
    paintLandBase(instance);
    paintAllFills(instance); // catch-all so OpenFreeMap defaults don't bleed.
    paintWaterNavy(instance);
    paintVegetationForest(instance);
    paintAllRoads(instance);
    paintBuildingsFlat(instance);
    polishLabels(instance);
    if (options.buildings) addBuildingExtrusion(instance);
    if (options.suppressMinorLabels) muteMinorLabels(instance);
}

// Base coat — water / parks / buildings repaint on top.
function paintAllFills(instance: MapLibreMap): void {
    for (const layer of fillLayersIn(instance)) {
        instance.setPaintProperty(layer.id, 'fill-color', PALETTE.land);
    }
}

function paintAllRoads(instance: MapLibreMap): void {
    for (const layer of (instance.getStyle().layers ?? []).filter(
        (l) => l.type === 'line'
    )) {
        const color = lineColorFor(layer);
        instance.setPaintProperty(layer.id, 'line-color', color);
    }
}

export function lineColorFor(layer: LayerSpecification): string {
    const sl = sourceLayerOf(layer);
    const id = layer.id.toLowerCase();
    if (sl === 'boundary' || id.includes('admin') || id.includes('boundary')) {
        return isStateBoundary(layer)
            ? PALETTE.boundaryState
            : PALETTE.boundaryCountry;
    }
    if (sl === 'water' || id.includes('coastline') || id.includes('waterway')) {
        return PALETTE.coastline;
    }
    const isMajor = /motor|trunk|primary|secondary/.test(id);
    return isMajor ? PALETTE.roadMajor : PALETTE.roadMinor;
}

export const APPLE_MAPS_DARK_PALETTE = PALETTE;

// OpenMapTiles: country = admin_level 2, state/region = 3+.
function isStateBoundary(layer: LayerSpecification): boolean {
    const id = layer.id.toLowerCase();
    if (
        id.includes('state') ||
        id.includes('province') ||
        id.includes('region')
    ) {
        return true;
    }
    const filter = (layer as {filter?: unknown[]}).filter;
    if (!Array.isArray(filter)) return false;
    const serialized = JSON.stringify(filter);
    // Anchor on admin_level so zoom filters like [">=","zoom",3] don't false-positive.
    if (!serialized.includes('"admin_level"')) return false;
    return /"admin_level"[^]*?[3-9]/.test(serialized);
}

function paintBuildingsFlat(instance: MapLibreMap): void {
    for (const layer of fillLayersIn(instance)) {
        if (sourceLayerOf(layer) === 'building') {
            instance.setPaintProperty(layer.id, 'fill-color', PALETTE.building);
        }
    }
}

function paintLandBase(instance: MapLibreMap): void {
    for (const layer of fillLayersIn(instance)) {
        const sl = sourceLayerOf(layer);
        if (sl === 'landcover' && layerHas(layer, 'land')) {
            instance.setPaintProperty(layer.id, 'fill-color', PALETTE.land);
        }
    }
    const style = instance.getStyle();
    if (style.layers?.[0]) {
        instance.setPaintProperty(
            'background',
            'background-color',
            PALETTE.land
        );
    }
}

function layerHas(layer: LayerSpecification, keyword: string): boolean {
    if (layer.id.toLowerCase().includes(keyword)) return true;
    const filter = (layer as {filter?: unknown[]}).filter;
    return (
        Array.isArray(filter) &&
        JSON.stringify(filter).toLowerCase().includes(keyword)
    );
}

function polishLabels(instance: MapLibreMap): void {
    for (const layer of symbolLayersIn(instance)) {
        const sl = sourceLayerOf(layer);
        if (sl !== 'place' && sl !== 'water_name') continue;
        instance.setPaintProperty(layer.id, 'text-color', PALETTE.labelText);
        instance.setPaintProperty(
            layer.id,
            'text-halo-color',
            PALETTE.labelHalo
        );
        instance.setPaintProperty(layer.id, 'text-halo-width', 1.5);
        instance.setPaintProperty(layer.id, 'text-halo-blur', 0.5);
    }
}

function paintWaterNavy(instance: MapLibreMap): void {
    for (const layer of fillLayersIn(instance)) {
        if (sourceLayerOf(layer) === 'water') {
            instance.setPaintProperty(layer.id, 'fill-color', PALETTE.water);
        }
    }
}

function muteMinorLabels(instance: MapLibreMap): void {
    for (const layer of symbolLayersIn(instance)) {
        const sl = sourceLayerOf(layer);
        if (sl === 'poi' || sl === 'transportation_name') {
            instance.setPaintProperty(layer.id, 'text-opacity', 0);
            instance.setPaintProperty(layer.id, 'icon-opacity', 0);
        }
    }
}

function symbolLayersIn(instance: MapLibreMap): LayerSpecification[] {
    return (instance.getStyle().layers ?? []).filter(
        (l) => l.type === 'symbol'
    );
}

function paintVegetationForest(instance: MapLibreMap): void {
    for (const layer of fillLayersIn(instance)) {
        if (!isLanduseOrLandcover(layer)) continue;
        if (!hasVegetationKeyword(layer)) continue;
        instance.setPaintProperty(layer.id, 'fill-color', PALETTE.park);
    }
}

function addBuildingExtrusion(instance: MapLibreMap): void {
    if (instance.getLayer('fm-buildings-3d')) return;
    if (!instance.getSource('openmaptiles')) return;
    instance.addLayer(buildingExtrusionLayer(), firstTextLayerId(instance));
}

function fillLayersIn(instance: MapLibreMap): LayerSpecification[] {
    return (instance.getStyle().layers ?? []).filter((l) => l.type === 'fill');
}

function sourceLayerOf(layer: LayerSpecification): string | undefined {
    return (layer as {'source-layer'?: string})['source-layer'];
}

function isLanduseOrLandcover(layer: LayerSpecification): boolean {
    const sl = sourceLayerOf(layer);
    return sl === 'landcover' || sl === 'landuse';
}

function hasVegetationKeyword(layer: LayerSpecification): boolean {
    if (anyKeywordIn(layer.id.toLowerCase())) return true;
    const filter = (layer as {filter?: unknown[]}).filter;
    if (!Array.isArray(filter)) return false;
    return anyKeywordIn(JSON.stringify(filter).toLowerCase());
}

function anyKeywordIn(haystack: string): boolean {
    return PARK_KEYWORDS.some((k) => haystack.includes(k));
}

function firstTextLayerId(instance: MapLibreMap): string | undefined {
    return instance
        .getStyle()
        .layers?.find(
            (l) =>
                l.type === 'symbol' &&
                !!(l as {layout?: {'text-field'?: unknown}}).layout?.[
                    'text-field'
                ]
        )?.id;
}

function buildingExtrusionLayer(): LayerSpecification {
    return {
        id: 'fm-buildings-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
            'fill-extrusion-color': PALETTE.building,
            'fill-extrusion-height': zoomGrownHeight('render_height'),
            'fill-extrusion-base': zoomGrownHeight('render_min_height'),
            'fill-extrusion-opacity': 0.82
        }
    };
}

// Ramp from 0m at zoom 14 to feature height at 15.5 — avoids popping.
function zoomGrownHeight(
    featureProp: string
): DataDrivenPropertyValueSpecification<number> {
    return [
        'interpolate',
        ['linear'],
        ['zoom'],
        14,
        0,
        15.5,
        ['get', featureProp]
    ] as unknown as DataDrivenPropertyValueSpecification<number>;
}
