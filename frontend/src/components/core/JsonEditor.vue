<template>
    <div class="je">
        <div class="je-toolbar">
            <Button type="blue-hollow" size="xs" @click="formatJson">Format</Button>
            <Button type="blue-hollow" size="xs" @click="copyContent">Copy</Button>
            <span v-if="!isValid" class="je-error"><i class="fas fa-triangle-exclamation" /> Invalid JSON</span>
            <span v-if="undefinedVars.length" class="je-warn">
                <i class="fas fa-triangle-exclamation" /> Undefined: {{ undefinedVars.map(v => '${' + v + '}').join(', ') }}
            </span>
        </div>
        <div ref="editorRef" class="je-editor" />
    </div>
</template>

<script setup lang="ts">
import {
    ACTION_VARIABLES_META_REGISTRY,
    ACTION_VARIABLES_REGISTRY
} from '@api/registryNames';
import {computed, onMounted, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import {useCodeMirror} from '@/composables/useCodeMirror';
import {useToastStore} from '@/stores/toast';
import {getRegistry} from '@/tools/websocket';

const props = defineProps<{
    modelValue: string;
    editable?: boolean;
    placeholder?: string;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string];
}>();

const toast = useToastStore();
const editorRef = ref<HTMLElement | null>(null);
const content = ref(props.modelValue);
const editableRef = ref(props.editable ?? true);
const variables = ref<Record<string, string>>({});
const varDescriptions = ref<Record<string, string>>({});
// Why: reactive mirror of editor text so computeds can track it
const liveText = ref(props.modelValue);

// Fetch variables + metadata for autocomplete with descriptions
const varRegistry = getRegistry(ACTION_VARIABLES_REGISTRY);
const metaRegistry = getRegistry(ACTION_VARIABLES_META_REGISTRY);
onMounted(async () => {
    try {
        const [vals, metas] = await Promise.all([
            varRegistry.getAll<Record<string, string>>(),
            metaRegistry.getAll<Record<string, {description?: string}>>()
        ]);
        variables.value = vals ?? {};
        if (metas) {
            const descs: Record<string, string> = {};
            for (const [k, v] of Object.entries(metas)) {
                if (v?.description) descs[k] = v.description;
            }
            varDescriptions.value = descs;
        }
    } catch (e) {
        console.debug('JsonEditor: variable fetch unavailable', e);
    }
});

const {isValid, formatJson, setContent, getContent} = useCodeMirror({
    container: editorRef,
    content,
    editable: editableRef,
    placeholder: props.placeholder,
    variables,
    variableDescriptions: varDescriptions,
    onChange(value) {
        liveText.value = value;
        emit('update:modelValue', value);
    }
});

// Why liveText not getContent: computed must track a reactive ref to recompute on edits
const undefinedVars = computed(() => {
    const text = liveText.value;
    const refs = new Set<string>();
    const regex = /\$\{([A-Za-z0-9_]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        if (!variables.value[match[1]]) refs.add(match[1]);
    }
    return [...refs];
});

// Sync external changes (preset selection) into editor
watch(
    () => props.modelValue,
    (newVal) => {
        if (newVal !== getContent()) setContent(newVal);
    }
);

watch(
    () => props.editable,
    (val) => {
        editableRef.value = val ?? true;
    }
);

function copyContent() {
    navigator.clipboard.writeText(getContent());
    toast.success('Copied');
}
</script>

<style scoped>
.je {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    flex: 1;
    min-height: 0;
}
.je-toolbar {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.je-error {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-danger-text);
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.je-warn {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-warning-text);
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.je-editor {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border-radius: var(--radius-md);
}
.je-editor :deep(.cm-editor) {
    min-height: 100px;
}
</style>
