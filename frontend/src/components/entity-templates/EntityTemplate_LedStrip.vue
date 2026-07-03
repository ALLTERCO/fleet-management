<template>
    <div class="et-ls">
        <LedStripField
            v-for="field in visibleFields"
            :key="field.key"
            :field="field"
            :value="liveStatus[field.key]"
            :catalog="catalog"
            :allowlist="allowlistFor(field)"
            :disabled="!canExecute || busy"
            @change="(v) => setField(field.key, v)"
        >
            <template v-if="field.key === 'effect'" #trailing>
                <button
                    class="et-ls__next"
                    :disabled="!canExecute || busy"
                    title="Next effect"
                    @click="callNextEffect"
                >
                    <i class="fas fa-forward" />
                </button>
            </template>
        </LedStripField>

        <div v-if="error" class="et-ls__error">
            <i class="fas fa-triangle-exclamation" /> {{ error }}
        </div>
    </div>
</template>

<script setup lang="ts">
import type {LedStripCatalogEntry, LedStripUiField} from '@api/ledstrip';
import {computed, ref} from 'vue';
import LedStripField from '@/components/core/LedStripField.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    entityId?: string;
    entityProperties?: Record<string, any>;
}>();

const deviceStore = useDevicesStore();
const entityStore = useEntityStore();
const busy = ref(false);
const error = ref<string | null>(null);

const componentKey = computed<string>(
    () => props.entityProperties?.componentKey ?? 'ledstrip:0'
);

const device = computed(() =>
    props.shellyID ? deviceStore.devices[props.shellyID] : null
);

const liveStatus = computed<Record<string, any>>(
    () => device.value?.status?.[componentKey.value] ?? props.status ?? {}
);

const liveConfig = computed<Record<string, any>>(
    () => device.value?.settings?.[componentKey.value] ?? props.settings ?? {}
);

const catalog = computed<
    Record<string, (string | LedStripCatalogEntry)[] | undefined>
>(() => liveConfig.value._catalog ?? {});

const uiFields = computed<LedStripUiField[]>(() => {
    const fields = liveConfig.value._meta?.ui?.fields;
    return Array.isArray(fields) ? (fields as LedStripUiField[]) : [];
});

const currentEffectMods = computed<string[]>(() => {
    const effects = catalog.value.effects ?? [];
    const currentKey = (liveStatus.value.effect as string) ?? '';
    const entry = effects.find(
        (e): e is LedStripCatalogEntry =>
            typeof e !== 'string' && e.key === currentKey
    );
    return Array.isArray(entry?.mods) ? (entry?.mods ?? []) : [];
});

function modsAllow(field: LedStripUiField): boolean {
    if (!field.requiresMod) return true;
    return currentEffectMods.value.includes(field.requiresMod);
}

function fieldHasValue(field: LedStripUiField): boolean {
    return liveStatus.value[field.key] !== undefined;
}

const visibleFields = computed<LedStripUiField[]>(() =>
    uiFields.value.filter((f) => fieldHasValue(f) && modsAllow(f))
);

function allowlistFor(field: LedStripUiField): string[] | null {
    if (!field.allowlistKey) return null;
    const allowed = liveConfig.value[field.allowlistKey];
    return Array.isArray(allowed) ? (allowed as string[]) : null;
}

async function runEntityAction(
    action: string,
    params: Record<string, unknown>
): Promise<void> {
    if (!props.entityId) {
        error.value = 'Entity not available';
        return;
    }
    busy.value = true;
    error.value = null;
    try {
        await entityStore.invokeAction(props.entityId, action, params);
    } catch (err) {
        error.value = rpcErrorMessage(err);
    } finally {
        busy.value = false;
    }
}

function setField(key: string, value: unknown): void {
    void runEntityAction('setLedStripField', {key, value});
}

function callNextEffect(): void {
    void runEntityAction('nextLedStripEffect', {});
}
</script>

<style scoped>
.et-ls {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.et-ls__next {
    flex: 0 0 auto;
    padding: var(--space-1) var(--space-2);
    background: transparent;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    cursor: pointer;
}

.et-ls__next:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
}

.et-ls__error {
    padding: var(--space-2) var(--space-3);
    background: rgba(var(--color-danger-rgb), 0.1);
    border: 1px solid rgba(var(--color-danger-rgb), 0.25);
    border-radius: var(--radius-md);
    color: var(--color-danger-text);
    font-size: var(--type-caption);
}
</style>
