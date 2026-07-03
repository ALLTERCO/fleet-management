<template>
    <Modal :visible="visible" wide @close="close">
        <template #title>
            <ModalHeader
                :icon="props.mode === 'create' ? 'fa-plus' : 'fa-pen'"
                :title="headerTitle"
                :description="headerDescription"
            />
        </template>

        <template #default>
            <form class="eet" autocomplete="off" @submit.prevent="handleSave">
                <section class="eet__section">
                    <header class="eet__section-hdr">
                        <h3 class="eet__section-title">Identity</h3>
                        <p class="eet__section-desc">
                            Names appear in the endpoint picker and alert rule
                            audit logs. Keep them short and describe the
                            audience — not the content.
                        </p>
                    </header>
                    <div class="eet__grid">
                        <div class="eet__field eet__field--wide">
                            <label class="eet__label" :for="nameId">
                                Name
                                <span class="eet__required" aria-hidden="true">*</span>
                            </label>
                            <Input
                                :id="nameId"
                                v-model="formName"
                                placeholder="e.g. Ops daily digest"
                                @blur="syncNameError"
                            />
                            <p v-if="nameError" class="eet__error" role="alert">
                                <i class="fas fa-circle-exclamation" />
                                {{ nameError }}
                            </p>
                        </div>
                        <div class="eet__field eet__field--wide">
                            <label class="eet__label" :for="descId">
                                Description
                            </label>
                            <Input
                                :id="descId"
                                v-model="formDescription"
                                placeholder="Optional — what this template is for"
                            />
                        </div>
                    </div>
                </section>

                <section class="eet__section">
                    <header class="eet__section-hdr">
                        <h3 class="eet__section-title">Template fields</h3>
                        <p class="eet__section-desc">
                            Fill at least one field. Empty fields fall back to
                            the branded defaults when the template is used.
                        </p>
                    </header>
                    <IntegrationTemplateEditor
                        :model-value="templateFields"
                        :fields="TEMPLATE_FIELDS"
                        @update:model-value="onTemplateFieldsUpdate"
                        @update:validity="onValidity"
                    />
                    <p v-if="bodyError" class="eet__error" role="alert">
                        <i class="fas fa-circle-exclamation" />
                        {{ bodyError }}
                    </p>
                </section>
            </form>
        </template>

        <template #footer>
            <ModalFooter>
                <template v-if="justSaved" #meta>
                    <span class="eet__flash">
                        <i class="fas fa-circle-check" />
                        {{ props.mode === 'create' ? 'Template created' : 'Changes saved' }}
                    </span>
                </template>
                <template #secondary>
                    <Button type="blue-hollow" @click="close">Cancel</Button>
                </template>
                <template #primary>
                    <Button
                        type="blue"
                        :loading="saving"
                        :disabled="!canSave"
                        :requires-write="true"
                        @click="handleSave"
                    >
                        {{ primaryLabel }}
                    </Button>
                </template>
            </ModalFooter>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, defineAsyncComponent, ref, useId, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import type {TemplateField} from '@/components/core/IntegrationTemplateEditor.vue';
import ModalFooter from '@/components/core/ModalFooter.vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import {useOptimisticSave} from '@/composables/useOptimisticSave';
import {useRequiredNameField} from '@/composables/useRequiredNameField';
import {type EmailTemplate, useNotificationsStore} from '@/stores/notifications';

const IntegrationTemplateEditor = defineAsyncComponent(
    () => import('@/components/core/IntegrationTemplateEditor.vue')
);

import Modal from './Modal.vue';

const TEMPLATE_FIELDS: TemplateField[] = [
    {
        key: 'subjectTemplate',
        label: 'Subject',
        mode: 'plain',
        placeholder: '[{{alert.severity | upper}}] {{rule.name}}',
        hint: 'Single-line subject. Supports tokens.'
    },
    {
        key: 'htmlTemplate',
        label: 'HTML',
        mode: 'html',
        placeholder: '<p>{{alert.title}}</p>',
        hint: 'HTML body.'
    },
    {
        key: 'textTemplate',
        label: 'Plain text',
        mode: 'plain',
        placeholder: '{{alert.title}}',
        hint: 'Plain-text fallback for clients that block HTML.'
    }
];

const visible = defineModel<boolean>({required: true});

const props = defineProps<{
    mode: 'create' | 'edit';
    initial?: EmailTemplate | null;
}>();

const emit = defineEmits<{saved: [EmailTemplate]}>();

const notificationsStore = useNotificationsStore();

const nameId = useId();
const descId = useId();

const formName = ref('');
const formDescription = ref('');
const templateFields = ref<Record<string, unknown>>({});

const {
    error: nameError,
    isValid: isNameValid,
    sync: syncNameError,
    reset: resetNameError
} = useRequiredNameField(formName);

const bodyError = ref('');

const {saving, justSaved, runOptimisticSave} =
    useOptimisticSave<EmailTemplate>({
        onSuccess: (saved) => {
            emit('saved', saved);
            close();
        }
    });

const headerTitle = computed(() =>
    props.mode === 'create'
        ? 'New email template'
        : `Edit "${props.initial?.name}"`
);

const headerDescription = computed(() =>
    props.mode === 'create'
        ? 'Save a reusable subject / HTML / text body. Endpoints pick templates from this library at delivery time.'
        : 'Update the template contents. Endpoints referencing this template will pick up changes on next delivery.'
);

const templateValidity = ref<Record<string, boolean>>({});
const areTemplatesValid = computed(() =>
    Object.values(templateValidity.value).every((ok) => ok !== false)
);
function onValidity(next: Record<string, boolean>) {
    templateValidity.value = next;
}

const canSave = computed(
    () => !saving.value && isNameValid.value && areTemplatesValid.value
);

const primaryLabel = computed(() => {
    if (justSaved.value) {
        return props.mode === 'create' ? 'Created' : 'Saved';
    }
    if (saving.value) {
        return props.mode === 'create' ? 'Creating…' : 'Saving…';
    }
    return props.mode === 'create' ? 'Create template' : 'Save changes';
});

watch(
    () => visible.value,
    (open) => {
        if (open) resetForm();
    },
    {immediate: true}
);

function resetForm() {
    const t = props.initial;
    formName.value = t?.name ?? '';
    formDescription.value = t?.description ?? '';
    templateFields.value = {
        subjectTemplate: t?.subjectTemplate ?? '',
        htmlTemplate: t?.htmlTemplate ?? '',
        textTemplate: t?.textTemplate ?? ''
    };
    resetNameError();
    bodyError.value = '';
}

function onTemplateFieldsUpdate(next: Record<string, unknown>) {
    templateFields.value = next;
    bodyError.value = '';
}

// Backend requires at least one body field (subject/html/text).
function hasAnyBody(): boolean {
    return (
        nonEmpty(templateFields.value.subjectTemplate) ||
        nonEmpty(templateFields.value.htmlTemplate) ||
        nonEmpty(templateFields.value.textTemplate)
    );
}

function nonEmpty(v: unknown): boolean {
    return String(v ?? '').trim().length > 0;
}

function syncBodyError(): void {
    bodyError.value = hasAnyBody()
        ? ''
        : 'Fill at least one of Subject, HTML, or Plain text.';
}

const isFormValid = computed(() => isNameValid.value && hasAnyBody());

async function handleSave() {
    syncNameError();
    syncBodyError();
    if (!isFormValid.value) return;
    await runOptimisticSave(persistTemplate);
}

function persistTemplate(): Promise<EmailTemplate | null> {
    const payload = buildPayload();
    if (props.mode === 'create') {
        return notificationsStore.createEmailTemplate(payload);
    }
    if (!props.initial) return Promise.resolve(null);
    return notificationsStore.updateEmailTemplate(props.initial.id, payload);
}

function buildPayload() {
    return {
        name: formName.value.trim(),
        description: formDescription.value.trim() || null,
        subjectTemplate: strOrNull(templateFields.value.subjectTemplate),
        htmlTemplate: strOrNull(templateFields.value.htmlTemplate),
        textTemplate: strOrNull(templateFields.value.textTemplate),
        attachments: []
    };
}

function strOrNull(v: unknown): string | null {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.length > 0 ? s : null;
}

function close() {
    visible.value = false;
}
</script>

<style scoped>
.eet {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}

.eet__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.eet__section-hdr {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.eet__section-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.eet__section-desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.45;
    max-width: 60ch;
}

.eet__section-desc code {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--color-surface-3);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
}

.eet__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
}

.eet__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.eet__field--wide {
    grid-column: 1 / -1;
}

.eet__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.eet__required {
    color: var(--color-danger-text);
    margin-left: var(--space-0-5);
}

.eet__error {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-danger-text);
    line-height: 1.4;
}

.eet__flash {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-success-text);
    font-weight: var(--font-semibold);
    animation: eet-flash-in var(--duration-normal) var(--ease-out);
}

@keyframes eet-flash-in {
    from {
        opacity: 0;
        transform: translateY(-2px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>
