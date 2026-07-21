<template>
    <DeviceTriageCard
        :title="device.model || device.shellyId"
        :rows="rows"
        :image-key="device.model ?? ''"
        image-local-fallback
        :gen="device.gen"
    >
        <template v-if="hasExtras" #extra>
            <div v-if="alreadyKnownText" class="ddc-badge ddc-badge--known">
                <i class="fas fa-check-circle" aria-hidden="true" />
                {{ alreadyKnownText }}
            </div>
            <div v-if="inWaitingRoomText" class="ddc-badge ddc-badge--waiting">
                <i class="fas fa-hourglass-half" aria-hidden="true" />
                {{ inWaitingRoomText }}
            </div>
            <FormField
                v-if="device.authRequired && !alreadyKnown"
                :label="`Device password${authDomainSuffix}`"
                help="The device firmware requires authentication to change its WS config."
            >
                <Input
                    :model-value="password ?? ''"
                    type="password"
                    autocomplete="off"
                    placeholder="Required to accept"
                    @update:model-value="onPasswordInput"
                />
            </FormField>
        </template>

        <!-- Known devices show only the green badge — no footer needed. -->
        <template v-if="!alreadyKnown" #footer>
            <Button
                type="green"
                size="xs"
                :loading="admitting"
                :disabled="!canAdmit"
                @click="$emit('admit')"
            >
                {{ admitLabel }}
            </Button>
        </template>
    </DeviceTriageCard>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import DeviceTriageCard, {
    type TriageRow
} from '@/components/cards/DeviceTriageCard.vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';

interface ProbedDevice {
    ip: string;
    shellyId: string;
    gen: 1 | 2 | 3 | 4;
    model: string;
    ver?: string;
    mac?: string;
    authRequired?: boolean;
    authDomain?: string | null;
    alreadyKnown?: boolean;
    inWaitingRoom?: boolean;
}

const props = defineProps<{
    device: ProbedDevice;
    password?: string;
    admitting?: boolean;
}>();

const emit = defineEmits<{
    admit: [];
    'update:password': [value: string];
}>();

function onPasswordInput(value: string | number): void {
    emit('update:password', String(value));
}

const rows = computed<TriageRow[]>(() => {
    const list: TriageRow[] = [
        {label: 'ID', value: props.device.shellyId},
        {label: 'IP', value: props.device.ip || '—'}
    ];
    if (props.device.mac) list.push({label: 'MAC', value: props.device.mac});
    if (props.device.ver) {
        list.push({label: 'Firmware', value: props.device.ver});
    }
    return list;
});

const alreadyKnown = computed(() => props.device.alreadyKnown === true);

const alreadyKnownText = computed(() =>
    alreadyKnown.value ? 'This device is already in your fleet' : null
);
const inWaitingRoomText = computed(() =>
    props.device.inWaitingRoom && !alreadyKnown.value
        ? 'Admission pending. The device appears once it reconnects'
        : null
);

const hasExtras = computed(
    () =>
        alreadyKnownText.value !== null ||
        inWaitingRoomText.value !== null ||
        (props.device.authRequired === true && !alreadyKnown.value)
);

const authDomainSuffix = computed(() =>
    props.device.authDomain ? ` (realm: ${props.device.authDomain})` : ''
);

const canAdmit = computed(() => {
    if (alreadyKnown.value) return false;
    if (props.device.authRequired && !props.password?.length) return false;
    return true;
});

const admitLabel = computed(() => {
    if (props.device.inWaitingRoom) return 'Accept device';
    return 'Add to fleet';
});
</script>

<style scoped>
.ddc-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--type-caption);
    width: fit-content;
}
.ddc-badge--known {
    background: var(--color-success-subtle);
    color: var(--color-success-text);
}
.ddc-badge--waiting {
    background: var(--color-warning-subtle);
    color: var(--color-warning-text);
}
</style>
