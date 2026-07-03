<template>
    <div class="et-schedule">
        <!-- Header -->
        <div class="et-schedule__header">
            <span class="et-schedule__count">{{ jobs.length }} schedule{{ jobs.length !== 1 ? 's' : '' }}</span>
            <div class="et-schedule__header-actions">
                <button v-if="canExecute && jobs.length > 1" class="et-schedule__delete-all" @click="deleteAll">
                    All
                </button>
                <button v-if="canExecute" class="et-schedule__refresh" :disabled="loading" @click="loadJobs">
                    <i :class="loading ? 'fas fa-spinner fa-spin' : 'fas fa-rotate'" />
                </button>
            </div>
        </div>

        <!-- Job list -->
        <div v-if="jobs.length" class="et-schedule__jobs">
            <div v-for="job in jobs" :key="job.id" class="et-schedule__job">
                <div class="et-schedule__job-header">
                    <button
                        v-if="canExecute"
                        class="et-schedule__enable-btn"
                        :class="job.enable && 'et-schedule__enable-btn--on'"
                        @click="toggleJob(job)"
                    >
                        <i class="fas" :class="job.enable ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                    <span v-else class="et-schedule__enable-badge" :class="job.enable && 'et-schedule__enable-badge--on'">
                        {{ job.enable ? 'ON' : 'OFF' }}
                    </span>
                    <span class="et-schedule__timespec">
                        {{ formatTimespec(job.timespec) }}
                        <span v-if="locationTimezone" class="et-schedule__tz">
                            · {{ locationTimezone }}
                        </span>
                    </span>
                    <button v-if="canExecute" class="et-schedule__delete-btn" title="Delete schedule" aria-label="Delete schedule" @click="deleteJob(job.id)">
                        <i class="fas fa-trash" />
                    </button>
                </div>
                <div class="et-schedule__calls">
                    <div v-for="(call, ci) in job.calls" :key="ci" class="et-schedule__call">
                        <span class="et-schedule__method">{{ call.method }}</span>
                        <span v-if="call.params" class="et-schedule__params">{{ formatParams(call.params) }}</span>
                    </div>
                </div>
            </div>
        </div>

        <div v-else-if="!loading" class="et-schedule__empty">
            No schedules configured
        </div>

        <!-- Add new schedule -->
        <div v-if="canExecute" class="et-schedule__add-section">
            <div class="et-schedule__section-header" @click="showAdd = !showAdd">
                <i class="fas fa-plus" /> Add Schedule
                <i class="fas" :class="showAdd ? 'fa-chevron-down' : 'fa-chevron-right'" style="margin-left: auto; font-size: var(--type-body); color: var(--color-text-disabled);" />
            </div>
            <template v-if="showAdd">
                <div class="et-schedule__field">
                    <span class="et-schedule__label">Cron (SEC MIN HOUR MDAY MON WDAY)</span>
                    <input
                        v-model="newTimespec"
                        type="text"
                        class="et-schedule__text-input"
                        placeholder="0 0 8 * * MON,TUE,WED,THU,FRI"
                    />
                </div>

                <div
                    v-for="(c, ci) in newCalls"
                    :key="c.uid"
                    class="et-schedule__call-edit"
                >
                    <div class="et-schedule__field">
                        <span class="et-schedule__label">
                            Call #{{ ci + 1 }} method
                            <button
                                v-if="newCalls.length > 1"
                                class="et-schedule__remove-call"
                                @click="removeCall(c.uid)"
                            >
                                <i class="fas fa-xmark" />
                            </button>
                        </span>
                        <input
                            v-model="c.method"
                            type="text"
                            class="et-schedule__text-input"
                            placeholder="Switch.Set"
                        />
                    </div>
                    <div class="et-schedule__field">
                        <span class="et-schedule__label">Params (JSON)</span>
                        <input
                            v-model="c.params"
                            type="text"
                            class="et-schedule__text-input"
                            placeholder='{"id":0,"on":true}'
                        />
                    </div>
                </div>

                <button
                    v-if="newCalls.length < MAX_CALLS"
                    class="et-schedule__add-call"
                    @click="addCall"
                >
                    <i class="fas fa-plus" /> Add call ({{ newCalls.length }}/{{ MAX_CALLS }})
                </button>

                <button
                    class="et-schedule__create-btn"
                    :disabled="!newTimespec.trim() || !newCalls.some((c) => c.method.trim())"
                    @click="createJob"
                >
                    <i class="fas fa-plus" /> Create
                </button>
            </template>
        </div>

        <!-- Error -->
        <div v-if="error" class="et-schedule__error">
            <i class="fas fa-triangle-exclamation" /> {{ error }}
        </div>
    </div>
</template>

<script setup lang="ts">
import type {ScheduleJob, ScheduleListResponse} from '@api/schedule';
import {storeToRefs} from 'pinia';
import {computed, onMounted, ref} from 'vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {useLocationsStore} from '@/stores/locations';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
}>();

const MAX_CALLS = 5;

const devicesStore = useDevicesStore();
const locationsStore = useLocationsStore();
const {devices} = storeToRefs(devicesStore);
const {locations} = storeToRefs(locationsStore);
const locationTimezone = computed<string | null>(() => {
    const shellyID = props.shellyID;
    if (!shellyID) return null;
    const locationId = devices.value[shellyID]?.locationId;
    if (locationId == null) return null;
    return locations.value[locationId]?.effective?.timezone ?? null;
});

interface NewCall {
    uid: number;
    method: string;
    params: string;
}

let callUidCounter = 0;
function makeCall(): NewCall {
    callUidCounter += 1;
    return {uid: callUidCounter, method: '', params: ''};
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return (
        typeof v === 'object' &&
        v !== null &&
        !Array.isArray(v) &&
        Object.prototype.toString.call(v) === '[object Object]'
    );
}

const jobs = ref<ScheduleJob[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const showAdd = ref(false);
const newTimespec = ref('');
const newCalls = ref<NewCall[]>([makeCall()]);

function addCall(): void {
    if (newCalls.value.length < MAX_CALLS) {
        newCalls.value.push(makeCall());
    }
}

function removeCall(uid: number): void {
    if (newCalls.value.length > 1) {
        newCalls.value = newCalls.value.filter((c) => c.uid !== uid);
    }
}

async function loadJobs() {
    if (!props.shellyID) return;
    loading.value = true;
    error.value = null;
    try {
        const result = await sendRPC<ScheduleListResponse>(
            'FLEET_MANAGER',
            'Schedule.List',
            {shellyID: props.shellyID}
        );
        jobs.value = result?.items ?? [];
    } catch (e: unknown) {
        error.value = rpcErrorMessage(e, 'Failed to load schedules');
    } finally {
        loading.value = false;
    }
}

async function toggleJob(job: ScheduleJob) {
    if (!props.shellyID) return;
    error.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Schedule.Update', {
            shellyID: props.shellyID,
            id: job.id,
            enable: !job.enable
        });
        job.enable = !job.enable;
    } catch (e: unknown) {
        error.value = rpcErrorMessage(e, 'Failed to update schedule');
    }
}

async function deleteJob(id: number) {
    if (!props.shellyID) return;
    error.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Schedule.Delete', {
            shellyID: props.shellyID,
            id
        });
        jobs.value = jobs.value.filter((j: ScheduleJob) => j.id !== id);
    } catch (e: unknown) {
        error.value = rpcErrorMessage(e, 'Failed to delete schedule');
    }
}

async function deleteAll() {
    if (!props.shellyID) return;
    if (!window.confirm('Delete all schedules on this device?')) return;
    error.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Schedule.DeleteAll', {
            shellyID: props.shellyID
        });
        jobs.value = [];
    } catch (e: unknown) {
        error.value = rpcErrorMessage(e, 'Failed to delete all schedules');
    }
}

async function createJob() {
    const timespec = newTimespec.value.trim();
    if (!props.shellyID || !timespec) return;
    error.value = null;

    const calls: {method: string; params?: Record<string, unknown>}[] = [];
    for (const c of newCalls.value) {
        const method = c.method.trim();
        if (!method) continue;
        const entry: {method: string; params?: Record<string, unknown>} = {
            method
        };
        const paramsText = c.params.trim();
        if (paramsText) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(paramsText);
            } catch {
                error.value = `Invalid JSON in params for ${method}`;
                return;
            }
            if (!isPlainObject(parsed)) {
                error.value = `Params for ${method} must be a JSON object`;
                return;
            }
            entry.params = parsed;
        }
        calls.push(entry);
    }
    if (!calls.length) {
        error.value = 'At least one call with a method is required';
        return;
    }

    try {
        await sendRPC('FLEET_MANAGER', 'Schedule.Create', {
            shellyID: props.shellyID,
            enable: true,
            timespec,
            calls
        });
        newTimespec.value = '';
        newCalls.value = [makeCall()];
        showAdd.value = false;
        await loadJobs();
    } catch (e: unknown) {
        error.value = rpcErrorMessage(e, 'Failed to create schedule');
    }
}

function formatTimespec(ts: string): string {
    const parts = ts.split(/\s+/);
    if (parts.length !== 6) return ts;
    const [, min, hour, , , wday] = parts;
    const days =
        wday === 'SUN,MON,TUE,WED,THU,FRI,SAT'
            ? 'Every day'
            : wday === 'MON,TUE,WED,THU,FRI'
              ? 'Weekdays'
              : wday === 'SAT,SUN'
                ? 'Weekends'
                : wday;
    return `${hour}:${min.padStart(2, '0')} ${days}`;
}

function formatParams(params: Record<string, any>): string {
    const entries = Object.entries(params);
    return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
}

onMounted(() => {
    if (props.shellyID) loadJobs();
});
</script>

<style scoped>
.et-schedule {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-schedule__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.et-schedule__count {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.et-schedule__header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}
.et-schedule__refresh {
    color: var(--color-text-disabled);
    cursor: pointer;
    font-size: var(--type-body);
    padding: var(--space-0-5) var(--space-1);
}
.et-schedule__refresh:hover:not(:disabled) {
    color: var(--color-text-primary);
}
.et-schedule__delete-all {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-disabled);
    cursor: pointer;
    font-size: var(--type-body);
    padding: var(--space-0-5) var(--space-1-5);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: transparent;
}
.et-schedule__delete-all:hover {
    color: var(--color-danger-text);
    border-color: var(--color-danger-text);
}

/* Job list */
.et-schedule__jobs {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}
.et-schedule__job {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.et-schedule__job-header {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
}
.et-schedule__enable-btn {
    font-size: var(--type-subheading);
    color: var(--color-text-disabled);
    cursor: pointer;
    flex-shrink: 0;
}
.et-schedule__enable-btn--on {
    color: var(--color-success-text);
}
.et-schedule__enable-badge {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-disabled);
}
.et-schedule__enable-badge--on {
    color: var(--color-success-text);
}
.et-schedule__timespec {
    flex: 1;
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
}
.et-schedule__tz {
    font-weight: var(--font-normal);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.et-schedule__delete-btn {
    color: var(--color-text-disabled);
    cursor: pointer;
    font-size: var(--type-body);
    padding: var(--space-0-5) var(--space-1);
}
.et-schedule__delete-btn:hover {
    color: var(--color-danger-text);
}
.et-schedule__calls {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding-left: var(--space-6);
}
.et-schedule__call {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
}
.et-schedule__method {
    font-weight: var(--font-semibold);
    color: var(--color-primary);
}
.et-schedule__params {
    color: var(--color-text-disabled);
}

/* Empty state */
.et-schedule__empty {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    text-align: center;
    padding: var(--space-2);
}

/* Add section */
.et-schedule__add-section {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}
.et-schedule__section-header {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    cursor: pointer;
    user-select: none;
}
.et-schedule__section-header:hover {
    color: var(--color-text-secondary);
}
.et-schedule__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.et-schedule__label {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}
.et-schedule__text-input {
    font-size: var(--type-body);
    color: var(--color-text-primary);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
}
.et-schedule__text-input:focus {
    outline: none;
    border-color: var(--color-primary);
}
.et-schedule__create-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
}
.et-schedule__create-btn:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-primary) 20%, transparent);
}
.et-schedule__create-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* Error */
.et-schedule__error {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    color: var(--color-danger-text);
}

.et-schedule__call-edit {
    padding-top: var(--space-1);
    border-top: 1px solid var(--color-border-subtle);
}
.et-schedule__remove-call {
    margin-left: var(--space-1);
    background: transparent;
    border: none;
    color: var(--color-danger-text);
    cursor: pointer;
    font-size: var(--type-body);
}
.et-schedule__add-call {
    align-self: flex-start;
    padding: var(--space-1) var(--space-2);
    background: transparent;
    border: 1px dashed var(--color-border-default);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    cursor: pointer;
}
.et-schedule__add-call:hover {
    border-color: var(--color-primary);
    color: var(--color-primary-text);
}
</style>
