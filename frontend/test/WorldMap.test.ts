// Verifies that WorldMap exposes project() and onMapMove() so a parent page
// can convert lng/lat coordinates to viewport pixels and react to map moves
// without holding a direct reference to the MapLibre instance.

import {mount} from '@vue/test-utils';
import {createPinia} from 'pinia';
import {describe, expect, it, vi} from 'vitest';
import WorldMap from '@/components/core/maps/WorldMap.vue';

// MapCanvas wraps maplibre-gl which requires WebGL — stub the child component
// so tests focus on WorldMap's exposed API, not the rendering pipeline.
vi.mock('@/components/core/maps/MapCanvas.vue', () => {
    const {defineComponent, ref} = require('vue');
    return {
        default: defineComponent({
            name: 'MapCanvas',
            props: ['initial'],
            setup(_: unknown, {expose}: {expose: (obj: object) => void}) {
                expose({
                    map: ref(null),
                    loaded: ref(false),
                    unsupported: ref(false)
                });
                return {};
            },
            template: '<div><slot :loaded="false" /></div>'
        })
    };
});

// Silence maplibre-gl CSS import that happy-dom cannot process.
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

function mountWorldMap() {
    return mount(WorldMap, {
        global: {plugins: [createPinia()]},
        props: {pins: [], unmappedLocations: [], loading: false}
    });
}

describe('WorldMap defineExpose', () => {
    it('exposes a project() function so parents can convert lng/lat to pixels', () => {
        const wrapper = mountWorldMap();
        const exposed = wrapper.vm as unknown as {
            project?: (
                lngLat: [number, number]
            ) => {x: number; y: number} | null;
        };
        expect(typeof exposed.project).toBe('function');
    });

    it('exposes onMapMove() returning an unsubscribe function', () => {
        const wrapper = mountWorldMap();
        const exposed = wrapper.vm as unknown as {
            onMapMove?: (cb: () => void) => () => void;
        };
        expect(typeof exposed.onMapMove).toBe('function');
        if (exposed.onMapMove) {
            const unsubscribe = exposed.onMapMove(() => {});
            expect(typeof unsubscribe).toBe('function');
        }
    });

    it('project() returns null when the map instance is not yet ready', () => {
        const wrapper = mountWorldMap();
        const exposed = wrapper.vm as unknown as {
            project: (
                lngLat: [number, number]
            ) => {x: number; y: number} | null;
        };
        // happy-dom doesn't instantiate MapLibre, so mapRef is null — must return null safely.
        expect(exposed.project([13.41, 52.52])).toBeNull();
    });

    it('onMapMove() returns a no-op unsubscribe when map is not ready', () => {
        const wrapper = mountWorldMap();
        const exposed = wrapper.vm as unknown as {
            onMapMove: (cb: () => void) => () => void;
        };
        // Must not throw when map is null.
        const unsubscribe = exposed.onMapMove(() => {});
        expect(() => unsubscribe()).not.toThrow();
    });

    it('exposes flyTo as a function — safe to call when map is not ready', () => {
        const wrapper = mountWorldMap();
        const exposed = wrapper.vm as unknown as {
            flyTo?: (lng: number, lat: number) => void;
        };
        expect(typeof exposed.flyTo).toBe('function');
        expect(() => exposed.flyTo?.(13.41, 52.52)).not.toThrow();
    });
});
