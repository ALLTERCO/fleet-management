import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import type {AlertState, AlertTransition} from '@api/alert';
import AlertStateBadge from '@/components/core/AlertStateBadge.vue';
import TransitionTimeline from '@/components/core/TransitionTimeline.vue';

const lifecycleStates: Array<{state: AlertState; label: string}> = [
    {state: 'pending', label: 'Pending'},
    {state: 'recovering', label: 'Recovering'},
    {state: 'no_data', label: 'No data'},
    {state: 'evaluation_error', label: 'Evaluation error'}
];

describe('AlertStateBadge lifecycle states', () => {
    it.each(lifecycleStates)('renders $state as $label', ({state, label}) => {
        const wrapper = mount(AlertStateBadge, {props: {state}});

        expect(wrapper.text()).toContain(label);
    });
});

function transition(action: AlertTransition['action']): AlertTransition {
    return {
        at: '2026-07-02T10:00:00.000Z',
        action,
        actor: null,
        data: {}
    };
}

describe('TransitionTimeline lifecycle actions', () => {
    it('renders the full alert lifecycle vocabulary', () => {
        const wrapper = mount(TransitionTimeline, {
            props: {
                transitions: [
                    transition('pending'),
                    transition('recovering'),
                    transition('cleared_unack'),
                    transition('cleared_ack'),
                    transition('no_data'),
                    transition('evaluation_error')
                ]
            }
        });

        expect(wrapper.text()).toContain('Pending');
        expect(wrapper.text()).toContain('Recovering');
        expect(wrapper.text()).toContain('Cleared (unack)');
        expect(wrapper.text()).toContain('Cleared');
        expect(wrapper.text()).toContain('No data');
        expect(wrapper.text()).toContain('Evaluation error');
    });
});
