// Map UX constants. Defaults are sensible production values; each is
// overridable via VITE_* env vars so deploy targets with slower hardware
// or different zoom preferences can tune without code changes.

import {readEnvNumber} from '@/helpers/env';

// Zoom level used the first time a pin lands on the mini-map.
export const MAP_ZOOM_INITIAL = readEnvNumber('VITE_MAP_ZOOM_INITIAL', 14);

// Zoom level for the empty world-overview state before a pin is dropped.
export const MAP_ZOOM_WORLD = readEnvNumber('VITE_MAP_ZOOM_WORLD', 1.4);

// flyTo duration in ms when a geocoded result is picked from autocomplete.
export const MAP_FLY_DURATION_MS = readEnvNumber(
    'VITE_MAP_FLY_DURATION_MS',
    800
);

// flyTo duration in ms when the user types coordinates manually — shorter
// because manual entry implies "I know where this is, just show me".
export const MAP_FLY_DURATION_MANUAL_MS = readEnvNumber(
    'VITE_MAP_FLY_DURATION_MANUAL_MS',
    500
);
