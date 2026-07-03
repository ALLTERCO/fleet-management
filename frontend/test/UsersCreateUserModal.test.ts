import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import UsersCreateUserModal, {
    type CreateUserForm
} from '@/components/pages/users/UsersCreateUserModal.vue';
import {_resetModalStackForTests} from '@/helpers/modalStack';

beforeEach(() => {
    setActivePinia(createPinia());
    _resetModalStackForTests();
});

afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
});

function createForm(overrides: Partial<CreateUserForm> = {}): CreateUserForm {
    return {
        email: '',
        userName: '',
        firstName: '',
        lastName: '',
        password: '',
        passwordChangeRequired: true,
        groupIds: [],
        assignments: [],
        ...overrides
    };
}

function mountModal(form: CreateUserForm) {
    return mount(UsersCreateUserModal, {
        attachTo: document.body,
        props: {
            visible: true,
            creating: false,
            form,
            errors: {
                email: '',
                userName: '',
                firstName: '',
                lastName: '',
                password: ''
            },
            passwordRules: [
                {key: 'length', label: '12+ characters', valid: true},
                {key: 'number', label: 'Number', valid: false}
            ]
        }
    });
}

describe('UsersCreateUserModal', () => {
    it('renders a guided create-user layout instead of a flat field grid', async () => {
        const wrapper = mountModal(
            createForm({
                email: 'ada@example.com',
                userName: 'ada.lovelace',
                firstName: 'Ada',
                lastName: 'Lovelace'
            })
        );
        await nextTick();

        expect(document.body.textContent).toContain('Identity');
        expect(document.body.textContent).toContain('Sign-in');
        expect(document.body.textContent).toContain('Access');
        // Single-column guided layout: sectioned main, no preview side panel.
        expect(
            document.body.querySelector('.create-user__main')
        ).not.toBeNull();
        expect(document.body.querySelector('.create-user__side')).toBeNull();
        wrapper.unmount();
    });

    it('shows temporary-password status and password rules when a password is set', async () => {
        const wrapper = mountModal(
            createForm({
                userName: 'ops.user',
                password: 'temporary-pass-1'
            })
        );
        await nextTick();

        expect(document.body.textContent).toContain('Temporary password');
        expect(document.body.textContent).toContain('12+ characters');
        expect(document.body.textContent).toContain(
            'Require password change on first login'
        );
        wrapper.unmount();
    });
});
