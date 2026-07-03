/** Integration tests for CreateChannelModal — exercise the composition
 *  of type picker + per-type fieldset + name validation + save guard.
 *  Each test focuses on one observable behaviour. */

import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import CreateChannelModal, {
    type ChannelDraft
} from '@/components/modals/CreateChannelModal.vue';
import {_resetModalStackForTests} from '@/helpers/modalStack';
import {createEmailChannelConfigForm} from '@/helpers/notificationEmailConfig';

beforeEach(() => {
    setActivePinia(createPinia());
    _resetModalStackForTests();
    document.body.style.overflow = '';
});

afterEach(() => {
    for (const node of Array.from(
        document.body.querySelectorAll('.modal-root')
    )) {
        node.remove();
    }
});

function buildInitialDraft(
    overrides: Partial<ChannelDraft> = {}
): ChannelDraft {
    return {
        channelId: null,
        name: '',
        type: 'email_smtp',
        config: {
            email: createEmailChannelConfigForm(),
            webhook: {url: '', signingSecret: '', timeoutMs: 10000},
            slack: {url: '', channelOverride: ''},
            teams: {url: ''},
            telegram: {botToken: '', chatId: '', parseMode: ''}
        },
        quietHours: {start: '', end: '', timezone: ''},
        ...overrides
    };
}

describe('CreateChannelModal mounting', () => {
    it('renders the type picker with one option per configurable channel', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {visible: true, initialDraft: buildInitialDraft()}
        });
        await nextTick();
        expect(document.querySelectorAll('.ctp__option').length).toBe(6);
        wrapper.unmount();
    });

    it('starts in create-mode showing the "New channel" title', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {visible: true, initialDraft: buildInitialDraft()}
        });
        await nextTick();
        expect(document.body.textContent).toContain('New channel');
        wrapper.unmount();
    });

    it('shows the "Edit channel" title when an existing channelId is passed', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {
                visible: true,
                initialDraft: buildInitialDraft({channelId: 7, name: 'Ops'})
            }
        });
        await nextTick();
        expect(document.body.textContent).toContain('Edit channel');
        wrapper.unmount();
    });
});

describe('CreateChannelModal type switching', () => {
    it('swaps the per-type fieldset when a different type is picked', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {visible: true, initialDraft: buildInitialDraft()}
        });
        await nextTick();
        const slackOption = Array.from(
            document.querySelectorAll<HTMLButtonElement>('.ctp__option')
        ).find((node) => node.textContent?.includes('Slack'));
        slackOption?.click();
        await nextTick();
        expect(document.body.textContent).toContain('Slack webhook URL');
        wrapper.unmount();
    });

    it('shows no Teams help disclosure after picking Teams — fieldsets stay minimal', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {visible: true, initialDraft: buildInitialDraft()}
        });
        await nextTick();
        const teamsOption = Array.from(
            document.querySelectorAll<HTMLButtonElement>('.ctp__option')
        ).find((node) => node.textContent?.includes('Teams'));
        teamsOption?.click();
        await nextTick();
        expect(document.body.textContent).not.toContain(
            'How do I get a Teams workflow URL?'
        );
        wrapper.unmount();
    });
});

describe('CreateChannelModal save guard', () => {
    it('does not emit save when the form is invalid', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {visible: true, initialDraft: buildInitialDraft()}
        });
        await nextTick();
        const saveButton = Array.from(
            document.querySelectorAll<HTMLElement>('.ccm__footer button')
        ).find((node) => node.textContent?.includes('Save'));
        saveButton?.click();
        await nextTick();
        expect(wrapper.emitted('save')).toBeUndefined();
        wrapper.unmount();
    });

    it('reveals inline name error when Save is attempted with empty fields', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {visible: true, initialDraft: buildInitialDraft()}
        });
        await nextTick();
        const saveButton = Array.from(
            document.querySelectorAll<HTMLElement>('.ccm__footer button')
        ).find((node) => node.textContent?.includes('Save'));
        saveButton?.click();
        await nextTick();
        expect(document.body.textContent).toContain('Name is required');
        wrapper.unmount();
    });

    it('emits save with the populated draft when the form is valid', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {
                visible: true,
                initialDraft: buildInitialDraft({
                    name: 'Ops Email',
                    type: 'email_smtp',
                    config: {
                        ...buildInitialDraft().config,
                        email: {
                            ...createEmailChannelConfigForm(),
                            mode: 'use_system_smtp',
                            toAddresses: 'ops@example.com'
                        }
                    }
                })
            }
        });
        await nextTick();
        const saveButton = Array.from(
            document.querySelectorAll<HTMLElement>('.ccm__footer button')
        ).find((node) => node.textContent?.includes('Save'));
        saveButton?.click();
        await nextTick();
        const emitted = wrapper.emitted('save');
        expect(emitted).toBeTruthy();
        expect(emitted?.[0]?.[0]).toMatchObject({name: 'Ops Email'});
        wrapper.unmount();
    });
});

describe('CreateChannelModal test action', () => {
    it('hides the send-test button while creating a new channel', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {visible: true, initialDraft: buildInitialDraft()}
        });
        await nextTick();
        expect(document.querySelector('.ccm__test-btn')).toBeNull();
        wrapper.unmount();
    });

    it('shows the send-test button when editing an existing testable channel', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {
                visible: true,
                initialDraft: buildInitialDraft({channelId: 5, name: 'Slack'})
            }
        });
        await nextTick();
        expect(document.querySelector('.ccm__test-btn')).not.toBeNull();
        wrapper.unmount();
    });

    it('emits a test event when the send-test button is pressed', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {
                visible: true,
                initialDraft: buildInitialDraft({channelId: 5, name: 'Slack'})
            }
        });
        await nextTick();
        const testButton =
            document.querySelector<HTMLElement>('.ccm__test-btn');
        testButton?.click();
        await nextTick();
        expect(wrapper.emitted('test')).toBeTruthy();
        wrapper.unmount();
    });
});

describe('CreateChannelModal cancel', () => {
    it('emits close when Cancel is pressed', async () => {
        const wrapper = mount(CreateChannelModal, {
            attachTo: document.body,
            props: {visible: true, initialDraft: buildInitialDraft()}
        });
        await nextTick();
        const cancel = Array.from(
            document.querySelectorAll<HTMLElement>('.ccm__footer button')
        ).find((node) => node.textContent?.includes('Cancel'));
        cancel?.click();
        await nextTick();
        expect(wrapper.emitted('close')).toBeTruthy();
        wrapper.unmount();
    });
});
