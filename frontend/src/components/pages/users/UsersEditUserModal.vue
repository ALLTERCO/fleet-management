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

        <!-- Two columns: the rail is a sticky sidebar, not a block that
             stacks on top of the panel. Same shape as every other tab-rail
             modal in the app. -->
        <div class="edit-user-layout">
        <ModalTabRail
            :tabs="visibleTabs"
            :model-value="tabModel"
            aria-label="Edit user sections"
            @update:model-value="tabModel = $event as EditUserTab"
        />

        <div class="edit-user-panel">
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

        <!-- Never leave the panel blank: a service user whose selected tab is
             human-only would otherwise render nothing at all. -->
        <p v-else class="edit-user-empty">
            This section does not apply to a service user. Pick another
            section on the left.
        </p>
        </div>
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
                    <Button type="blue-hollow" @click="$emit('close')">
                        Close
                    </Button>
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

<style scoped>
/* Scoped here, not in the parent page: a parent's scoped styles never reach a
   child component's inner elements, so these rules only apply where the markup
   actually lives. */
.edit-user-header {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.edit-user-status {
    flex-shrink: 0;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    padding: 2px var(--gap-xs);
    border-radius: var(--radius-full);
}
.edit-user-status--active {
    color: var(--color-success-text);
    background-color: color-mix(in srgb, var(--color-success) 15%, transparent);
}
.edit-user-status--inactive {
    color: var(--color-danger-text);
    background-color: color-mix(in srgb, var(--color-danger) 15%, transparent);
}

/* Two columns: the rail is a sidebar, not a block that stacks on the panel. */
.edit-user-layout {
    display: grid;
    grid-template-columns: var(--form-tab-rail-width) minmax(0, 1fr);
    gap: var(--gap-md);
    align-items: start;
}
.edit-user-panel {
    min-width: 0;
}
.edit-user-empty {
    margin: 0;
    padding: var(--gap-md) 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.edit-user-profile {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
.edit-user-profile__row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap-sm);
}
.edit-user-profile__readonly {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--gap-2xs) var(--gap-xs);
    padding: var(--gap-xs) var(--gap-sm);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
}
.edit-user-profile__readonly-value {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.edit-user-profile__readonly-hint {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
}

.edit-user-footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--gap-xs);
    width: 100%;
}
.edit-user-footer__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-xs);
}
/* margin-left, not space-between: the left action group is absent for service
   users, and space-between would strand Save on the left. */
.edit-user-footer__right {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    margin-left: auto;
}
.edit-user-footer__saving {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

@media (max-width: 640px) {
    .edit-user-layout {
        grid-template-columns: 1fr;
        gap: var(--gap-sm);
    }
    .edit-user-profile__row {
        grid-template-columns: 1fr;
    }
}
</style>
