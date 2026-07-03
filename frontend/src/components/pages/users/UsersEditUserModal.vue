<template>
    <Modal :visible="!!targetId" wide @close="$emit('close')">
        <template #title>
            <div class="edit-user-header">
                <span>Edit User — {{ targetLabel }}</span>
                <span
                    v-if="!isServiceUser"
                    class="edit-user-status"
                    :class="
                        targetActive
                            ? 'edit-user-status--active'
                            : 'edit-user-status--inactive'
                    "
                >
                    {{ targetActive ? 'Active' : 'Inactive' }}
                </span>
            </div>
        </template>

        <ModalTabRail
            :tabs="visibleTabs"
            :model-value="tabModel"
            aria-label="Edit user sections"
            @update:model-value="tabModel = $event as EditUserTab"
        />

        <div
            v-if="tabModel === 'profile' && !isServiceUser"
            class="edit-user-profile"
        >
            <FormField label="Username">
                <div class="edit-user-profile__readonly">
                    <span class="edit-user-profile__readonly-value">
                        {{ targetUserName }}
                    </span>
                    <span class="edit-user-profile__readonly-hint">
                        Cannot be changed after creation
                    </span>
                </div>
            </FormField>
            <div class="edit-user-profile__row">
                <FormField label="First Name">
                    <Input
                        v-model="form.firstName"
                        placeholder="First name"
                    />
                </FormField>
                <FormField label="Last Name">
                    <Input v-model="form.lastName" placeholder="Last name" />
                </FormField>
            </div>
            <div class="edit-user-profile__row">
                <FormField label="Display Name">
                    <Input
                        v-model="form.displayName"
                        placeholder="Display name"
                    />
                </FormField>
                <FormField label="Email">
                    <Input
                        v-model="form.email"
                        type="email"
                        placeholder="user@example.com"
                    />
                </FormField>
            </div>
        </div>

        <div v-else-if="tabModel === 'assignments'">
            <AssignmentsPanel
                v-if="targetId"
                subject-type="user"
                :subject-id="targetId"
                :subject-is-service-user="isServiceUser"
            />
        </div>

        <div v-else-if="tabModel === 'permissions'">
            <EffectivePermissionsPanel :user-id="targetId" />
        </div>

        <div v-else-if="tabModel === 'auth-methods' && !isServiceUser">
            <UserAuthMethodsPanel :user-id="targetId" />
        </div>

        <div v-else-if="tabModel === 'sessions' && !isServiceUser">
            <UserSessionsPanel :user-id="targetId" />
        </div>

        <template #footer>
            <div class="edit-user-footer">
                <div v-if="!isServiceUser" class="edit-user-footer__actions">
                    <Button type="blue-hollow" @click="$emit('reset-password')">
                        Reset Password
                    </Button>
                    <Button
                        v-if="targetActive"
                        type="red"
                        @click="$emit('toggle-active')"
                    >
                        Deactivate
                    </Button>
                    <Button
                        v-else-if="targetId"
                        type="green"
                        @click="$emit('toggle-active')"
                    >
                        Reactivate
                    </Button>
                </div>
                <div class="edit-user-footer__right">
                    <div v-if="saving" class="edit-user-footer__saving">
                        <Spinner size="sm" /> Saving...
                    </div>
                    <Button
                        v-if="tabModel === 'profile'"
                        type="blue"
                        :disabled="saving"
                        @click="$emit('save-profile')"
                    >
                        Save
                    </Button>
                </div>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import ModalTabRail, {
    type TabRailItem
} from '@/components/core/ModalTabRail.vue';
import Spinner from '@/components/core/Spinner.vue';
import Modal from '@/components/modals/Modal.vue';
import AssignmentsPanel from '@/components/panels/AssignmentsPanel.vue';
import EffectivePermissionsPanel from '@/components/panels/EffectivePermissionsPanel.vue';
import UserAuthMethodsPanel from '@/components/panels/UserAuthMethodsPanel.vue';
import UserSessionsPanel from '@/components/panels/UserSessionsPanel.vue';

export type EditUserTab =
    | 'profile'
    | 'assignments'
    | 'permissions'
    | 'auth-methods'
    | 'sessions';

export interface EditUserForm {
    firstName: string;
    lastName: string;
    displayName: string;
    email: string;
}

interface TabDescriptor extends TabRailItem {
    key: EditUserTab;
    serviceUserHidden?: boolean;
}

const TABS: readonly TabDescriptor[] = [
    {key: 'profile', label: 'Profile', icon: 'fa-user', serviceUserHidden: true},
    {key: 'assignments', label: 'Assignments', icon: 'fa-id-badge'},
    {key: 'permissions', label: 'Permissions', icon: 'fa-shield-halved'},
    {
        key: 'auth-methods',
        label: 'Auth Methods',
        icon: 'fa-key',
        serviceUserHidden: true
    },
    {key: 'sessions', label: 'Sessions', icon: 'fa-desktop', serviceUserHidden: true}
];

// form is a reactive() proxy from parent; nested v-model edits propagate.
const props = defineProps<{
    targetId: string | null;
    targetLabel: string;
    targetUserName: string;
    targetActive: boolean;
    isServiceUser: boolean;
    saving: boolean;
    form: EditUserForm;
}>();

const tabModel = defineModel<EditUserTab>('tab', {required: true});

const visibleTabs = computed<TabRailItem[]>(() =>
    TABS.filter((tab) => !(props.isServiceUser && tab.serviceUserHidden))
);

defineEmits<{
    close: [];
    'save-profile': [];
    'reset-password': [];
    'toggle-active': [];
}>();
</script>
