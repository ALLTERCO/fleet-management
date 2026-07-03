// Shared map types: MapCanvas, WorldMap, LocationMap, deck.gl factories.

export interface MapPin {
    id: string;
    lat: number;
    lng: number;
    label?: string;
    status?: 'on' | 'off' | 'warn' | 'unknown';
    kind?: string;
    /** Open-alert count — >0 switches pin to attention pulse, 0 = ambient. */
    alertCount?: number;
}

export type MapStatusFilter = 'all' | 'on' | 'warn' | 'off' | 'alerts';

export interface MapViewport {
    longitude: number;
    latitude: number;
    zoom: number;
    pitch?: number;
    bearing?: number;
}

export const DEFAULT_VIEWPORT: MapViewport = {
    longitude: 0,
    latitude: 25,
    zoom: 1.5,
    pitch: 0,
    bearing: 0
};
