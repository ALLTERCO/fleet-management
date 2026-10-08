<template>
    <div class="dvp">
        <div class="dvp__head">
            <span class="dvp__name">{{ deviceName }}</span>
            <span class="dvp__status" :class="{'dvp__status--off': !online}">
                {{ online ? 'Online' : 'Offline' }}
            </span>
        </div>

        <!-- Readings: state you watch (read-only views). -->
        <div v-if="readings.length" class="dvp__group">
            <div
                v-for="r in readings"
                :key="r.id"
                class="dvp__row"
                :class="{'dvp__row--stacked': isWide(r)}"
            >
                <button type="button" class="dvp__label" @click="emit('open', r)">
                    {{ r.name }}
                </button>

                <!-- number: progressbar -->
                <div v-if="r.type === 'number' && viewOf(r) === 'progressbar'" class="dvp__wide">
                    <div class="dvp__reading-val">
                        <span class="dvp__val">{{ numText(r) }}</span>
                        <span v-if="unitOf(r)" class="dvp__unit">{{ unitOf(r) }}</span>
                    </div>
                    <HorizontalProgress :value="num(r)" :min="minOf(r)" :max="maxOf(r)" />
                </div>

                <!-- text: image -->
                <img
                    v-else-if="r.type === 'text' && viewOf(r) === 'image' && val(r)"
                    class="dvp__img"
                    :src="String(val(r))"
                    :alt="r.name"
                />

                <!-- object: JSON tree -->
                <div v-else-if="r.type === 'object'" class="dvp__wide">
                    <EntityTemplate_Object :status="{value: val(r)}" :settings="undefined" :can-execute="false" />
                </div>

                <!-- boolean: label -->
                <span v-else-if="r.type === 'boolean'" class="dvp__val dvp__val--state">
                    {{ boolText(r) }}
                </span>

                <!-- group: member count -->
                <span v-else-if="r.type === 'group'" class="dvp__val dvp__val--muted">
                    {{ memberCount(r) }} members
                </span>

                <div
                    v-if="r.type === 'group' && (canExecute || canExtract)"
                    class="dvp__group-actions"
                >
                    <Button
                        v-if="canExecute"
                        type="blue-hollow"
                        size="sm"
                        title="Edit name, icon and color"
                        @click.stop="emit('editGroup', r)"
                    >
                        <i class="fas fa-pen" /> Edit
                    </Button>
                    <Button
                        v-if="canExtract"
                        type="green"
                        size="sm"
                        title="Extract this group as its own device"
                        @click.stop="emit('extractGroup', r)"
                    >
                        <i class="fas fa-up-right-from-square" /> Extract
                    </Button>
                </div>

                <!-- number label/field, text label/field: plain value -->
                <div v-else class="dvp__reading-val">
                    <span class="dvp__val">{{ r.type === 'number' ? numText(r) : textVal(r) }}</span>
                    <span v-if="unitOf(r)" class="dvp__unit">{{ unitOf(r) }}</span>
                </div>
            </div>
        </div>

        <!-- Controls: things you adjust in place. -->
        <div v-if="controls.length" class="dvp__group">
            <div
                v-for="c in controls"
                :key="c.id"
                class="dvp__row"
                :class="{'dvp__row--stacked': c.type === 'number'}"
            >
                <button type="button" class="dvp__label" @click="emit('open', c)">
                    {{ c.name }}
                </button>

                <!-- number: slider -->
                <template v-if="c.type === 'number'">
                    <div class="dvp__reading-val dvp__reading-val--right">
                        <span class="dvp__val">{{ numText(c) }}</span>
                        <span v-if="unitOf(c)" class="dvp__unit">{{ unitOf(c) }}</span>
                    </div>
                    <CardSlider
                        :value="num(c)"
                        :variant="sliderVariant(c)"
                        :min="minOf(c)"
                        :max="maxOf(c)"
                        :step="stepOf(c)"
                        :disabled="!canExecute"
                        :aria-label="c.name"
                        @change="onSlide(c, $event)"
                    />
                </template>

                <!-- enum: dropdown -->
                <div v-else-if="c.type === 'enum'" class="dvp__ctl" @click.stop>
                    <Dropdown
                        :key="enumOpts(c).currentKey"
                        :options="enumOpts(c).labels"
                        :default="enumOpts(c).currentLabel"
                        :disabled="!canExecute"
                        :aria-label="c.name"
                        @selected="(_opt: string, i: number) => setEnum(c, i)"
                    />
                </div>

                <!-- boolean: toggle -->
                <div v-else class="dvp__ctl">
                    <CardToggle :is-on="bool(c)" :disabled="!canExecute" @toggle="toggle(c)" />
                </div>
            </div>
        </div>

        <!-- Actions: momentary commands. -->
        <div v-if="actions.length" class="dvp__group dvp__actions">
            <Button
                v-for="a in actions"
                :key="a.id"
                type="blue-hollow"
                size="sm"
                :disabled="!canExecute"
                @click="press(a)"
            >
                {{ a.name }}
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import CardToggle from '@/components/cards/CardToggle.vue';
import Button from '@/components/core/Button.vue';
import CardSlider, {
    type CardSliderVariant
} from '@/components/core/CardSlider.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import HorizontalProgress from '@/components/core/HorizontalProgress.vue';
import EntityTemplate_Object from '@/components/entity-templates/EntityTemplate_Object.vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import type {entity_t} from '@/types';

const props = defineProps<{
    entities: entity_t[];
    source: string;
    deviceName: string;
    online: boolean;
}>();

const emit = defineEmits<{
    open: [entity_t];
    editGroup: [entity_t];
    extractGroup: [entity_t];
}>();

const deviceStore = useDevicesStore();
const authStore = useAuthStore();
const rpc = useCardRpc();

const canExecute = computed(() => authStore.canExecuteDevice(props.source));
const canExtract = computed(
    () =>
        authStore.hasComponentPermission('devices', 'create') &&
        authStore.canPerformComponent('devices', 'read', props.source)
);

// A component's live value lives in the devices store under `type:id`, not on
// the entity itself (matches CardValue_Virtual).
function val(e: entity_t): unknown {
    const key = `${e.type}:${e.properties.id}`;
    return deviceStore.statusOf(props.source, key)?.value;
}

function viewOf(e: entity_t): string | null {
    return (e.properties as {view?: string | null}).view ?? null;
}

// Readings are watched (read-only views); controls are adjusted in place;
// actions are momentary buttons. A number is a control only as a slider — a
// field/progressbar/label number is shown as a reading and edited in detail.
type Role = 'reading' | 'control' | 'action';
function roleOf(e: entity_t): Role {
    if (e.type === 'button') return 'action';
    const view = viewOf(e);
    if (e.type === 'boolean') return view === 'toggle' ? 'control' : 'reading';
    if (e.type === 'enum') return view === 'dropdown' ? 'control' : 'reading';
    if (e.type === 'number') return view === 'slider' ? 'control' : 'reading';
    return 'reading';
}

const readings = computed(() => props.entities.filter((e) => roleOf(e) === 'reading'));
const controls = computed(() => props.entities.filter((e) => roleOf(e) === 'control'));
const actions = computed(() => props.entities.filter((e) => roleOf(e) === 'action'));

// A row spans the full width when its control/value sits under the name.
function isWide(e: entity_t): boolean {
    return (
        e.type === 'object' ||
        (e.type === 'number' && viewOf(e) === 'progressbar') ||
        (e.type === 'text' && viewOf(e) === 'image')
    );
}

// ── numbers ──
function numProp(e: entity_t, key: 'min' | 'max' | 'step'): number | undefined {
    const v = (e.properties as Record<string, unknown>)[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
const minOf = (e: entity_t) => numProp(e, 'min') ?? 0;
const maxOf = (e: entity_t) => numProp(e, 'max') ?? 100;
const stepOf = (e: entity_t) => numProp(e, 'step') ?? 1;
function num(e: entity_t): number {
    const v = val(e);
    return typeof v === 'number' ? v : minOf(e);
}
function numText(e: entity_t): string {
    const v = val(e);
    if (v == null) return '—';
    if (typeof v !== 'number') return String(v);
    const step = numProp(e, 'step');
    const decimals = step && !Number.isInteger(step) ? 1 : Number.isInteger(v) ? 0 : 1;
    return v.toFixed(decimals);
}
function unitOf(e: entity_t): string {
    return (e.properties as {unit?: string}).unit ?? '';
}
function sliderVariant(e: entity_t): CardSliderVariant {
    const unit = unitOf(e);
    if (unit.includes('°')) return 'temp';
    if (unit.includes('%')) return 'hum';
    return 'value';
}

// ── booleans ──
function bool(e: entity_t): boolean {
    return !!val(e);
}
function boolText(e: entity_t): string {
    const p = e.properties as {labelTrue?: string; labelFalse?: string};
    return bool(e) ? (p.labelTrue ?? 'On') : (p.labelFalse ?? 'Off');
}

// ── text ──
function textVal(e: entity_t): string {
    const v = val(e);
    return v == null || v === '' ? '—' : String(v);
}

// ── enum ──
function enumOpts(e: entity_t): {
    keys: string[];
    labels: string[];
    currentKey: string;
    currentLabel: string;
} {
    const options = (e.properties as {options?: Record<string, string>}).options ?? {};
    const keys = Object.keys(options);
    const labels = keys.map((k) => options[k]);
    const currentKey = val(e) != null ? String(val(e)) : '';
    return {
        keys,
        labels,
        currentKey,
        currentLabel: options[currentKey] ?? currentKey
    };
}

// ── group ──
function memberCount(e: entity_t): number {
    const members = (e.properties as {members?: string[]}).members;
    return Array.isArray(members) ? members.length : 0;
}

// ── writes (all funnel through Entity.InvokeAction) ──
function toggle(e: entity_t): void {
    rpc.invokeAction(e.id, 'setValue', {value: !bool(e)});
}
function onSlide(e: entity_t, event: Event): void {
    const next = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(next) && next !== num(e)) {
        rpc.invokeAction(e.id, 'setValue', {value: next});
    }
}
function setEnum(e: entity_t, index: number): void {
    const {keys, currentKey} = enumOpts(e);
    const key = keys[index];
    if (key && key !== currentKey) rpc.invokeAction(e.id, 'setValue', {value: key});
}
function press(e: entity_t): void {
    rpc.invokeAction(e.id, 'press', {event: 'single_push'});
}
</script>

<style scoped>
.dvp {
    background: linear-gradient(180deg, var(--color-surface-2), var(--color-surface-1));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
}
.dvp__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--color-border-subtle);
}
.dvp__name {
    font-weight: var(--font-bold);
    font-size: var(--type-body);
    letter-spacing: -0.3px;
    color: var(--color-text-primary);
}
.dvp__status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-caption);
    color: var(--color-status-on);
}
.dvp__status::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-status-on);
    box-shadow: 0 0 8px rgba(34, 192, 142, 0.6);
}
.dvp__status--off {
    color: var(--color-text-tertiary);
}
.dvp__status--off::before {
    background: var(--color-text-tertiary);
    box-shadow: none;
}

/* Groups are separated by whitespace only — no category headers. */
.dvp__group {
    padding: var(--space-2) var(--space-5) var(--space-4);
}
.dvp__group + .dvp__group {
    border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.dvp__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    min-height: 48px;
    position: relative;
}
.dvp__row + .dvp__row::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.05);
}
.dvp__row--stacked {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-3) 0;
}

.dvp__label {
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: color var(--duration-fast);
}
.dvp__row--stacked .dvp__label {
    align-self: flex-start;
}
.dvp__label:hover {
    color: var(--color-primary);
}

.dvp__reading-val {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
}
.dvp__reading-val--right {
    margin-left: auto;
}
.dvp__val {
    font-family: var(--font-mono);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
}
.dvp__val--state {
    color: var(--color-text-primary);
}
.dvp__val--muted {
    color: var(--color-text-tertiary);
    font-family: var(--font-sans);
    font-size: var(--type-caption);
}
.dvp__group-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}
.dvp__unit {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-weight: var(--font-semibold);
}

.dvp__wide {
    width: 100%;
}
.dvp__ctl {
    flex: none;
}
.dvp__img {
    max-width: 120px;
    max-height: 80px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-subtle);
}
.dvp__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
}
</style>
