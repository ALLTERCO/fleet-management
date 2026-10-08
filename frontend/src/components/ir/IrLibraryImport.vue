<template>
    <div class="irli">
        <div class="irli__row">
            <FileUploadField
                accept=".csv,.ir"
                :loading="parsing"
                upload-label="Choose IRDB .csv or Flipper .ir"
                :show-delete="false"
                @upload="onFileChosen"
            />
            <span v-if="filename" class="irli__filename">{{ filename }}</span>
        </div>
        <div class="irli__row">
            <Input
                v-model="brand"
                placeholder="Brand (optional)"
                aria-label="Brand"
            />
            <Input
                v-model="deviceType"
                placeholder="Device type (optional)"
                aria-label="Device type"
            />
        </div>

        <div v-if="preview" class="irli__preview">
            <div class="irli__summary">
                Parsed {{ preview.parsed }}
                {{ preview.parsed === 1 ? 'code' : 'codes' }}
                ({{ formatLabel }})<template v-if="preview.skipped.length">
                    with {{ preview.skipped.length }} skipped</template
                >
            </div>
            <ul class="irli__codes">
                <li
                    v-for="(code, i) in preview.preview ?? []"
                    :key="i"
                    class="irli__code"
                >
                    <span class="irli__code-name">{{ code.name }}</span>
                    <span class="irli__code-protocol">{{
                        code.protocol ?? 'raw'
                    }}</span>
                </li>
            </ul>
            <ul v-if="preview.skipped.length" class="irli__skips">
                <li v-for="(skip, i) in preview.skipped" :key="i">
                    Line {{ skip.line }}: {{ skip.reason }}
                </li>
            </ul>
            <div class="irli__actions">
                <Button
                    type="blue"
                    size="sm"
                    :loading="importing"
                    @click="commit"
                    >Import {{ preview.parsed }}
                    {{ preview.parsed === 1 ? 'code' : 'codes' }}</Button
                >
                <Button type="white" size="sm" @click="reset">Cancel</Button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import FileUploadField from '@/components/core/FileUploadField.vue';
import Input from '@/components/core/Input.vue';
import {type IrImportResult, useIrLibraryStore} from '@/stores/irLibrary';
import {useToastStore} from '@/stores/toast';

const emit = defineEmits<{imported: [count: number]}>();

const store = useIrLibraryStore();
const toast = useToastStore();

const filename = ref('');
const content = ref('');
const brand = ref('');
const deviceType = ref('');
const parsing = ref(false);
const importing = ref(false);
const preview = ref<IrImportResult | null>(null);

const formatLabel = computed(() =>
    preview.value?.format === 'irdb_csv' ? 'IRDB CSV' : 'Flipper IR'
);

function reset(): void {
    filename.value = '';
    content.value = '';
    preview.value = null;
}

function importParams() {
    return {
        filename: filename.value,
        content: content.value,
        ...(brand.value.trim() ? {brand: brand.value.trim()} : {}),
        ...(deviceType.value.trim()
            ? {deviceType: deviceType.value.trim()}
            : {})
    };
}

async function onFileChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    parsing.value = true;
    preview.value = null;
    try {
        filename.value = file.name;
        content.value = await file.text();
        preview.value = await store.previewImport(importParams());
    } catch {
        toast.error('Could not read the selected file');
    } finally {
        parsing.value = false;
    }
}

async function commit(): Promise<void> {
    importing.value = true;
    try {
        const result = await store.commitImport(importParams());
        if (result) {
            emit('imported', result.imported);
            reset();
        }
    } finally {
        importing.value = false;
    }
}
</script>

<style scoped>
.irli {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.irli__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.irli__filename {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    overflow-wrap: anywhere;
}
.irli__preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
}
.irli__summary {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
}
.irli__codes {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 14rem;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
}
.irli__code {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-3);
    border-radius: var(--radius-sm);
    font-size: var(--type-caption);
}
.irli__code-name {
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
}
.irli__code-protocol {
    color: var(--color-text-tertiary);
    flex-shrink: 0;
}
.irli__skips {
    margin: 0;
    padding: 0 0 0 var(--space-4);
    color: var(--color-warning-text);
    font-size: var(--type-caption);
}
.irli__actions {
    display: flex;
    gap: var(--space-2);
}
</style>
