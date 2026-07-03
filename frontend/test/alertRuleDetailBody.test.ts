// The shared body for the rule preview popup and the rule detail page.
// One component so the two surfaces can't drift.

import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {sendRPC, onAlertEvent, close, toastError} = vi.hoisted(() => ({
    sendRPC: vi.fn(),
    onAlertEvent: vi.fn(() => () => {}),
    close: vi.fn(),
    toastError: vi.fn()
}));
vi.mock('@/tools/websocket', () => ({sendRPC, onAlertEvent, close}));
vi.mock('@/stores/toast', () => ({useToastStore: () => ({error: toastError})}));

import type {AlertRule} from '@api/alert';
import AlertRuleDetailBody from '@/components/core/AlertRuleDetailBody.vue';

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
    return {
        id: 7,
        organizationId: 'org',
        name: 'Relay watch',
        kind: 'component_state',
        severity: 'info',
        enabled: true,
        scope: {deviceIds: [1, 2]},
        config: {component: 'switch:0', field: 'output', equals: true},
        destinationChannelIds: [],
        destinationGroupIds: [],
        dedupeWindowSec: 0,
        cooldownSec: 0,
        autoResolve: true,
        summaryTemplate: null,
        messageTemplate: null,
        runbookUrl: null,
        deliveryMode: 'instant',
        digestWindowMinutes: null,
        templateId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null,
        ...overrides
    } as AlertRule;
}

beforeEach(() => {
    setActivePinia(createPinia());
    sendRPC.mockReset();
    onAlertEvent.mockClear();
});

describe('AlertRuleDetailBody', () => {
    it('shows the severity, enabled state and the plain-English condition', () => {
        const wrapper = mount(AlertRuleDetailBody, {props: {rule: rule()}});
        expect(wrapper.text()).toContain('Enabled');
        expect(wrapper.text()).toContain('a relay turns on');
    });

    it('reflects a disabled rule', () => {
        const wrapper = mount(AlertRuleDetailBody, {
            props: {rule: rule({enabled: false})}
        });
        expect(wrapper.text()).toContain('Disabled');
    });

    it('summarises the scope', () => {
        const wrapper = mount(AlertRuleDetailBody, {props: {rule: rule()}});
        expect(wrapper.text()).toContain('2 device');
    });
});
