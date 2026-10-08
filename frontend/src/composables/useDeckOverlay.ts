import type {Layer} from '@deck.gl/core';
import {MapLibreOverlay} from '@deck.gl/maplibre';
import type {Map as MapLibreMap} from 'maplibre-gl';
import type {Ref} from 'vue';
import {onBeforeUnmount, shallowRef, watch} from 'vue';

export interface UseDeckOverlayOptions {
    // interleaved=true sorts deck layers with MapLibre layers (pins behind 3D buildings).
    interleaved?: boolean;
}

export interface PinCursorState {
    isDragging: boolean;
    isHovering: boolean;
}

// Pointer when hovering pickable layers, grabbing while panning, grab idle.
export function pinCursor({isDragging, isHovering}: PinCursorState): string {
    if (isDragging) return 'grabbing';
    if (isHovering) return 'pointer';
    return 'grab';
}

// Mounts the official deck.gl MapLibreOverlay (shared WebGL context when interleaved).
export function useDeckOverlay(
    map: Ref<MapLibreMap | null>,
    layers: Ref<Layer[]>,
    options: UseDeckOverlayOptions = {}
) {
    const overlay = shallowRef<MapLibreOverlay | null>(null);

    const ensure = () => {
        const m = map.value;
        if (!m || overlay.value) return;
        const ov = new MapLibreOverlay({
            interleaved: options.interleaved ?? false,
            layers: layers.value,
            getCursor: pinCursor
        });
        m.addControl(ov);
        overlay.value = ov;
    };

    watch(map, ensure, {immediate: true});

    watch(
        layers,
        (next) => {
            overlay.value?.setProps({layers: next});
        },
        {deep: false}
    );

    onBeforeUnmount(() => {
        // finalize() detaches from the map and releases the WebGL context.
        // Works whether the parent map is still mounted or already destroyed.
        overlay.value?.finalize();
        overlay.value = null;
    });

    return {overlay};
}
