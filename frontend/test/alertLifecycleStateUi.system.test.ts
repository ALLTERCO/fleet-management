import {flushPromises, mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {AlertState, AlertTransitionAction} from '@api/alert';
import AlertInstanceModal from '@/components/modals/AlertInstanceModal.vue';

const lifecycle = vi.hoisted(() => ({
    state: 'pending' as AlertState,
    action: 'pending' as AlertTransitionAction
}));

vi.mock('@/composables/useAlertInstance', async () => {
    const {computed, ref} = await import('vue');

    return {
        useAlertInstance: () => ({
            instance: computed(() => ({
                id: 42,
                organizationId: 'org',
                ruleId: 7,
                ruleName: 'Lifecycle rule',
                ruleKind: 'component_state',
                severity: 'warning',
                state: lifecycle.state,
                source: {subjectType: 'device', subjectId: 'hallway-relay'},
                title: 'Lifecycle test alert',
                message: 'A lifecycle state changed.',
                fingerprint: 'rule:7:device:hallway-relay:switch:0.output',
                activeSince: '2026-07-02T10:00:00.000Z',
                lastTriggeredAt: '2026-07-02T10:00:00.000Z',
                acknowledgedAt: null,
                acknowledgedBy: null,
                ackComment: null,
                resolvedAt: null,
                silencedUntil: null,
                silenceReason: null,
                counts: {notificationsCreated: 0, deliveryJobsCreated: 0},
                context: {component: 'switch:0', field: 'output'}
            })),
            source: computed(() => ({
                kind: 'Device',
                icon: 'fas fa-microchip',
                label: 'Hallway relay',
                to: null
            })),
            sourceDevice: computed(() => null),
            sourceGroup: computed(() => null),
            timeline: computed(() => [
                {
                    at: '2026-07-02T10:00:00.000Z',
                    action: lifecycle.action,
                    actor: null,
                    data: {}
                }
            ]),
            deliveryJobs: computed(() => []),
            loading: ref(false),
            silenceVisible: ref(false),
            silencedActive: computed(() => false),
            ageLabel: computed(() => 'just now'),
            hasContext: computed(() => true),
            contextPreview: computed(() =>
                JSON.stringify({component: 'switch:0', field: 'output'}, null, 2)
            ),
            canWrite: computed(() => false),
            formatTs: (ts: string) => ts,
            ack: vi.fn(),
            unack: vi.fn(),
            unsilence: vi.fn(),
            resolve: vi.fn(),
            onSilence: vi.fn()
        })
    };
});

const states: Array<{
    state: AlertState;
    action: AlertTransitionAction;
    label: string;
}> = [
    {state: 'pending', action: 'pending', label: 'Pending'},
    {state: 'recovering', action: 'recovering', label: 'Recovering'},
    {state: 'no_data', action: 'no_data', label: 'No data'},
    {
        state: 'evaluation_error',
        action: 'evaluation_error',
        label: 'Evaluation error'
    }
];

beforeEach(() => {
    setActivePinia(createPinia());
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('system — alert lifecycle state detail view', () => {
    it.each(states)(
        'renders $state in the alert header and activity timeline',
        async ({state, action, label}) => {
            lifecycle.state = state;
            lifecycle.action = action;

            const wrapper = mount(AlertInstanceModal, {
                attachTo: document.body,
                props: {
                    instanceId: 42,
                    modelValue: true
                },
                global: {
                    plugins: [createPinia()],
                    stubs: {
                        RouterLink: {template: '<a><slot /></a>'}
                    }
                }
            });

            await flushPromises();

            expect(document.body.textContent).toContain('Lifecycle test alert');
            expect(document.body.querySelector('.aim-head')?.textContent).toContain(
                label
            );
            expect(document.body.querySelector('.tt')?.textContent).toContain(
                label
            );

            wrapper.unmount();
        }
    );
});
