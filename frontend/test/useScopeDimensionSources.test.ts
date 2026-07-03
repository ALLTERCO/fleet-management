import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it} from 'vitest';
import {effectScope} from 'vue';
import {useScopeDimensionSources} from '@/composables/useScopeDimensionSources';
import {useAlertsStore} from '@/stores/alerts';
import {useDestinationsStore} from '@/stores/destinations';
import {useDevicesStore} from '@/stores/devices';
import {useChannelsStore} from '@/stores/channels';

beforeEach(() => {
    setActivePinia(createPinia());
});

function buildSources() {
    const scope = effectScope();
    const sources = scope.run(() => useScopeDimensionSources());
    if (!sources) throw new Error('composable returned nothing');
    return {scope, sources};
}

describe('useScopeDimensionSources', () => {
    it('labels devices by name with the shelly id as value', () => {
        const devices = useDevicesStore();
        (devices.devices as Record<string, unknown>)['shelly-abc'] = {
            shellyID: 'shelly-abc',
            info: {name: 'Boiler'}
        };
        const {scope, sources} = buildSources();
        expect(sources.device_ids?.options.value).toEqual([
            {value: 'shelly-abc', label: 'Boiler'}
        ]);
        scope.stop();
    });

    it('converts numeric ids to wire strings for alerts, destinations, integrations', () => {
        const alerts = useAlertsStore();
        alerts.rules = {1: {id: 1, name: 'High temp'}} as never;
        const destinations = useDestinationsStore();
        destinations.destinations = {2: {id: 2, name: 'Ops team'}} as never;
        const integrations = useChannelsStore();
        integrations.channels = {3: {id: 3, name: 'MQTT bridge'}} as never;

        const {scope, sources} = buildSources();
        expect(sources.alert_ids?.options.value).toEqual([
            {value: '1', label: 'High temp'}
        ]);
        expect(sources.notification_ids?.options.value).toEqual([
            {value: '2', label: 'Ops team'}
        ]);
        expect(sources.integration_keys?.options.value).toEqual([
            {value: '3', label: 'MQTT bridge'}
        ]);
        scope.stop();
    });

    it('sorts options by label', () => {
        const devices = useDevicesStore();
        (devices.devices as Record<string, unknown>).b = {
            shellyID: 'b',
            info: {name: 'Zeta'}
        };
        (devices.devices as Record<string, unknown>).a = {
            shellyID: 'a',
            info: {name: 'Alpha'}
        };
        const {scope, sources} = buildSources();
        expect(sources.device_ids?.options.value.map((o) => o.label)).toEqual([
            'Alpha',
            'Zeta'
        ]);
        scope.stop();
    });
});
