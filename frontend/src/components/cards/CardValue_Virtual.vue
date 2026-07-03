<template>
    <!-- ═══ Boolean ═══ -->
    <CardShell
        v-if="entity.type === 'boolean'"
        type="switch"
        :name="entity.name"
        :icon="boolIcon"
        :size="size"
        :is-on="boolValue"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="vc-mini">
                <span class="vc-mini__label">{{ boolDisplayLabel }}</span>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template v-if="isToggle" #toggle>
            <CardToggle :is-on="boolValue" :disabled="!canExecute" @toggle="toggleBool" />
        </template>
    </CardShell>

    <!-- ═══ Number ═══ -->
    <CardShell
        v-else-if="entity.type === 'number'"
        type="input"
        :name="entity.name"
        icon="fas fa-hashtag"
        :size="size"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="vc-num">
                <div class="vc-num__readout">
                    <span class="vc-num__val">{{ numberDisplay }}</span>
                    <span v-if="numberUnit" class="vc-num__unit">{{ numberUnit }}</span>
                </div>
                <div v-if="numberGaugePct !== null" class="vc-num__gauge">
                    <div
                        class="vc-num__gauge-fill"
                        :style="{width: `${numberGaugePct}%`}"
                    />
                </div>
                <div v-if="numberRangeLabel" class="vc-num__range">
                    {{ numberRangeLabel }}
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ Text ═══ -->
    <CardShell
        v-else-if="entity.type === 'text'"
        type="input"
        :name="entity.name"
        icon="fas fa-font"
        :size="size"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="vc-text">
                <span class="vc-text__val" :title="textDisplay">
                    {{ textDisplay }}
                </span>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ Enum ═══ -->
    <CardShell
        v-else-if="entity.type === 'enum'"
        type="input"
        :name="entity.name"
        icon="fas fa-list"
        :size="size"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="vc-enum">
                <span class="vc-enum__val">{{ enumDisplayLabel }}</span>
                <div v-if="enumChips.length > 0" class="vc-enum__chips">
                    <button
                        v-for="opt in enumChips"
                        :key="opt.key"
                        type="button"
                        class="vc-enum__chip"
                        :class="{
                            'vc-enum__chip--active': opt.key === enumRawValue,
                            'vc-enum__chip--readonly': !canExecute
                        }"
                        :disabled="!canExecute"
                        @click="setEnum(opt.key)"
                    >
                        {{ opt.label }}
                    </button>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ Button ═══ -->
    <CardShell
        v-else-if="entity.type === 'button'"
        type="action"
        :name="entity.name"
        icon="fas fa-circle-play"
        :size="size"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="vc-mini vc-mini--clickable" @click="pressButton">
                <i class="fas fa-circle-play vc-mini__play-icon"></i>
                <span class="vc-mini__hint">Press</span>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import type {
    entity_t,
    virtual_boolean_entity,
    virtual_button_entity,
    virtual_enum_entity,
    virtual_number_entity
} from '@/types';
import CardBadges from './CardBadges.vue';
import CardShell from './CardShell.vue';
import CardToggle from './CardToggle.vue';

const props = withDefaults(
    defineProps<{
        entity: entity_t;
        size: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {editMode: false}
);

const emit = defineEmits<{
    'open-detail': [];
    delete: [];
    'cycle-size': [];
    press: [];
}>();

const deviceStore = useDevicesStore();
const authStore = useAuthStore();
const rpc = useCardRpc();

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);

const status = computed(() => {
    if (!device.value) return null;
    const key = `${props.entity.type}:${props.entity.properties.id}`;
    return deviceStore.statusOf(props.entity.source, key) ?? null;
});

// ── Boolean helpers ──

const boolEntity = computed(() => props.entity as virtual_boolean_entity);
const boolValue = computed(() => !!status.value?.value);
const isToggle = computed(() => boolEntity.value.properties?.view === 'toggle');
const boolIcon = computed(() =>
    boolValue.value ? 'fas fa-toggle-on' : 'fas fa-toggle-off'
);

const boolDisplayLabel = computed(() => {
    if (boolValue.value)
        return boolEntity.value.properties?.labelTrue || 'True';
    return boolEntity.value.properties?.labelFalse || 'False';
});

function toggleBool() {
    rpc.invokeAction(props.entity.id, 'setValue', {value: !boolValue.value});
}

// ── Number helpers ──

const numberEntity = computed(() => props.entity as virtual_number_entity);
const numberUnit = computed(() => numberEntity.value.properties?.unit ?? '');
const numberMin = computed(() => {
    const m = numberEntity.value.properties?.min;
    return typeof m === 'number' && Number.isFinite(m) ? m : null;
});
const numberMax = computed(() => {
    const m = numberEntity.value.properties?.max;
    return typeof m === 'number' && Number.isFinite(m) ? m : null;
});
const numberStep = computed(() => {
    const s = numberEntity.value.properties?.step;
    return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : null;
});

// Decimal places inferred from step. Round-trip through toPrecision strips
// float binary-noise tails ("0.10000000000000000555" → "0.1"); scientific
// notation falls back to log10 since the trimmed form keeps the exponent.
// Supports fractional steps >= 1 (e.g. step=2.5 → 1 decimal).
const numberDecimals = computed(() => {
    const s = numberStep.value;
    if (s === null) return 0;
    if (Number.isInteger(s)) return 0;
    const str = String(Number.parseFloat(s.toPrecision(15)));
    if (str.includes('e')) {
        return Math.min(20, Math.max(0, Math.ceil(-Math.log10(s))));
    }
    const dot = str.indexOf('.');
    return dot < 0 ? 0 : Math.min(20, str.length - dot - 1);
});

const numberDisplay = computed(() => {
    const val = status.value?.value;
    if (val == null) return '--';
    if (typeof val !== 'number') return String(val);
    return val.toFixed(numberDecimals.value);
});

const numberGaugePct = computed<number | null>(() => {
    const val = status.value?.value;
    const min = numberMin.value;
    const max = numberMax.value;
    if (typeof val !== 'number' || min === null || max === null || max <= min) {
        return null;
    }
    const pct = ((val - min) / (max - min)) * 100;
    return Math.max(0, Math.min(100, pct));
});

const numberRangeLabel = computed(() => {
    const min = numberMin.value;
    const max = numberMax.value;
    if (min === null || max === null) return '';
    const fmt = (n: number) => n.toFixed(numberDecimals.value);
    const unit = numberUnit.value ? ` ${numberUnit.value}` : '';
    return `${fmt(min)} – ${fmt(max)}${unit}`;
});

// ── Text helpers ──

const textDisplay = computed(() => {
    const val = status.value?.value;
    if (val == null || val === '') return '--';
    return String(val);
});

// ── Enum helpers ──

const enumEntity = computed(() => props.entity as virtual_enum_entity);
const enumRawValue = computed(() => {
    const val = status.value?.value;
    return val != null ? String(val) : '--';
});

const enumDisplayLabel = computed(() => {
    const val = status.value?.value;
    if (val == null) return '--';
    const options = enumEntity.value.properties?.options;
    if (options && val in options) return options[val];
    return String(val);
});

// Show segmented chips for small option sets; large sets fall back to label only.
const ENUM_CHIPS_MAX = 5;
const enumChips = computed<Array<{key: string; label: string}>>(() => {
    const options = enumEntity.value.properties?.options;
    if (!options) return [];
    const entries = Object.entries(options);
    if (entries.length === 0 || entries.length > ENUM_CHIPS_MAX) return [];
    return entries.map(([key, label]) => ({key, label: String(label)}));
});

function setEnum(value: string) {
    if (!canExecute.value || value === enumRawValue.value) return;
    rpc.invokeAction(props.entity.id, 'setValue', {value});
}

// ── Button helpers ──

function pressButton() {
    if (!canExecute.value) return;
    rpc.invokeAction(props.entity.id, 'press');
    emit('press');
}
</script>
