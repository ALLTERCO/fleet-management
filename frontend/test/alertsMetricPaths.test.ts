import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {sendRPC, onAlertEvent, toastError} = vi.hoisted(() => ({
    sendRPC: vi.fn(),
    onAlertEvent: vi.fn(() => () => {}),
    toastError: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({sendRPC, onAlertEvent}));
vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({error: toastError})
}));

import {useAlertsStore} from '@/stores/alerts';

describe('alerts store · listMetricPaths', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        sendRPC.mockReset();
        toastError.mockReset();
    });

    it('calls Rule.ListMetricPaths with the shellyID and returns the items', async () => {
        sendRPC.mockImplementation(async (_ns, method, params) => {
            if (method === 'alert.rule.listmetricpaths') {
                expect(params).toEqual({shellyID: 'shelly-abc'});
                return {
                    items: [
                        {component: 'temperature:0', field: 'tC', unit: '°C'},
                        {component: 'em:0', field: 'act_power', unit: 'W'}
                    ]
                };
            }
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useAlertsStore();
        const paths = await store.listMetricPaths('shelly-abc');

        expect(paths).toEqual([
            {component: 'temperature:0', field: 'tC', unit: '°C'},
            {component: 'em:0', field: 'act_power', unit: 'W'}
        ]);
    });

    it('returns an empty list and toasts when the call fails', async () => {
        sendRPC.mockRejectedValue(new Error('denied'));

        const store = useAlertsStore();
        const paths = await store.listMetricPaths('shelly-abc');

        expect(paths).toEqual([]);
        expect(toastError).toHaveBeenCalled();
    });

    it('calls Rule.ListComponentPaths and returns metric/state paths', async () => {
        sendRPC.mockImplementation(async (_ns, method, params) => {
            if (method === 'alert.rule.listcomponentpaths') {
                expect(params).toEqual({});
                return {
                    items: [
                        {
                            kind: 'metric',
                            component: 'temperature:0',
                            field: 'tC',
                            valueType: 'number'
                        },
                        {
                            kind: 'state',
                            component: 'switch:0',
                            field: 'output',
                            valueType: 'boolean',
                            values: [true, false]
                        }
                    ]
                };
            }
            throw new Error(`unexpected RPC ${method}`);
        });

        const store = useAlertsStore();
        const paths = await store.listComponentPaths();

        expect(paths).toEqual([
            {
                kind: 'metric',
                component: 'temperature:0',
                field: 'tC',
                valueType: 'number'
            },
            {
                kind: 'state',
                component: 'switch:0',
                field: 'output',
                valueType: 'boolean',
                values: [true, false]
            }
        ]);
    });
});
