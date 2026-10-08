<template>
    <div class="irsl">
        <div class="irsl__row">
            <Button
                type="blue-hollow"
                size="sm"
                :loading="reading"
                @click="readFromDevice"
                >Read codes from device</Button
            >
        </div>

        <template v-if="readResult">
            <pre class="irsl__raw">{{ readResultText }}</pre>
            <div class="irsl__row">
                <Input
                    v-model="name"
                    placeholder="Code name (e.g. AC Power)"
                    aria-label="Code name"
                />
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
            <div class="irsl__row">
                <Button
                    type="blue"
                    size="sm"
                    :disabled="name.trim().length === 0"
                    :loading="saving"
                    @click="save"
                    >Save to library</Button
                >
            </div>
        </template>
        <div class="irsl__note">
            Preview firmware: the device stores learned codes in an
            undocumented format. What the device reports is saved as-is.
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import {useIrLibraryStore} from '@/stores/irLibrary';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

const props = defineProps<{shellyID: string}>();
const emit = defineEmits<{saved: []}>();

const irStore = useIrLibraryStore();
const toast = useToastStore();

const reading = ref(false);
const saving = ref(false);
const readResult = ref<Record<string, unknown> | null>(null);
const name = ref('');
const brand = ref('');
const deviceType = ref('');

const readResultText = computed(() =>
    JSON.stringify(readResult.value, null, 2)
);

// Read whatever the ircode namespace exposes today (preview firmware;
// both calls are permissive passthroughs) and keep it verbatim.
async function readFromDevice(): Promise<void> {
    reading.value = true;
    try {
        const [config, status] = await Promise.all([
            ws.sendRPC('FLEET_MANAGER', 'ircode.getconfig', {
                shellyID: props.shellyID
            }),
            ws.sendRPC('FLEET_MANAGER', 'ircode.getstatus', {
                shellyID: props.shellyID
            })
        ]);
        readResult.value = {format: 'device_read', config, status};
    } catch (err) {
        toast.error(
            `Could not read IR codes from the device: ${
                (err as {message?: string})?.message ?? 'device call failed'
            }`
        );
    } finally {
        reading.value = false;
    }
}

async function save(): Promise<void> {
    if (!readResult.value) return;
    saving.value = true;
    try {
        const entry = await irStore.saveEntry({
            name: name.value.trim(),
            brand: brand.value.trim() || null,
            deviceType: deviceType.value.trim() || null,
            payload: readResult.value,
            source: 'learned',
            sourceDetail: props.shellyID
        });
        if (entry) {
            readResult.value = null;
            name.value = '';
            emit('saved');
        }
    } finally {
        saving.value = false;
    }
}
</script>

<style scoped>
.irsl {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.irsl__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.irsl__raw {
    max-height: 12rem;
    overflow: auto;
    margin: 0;
    padding: var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}
.irsl__note {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
</style>
