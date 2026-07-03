<template>
    <Modal :visible="visible" @close="$emit('close')">
        <template #title>Create user</template>
        <form class="create-user" @submit.prevent="$emit('submit')">
            <section class="create-user__main">
                <FormSection icon="fas fa-address-card" title="Identity">
                    <div class="cu-avatar-field">
                        <button
                            type="button"
                            class="cu-avatar"
                            :title="pictureFile ? 'Change photo' : 'Upload photo'"
                            :aria-label="pictureFile ? 'Change photo' : 'Upload photo'"
                            @click="pictureInput?.click()"
                        >
                            <img v-if="picturePreview" :src="picturePreview" alt="" />
                            <span v-else-if="initials" class="cu-avatar__initials">
                                {{ initials }}
                            </span>
                            <i v-else class="fas fa-user cu-avatar__placeholder" aria-hidden="true" />
                            <span class="cu-avatar__badge">
                                <i class="fas fa-camera" aria-hidden="true" />
                            </span>
                        </button>
                        <button
                            v-if="pictureFile"
                            type="button"
                            class="cu-avatar__remove"
                            @click="clearPicture"
                        >
                            Remove photo
                        </button>
                        <input
                            ref="pictureInput"
                            type="file"
                            accept="image/*"
                            class="cu-file"
                            @change="onPicture"
                        />
                    </div>
                    <div class="create-user__grid">
                        <FormField label="Email" :error="errors.email">
                            <Input
                                v-model="form.email"
                                type="email"
                                placeholder="name@company.com"
                                autocomplete="email"
                                @blur="$emit('validate', 'email')"
                            />
                        </FormField>
                        <FormField label="Username" :error="errors.userName">
                            <Input
                                v-model="form.userName"
                                placeholder="name.company"
                                autocomplete="username"
                                @blur="$emit('validate', 'userName')"
                            />
                        </FormField>
                        <FormField label="First name" :error="errors.firstName">
                            <Input
                                v-model="form.firstName"
                                placeholder="First"
                                autocomplete="given-name"
                                @blur="$emit('validate', 'firstName')"
                            />
                        </FormField>
                        <FormField label="Last name" :error="errors.lastName">
                            <Input
                                v-model="form.lastName"
                                placeholder="Last"
                                autocomplete="family-name"
                                @blur="$emit('validate', 'lastName')"
                            />
                        </FormField>
                    </div>
                </FormSection>

                <FormSection icon="fas fa-key" title="Sign-in">
                    <FormField label="Temporary password" optional :error="errors.password">
                        <Input
                            v-model="form.password"
                            type="password"
                            autocomplete="new-password"
                            placeholder="Send setup email instead"
                            @blur="$emit('validate', 'password')"
                        />
                    </FormField>
                    <div v-if="form.password" class="create-user-rules">
                        <div
                            v-for="rule in passwordRules"
                            :key="rule.key"
                            class="create-user-rules__item"
                            :class="
                                rule.valid
                                    ? 'create-user-rules__item--ok'
                                    : 'create-user-rules__item--pending'
                            "
                        >
                            <i
                                :class="rule.valid ? 'fas fa-check' : 'fas fa-circle'"
                                aria-hidden="true"
                            />
                            <span>{{ rule.label }}</span>
                        </div>
                    </div>
                    <Checkbox
                        v-if="form.password"
                        v-model="form.passwordChangeRequired"
                        label="Require password change on first login"
                    />
                </FormSection>

                <FormSection
                    icon="fas fa-user-shield"
                    title="Access"
                    badge="optional"
                >
                    <FormField label="Persona">
                        <Dropdown
                            :groups="personaDropdownGroups"
                            :default="selectedPersonaId"
                            searchable
                            @selected="(v: unknown) => (selectedPersonaId = String(v))"
                        />
                    </FormField>
                    <FormField label="Groups">
                        <div v-if="groups.length" class="cu-checklist">
                            <Checkbox
                                v-for="group in groups"
                                :key="group.id"
                                :model-value="form.groupIds.includes(group.id)"
                                :label="group.name"
                                @update:model-value="toggleGroup(group.id)"
                            />
                        </div>
                        <p v-else class="cu-empty">
                            No user groups yet — create them in Settings.
                        </p>
                    </FormField>

                    <details class="cu-advanced">
                        <summary>Advanced — scoped role grants</summary>
                        <ServiceUserAccessPanel
                            :group-ids="form.groupIds"
                            :assignments="form.assignments"
                            :role="''"
                            subject-label="user"
                            :show-pat-note="false"
                            :show-groups="false"
                            :include-system="true"
                            @update:group-ids="form.groupIds = $event"
                            @update:assignments="form.assignments = $event"
                        />
                    </details>
                </FormSection>
            </section>
        </form>
        <template #footer>
            <div class="create-user-footer">
                <Button type="blue-hollow" @click="$emit('close')">Cancel</Button>
                <Button
                    type="green"
                    :disabled="creating"
                    @click="$emit('submit')"
                >
                    {{ creating ? 'Creating...' : 'Create' }}
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FormField from '@/components/core/FormField.vue';
import FormSection from '@/components/core/FormSection.vue';
import Input from '@/components/core/Input.vue';
import Modal from '@/components/modals/Modal.vue';
import ServiceUserAccessPanel from '@/components/panels/ServiceUserAccessPanel.vue';
import type {ServiceUserAccessAssignment} from '@/helpers/serviceUserAccessPlan';
import {usePersonasStore} from '@/stores/personas';
import {useUserGroupsStore} from '@/stores/userGroups';

export type CreateUserField =
    | 'email'
    | 'userName'
    | 'firstName'
    | 'lastName'
    | 'password';

export type CreateUserForm = Record<CreateUserField, string> & {
    passwordChangeRequired: boolean;
    groupIds: string[];
    assignments: ServiceUserAccessAssignment[];
};

export interface PasswordRule {
    key: string;
    label: string;
    valid: boolean;
}

const props = defineProps<{
    visible: boolean;
    creating: boolean;
    form: CreateUserForm;
    errors: Record<CreateUserField, string>;
    passwordRules: readonly PasswordRule[];
}>();

defineEmits<{
    close: [];
    submit: [];
    validate: [field: CreateUserField];
}>();

const personasStore = usePersonasStore();
const userGroupsStore = useUserGroupsStore();

// The dropdown lists existing custom personas; advanced grants stay separate.
const personas = computed(() =>
    Object.values(personasStore.personas).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
);
const groups = computed(() =>
    Object.values(userGroupsStore.groups).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
);

const personaDropdownGroups = computed(() => [
    {
        label: 'Personas',
        items: [
            {value: '', label: 'No persona'},
            ...personas.value.map((p) => ({value: p.id, label: p.name}))
        ]
    }
]);

function toggleGroup(id: string): void {
    props.form.groupIds = props.form.groupIds.includes(id)
        ? props.form.groupIds.filter((g) => g !== id)
        : [...props.form.groupIds, id];
}

// Avatar fallback = the user's initials (Gmail/Dropbox/Apple convention),
// not a generic icon — so the placeholder reflects the person being created.
const initials = computed(() => {
    const first = props.form.firstName.trim()[0] ?? '';
    const last = props.form.lastName.trim()[0] ?? '';
    const combined = `${first}${last}`.toUpperCase();
    if (combined) return combined;
    const user = props.form.userName.trim()[0];
    return user ? user.toUpperCase() : '';
});

// The simple dropdown owns the single full-access ("all" scope) grant; any
// scoped grants added under Advanced are preserved alongside it.
const selectedPersonaId = computed<string>({
    get: () =>
        props.form.assignments.find((a) => a.scope?.all)?.personaId ?? '',
    set: (id) => {
        const scoped = props.form.assignments.filter((a) => !a.scope?.all);
        props.form.assignments = id
            ? [...scoped, {personaId: id, scope: {all: true}}]
            : scoped;
    }
});

onMounted(() => {
    void personasStore.fetchAll(true);
    void userGroupsStore.fetchAll();
});

// Picked avatar is held by the parent (uploaded after the user exists).
const pictureFile = defineModel<File | null>('pictureFile', {default: null});
const pictureInput = ref<HTMLInputElement | null>(null);
const picturePreview = ref('');

function revokePreview(): void {
    if (picturePreview.value) URL.revokeObjectURL(picturePreview.value);
}

function onPicture(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (!file) return;
    revokePreview();
    pictureFile.value = file;
    picturePreview.value = URL.createObjectURL(file);
}

function clearPicture(): void {
    revokePreview();
    pictureFile.value = null;
    picturePreview.value = '';
    if (pictureInput.value) pictureInput.value.value = '';
}

watch(pictureFile, (file) => {
    if (!file) {
        revokePreview();
        picturePreview.value = '';
    }
});

onBeforeUnmount(revokePreview);
</script>

<style scoped>
.create-user {
    display: grid;
    gap: var(--gap-lg);
}
.create-user__main {
    display: grid;
    gap: var(--gap-md);
}
/* Click the avatar itself to upload — camera badge signals it's editable. */
.cu-avatar-field {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--gap-xs);
}
.cu-avatar {
    position: relative;
    width: var(--space-20);
    height: var(--space-20);
    padding: 0;
    border: 0;
    cursor: pointer;
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    color: var(--color-text-tertiary);
    display: grid;
    place-items: center;
    transition: filter var(--motion-hover);
}
.cu-avatar:hover {
    filter: brightness(var(--hover-brightness));
}
.cu-avatar:focus-visible {
    outline: var(--focus-ring-width) solid var(--color-primary);
    outline-offset: var(--focus-ring-offset);
}
.cu-avatar img {
    width: 100%;
    height: 100%;
    border-radius: var(--radius-full);
    object-fit: cover;
}
.cu-avatar__placeholder {
    font-size: var(--icon-size-lg);
}
.cu-avatar__initials {
    font-size: var(--type-subheading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    text-transform: uppercase;
}
.cu-avatar__badge {
    position: absolute;
    right: 0;
    bottom: 0;
    width: var(--space-6);
    height: var(--space-6);
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--color-primary);
    color: var(--color-text-inverse);
    font-size: var(--type-caption);
    border: var(--space-0-5) solid var(--color-surface-1);
}
.cu-avatar__remove {
    border: 0;
    background: transparent;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    cursor: pointer;
}
.cu-avatar__remove:hover {
    color: var(--color-danger-text);
}
.cu-file {
    display: none;
}
.cu-checklist {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}
.cu-empty {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.cu-advanced > summary {
    cursor: pointer;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    padding: var(--gap-xs) 0;
}
.cu-advanced[open] > summary {
    margin-bottom: var(--gap-sm);
    color: var(--color-text-secondary);
}
/* Single-column form — better comprehension + accessibility (USWDS / CXL). */
.create-user__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--gap-md);
}
.create-user-rules {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--gap-xs);
}
.create-user-rules__item {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    min-width: 0;
    font-size: var(--type-body);
}
.create-user-rules__item--ok {
    color: var(--color-success-text);
}
.create-user-rules__item--pending {
    color: var(--color-text-tertiary);
}
.create-user-rules__item i {
    width: var(--icon-size-sm);
    font-size: var(--type-caption);
}
.create-user-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-xs);
}
</style>
