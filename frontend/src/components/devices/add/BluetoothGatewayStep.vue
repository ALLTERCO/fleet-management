<template>
    <WizardStep
        name="gateway"
        lede="Sensors pair through a Shelly with Bluetooth: a Pro, Gen 3 or Gen 4."
    >
        <div v-if="gateways.length" class="bgs__search">
            <FilterPill v-model="query" placeholder="Search gateways" />
        </div>

        <PickRowSkeleton v-if="loading" label="Looking for gateways" />

        <WizardState v-else-if="error" tone="error">
            {{ error }}
            <template #action>
                <Button type="blue-hollow" size="sm" @click="load">Retry</Button>
            </template>
        </WizardState>

        <WizardState
            v-else-if="!gateways.length"
            tone="empty"
            icon="fab fa-bluetooth-b"
            title="No BLU-capable gateway online"
        >
            Connect a Shelly Pro, Gen 3 or Gen 4 device first, then come back to
            pair sensors.
        </WizardState>

        <WizardState
            v-else-if="!visibleGateways.length"
            tone="empty"
            icon="fas fa-magnifying-glass"
        >
            No gateway matches "{{ query }}".
        </WizardState>

        <ul v-else class="stack-list">
            <li v-for="gw in visibleGateways" :key="gw.shellyID">
                <PickRow
                    :selected="modelValue === gw.shellyID"
                    :data-gateway="gw.shellyID"
                    @click="onPick(gw.shellyID)"
                >
                    <template #lead>
                        <i class="fab fa-bluetooth-b" aria-hidden="true" />
                    </template>
                    {{ gw.name }}
                    <template #meta>
                        <span class="mono-id">{{ gw.shellyID }}</span>
                    </template>
                </PickRow>
            </li>
        </ul>
    </WizardStep>
</template>

<script setup lang="ts">
import {type BTHomeGateway, bluetoothDevices} from '@host/bluetoothDevices';
import {computed, onMounted, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import FilterPill from '@/components/core/FilterPill.vue';
import PickRow from '@/components/core/wizard/PickRow.vue';
import PickRowSkeleton from '@/components/core/wizard/PickRowSkeleton.vue';
import WizardState from '@/components/core/wizard/WizardState.vue';
import WizardStep from '@/components/core/wizard/WizardStep.vue';
import {useNameSearch} from '@/composables/useNameSearch';
import {actionableError} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';

defineProps<{modelValue: string | null}>();
const emit = defineEmits<{'update:modelValue': [string]}>();

const gateways = ref<BTHomeGateway[]>([]);
const query = ref('');

const deviceStore = useDevicesStore();

interface GatewayRow {
    shellyID: string;
    name: string;
    model: string;
    gen: string;
}

const rows = computed<GatewayRow[]>(() =>
    gateways.value.map((gw) => {
        const info = deviceStore.devices[gw.shellyID]?.info;
        return {
            shellyID: gw.shellyID,
            name: gw.name,
            model: info?.model ?? '',
            gen: info?.gen ? `Gen ${info.gen}` : ''
        };
    })
);

const {matches} = useNameSearch(query);

// Match on everything the row shows, so what you can see is what you can find.
const visibleGateways = computed(() =>
    rows.value.filter(
        (gw) =>
            matches(gw.name) ||
            matches(gw.shellyID) ||
            matches(gw.model) ||
            matches(gw.gen)
    )
);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        const res = await bluetoothDevices.listGateways();
        gateways.value = res?.items ?? [];
    } catch (err) {
        error.value = actionableError(
            err,
            'Could not load your gateways. Check that Fleet Manager is connected, then retry.'
        );
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
/* Sticky to .adw__form, the step scroller. Repaints the modal's own material
   so rows blur out underneath instead of showing through. */
.bgs__search {
    position: sticky;
    top: 0;
    z-index: var(--z-raised);
    padding-block: var(--gap-xs);
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
}


</style>
