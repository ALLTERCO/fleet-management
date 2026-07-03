import maplibregl, {type Map as MapLibreMap} from 'maplibre-gl';
import type {Ref} from 'vue';
import {onBeforeUnmount, onMounted, ref, shallowRef} from 'vue';
import {getMapStyleUrl} from '@/helpers/map-style';
import {applyAppleMapsTint} from '@/helpers/map-tint';
import {hasWebGL} from '@/helpers/webgl';
import {DEFAULT_VIEWPORT, type MapViewport} from '@/types/map';

const MISSING_ICON_STUB = {
    width: 1,
    height: 1,
    data: new Uint8Array([0, 0, 0, 0])
};

export interface MapInstanceOptions {
    showNavControl?: boolean;
    showAttribution?: boolean;
    /** 3D buildings on zoom 14+ — keep off for analytics dashboards. */
    enableBuildings?: boolean;
    /** Mute POI / road-name labels — Mapbox ≤60% label coverage rule. */
    suppressMinorLabels?: boolean;
}

// `unsupported` ref lets callers fall back when WebGL is missing.
export function useMapInstance(
    container: Ref<HTMLElement | null>,
    initial: MapViewport = DEFAULT_VIEWPORT,
    options: MapInstanceOptions = {}
) {
    const showNavControl = options.showNavControl ?? true;
    const showAttribution = options.showAttribution ?? true;
    const enableBuildings = options.enableBuildings ?? true;
    const suppressMinorLabels = options.suppressMinorLabels ?? false;
    const map = shallowRef<MapLibreMap | null>(null);
    const loaded = ref(false);
    const unsupported = ref(false);

    onMounted(() => {
        if (!container.value) return;
        if (!hasWebGL()) {
            unsupported.value = true;
            return;
        }
        try {
            const instance = new maplibregl.Map({
                container: container.value,
                style: getMapStyleUrl(),
                center: [initial.longitude, initial.latitude],
                zoom: initial.zoom,
                pitch: initial.pitch ?? 0,
                bearing: initial.bearing ?? 0,
                attributionControl: showAttribution ? {compact: true} : false
            });

            if (showNavControl) {
                instance.addControl(
                    new maplibregl.NavigationControl({visualizePitch: true}),
                    'top-right'
                );
            }

            // 'load' = style ready; first 'idle' = tiles fully painted.
            instance.on('load', () =>
                applyAppleMapsTint(instance, {
                    buildings: enableBuildings,
                    suppressMinorLabels
                })
            );
            instance.once('idle', () => {
                loaded.value = true;
            });

            // OpenFreeMap dark style references Maki icons (circle-11 etc.)
            // that aren't always in its sprite sheet — supply a 1px
            // transparent stub so MapLibre stops warning per missing icon.
            instance.on('styleimagemissing', (e) => {
                if (instance.hasImage(e.id)) return;
                instance.addImage(e.id, MISSING_ICON_STUB, {pixelRatio: 1});
            });

            map.value = instance;
        } catch {
            unsupported.value = true;
        }
    });

    onBeforeUnmount(() => {
        map.value?.remove();
        map.value = null;
        loaded.value = false;
    });

    return {map, loaded, unsupported};
}
