<template>
    <Modal :visible="visible" wide @close="close">
        <template #title>
            <ModalHeader
                :title="mode === 'create' ? 'New template' : `Edit “${initial?.name}”`"
            />
        </template>

        <form class="eat" autocomplete="off" @submit.prevent="handleSave">
            <div class="eat__row">
                <div class="eat__field">
                    <label class="eat__label" :for="nameId">
                        Name <span class="eat__req" aria-hidden="true">*</span>
                    </label>
                    <Input
                        :id="nameId"
                        v-model="formName"
                        placeholder="e.g. Critical incident"
                        @blur="syncNameError"
                    />
                    <p v-if="nameError" class="eat__error" role="alert">
                        <i class="fas fa-circle-exclamation" /> {{ nameError }}
                    </p>
                </div>
                <div class="eat__field">
                    <label class="eat__label" :for="descId">Description</label>
                    <Input
                        :id="descId"
                        v-model="formDescription"
                        placeholder="Optional"
                    />
                </div>
            </div>

            <MultiChannelTemplateEditor v-model="formBodies" />
        </form>

        <template #footer>
            <ModalFooter>
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
import {computed, ref, useId, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import ModalFooter from '@/components/core/ModalFooter.vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import MultiChannelTemplateEditor, {
    type MultiChannelTemplate
} from '@/components/core/MultiChannelTemplateEditor.vue';
import {useOptimisticSave} from '@/composables/useOptimisticSave';
import {useRequiredNameField} from '@/composables/useRequiredNameField';
import {type MessageTemplate, useAlertsStore} from '@/stores/alerts';
import Modal from './Modal.vue';

const visible = defineModel<boolean>({required: true});

const props = defineProps<{
    mode: 'create' | 'edit';
    initial?: MessageTemplate | null;
}>();

const emit = defineEmits<{saved: [MessageTemplate]}>();

const store = useAlertsStore();
const nameId = useId();
const descId = useId();

const formName = ref('');
const formDescription = ref('');
const formBodies = ref<MultiChannelTemplate>(emptyBodies());

const {
    error: nameError,
    isValid: isNameValid,
    sync: syncNameError,
    reset: resetNameError
} = useRequiredNameField(formName);

const {saving, runOptimisticSave} = useOptimisticSave<MessageTemplate>({
    onSuccess: (saved) => {
        emit('saved', saved);
        close();
    }
});

function emptyBodies(): MultiChannelTemplate {
    return {
        email: {subject: '', html: ''},
        slack: {blocks: ''},
        teams: {card: ''},
        fallback: {text: ''}
    };
}

// MessageTemplate.bodies (channels optional, email has text) ↔ editor model.
function fromTemplate(t: MessageTemplate | null | undefined): MultiChannelTemplate {
    return {
        email: {
            subject: t?.bodies.email?.subject ?? '',
            html: t?.bodies.email?.html ?? ''
        },
        slack: {blocks: t?.bodies.slack?.blocks ?? ''},
        teams: {card: t?.bodies.teams?.card ?? ''},
        fallback: {text: t?.fallbackText ?? ''}
    };
}

const fallbackFilled = computed(() => formBodies.value.fallback.text.trim().length > 0);
const canSave = computed(
    () => !saving.value && isNameValid.value && fallbackFilled.value
);
const primaryLabel = computed(() =>
    props.mode === 'create' ? 'Create template' : 'Save changes'
);

function close() {
    visible.value = false;
}

watch(
    visible,
    (open) => {
        if (!open) return;
        formName.value = props.initial?.name ?? '';
        formDescription.value = props.initial?.description ?? '';
        formBodies.value = fromTemplate(props.initial);
        resetNameError();
    },
    {immediate: true}
);

function buildDraft() {
    const b = formBodies.value;
    const bodies: MessageTemplate['bodies'] = {};
    if (b.email.subject.trim() || b.email.html.trim()) {
        bodies.email = {subject: b.email.subject, html: b.email.html, text: ''};
    }
    if (b.slack.blocks.trim()) bodies.slack = {blocks: b.slack.blocks};
    if (b.teams.card.trim()) bodies.teams = {card: b.teams.card};
    return {
        name: formName.value.trim(),
        description: formDescription.value.trim() || null,
        bodies,
        fallbackText: b.fallback.text
    };
}

async function handleSave() {
    syncNameError();
    if (!canSave.value) return;
    const draft = buildDraft();
    await runOptimisticSave(() =>
        props.mode === 'create'
            ? store.createTemplate(draft)
            : props.initial
              ? store.updateTemplate(props.initial.id, draft)
              : Promise.resolve(null)
    );
}
</script>

<style scoped>
.eat {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}
.eat__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: var(--space-4);
}
@media (max-width: 640px) {
    .eat__row {
        grid-template-columns: 1fr;
    }
}
.eat__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}
.eat__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.eat__req {
    color: var(--color-danger-text);
}
.eat__error {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-danger-text);
}
.eat__hint {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
</style>
