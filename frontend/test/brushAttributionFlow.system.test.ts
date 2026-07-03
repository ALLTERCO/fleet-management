// System-tier integration: brush → useWindowAttribution → DashAttributionPanel.
// Exercises the same wiring an Energy or Environment page uses, end-to-end:
//   1. user selects a window on the chart (we call setRange directly)
//   2. composable validates + debounces + calls Analytics.AttributeWindow
//   3. result flows reactively into the panel
//   4. switching the scope picker triggers a refetch
//   5. switching off-axis (e.g. HH:MM bucket) is rejected at the gate
// One asserted flow per behaviour — no implementation peek beyond the
// public composable + component API.

import type {AttributeWindowResult} from '@api/analytics';
import {flushPromises, mount} from '@vue/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defineComponent, h, ref} from 'vue';
import DashAttributionPanel from '@/components/dashboard/DashAttributionPanel.vue';
import type {DashboardScope} from '@/composables/useDashboardScope';
import {useWindowAttribution} from '@/composables/useWindowAttribution';

const sendRPC =
    vi.fn<
        (
            target: string,
            method: string,
            params: Record<string, unknown>
        ) => Promise<AttributeWindowResult | null>
    >();

vi.mock('@/tools/websocket', () => ({
    sendRPC: (
        target: string,
        method: string,
        params: Record<string, unknown>
    ) => sendRPC(target, method, params)
}));

const FROM = '2026-05-27T03:00:00Z';
const TO = '2026-05-27T04:00:00Z';

function makeResult(
    overrides: Partial<AttributeWindowResult> = {}
): AttributeWindowResult {
    return {
        metric: 'consumption',
        from: FROM,
        to: TO,
        aggregation: 'sum',
        unit: 'kWh',
        totalValue: 12,
        contributors: [
            {
                deviceId: 1,
                shellyID: 's-1',
                deviceName: 'Server room',
                value: 8,
                share: 0.67,
                sampleCount: 60
            },
            {
                deviceId: 2,
                shellyID: 's-2',
                deviceName: 'HVAC roof',
                value: 4,
                share: 0.33,
                sampleCount: 60
            }
        ],
        truncated: false,
        truncatedCount: 0,
        ...overrides
    };
}

// Test harness — composable lives inside setup() so it binds to the
// component's effect scope; the outer `bridge` ref lets the test drive
// scope changes and read the api back out.
function makeHarness(initialScope: DashboardScope) {
    const scope = ref<DashboardScope>(initialScope);
    const bridge: {api?: ReturnType<typeof useWindowAttribution>} = {};
    const Harness = defineComponent({
        setup() {
            const api = useWindowAttribution({
                metric: () => 'consumption',
                scope,
                topN: () => 10
            });
            bridge.api = api;
            return () =>
                h(DashAttributionPanel, {
                    range: api.range.value,
                    result: api.result.value,
                    loading: api.loading.value,
                    error: api.error.value,
                    closable: true,
                    onClose: () => api.setRange(null)
                });
        }
    });
    return {
        scope,
        Harness,
        get api(): ReturnType<typeof useWindowAttribution> {
            if (!bridge.api) throw new Error('Harness not yet mounted');
            return bridge.api;
        }
    };
}

describe('brush → attribution → panel (system)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        sendRPC.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders the contributor breakdown after a valid brush selection', async () => {
        sendRPC.mockResolvedValue(makeResult());
        const harness = makeHarness({kind: 'fleet'});
        const wrapper = mount(harness.Harness);

        harness.api.setRange({from: FROM, to: TO});
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        await wrapper.vm.$nextTick();

        expect(sendRPC).toHaveBeenCalledTimes(1);
        expect(wrapper.text()).toContain('Server room');
        expect(wrapper.text()).toContain('67%');
        expect(wrapper.text()).toContain('HVAC roof');
    });

    it('switches the scope picker → forwards the new axis to the RPC', async () => {
        sendRPC.mockResolvedValue(makeResult());
        const harness = makeHarness({kind: 'fleet'});
        mount(harness.Harness);

        harness.api.setRange({from: FROM, to: TO});
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(sendRPC.mock.calls[0]![2].scope).toEqual({});

        harness.scope.value = {kind: 'group', id: 7};
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(sendRPC).toHaveBeenCalledTimes(2);
        expect(sendRPC.mock.calls[1]![2].scope).toEqual({groupId: 7});
    });

    it('rejects non-ISO bucket strings at the gate — RPC never called', async () => {
        sendRPC.mockResolvedValue(makeResult());
        const harness = makeHarness({kind: 'fleet'});
        const wrapper = mount(harness.Harness);

        harness.api.setRange({from: '04:00', to: '05:00'});
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        await wrapper.vm.$nextTick();

        expect(sendRPC).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('Select a range');
    });

    it('clears the panel when the user closes it (range → null)', async () => {
        sendRPC.mockResolvedValue(makeResult());
        const harness = makeHarness({kind: 'fleet'});
        const wrapper = mount(harness.Harness);

        harness.api.setRange({from: FROM, to: TO});
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Server room');

        await wrapper.find('.dap__close').trigger('click');
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Select a range');
    });

    it('surfaces RPC errors on the panel as a retry-able state', async () => {
        sendRPC.mockRejectedValue(new Error('permission denied'));
        const harness = makeHarness({kind: 'fleet'});
        const wrapper = mount(harness.Harness);

        harness.api.setRange({from: FROM, to: TO});
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.dsx--error').exists()).toBe(true);
        expect(wrapper.text()).toContain('permission denied');
    });
});
