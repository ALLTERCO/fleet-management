<template>
    <Modal :visible="visible" @close="close">
        <template #title>
            <ModalHeader
                icon="fa-bell-slash"
                title="Silence alert"
                description="Suppress notifications until the chosen time. The alert still stays active — silencing only blocks delivery."
            />
        </template>

        <template #default>
            <form class="slm" autocomplete="off" @submit.prevent="handleSave">
                <section class="slm__section">
                    <h3 class="slm__section-title">How long?</h3>
                    <div class="slm__presets" role="radiogroup">
                        <button
                            v-for="p in DURATION_PRESETS"
                            :key="p.label"
                            type="button"
                            class="slm__preset"
                            :class="{'slm__preset--active': currentDurationLabel === p.label}"
                            @click="applyPresetByLabel(p.label)"
                        >
                            <span class="slm__preset-label">{{ p.label }}</span>
                        </button>
                    </div>
                </section>

                <section class="slm__section">
                    <h3 class="slm__section-title">Until (exact time)</h3>
                    <Input
                        v-model="customUntil"
                        type="datetime-local"
                        label="Silence expires at"
                    />
                    <p class="slm__hint">
                        Local time. Picking a preset above overwrites this.
                    </p>
                </section>

                <section class="slm__section">
                    <h3 class="slm__section-title">Reason</h3>
                    <Input
                        v-model="reason"
                        placeholder="Optional — why is this silenced?"
                        label="Note for teammates"
                    />
                    <p class="slm__hint">
                        Saved on the silence record. Helpful when someone asks
                        later why an alert was quiet.
                    </p>
                </section>
            </form>
        </template>

        <template #footer>
            <ModalFooter>
                <template #secondary>
                    <Button type="blue-hollow" @click="close">Cancel</Button>
                </template>
                <template #primary>
                    <Button
                        type="blue"
                        :loading="saving"
                        :disabled="!canSave"
                        @click="handleSave"
                    >
                        Silence until {{ niceUntil }}
                    </Button>
                </template>
            </ModalFooter>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import ModalFooter from '@/components/core/ModalFooter.vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import {UI_CONFIG} from '@/config/ui';
import Modal from './Modal.vue';

const visible = defineModel<boolean>({required: true});

const emit = defineEmits<{
    silence: [payload: {until: string; reason: string | null}];
}>();

type Preset = {
    label: string;
    minutes?: number;
    resolve?: () => Date;
};

function formatMinutesLabel(m: number): string {
    if (m < 60) return `${m} minutes`;
    if (m === 60) return '1 hour';
    if (m < 1440) return `${m / 60} hours`;
    return `${m / 1440} day${m === 1440 ? '' : 's'}`;
}

const DURATION_PRESETS: Preset[] = [
    ...UI_CONFIG.silence.presetMinutes.map(
        (m): Preset => ({label: formatMinutesLabel(m), minutes: m})
    ),
    {
        label: `Tomorrow ${UI_CONFIG.silence.tomorrowHour}:00`,
        resolve: nextWorkdayMorning
    },
    {label: 'Custom'}
];

const DEFAULT_LABEL = formatMinutesLabel(
    UI_CONFIG.silence.presetMinutes[1] ?? UI_CONFIG.silence.presetMinutes[0]
);

const currentDurationLabel = ref<string>(DEFAULT_LABEL);
const customUntil = ref('');
const reason = ref('');
const saving = ref(false);

function toLocalInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextWorkdayMorning(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(UI_CONFIG.silence.tomorrowHour, 0, 0, 0);
    return d;
}

function applyPreset(preset: Preset) {
    currentDurationLabel.value = preset.label;
    if (preset.minutes == null && !preset.resolve) {
        // "Custom" — user will edit the datetime directly, don't overwrite.
        return;
    }
    const next = preset.resolve
        ? preset.resolve()
        : new Date(Date.now() + (preset.minutes ?? 0) * 60_000);
    customUntil.value = toLocalInput(next);
}

function applyPresetByLabel(label: string) {
    const preset = DURATION_PRESETS.find((p) => p.label === label);
    if (preset) applyPreset(preset);
}

watch(
    () => visible.value,
    (open) => {
        if (!open) return;
        const defaultPreset =
            DURATION_PRESETS.find((p) => p.label === DEFAULT_LABEL) ??
            DURATION_PRESETS[0];
        reason.value = '';
        saving.value = false;
        applyPreset(defaultPreset);
    },
    {immediate: true}
);

const canSave = computed(
    () => !saving.value && customUntil.value.trim().length > 0
);

const niceUntil = computed(() => {
    if (!customUntil.value) return '…';
    const d = new Date(customUntil.value);
    if (Number.isNaN(d.getTime())) return '…';
    return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit'
    });
});

function close() {
    visible.value = false;
}

async function handleSave() {
    if (!canSave.value) return;
    saving.value = true;
    try {
        const localDate = new Date(customUntil.value);
        if (Number.isNaN(localDate.getTime())) {
            saving.value = false;
            return;
        }
        emit('silence', {
            until: localDate.toISOString(),
            reason: reason.value.trim() || null
        });
        close();
    } finally {
        saving.value = false;
    }
}
</script>

<style scoped>
.slm {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}

.slm__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.slm__section-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.slm__hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.4;
}

.slm__presets {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: var(--space-2);
}

.slm__preset {
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition:
        border-color var(--motion-hover),
        background var(--motion-hover),
        color var(--motion-hover);
}

.slm__preset:hover {
    border-color: var(--color-border-strong);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
}

.slm__preset--active {
    border-color: var(--color-primary);
    background: color-mix(
        in srgb,
        var(--color-primary) 14%,
        var(--color-surface-2)
    );
    color: var(--color-text-primary);
    box-shadow: var(--shadow-brand-ring);
}

.slm__preset-label {
    display: block;
}
</style>
