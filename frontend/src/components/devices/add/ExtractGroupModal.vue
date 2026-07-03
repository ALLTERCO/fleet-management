<template>
    <Modal :visible="visible" wide @close="$emit('close')">
        <template #title>
            <div class="egm__title">
                <i class="fas fa-up-right-from-square" />
                <span>Extract as device</span>
            </div>
        </template>

        <div class="egm">
            <div v-if="loading" class="egm__state">
                <Spinner size="md" /> <span>Loading preview…</span>
            </div>

            <div v-else-if="loadError" class="egm__state egm__state--error">
                <i class="fas fa-triangle-exclamation" />
                <span>{{ loadError }}</span>
                <Button type="blue-hollow" size="sm" @click="loadPreview">Retry</Button>
            </div>

            <div v-else-if="preview?.alreadyExtracted" class="egm__state">
                <i class="fas fa-circle-info" />
                <span>
                    This group has already been extracted as
                    <strong>{{ preview.extractedExternalId }}</strong>.
                </span>
            </div>

            <div v-else-if="preview">
                <p class="egm__hint">
                    Promotes the
                    <strong>{{ preview.sourceKey }}</strong>
                    group on
                    <strong>{{ preview.hostExternalId }}</strong>
                    into its own device. The host stays where it is — the
                    new device just becomes the place where this group's
                    history, alerts and dashboards live.
                </p>

                <div class="egm__grid">
                    <FormField label="Name">
                        <Input v-model="form.name" autocomplete="off" />
                    </FormField>
                    <FormField label="Type">
                        <Input v-model="form.typeKey" autocomplete="off" />
                    </FormField>
                    <FormField label="Category">
                        <select v-model="form.categoryKey" class="egm__select">
                            <option :value="null">— None —</option>
                            <option
                                v-for="cat in CATEGORIES"
                                :key="cat.key"
                                :value="cat.key"
                            >
                                {{ cat.label }}
                            </option>
                        </select>
                    </FormField>
                </div>

                <section class="egm__roles">
                    <h6>
                        Roles ({{ preview.roles.length }})
                    </h6>
                    <ul>
                        <li v-for="role in preview.roles" :key="role.roleKey">
                            <span class="egm__role-label">{{ role.label }}</span>
                            <span class="egm__role-meta">
                                {{ role.valueType
                                }}<template v-if="roleUnit(role.roleKey)">
                                    · {{ roleUnit(role.roleKey) }}</template
                                >
                            </span>
                            <span class="egm__role-src">
                                from {{ role.componentKey }}
                            </span>
                        </li>
                    </ul>
                </section>

                <div v-if="createError" class="egm__error">
                    {{ createError }}
                </div>
            </div>
        </div>

        <template #footer>
            <div class="egm__footer">
                <Button type="blue-hollow" size="sm" @click="$emit('close')">
                    Cancel
                </Button>
                <Button
                    v-if="preview && !preview.alreadyExtracted"
                    type="green"
                    size="sm"
                    :disabled="!form.name.trim()"
                    :loading="creating"
                    @click="onCreate"
                >
                    Extract
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {
    type ExtractionPreview,
    virtualDevices
} from '@host/virtualDevices';
import {reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import Spinner from '@/components/core/Spinner.vue';
import Modal from '@/components/modals/Modal.vue';
import {DEVICE_CATEGORIES} from '@/helpers/deviceCategories';

const CATEGORIES = DEVICE_CATEGORIES;

const props = defineProps<{
    visible: boolean;
    hostExternalId: string;
    sourceKey: string;
}>();

const emit = defineEmits<{
    close: [];
    extracted: [externalId: string];
}>();

const preview = ref<ExtractionPreview | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const creating = ref(false);
const createError = ref<string | null>(null);

const form = reactive({
    name: '',
    typeKey: '',
    categoryKey: null as string | null
});

async function loadPreview(): Promise<void> {
    loading.value = true;
    loadError.value = null;
    try {
        const res = await virtualDevices.extraction.preview({
            hostExternalId: props.hostExternalId,
            sourceKey: props.sourceKey
        });
        preview.value = res;
        form.name = res.name;
        form.typeKey = res.typeKey;
        form.categoryKey = res.categoryKey ?? null;
    } catch (err) {
        loadError.value = err instanceof Error ? err.message : String(err);
        preview.value = null;
    } finally {
        loading.value = false;
    }
}

async function onCreate(): Promise<void> {
    if (!preview.value) return;
    creating.value = true;
    createError.value = null;
    try {
        const created = await virtualDevices.extraction.create({
            hostExternalId: props.hostExternalId,
            sourceKey: props.sourceKey,
            name: form.name.trim(),
            typeKey: form.typeKey.trim() || undefined,
            categoryKey: form.categoryKey ?? undefined
        });
        emit('extracted', created.externalId);
        emit('close');
    } catch (err) {
        createError.value = err instanceof Error ? err.message : String(err);
    } finally {
        creating.value = false;
    }
}

function roleUnit(roleKey: string): string | null {
    return (
        preview.value?.sourceSnapshot.members.find(
            (member) => member.roleKey === roleKey
        )?.unit ?? null
    );
}

watch(
    () => [props.visible, props.hostExternalId, props.sourceKey] as const,
    ([open]) => {
        if (open) loadPreview();
    },
    {immediate: true}
);
</script>

<style scoped>
.egm__title {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    color: var(--color-text-primary);
}
.egm__title i {
    color: var(--brand-light);
}
.egm {
    display: grid;
    gap: var(--gap-lg);
    min-height: 240px;
}
.egm__state {
    display: grid;
    place-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-xl);
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-md);
    min-height: 200px;
    text-align: center;
}
.egm__state--error i {
    color: var(--color-warning-text);
    font-size: var(--type-subheading);
}
.egm__hint {
    margin: 0 0 var(--gap-md) 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    line-height: var(--leading-snug);
}
.egm__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--gap-md);
    margin-bottom: var(--gap-lg);
}
.egm__select {
    width: 100%;
    min-height: var(--touch-target-min);
    padding: 0 var(--gap-sm);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
}
.egm__roles {
    padding: var(--gap-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}
.egm__roles h6 {
    margin: 0 0 var(--gap-sm) 0;
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    color: var(--color-text-tertiary);
}
.egm__roles ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
}
.egm__roles li {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: var(--gap-sm);
    align-items: baseline;
    font-size: var(--type-body);
    color: var(--color-text-primary);
}
.egm__role-label {
    font-weight: var(--font-medium);
}
.egm__role-meta {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.egm__role-src {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.egm__error {
    margin-top: var(--gap-md);
    padding: var(--gap-sm);
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-radius: var(--radius-sm);
    font-size: var(--type-body);
}
.egm__footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-sm);
}
</style>
