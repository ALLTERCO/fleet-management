/** INTEGRATION: LocationKpiStrip wired with the real visibleKpisForKind
 *  helper. No mocks of the kind classifier — only the component DOM.
 *  Asserts the contract: the right kind shows the right metrics. */

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import LocationKpiStrip from '@/components/locations/LocationKpiStrip.vue';

const rollups = {
    deviceCount: 12,
    onlineSplit: {online: 10, offline: 2},
    alertCount: 3,
    powerSumWatts: 480,
    temperature: {avgCelsius: 22, count: 4}
} as const;

function captions(wrapper: ReturnType<typeof mount>): string[] {
    return wrapper.findAll('.lk__caption').map((n) => n.text());
}

describe('INTEGRATION: LocationKpiStrip honours kind visibility', () => {
    it('country kind shows devices + offline + alerts only', () => {
        const wrapper = mount(LocationKpiStrip, {
            props: {kind: 'country', ...rollups}
        });
        const labels = captions(wrapper);
        expect(labels).toContain('Devices online');
        expect(labels).toContain('Offline');
        expect(labels).toContain('Alerts');
        expect(labels).not.toContain('Power');
        expect(labels).not.toContain('Temperature');
    });

    it('site kind adds Power but keeps Temperature hidden', () => {
        const wrapper = mount(LocationKpiStrip, {
            props: {kind: 'site', ...rollups}
        });
        const labels = captions(wrapper);
        expect(labels).toContain('Power');
        expect(labels).not.toContain('Temperature');
    });

    it('zone kind reveals all five metrics', () => {
        const wrapper = mount(LocationKpiStrip, {
            props: {kind: 'zone', ...rollups}
        });
        const labels = captions(wrapper);
        expect(labels).toContain('Devices online');
        expect(labels).toContain('Offline');
        expect(labels).toContain('Alerts');
        expect(labels).toContain('Power');
        expect(labels).toContain('Temperature');
    });

    it('alert tile stays hidden when alertCount is zero regardless of kind', () => {
        const wrapper = mount(LocationKpiStrip, {
            props: {kind: 'zone', ...rollups, alertCount: 0}
        });
        expect(captions(wrapper)).not.toContain('Alerts');
    });

    it('reactively drops metrics when kind narrows live', async () => {
        const wrapper = mount(LocationKpiStrip, {
            props: {kind: 'zone', ...rollups}
        });
        expect(captions(wrapper)).toContain('Temperature');
        await wrapper.setProps({kind: 'country'});
        await nextTick();
        expect(captions(wrapper)).not.toContain('Temperature');
        expect(captions(wrapper)).not.toContain('Power');
    });
});
