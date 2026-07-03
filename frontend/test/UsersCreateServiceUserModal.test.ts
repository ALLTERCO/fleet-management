import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick, reactive} from 'vue';
import UsersCreateServiceUserModal, {
    type ServiceUserCreatedKey,
    type ServiceUserCreateForm
} from '@/components/pages/users/UsersCreateServiceUserModal.vue';
import {_resetModalStackForTests} from '@/helpers/modalStack';

beforeEach(() => {
    setActivePinia(createPinia());
    _resetModalStackForTests();
});

afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
});

function createForm(
    overrides: Partial<ServiceUserCreateForm> = {}
): ServiceUserCreateForm {
    return reactive({
        userName: '',
        name: '',
        description: '',
        personaId: '',
        scopeAll: true,
        scope: {},
        accessReason: '',
        accessExpiresDays: '365',
        keyName: '',
        expirationDays: '365',
        ...overrides
    });
}

function mountModal(
    opts: {
        form?: Partial<ServiceUserCreateForm>;
        personaKey?: string;
        result?: ServiceUserCreatedKey | null;
    } = {}
) {
    return mount(UsersCreateServiceUserModal, {
        attachTo: document.body,
        props: {
            visible: true,
            creating: false,
            form: createForm(opts.form),
            errors: {userName: '', name: ''},
            personaOptions: [
                {label: 'Roles', items: [{value: 'persona-1', label: 'Admin'}]}
            ],
            personaKey: opts.personaKey,
            result: opts.result ?? null
        },
        // The role dropdown and scope picker aren't under test here.
        global: {stubs: {Dropdown: true, BoundaryScopePicker: true}}
    });
}

function findButton(label: string): HTMLButtonElement | undefined {
    return [...document.body.querySelectorAll('button')].find((b) =>
        b.textContent?.includes(label)
    );
}

async function clickNext(): Promise<void> {
    findButton('Next')?.click();
    await nextTick();
}

describe('UsersCreateServiceUserModal', () => {
    it('renders a three-step wizard rail', async () => {
        const wrapper = mountModal();
        await nextTick();
        const text = document.body.textContent ?? '';
        expect(text).toContain('Details');
        expect(text).toContain('Access');
        expect(text).toContain('API key');
        wrapper.unmount();
    });

    it('blocks Next on details until a name is given', async () => {
        const wrapper = mountModal();
        await nextTick();
        expect(findButton('Next')?.disabled).toBe(true);
        wrapper.unmount();
    });

    it('derives the username from the name', async () => {
        const wrapper = mountModal();
        await nextTick();
        const nameInput = document.body.querySelector(
            'input[placeholder="e.g. CI pipeline"]'
        ) as HTMLInputElement;
        nameInput.value = 'CI Pipeline #2';
        nameInput.dispatchEvent(new Event('input'));
        await nextTick();
        expect(wrapper.props('form').userName).toBe('ci-pipeline-2');
        wrapper.unmount();
    });

    it('blocks Next on access until a role is picked', async () => {
        const wrapper = mountModal({form: {name: 'CI', userName: 'ci'}});
        await nextTick();
        await clickNext();
        expect(findButton('Next')?.disabled).toBe(true);
        wrapper.unmount();
    });

    it('blocks Next on access when scoped to nothing', async () => {
        const wrapper = mountModal({
            form: {
                name: 'CI',
                userName: 'ci',
                personaId: 'persona-1',
                scopeAll: false,
                scope: {}
            }
        });
        await nextTick();
        await clickNext();
        expect(findButton('Next')?.disabled).toBe(true);
        wrapper.unmount();
    });

    it('reaches the key step and creates once details and access are ready', async () => {
        const wrapper = mountModal({
            form: {name: 'CI', userName: 'ci', personaId: 'persona-1'}
        });
        await nextTick();
        await clickNext();
        await clickNext();
        const text = document.body.textContent ?? '';
        expect(text).toContain('Ready to create');
        expect(text).toContain('Admin');
        const create = findButton('Create & generate key');
        expect(create?.disabled).toBe(false);
        create?.click();
        await nextTick();
        expect(wrapper.emitted('submit')).toBeTruthy();
        wrapper.unmount();
    });

    it('demands a reason before admin gets everything', async () => {
        const wrapper = mountModal({
            form: {name: 'CI', userName: 'ci', personaId: 'persona-1'},
            personaKey: 'admin'
        });
        await nextTick();
        await clickNext();
        const text = document.body.textContent ?? '';
        expect(text).toContain('Why full access?');
        expect(findButton('Next')?.disabled).toBe(true);
        wrapper.props('form').accessReason = 'CI rollout';
        await nextTick();
        expect(findButton('Next')?.disabled).toBe(false);
        wrapper.unmount();
    });

    it('disables later step buttons until earlier steps are complete', async () => {
        const wrapper = mountModal();
        await nextTick();
        expect(findButton('Access')?.disabled).toBe(true);
        expect(findButton('API key')?.disabled).toBe(true);
        wrapper.unmount();
    });

    it('navigates back from access to details', async () => {
        const wrapper = mountModal({form: {name: 'CI', userName: 'ci'}});
        await nextTick();
        await clickNext();
        findButton('Back')?.click();
        await nextTick();
        const text = document.body.textContent ?? '';
        expect(text).toContain('signs in with an API key');
        wrapper.unmount();
    });

    it('reveals the key once with a shown-once warning, hiding the form', async () => {
        const wrapper = mountModal({
            result: {userName: 'api-worker', token: 'fmk_test_abc123'}
        });
        await nextTick();
        const text = document.body.textContent ?? '';
        expect(text).toContain('api-worker is ready');
        expect(text).toContain('fmk_test_abc123');
        expect(text).toContain("won't be shown again");
        // Configure fields are gone in the reveal phase.
        expect(text).not.toContain('Key expires after');
        wrapper.unmount();
    });

    it('emits copy and done from the reveal footer', async () => {
        const wrapper = mountModal({
            result: {userName: 'api-worker', token: 'fmk_test_abc123'}
        });
        await nextTick();
        findButton('Copy')?.click();
        findButton('Done')?.click();
        await nextTick();
        expect(wrapper.emitted('copy')).toBeTruthy();
        expect(wrapper.emitted('done')).toBeTruthy();
        wrapper.unmount();
    });
});
