<template>
    <article class="ddc" :class="{'ddc--locked': locked}">
        <header class="ddc__head">
            <i class="fas fa-microchip ddc__icon" aria-hidden="true" />
            <div class="ddc__id">
                <span class="ddc__shelly-id">{{ device.shellyId }}</span>
                <span v-if="device.model" class="ddc__model">
                    {{ device.model }}
                </span>
            </div>
            <span class="ddc__gen">Gen {{ device.gen }}</span>
        </header>

        <dl class="ddc__meta">
            <div v-if="device.ip" class="ddc__row">
                <dt>IP</dt>
                <dd>{{ device.ip }}</dd>
            </div>
            <div v-if="device.mac" class="ddc__row">
                <dt>MAC</dt>
                <dd>{{ device.mac }}</dd>
            </div>
            <div v-if="device.ver" class="ddc__row">
                <dt>Firmware</dt>
                <dd>{{ device.ver }}</dd>
            </div>
        </dl>

        <div v-if="alreadyKnownText" class="ddc__badge ddc__badge--known">
            <i class="fas fa-check-circle" aria-hidden="true" />
            {{ alreadyKnownText }}
        </div>
        <div v-if="inWaitingRoomText" class="ddc__badge ddc__badge--waiting">
            <i class="fas fa-hourglass-half" aria-hidden="true" />
            {{ inWaitingRoomText }}
        </div>

        <div v-if="device.authRequired && !alreadyKnown" class="ddc__auth">
            <FormField
                :label="`Device password${authDomainSuffix}`"
                help="The device firmware requires authentication to change its WS config."
            >
                <Input
                    :model-value="password ?? ''"
                    type="password"
                    autocomplete="off"
                    placeholder="Required to admit"
                    @update:model-value="onPasswordInput"
                />
            </FormField>
        </div>

        <div class="ddc__actions">
            <Button
                v-if="!alreadyKnown"
                type="blue"
                size="sm"
                :loading="admitting"
                :disabled="!canAdmit"
                @click="$emit('admit')"
            >
                {{ admitLabel }}
            </Button>
            <span v-else class="ddc__hint">
                Already in your fleet — no action needed.
            </span>
        </div>
    </article>
</template>

<script setup lang="ts">
import {computed} from 'vue';
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

const alreadyKnown = computed(() => props.device.alreadyKnown === true);
const locked = computed(() => alreadyKnown.value);

const alreadyKnownText = computed(() =>
    alreadyKnown.value ? 'This device is already in your fleet' : null
);
const inWaitingRoomText = computed(() =>
    props.device.inWaitingRoom && !alreadyKnown.value
        ? 'Admission pending — device will appear once it reconnects'
        : null
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
    if (props.device.inWaitingRoom) return 'Re-admit device';
    return 'Add to fleet';
});
</script>

<style scoped>
.ddc {
    display: grid;
    gap: var(--gap-md);
    padding: var(--gap-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-card);
    transition: border-color var(--duration-fast);
}
.ddc:hover {
    border-color: color-mix(in srgb, var(--brand-blue) 35%, transparent);
}
.ddc--locked {
    opacity: 0.7;
}
.ddc__head {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
}
.ddc__icon {
    color: var(--brand-light);
    font-size: var(--type-subheading);
    width: 32px;
    text-align: center;
}
.ddc__id {
    flex: 1;
    display: grid;
    gap: 2px;
    min-width: 0;
}
.ddc__shelly-id {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
    font-weight: var(--font-medium);
    overflow: hidden;
    text-overflow: ellipsis;
}
.ddc__model {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.ddc__gen {
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--brand-blue) 18%, transparent);
    color: var(--brand-light);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
}
.ddc__meta {
    margin: 0;
    display: grid;
    gap: 4px;
    font-size: var(--type-body);
}
.ddc__row {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: var(--gap-sm);
}
.ddc__row dt {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}
.ddc__row dd {
    margin: 0;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
}
.ddc__badge {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--type-caption);
    width: fit-content;
}
.ddc__badge--known {
    background: var(--color-success-subtle);
    color: var(--color-success-text);
}
.ddc__badge--waiting {
    background: var(--color-warning-subtle);
    color: var(--color-warning-text);
}
.ddc__auth {
    display: grid;
    gap: var(--gap-xs);
}
.ddc__actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--gap-sm);
}
.ddc--locked .ddc__actions {
    pointer-events: none;
}
.ddc__hint {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
</style>
