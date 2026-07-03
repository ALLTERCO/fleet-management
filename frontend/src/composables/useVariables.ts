import {
    ACTION_VARIABLES_META_REGISTRY,
    ACTION_VARIABLES_REGISTRY
} from '@api/registryNames';
import {computed, onMounted, ref} from 'vue';
import {getRegistry} from '@/tools/websocket';

export interface VariableMeta {
    description?: string;
    category?: string;
}

export interface SaveVariableParams {
    name: string;
    value: string;
    metadata: VariableMeta;
}

export interface RenameVariableParams {
    oldName: string;
    newName: string;
    value: string;
    metadata: VariableMeta;
}

/** Predefined categories — always shown in dropdown as options, never forced */
export const PREDEFINED_CATEGORIES = [
    'Network',
    'Credentials',
    'Device',
    'Cloud',
    'Firmware',
    'Automation',
    'Location',
    'Notification'
] as const;

const valuesRegistry = getRegistry(ACTION_VARIABLES_REGISTRY);
const metaRegistry = getRegistry(ACTION_VARIABLES_META_REGISTRY);

// Why separate registries: substituteVariablesSync expects Record<string, string>.
// Keeping values as plain strings preserves backward compat. Metadata is optional overlay.

const values = ref<Record<string, string>>({});
const meta = ref<Record<string, VariableMeta>>({});
const loading = ref(true);
const error = ref<string | null>(null);

const keys = computed(() => Object.keys(values.value).sort());

/** All unique categories: predefined + any user-created ones from metadata */
const categories = computed(() => {
    const cats = new Set<string>(PREDEFINED_CATEGORIES);
    for (const m of Object.values(meta.value)) {
        if (m.category) cats.add(m.category);
    }
    return [...cats].sort();
});

/** Variables grouped by category (only uses explicitly set category, falls back to "Other") */
const grouped = computed(() => {
    const groups: Record<string, string[]> = {};
    for (const key of keys.value) {
        const category = meta.value[key]?.category || 'Other';
        if (!groups[category]) groups[category] = [];
        groups[category].push(key);
    }
    const sorted: Array<{category: string; keys: string[]}> = [];
    const groupKeys = Object.keys(groups).sort((a, b) => {
        if (a === 'Other') return 1;
        if (b === 'Other') return -1;
        return a.localeCompare(b);
    });
    for (const cat of groupKeys)
        sorted.push({category: cat, keys: groups[cat]});
    return sorted;
});

function getValue(key: string): string {
    return values.value[key] ?? '';
}

function getMeta(key: string): VariableMeta {
    return meta.value[key] ?? {};
}

function getDescription(key: string): string {
    return meta.value[key]?.description ?? '';
}

function getCategory(key: string): string {
    return meta.value[key]?.category || 'Other';
}

/** Validate variable name: letters, digits, underscores — must start with a letter */
function validateName(name: string): string {
    if (!name.trim()) return 'Name is required';
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name.trim()))
        return 'Letters, digits, underscores only (start with a letter)';
    return '';
}

function nameExists(name: string): boolean {
    return name.trim() in values.value;
}

async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
        const [v, m] = await Promise.all([
            valuesRegistry.getAll<Record<string, string>>(),
            metaRegistry.getAll<Record<string, VariableMeta>>()
        ]);
        values.value = v ?? {};
        meta.value = m ?? {};
    } catch (e: any) {
        error.value = e.message || String(e);
    } finally {
        loading.value = false;
    }
}

async function saveVariable({name, value, metadata}: SaveVariableParams) {
    await valuesRegistry.setItem(name, value);
    // Why always write: clearing description/category must remove stale metadata
    if (metadata.description?.trim() || metadata.category?.trim()) {
        await metaRegistry.setItem(name, metadata);
    } else {
        try {
            await metaRegistry.removeItem(name);
        } catch (e) {
            console.debug('metaRegistry.removeItem skipped:', e);
        }
    }
}

async function deleteVariable(name: string) {
    await valuesRegistry.removeItem(name);
    try {
        await metaRegistry.removeItem(name);
    } catch (e) {
        console.debug('metaRegistry.removeItem skipped:', e);
    }
}

async function renameVariable({
    oldName,
    newName,
    value,
    metadata
}: RenameVariableParams) {
    if (oldName !== newName) await deleteVariable(oldName);
    await saveVariable({name: newName, value, metadata});
}

export function useVariables() {
    onMounted(fetchAll);

    return {
        values,
        meta,
        loading,
        error,
        keys,
        categories,
        grouped,
        getValue,
        getMeta,
        getDescription,
        getCategory,
        validateName,
        nameExists,
        fetchAll,
        saveVariable,
        deleteVariable,
        renameVariable
    };
}
