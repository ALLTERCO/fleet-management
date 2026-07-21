<template>
    <div class="bgs">
        <div class="bgs__intro">
            <h4 class="bgs__heading">Choose the BLU gateway</h4>
            <p class="bgs__subheading">
                BLU and BTHome sensors pair through a Shelly that supports
                Bluetooth — usually a Pro, Gen 3 or Gen 4 model.
            </p>
        </div>

        <div v-if="loading" class="bgs__state">
            <Spinner size="md" /> <span>Looking for gateways…</span>
        </div>

        <div v-else-if="error" class="bgs__state bgs__state--error">
            <i class="fas fa-triangle-exclamation" aria-hidden="true" />
            <span>{{ error }}</span>
            <Button type="blue-hollow" size="sm" @click="load">Retry</Button>
        </div>

        <div v-else-if="!gateways.length" class="bgs__state bgs__state--empty">
            <i class="fab fa-bluetooth-b" aria-hidden="true" />
            <h5>No BLU-capable gateway online</h5>
            <p>
                Connect a Shelly Pro, Gen 3 or Gen 4 device first — then come
                back to pair sensors.
            </p>
        </div>

        <ul v-else class="bgs__list">
            <li
                v-for="gw in gateways"
                :key="gw.shellyID"
            >
                <button
                    type="button"
                    class="bgs__gateway"
                    :class="{'bgs__gateway--active': modelValue === gw.shellyID}"
                    :data-gateway="gw.shellyID"
                    @click="onPick(gw.shellyID)"
                >
                    <span class="bgs__gateway-icon">
                        <i class="fab fa-bluetooth-b" aria-hidden="true" />
                    </span>
                    <span class="bgs__gateway-info">
                        <span class="bgs__gateway-name">{{ gw.name }}</span>
                        <span class="bgs__gateway-id">{{ gw.shellyID }}</span>
                    </span>
                    <i
                        v-if="modelValue === gw.shellyID"
                        class="fas fa-check bgs__gateway-check"
                        aria-hidden="true"
                    />
                    <i v-else class="fas fa-chevron-right bgs__gateway-chevron" aria-hidden="true" />
                </button>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import {type BTHomeGateway, bluetoothDevices} from '@host/bluetoothDevices';
import {onMounted, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Spinner from '@/components/core/Spinner.vue';

defineProps<{modelValue: string | null}>();
const emit = defineEmits<{'update:modelValue': [string]}>();

const gateways = ref<BTHomeGateway[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        const res = await bluetoothDevices.listGateways();
        gateways.value = res?.items ?? [];
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        gateways.value = [];
    } finally {
        loading.value = false;
    }
}

function onPick(shellyID: string): void {
    emit('update:modelValue', shellyID);
}

onMounted(load);
</script>

<style scoped>
.bgs {
    display: grid;
    gap: var(--gap-lg);
}
.bgs__intro {
    display: grid;
    gap: 6px;
}
.bgs__eyebrow {
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    color: var(--brand-light);
    font-weight: var(--font-semibold);
}
.bgs__heading {
    margin: 0;
    font-size: var(--type-subheading);
    line-height: var(--leading-tight);
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
}
.bgs__subheading {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    max-width: 56ch;
}
.bgs__state {
    display: grid;
    place-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-xl);
    text-align: center;
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-md);
    min-height: 200px;
}
.bgs__state i {
    font-size: var(--type-subheading);
    color: var(--color-text-tertiary);
}
.bgs__state--error i {
    color: var(--color-warning-text);
}
.bgs__state--empty i {
    color: var(--brand-blue);
    opacity: 0.7;
}
.bgs__state--empty h5 {
    margin: 0;
    font-size: var(--type-subheading);
    color: var(--color-text-primary);
}
.bgs__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--gap-sm);
}
.bgs__gateway {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    padding: var(--gap-md);
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    -webkit-backdrop-filter: var(--glass-2-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
    transition:
        transform var(--duration-quick) var(--ease-apple-spring),
        border-color var(--duration-fast),
        box-shadow var(--duration-quick);
}
.bgs__gateway:hover {
    transform: translateY(-2px);
    border-color: var(--color-border-focus);
}
.bgs__gateway--active {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-brand-glow);
}
.bgs__gateway-icon {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--brand-blue) 16%, transparent);
    color: var(--brand-light);
    font-size: var(--type-body);
}
.bgs__gateway--active .bgs__gateway-icon {
    background: var(--brand-blue);
    color: var(--color-text-inverse);
}
.bgs__gateway-info {
    flex: 1;
    display: grid;
    gap: 2px;
}
.bgs__gateway-name {
    font-weight: var(--font-semibold);
}
.bgs__gateway-id {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.bgs__gateway-chevron {
    color: var(--color-text-tertiary);
}
.bgs__gateway-check {
    color: var(--color-primary);
    font-size: var(--type-body);
}
</style>
