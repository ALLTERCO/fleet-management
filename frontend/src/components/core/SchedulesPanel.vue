<template>
    <div class="cfg-panel schedules-panel">
        <div class="cfg-panel__row">
            <span class="cfg-panel__list-count">
                {{ jobs.length }} schedule{{ jobs.length === 1 ? '' : 's' }}
            </span>
            <div class="cfg-panel__list-actions">
                <Button type="green" size="sm" @click="openCreate">
                    New schedule
                </Button>
                <Button
                    type="blue-hollow"
                    size="sm"
                    :loading="loading"
                    @click="loadJobs"
                >
                    Refresh
                </Button>
            </div>
        </div>

        <div
            v-if="error"
            class="cfg-panel__notice cfg-panel__notice--error cfg-panel__notice--split"
            role="alert"
        >
            <span>
                <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                {{ error }}
            </span>
            <Button
                type="blue-hollow"
                size="sm"
                :loading="loading"
                @click="loadJobs"
            >
                Retry
            </Button>
        </div>

        <section
            v-if="formOpen"
            class="cfg-panel__workspace-section schedules-panel__editor"
            :aria-label="formTitle"
        >
            <strong class="schedules-panel__editor-title">
                {{ formTitle }}
            </strong>

            <nav
                class="cfg-panel__tabs schedules-panel__mode"
                role="tablist"
                aria-label="Editor mode"
            >
                <button
                    type="button"
                    role="tab"
                    class="cfg-panel__tab"
                    :class="{'cfg-panel__tab--active': form.mode === 'simple'}"
                    :aria-selected="form.mode === 'simple'"
                    @click="setFormMode('simple')"
                >
                    Simple
                </button>
                <button
                    type="button"
                    role="tab"
                    class="cfg-panel__tab"
                    :class="{'cfg-panel__tab--active': form.mode === 'advanced'}"
                    :aria-selected="form.mode === 'advanced'"
                    @click="setFormMode('advanced')"
                >
                    Advanced
                </button>
            </nav>

            <template v-if="form.mode === 'simple'">
                <div class="schedules-panel__block">
                    <span class="schedules-panel__block-label">Days</span>
                    <div
                        class="schedules-panel__days"
                        role="group"
                        aria-label="Days of the week"
                    >
                        <button
                            v-for="day in WEEKDAYS"
                            :key="day.code"
                            type="button"
                            class="schedules-panel__day"
                            :class="{'schedules-panel__day--active': form.days.includes(day.code)}"
                            :aria-pressed="form.days.includes(day.code)"
                            :aria-label="day.label"
                            :title="day.label"
                            @click="toggleDay(day.code)"
                        >
                            {{ day.letter }}
                        </button>
                    </div>
                    <div class="schedules-panel__day-presets">
                        <button type="button" class="schedules-panel__preset" @click="setDaysPreset('all')">
                            Every day
                        </button>
                        <button type="button" class="schedules-panel__preset" @click="setDaysPreset('weekdays')">
                            Weekdays
                        </button>
                        <button type="button" class="schedules-panel__preset" @click="setDaysPreset('weekend')">
                            Weekend
                        </button>
                    </div>
                </div>

                <div class="schedules-panel__block">
                    <label class="schedules-panel__block-label" :for="`${uid}-time`">Time</label>
                    <input
                        :id="`${uid}-time`"
                        v-model="form.time"
                        type="time"
                        class="cfg-panel__workspace-input schedules-panel__time"
                        aria-label="Schedule time"
                        @input="markFormDirty"
                    />
                </div>

                <div v-if="simpleActions.length" class="schedules-panel__block">
                    <span class="schedules-panel__block-label">Action</span>
                    <Dropdown
                        aria-label="Schedule action"
                        :default="selectedAction?.label ?? 'Choose an action'"
                        :options="simpleActions.map((a) => a.label)"
                        @selected="onActionSelected"
                    />
                </div>
                <p v-else class="cfg-panel__field-help">
                    This device has no switch outputs — use Advanced mode to
                    schedule other actions.
                </p>

                <p class="schedules-panel__preview" aria-live="polite">
                    <i class="fas fa-clock" aria-hidden="true" />
                    {{ simplePreview }}
                </p>
            </template>

            <template v-if="form.mode === 'advanced'">
            <div class="cfg-panel__field-grid">
                <label
                    class="cfg-panel__field cfg-panel__field--wide"
                    :for="`${uid}-timespec`"
                >
                    <strong>Timespec</strong>
                    <input
                        :id="`${uid}-timespec`"
                        v-model="form.timespec"
                        class="cfg-panel__workspace-input schedules-panel__timespec"
                        placeholder="0 0 7 * * MON-FRI"
                        @input="markFormDirty"
                    />
                    <span class="cfg-panel__field-help">
                        Six cron fields: second, minute, hour, day of month,
                        month, weekday.
                    </span>
                </label>
            </div>

            <div
                v-for="(call, index) in form.calls"
                :key="index"
                class="schedules-panel__call"
            >
                <div class="cfg-panel__field-grid">
                    <label
                        class="cfg-panel__field"
                        :for="`${uid}-call-method-${index}`"
                    >
                        <strong>Method</strong>
                        <input
                            :id="`${uid}-call-method-${index}`"
                            v-model="call.method"
                            :list="`${uid}-methods`"
                            class="cfg-panel__workspace-input schedules-panel__call-method"
                            placeholder="Switch.Set"
                            @input="markFormDirty"
                        />
                    </label>
                    <label
                        class="cfg-panel__field"
                        :for="`${uid}-call-params-${index}`"
                    >
                        <strong>Params (JSON, optional)</strong>
                        <input
                            :id="`${uid}-call-params-${index}`"
                            v-model="call.params"
                            class="cfg-panel__workspace-input schedules-panel__call-params"
                            placeholder='{"id": 0, "on": true}'
                            @input="markFormDirty"
                        />
                    </label>
                </div>
                <div
                    v-if="form.calls.length > 1"
                    class="schedules-panel__call-remove"
                >
                    <Button
                        type="red"
                        size="xs"
                        :aria-label="`Remove call ${index + 1}`"
                        @click="removeCall(index)"
                    >
                        Remove
                    </Button>
                </div>
            </div>
            <datalist :id="`${uid}-methods`">
                <option
                    v-for="method in deviceMethods"
                    :key="method"
                    :value="method"
                />
            </datalist>
            </template>

            <div class="schedules-panel__editor-enable">
                <span class="schedules-panel__editor-enable-label">Enabled</span>
                <CardToggle size="row"
                    v-model="form.enable"
                    aria-label="Enabled"
                    @update:model-value="markFormDirty"
                />
            </div>

            <div
                v-if="formError"
                class="cfg-panel__notice cfg-panel__notice--error"
            >
                <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                {{ formError }}
            </div>

            <div class="schedules-panel__editor-actions">
                <Button
                    v-if="form.mode === 'advanced'"
                    type="blue-hollow"
                    size="xs"
                    :disabled="form.calls.length >= MAX_SCHEDULE_CALLS"
                    @click="addCall"
                >
                    Add call
                </Button>
                <span class="schedules-panel__editor-spacer" aria-hidden="true" />
                <Button
                    type="blue"
                    size="sm"
                    :loading="saving"
                    @click="saveForm"
                >
                    Save
                </Button>
                <Button type="blue-hollow" size="sm" @click="closeForm">
                    Cancel
                </Button>
            </div>
        </section>

        <div
            v-if="!jobs.length && !loading && !error && !formOpen"
            class="cfg-panel__empty"
        >
            <i class="fas fa-clock" aria-hidden="true" />
            <strong>No schedules yet</strong>
            <span>Timed actions the device runs on its own.</span>
            <Button type="green" size="sm" @click="openCreate">
                New schedule
            </Button>
        </div>

        <div v-if="jobs.length" class="cfg-panel__section">
        <div
            v-for="job in jobs"
            :key="job.id"
            class="cfg-panel__row cfg-panel__row--link"
            role="button"
            tabindex="0"
            :aria-label="`Edit schedule ${job.id}`"
            @click="openEdit(job)"
            @keydown.enter.prevent="openEdit(job)"
            @keydown.space.prevent="openEdit(job)"
        >
            <div class="cfg-panel__row-label">
                <strong class="cfg-panel__list-mono">{{ job.timespec }}</strong>
                <span>{{ callsSummary(job) }}</span>
            </div>
            <div class="cfg-panel__list-actions" @click.stop>
                <CardToggle size="row"
                    :model-value="job.enable"
                    :aria-label="`Enable schedule ${job.id}`"
                    @update:model-value="(v: boolean) => setEnable(job, v)"
                />
                <Button
                    type="red"
                    size="xs"
                    :loading="busy.has(job.id)"
                    @click="confirmDelete(job)"
                >
                    Delete
                </Button>
            </div>
            <i class="fas fa-chevron-right cfg-panel__row-chevron" aria-hidden="true" />
        </div>

        </div>

        <p class="cfg-panel__field-help schedules-panel__hint">
            Times use the device's own clock and timezone.
        </p>

        <ConfirmationModal ref="deleteConfirm" />
    </div>
</template>

<script setup lang="ts">
import type {ScheduleCreateParams, ScheduleJob} from '@api/schedule';
import {computed, onMounted, reactive, ref, useId, watch} from 'vue';
import {useSettingsDirtySource} from '@/composables/useSettingsDirtyTracker';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import CardToggle from '../cards/CardToggle.vue';
import ConfirmationModal from '../modals/ConfirmationModal.vue';
import Button from './Button.vue';
import Dropdown from './Dropdown.vue';

// Device rule: a schedule job runs at most 5 calls.
const MAX_SCHEDULE_CALLS = 5;

interface ScheduleCallDraft {
    method: string;
    params: string;
}

const props = defineProps<{shellyID: string}>();
const toast = useToastStore();
const devicesStore = useDevicesStore();
const uid = useId();

const jobs = ref<ScheduleJob[]>([]);
const busy = reactive(new Set<number>());
const loading = ref(false);
const error = ref<string | null>(null);
const deleteConfirm = ref<InstanceType<typeof ConfirmationModal> | null>(null);
let requestGeneration = 0;

const formOpen = ref(false);
const formDirty = ref(false);
const formError = ref<string | null>(null);
const saving = ref(false);
const editingId = ref<number | null>(null);
type EditorMode = 'simple' | 'advanced';

// Simple mode mirrors the app's wizard: days + time + one switch action.
const WEEKDAYS = [
    {code: 'MON', letter: 'M', label: 'Monday'},
    {code: 'TUE', letter: 'T', label: 'Tuesday'},
    {code: 'WED', letter: 'W', label: 'Wednesday'},
    {code: 'THU', letter: 'T', label: 'Thursday'},
    {code: 'FRI', letter: 'F', label: 'Friday'},
    {code: 'SAT', letter: 'S', label: 'Saturday'},
    {code: 'SUN', letter: 'S', label: 'Sunday'}
] as const;
const CRON_DAY_ORDER = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const form = reactive<{
    enable: boolean;
    mode: EditorMode;
    days: string[];
    time: string;
    actionKey: string;
    timespec: string;
    calls: ScheduleCallDraft[];
}>({
    enable: true,
    mode: 'simple',
    days: WEEKDAYS.map((day) => day.code),
    time: '07:00',
    actionKey: '',
    timespec: '',
    calls: [{method: '', params: ''}]
});

interface SimpleAction {
    key: string;
    label: string;
    id: number;
    on: boolean;
}

const switchIds = computed<number[]>(() => {
    const settings = devicesStore.devices[props.shellyID]?.settings ?? {};
    return Object.keys(settings)
        .map((key) => /^switch:(\d+)$/.exec(key))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => Number(match[1]))
        .sort((a, b) => a - b);
});

const simpleActions = computed<SimpleAction[]>(() =>
    switchIds.value.flatMap((id) => {
        const single = switchIds.value.length === 1;
        return [
            {
                key: `on:${id}`,
                label: single ? 'Turn on' : `Turn switch ${id} on`,
                id,
                on: true
            },
            {
                key: `off:${id}`,
                label: single ? 'Turn off' : `Turn switch ${id} off`,
                id,
                on: false
            }
        ];
    })
);

const selectedAction = computed(
    () =>
        simpleActions.value.find((action) => action.key === form.actionKey) ??
        null
);

function toggleDay(code: string): void {
    form.days = form.days.includes(code)
        ? form.days.filter((day) => day !== code)
        : [...form.days, code];
    markFormDirty();
}

function setDaysPreset(preset: 'all' | 'weekdays' | 'weekend'): void {
    if (preset === 'all') form.days = WEEKDAYS.map((day) => day.code);
    else if (preset === 'weekdays')
        form.days = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
    else form.days = ['SAT', 'SUN'];
    markFormDirty();
}

function onActionSelected(label: string): void {
    const action = simpleActions.value.find((a) => a.label === label);
    if (action) form.actionKey = action.key;
    markFormDirty();
}

// Switching to Advanced shows the cron equivalent of the simple form, so
// nothing is lost and the mapping teaches itself.
function setFormMode(mode: EditorMode): void {
    if (mode === form.mode) return;
    if (mode === 'advanced' && !form.timespec.trim()) {
        const simple = buildSimplePayload(false);
        if (simple) {
            form.timespec = simple.timespec;
            form.calls = simple.calls.map((call) => ({
                method: call.method,
                params: call.params ? JSON.stringify(call.params) : ''
            }));
        }
    }
    form.mode = mode;
}

const dayLabel = computed(() => {
    const set = new Set(form.days);
    if (set.size === 7) return 'Every day';
    if (
        set.size === 5 &&
        ['MON', 'TUE', 'WED', 'THU', 'FRI'].every((day) => set.has(day))
    ) {
        return 'Weekdays';
    }
    if (set.size === 2 && set.has('SAT') && set.has('SUN')) return 'Weekends';
    return WEEKDAYS.filter((day) => set.has(day.code))
        .map((day) => day.label.slice(0, 3))
        .join(', ');
});

const simplePreview = computed(() => {
    if (!form.days.length) return 'Pick at least one day.';
    if (!form.time) return 'Pick a time.';
    const action = selectedAction.value;
    if (!action) return 'Pick an action.';
    return `${dayLabel.value} at ${form.time}: ${action.label.toLowerCase()}.`;
});

function expandCronDays(expr: string): string[] | null {
    if (expr === '*') return WEEKDAYS.map((day) => day.code);
    const out = new Set<string>();
    for (const token of expr.toUpperCase().split(',')) {
        const range = token.split('-');
        if (range.length === 1) {
            if (!CRON_DAY_ORDER.includes(token)) return null;
            out.add(token);
        } else if (range.length === 2) {
            const from = CRON_DAY_ORDER.indexOf(range[0]);
            const to = CRON_DAY_ORDER.indexOf(range[1]);
            if (from < 0 || to < 0) return null;
            if (from <= to) {
                for (let i = from; i <= to; i++) out.add(CRON_DAY_ORDER[i]);
            } else {
                for (let i = from; i < CRON_DAY_ORDER.length; i++)
                    out.add(CRON_DAY_ORDER[i]);
                for (let i = 0; i <= to; i++) out.add(CRON_DAY_ORDER[i]);
            }
        } else {
            return null;
        }
    }
    return [...out];
}

function parseSimpleSchedule(
    job: ScheduleJob
): {days: string[]; time: string; actionKey: string} | null {
    const calls = job.calls ?? [];
    if (calls.length !== 1) return null;
    const call = calls[0];
    if (String(call.method ?? '').toLowerCase() !== 'switch.set') return null;
    const params = call.params as {id?: unknown; on?: unknown} | undefined;
    if (
        !params ||
        typeof params.id !== 'number' ||
        typeof params.on !== 'boolean'
    ) {
        return null;
    }
    const actionKey = `${params.on ? 'on' : 'off'}:${params.id}`;
    if (!simpleActions.value.some((action) => action.key === actionKey)) {
        return null;
    }
    const match = /^0 (\d{1,2}) (\d{1,2}) \* \* (\S+)$/.exec(
        job.timespec.trim()
    );
    if (!match) return null;
    const minute = Number(match[1]);
    const hour = Number(match[2]);
    if (minute > 59 || hour > 23) return null;
    const days = expandCronDays(match[3]);
    if (!days) return null;
    return {
        days,
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        actionKey
    };
}

function buildSimplePayload(
    report: boolean
): ScheduleCreateParams | null {
    if (!form.days.length) {
        if (report) formError.value = 'Pick at least one day.';
        return null;
    }
    const match = /^(\d{2}):(\d{2})$/.exec(form.time);
    if (!match) {
        if (report) formError.value = 'Pick a time.';
        return null;
    }
    const action = selectedAction.value;
    if (!action) {
        if (report) formError.value = 'Pick an action.';
        return null;
    }
    const days =
        form.days.length === 7
            ? '*'
            : WEEKDAYS.filter((day) => form.days.includes(day.code))
                  .map((day) => day.code)
                  .join(',');
    return {
        shellyID: props.shellyID,
        enable: form.enable,
        timespec: `0 ${Number(match[2])} ${Number(match[1])} * * ${days}`,
        calls: [{method: 'Switch.Set', params: {id: action.id, on: action.on}}]
    };
}

useSettingsDirtySource(
    'config:schedule',
    'device-config:schedule-editor',
    formDirty
);

const deviceMethods = computed(
    () => devicesStore.devices[props.shellyID]?.methods ?? []
);
const formTitle = computed(() =>
    editingId.value === null ? 'New schedule' : 'Edit schedule'
);

async function loadJobs(): Promise<void> {
    const generation = ++requestGeneration;
    loading.value = true;
    error.value = null;
    try {
        const response = await sendRPC<{items?: ScheduleJob[]}>(
            'FLEET_MANAGER',
            'schedule.List',
            {shellyID: props.shellyID}
        );
        if (generation !== requestGeneration) return;
        jobs.value = Array.isArray(response?.items) ? response.items : [];
    } catch (err: unknown) {
        if (generation !== requestGeneration) return;
        error.value = rpcErrorMessage(err);
    } finally {
        if (generation === requestGeneration) loading.value = false;
    }
}

function callsSummary(job: ScheduleJob): string {
    const methods = job.calls?.map((call) => call.method) ?? [];
    return methods.length ? methods.join(', ') : 'No actions';
}

function markFormDirty(): void {
    formDirty.value = true;
}

function openCreate(): void {
    editingId.value = null;
    form.enable = true;
    form.mode = simpleActions.value.length ? 'simple' : 'advanced';
    form.days = WEEKDAYS.map((day) => day.code);
    form.time = '07:00';
    form.actionKey = simpleActions.value[0]?.key ?? '';
    form.timespec = '';
    form.calls = [{method: '', params: ''}];
    formError.value = null;
    formDirty.value = false;
    formOpen.value = true;
}

function openEdit(job: ScheduleJob): void {
    editingId.value = job.id;
    form.enable = job.enable;
    form.timespec = job.timespec;
    form.calls = (job.calls ?? []).map((call) => ({
        method: call.method,
        params: call.params ? JSON.stringify(call.params) : ''
    }));
    if (!form.calls.length) form.calls = [{method: '', params: ''}];
    const simple = parseSimpleSchedule(job);
    if (simple) {
        form.mode = 'simple';
        form.days = simple.days;
        form.time = simple.time;
        form.actionKey = simple.actionKey;
    } else {
        form.mode = 'advanced';
    }
    formError.value = null;
    formDirty.value = false;
    formOpen.value = true;
}

function closeForm(): void {
    formOpen.value = false;
    editingId.value = null;
    formError.value = null;
    formDirty.value = false;
}

function addCall(): void {
    if (form.calls.length >= MAX_SCHEDULE_CALLS) return;
    form.calls.push({method: '', params: ''});
    markFormDirty();
}

function removeCall(index: number): void {
    form.calls.splice(index, 1);
    markFormDirty();
}

function parseJsonObject(text: string): Record<string, unknown> | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
    }
    return null;
}

function buildFormPayload(): ScheduleCreateParams | null {
    if (form.mode === 'simple') {
        const payload = buildSimplePayload(true);
        if (payload) formError.value = null;
        return payload;
    }
    const timespec = form.timespec.trim();
    if (!timespec) {
        formError.value = 'Timespec is required.';
        return null;
    }
    const calls: ScheduleCreateParams['calls'] = [];
    for (const [index, call] of form.calls.entries()) {
        const method = call.method.trim();
        const paramsText = call.params.trim();
        if (!method && !paramsText) continue;
        if (!method) {
            formError.value = `Call ${index + 1} needs a method.`;
            return null;
        }
        const entry: ScheduleCreateParams['calls'][number] = {method};
        if (paramsText) {
            const params = parseJsonObject(paramsText);
            if (!params) {
                formError.value = `Call ${index + 1} params must be a JSON object.`;
                return null;
            }
            entry.params = params;
        }
        calls.push(entry);
    }
    if (!calls.length) {
        formError.value = 'Add at least one call with a method.';
        return null;
    }
    formError.value = null;
    return {
        shellyID: props.shellyID,
        enable: form.enable,
        timespec,
        calls
    };
}

async function saveForm(): Promise<void> {
    const payload = buildFormPayload();
    if (!payload) return;
    saving.value = true;
    try {
        if (editingId.value === null) {
            await sendRPC('FLEET_MANAGER', 'schedule.Create', payload);
            toast.success('Schedule created');
        } else {
            await sendRPC('FLEET_MANAGER', 'schedule.Update', {
                ...payload,
                id: editingId.value
            });
            toast.success('Schedule updated');
        }
        closeForm();
        await loadJobs();
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    } finally {
        saving.value = false;
    }
}

async function setEnable(job: ScheduleJob, enable: boolean): Promise<void> {
    // Optimistic flip — the toggle renders from its prop, so
    // waiting for the device reply would visually bounce the click back.
    const previous = job.enable;
    job.enable = enable;
    busy.add(job.id);
    try {
        await sendRPC('FLEET_MANAGER', 'schedule.Update', {
            shellyID: props.shellyID,
            id: job.id,
            enable
        });
    } catch (err: unknown) {
        job.enable = previous;
        toast.error(rpcErrorMessage(err));
    } finally {
        busy.delete(job.id);
    }
}

function confirmDelete(job: ScheduleJob): void {
    deleteConfirm.value?.storeAction(() => performDelete(job.id), {
        title: 'Delete schedule?',
        message: `The schedule "${job.timespec}" is removed from the device.`,
        confirmLabel: 'Delete'
    });
}

async function performDelete(id: number): Promise<void> {
    busy.add(id);
    try {
        await sendRPC('FLEET_MANAGER', 'schedule.Delete', {
            shellyID: props.shellyID,
            id
        });
        jobs.value = jobs.value.filter((job) => job.id !== id);
        toast.success('Schedule deleted');
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    } finally {
        busy.delete(id);
    }
}

onMounted(loadJobs);
watch(
    () => props.shellyID,
    () => {
        jobs.value = [];
        error.value = null;
        closeForm();
        void loadJobs();
    }
);
</script>

<style scoped>
.schedules-panel__hint {
    padding: var(--space-2) var(--space-3);
}

.schedules-panel__editor {
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: var(--space-px) solid var(--color-border-medium);
}

.schedules-panel__mode {
    max-width: 20rem;
}

.schedules-panel__block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) 0;
}

.schedules-panel__block-label {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}

.schedules-panel__days {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.schedules-panel__day {
    display: grid;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    place-items: center;
    border: var(--space-px) solid var(--color-border-medium);
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition:
        background-color var(--motion-hover),
        border-color var(--motion-hover),
        color var(--motion-hover);
}

.schedules-panel__day:hover {
    border-color: rgba(var(--color-primary-rgb), 0.5);
}

.schedules-panel__day--active {
    border-color: rgba(var(--color-primary-rgb), 0.5);
    background: var(--color-primary-subtle);
    color: var(--color-primary-text);
}

.schedules-panel__day-presets {
    display: flex;
    gap: var(--space-3);
}

.schedules-panel__preset {
    padding: 0;
    color: var(--color-primary-text);
    font-size: var(--type-caption);
    cursor: pointer;
}

.schedules-panel__preset:hover {
    text-decoration: underline;
}

.schedules-panel__time {
    max-width: 10rem;
}

.schedules-panel__preview {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.schedules-panel__editor-title {
    padding: var(--space-2) var(--space-3) 0;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.schedules-panel__editor-enable {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-target-min);
    padding: 0 var(--space-3);
}

.schedules-panel__editor-enable-label {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
}

.schedules-panel__timespec {
    font-family: var(--font-mono);
}

.schedules-panel__call-remove {
    display: flex;
    justify-content: flex-end;
    padding: 0 var(--space-3);
}

.schedules-panel__editor-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
}

.schedules-panel__editor-spacer {
    flex: 1;
}
</style>
