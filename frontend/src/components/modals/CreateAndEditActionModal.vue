<template>
    <!-- ═══ EDIT MODE ═══ -->
    <Modal v-if="isEditMode" :visible="visible" wide @close="onClose">
        <template #title>Edit Action</template>
        <template #default>
            <div class="ea">
                <div class="ea-name-row">
                    <div class="ea-icon-circle" @click="iconPickerOpen = true">
                        <i v-if="selectedIcon" :class="selectedIcon" />
                        <i v-else class="fas fa-image" />
                    </div>
                    <Input v-model="name" placeholder="Action name" :error="nameError" class="ea-flex-1" @blur="validateName" />
                </div>

                <div class="ea-section">
                    <div class="ea-section-hdr">
                        Command
                    </div>
                    <div class="ea-preset-row">
                        <Dropdown class="ea-dropdown" :options="ALLOWED_COMPONENT_NAMES" :searchable="true" @selected="applyComponentPreset" />
                        <Dropdown v-if="componentMethodNames.length" class="ea-dropdown" :options="methodOptionsWithCustom" :searchable="true" @selected="applyMethodPreset" />
                    </div>
                    <JsonEditor
                        :model-value="jsonText"
                        :editable="isCustomMethod"
                        placeholder='{ "id": 1, "method": "Shelly.GetStatus", "params": {}, "dst": [] }'
                        @update:model-value="onJsonChange"
                    />
                </div>

                <div class="ea-section">
                    <div class="ea-section-hdr">Devices ({{ selectedDevices.length }})</div>
                    <DeviceSelector v-model="selectedDevices" />
                </div>

                <div class="ea-run-bar">
                    <Button type="blue-hollow" :loading="editRunning" size="sm" @click="runTest">{{ editRunResults ? 'Run again' : 'Test run' }}</Button>
                    <Button type="blue-hollow" size="xs" @click="copyPayload">Copy</Button>
                </div>

                <!-- Inline test results -->
                <div v-if="editRunResults" class="ea-section">
                    <div class="ea-section-hdr">
                        Results
                        <span class="ea-stat ea-stat--ok"><i class="fas fa-check" /> {{ okCount }}</span>
                        <span class="ea-stat ea-stat--fail"><i class="fas fa-xmark" /> {{ failCount }}</span>
                        <Button type="blue-hollow" size="xs" class="ea-ml-auto" @click="copyAllResults">Copy all</Button>
                    </div>
                    <Input v-model="resultsSearch" placeholder="Search results..." />
                    <div class="ea-results">
                        <div v-for="[deviceId, result] in visibleResults" :key="deviceId" class="ea-result" :class="{'ea-result--fail': isFailed(result)}">
                            <div class="ea-result-head">
                                <span class="ea-result-device">{{ deviceId }}</span>
                                <span v-if="isFailed(result)" class="ea-result-badge ea-result-badge--fail">Error {{ result.code }}</span>
                                <span v-else class="ea-result-badge ea-result-badge--ok"><i class="fas fa-check" /> OK</span>
                                <Button type="blue-hollow" size="xs" class="ea-ml-auto" title="Copy" aria-label="Copy" @click="copySingleResult(deviceId, result)"><i class="fas fa-copy" aria-hidden="true" /></Button>
                            </div>
                            <div v-if="hasResponseData(result)" class="ea-result-body">
                                <VueJsonPretty :data="stripInternal(result)" :deep="3" :show-line="false" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #footer>
            <div class="ea-footer">
                <Button type="blue-hollow" @click="onClose">Cancel</Button>
                <Button type="green" :loading="saving" @click="handleSave">Save</Button>
            </div>
        </template>
    </Modal>

    <!-- ═══ CREATE MODE: 2-step ═══ -->
    <Modal v-else :visible="visible" wide @close="onClose">
        <template #title>
            <div class="ea-create-title">
                <span>Create Action</span>
                <div class="ea-step-pills">
                    <div class="ea-pill" :class="{'ea-pill--active': stage === 1}" @click="stage = 1">
                        <span class="ea-pill-num">1</span> Devices
                    </div>
                    <div class="ea-pill" :class="{'ea-pill--active': stage === 2, 'ea-pill--disabled': !hasDevices}">
                        <span class="ea-pill-num">2</span> Configure
                    </div>
                </div>
            </div>
        </template>
        <template #default>
            <!-- Step 1: Devices -->
            <div v-if="stage === 1" class="ea">
                <DeviceSelector v-model="selectedDevices" />
                <div v-if="deviceError" class="ea-error">{{ deviceError }}</div>
            </div>

            <!-- Step 2: Configure -->
            <div v-else class="ea">
                <div class="ea-name-row">
                    <div class="ea-icon-circle" @click="iconPickerOpen = true">
                        <i v-if="selectedIcon" :class="selectedIcon" />
                        <i v-else class="fas fa-image" />
                    </div>
                    <Input v-model="name" placeholder="Action name" :error="nameError" class="ea-flex-1" @blur="validateName" />
                </div>

                <div class="ea-section">
                    <div class="ea-section-hdr">
                        Command
                    </div>
                    <div class="ea-preset-row">
                        <Dropdown class="ea-dropdown" :options="ALLOWED_COMPONENT_NAMES" :searchable="true" @selected="applyComponentPreset" />
                        <Dropdown v-if="componentMethodNames.length" class="ea-dropdown" :options="methodOptionsWithCustom" :searchable="true" @selected="applyMethodPreset" />
                    </div>
                    <JsonEditor
                        :model-value="jsonText"
                        :editable="isCustomMethod"
                        placeholder='{ "id": 1, "method": "Shelly.GetStatus", "params": {}, "dst": [] }'
                        @update:model-value="onJsonChange"
                    />
                </div>

                <div class="ea-section">
                    <div class="ea-section-hdr">Devices ({{ selectedDevices.length }})</div>
                    <div class="ea-device-grid">
                        <span v-for="id in selectedDevices.slice(0, 12)" :key="id" class="ea-device-chip">{{ id }}</span>
                        <span v-if="selectedDevices.length > 12" class="ea-device-chip ea-device-chip--more">+{{ selectedDevices.length - 12 }} more</span>
                    </div>
                </div>

                <div class="ea-run-bar">
                    <Button type="blue-hollow" :loading="editRunning" size="sm" @click="runTest">{{ editRunResults ? 'Run again' : 'Test run' }}</Button>
                    <Button type="blue-hollow" size="xs" @click="copyPayload">Copy</Button>
                </div>

                <!-- Inline test results -->
                <div v-if="editRunResults" class="ea-section">
                    <div class="ea-section-hdr">
                        Results
                        <span class="ea-stat ea-stat--ok"><i class="fas fa-check" /> {{ okCount }}</span>
                        <span class="ea-stat ea-stat--fail"><i class="fas fa-xmark" /> {{ failCount }}</span>
                        <Button type="blue-hollow" size="xs" class="ea-ml-auto" @click="copyAllResults">Copy all</Button>
                    </div>
                    <Input v-model="resultsSearch" placeholder="Search results..." />
                    <div class="ea-results">
                        <div v-for="[deviceId, result] in visibleResults" :key="deviceId" class="ea-result" :class="{'ea-result--fail': isFailed(result)}">
                            <div class="ea-result-head">
                                <span class="ea-result-device">{{ deviceId }}</span>
                                <span v-if="isFailed(result)" class="ea-result-badge ea-result-badge--fail">Error {{ result.code }}</span>
                                <span v-else class="ea-result-badge ea-result-badge--ok"><i class="fas fa-check" /> OK</span>
                                <Button type="blue-hollow" size="xs" class="ea-ml-auto" title="Copy" aria-label="Copy" @click="copySingleResult(deviceId, result)"><i class="fas fa-copy" aria-hidden="true" /></Button>
                            </div>
                            <div v-if="hasResponseData(result)" class="ea-result-body">
                                <VueJsonPretty :data="stripInternal(result)" :deep="3" :show-line="false" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #footer>
            <div class="ea-footer">
                <Button v-if="stage === 2" type="blue-hollow" @click="stage = 1">Back</Button>
                <div class="ea-spacer" />
                <Button v-if="stage === 1" type="blue-hollow" :disabled="!hasDevices" @click="advanceToStep2">Next</Button>
                <Button v-else type="green" :loading="saving" @click="handleSave">Save</Button>
            </div>
        </template>
    </Modal>

    <IconPickerModal
        :visible="iconPickerOpen"
        :selected-glyph="selectedIcon"
        @close="iconPickerOpen = false"
        @pick="applyIcon"
    />
</template>

<script lang="ts" setup>
import 'vue-json-pretty/lib/styles.css';
import {
    computed,
    defineAsyncComponent,
    onMounted,
    onUnmounted,
    ref,
    watch
} from 'vue';
import Button from '@/components/core/Button.vue';
import DeviceSelector from '@/components/core/DeviceSelector.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import IconPickerModal from '@/components/core/IconPickerModal.vue';
import default_rpc from '@/data/default_rpc.json';
import {
    hasResponseData,
    isFailed,
    stripInternal
} from '@/helpers/actionResults';
import {useToastStore} from '@/stores/toast';
import {getRegistry} from '@/tools/websocket';
import type {action_t} from '@/types';
import Input from '../core/Input.vue';
import Modal from './Modal.vue';

const VueJsonPretty = defineAsyncComponent(() => import('vue-json-pretty'));
const JsonEditor = defineAsyncComponent(
    () => import('../core/JsonEditor.vue')
);

const CUSTOM_METHOD = '── Custom ──';
const defaultRpc: Record<string, any> = {...default_rpc};
const toastStore = useToastStore();

// ── Props / Emits ──

const props = defineProps<{
    action?: action_t | null;
    visible: boolean;
    duplicate?: boolean;
}>();
const emit = defineEmits<{close: []}>();
const isEditMode = computed(() => !!props.action && !props.duplicate);

// ── Stage ──

const stage = ref(1);
const deviceError = ref('');

function advanceToStep2() {
    if (validateDevices()) stage.value = 2;
}

// ── Form state ──

const selectedDevices = ref<string[]>([]);
const name = ref('');
const nameError = ref('');
const selectedIcon = ref('');
const iconPickerOpen = ref(false);
const saving = ref(false);
const json = ref<Record<string, any>>({});

const jsonText = computed(() => {
    try {
        return JSON.stringify(json.value, null, 2);
    } catch {
        return '{}';
    }
});

function onJsonChange(text: string) {
    try {
        json.value = JSON.parse(text);
    } catch {
        /* user is mid-typing, don't update until valid */
    }
}

const activeComponent = ref('Shelly');
const activeMethod = ref('GetStatus');
const isCustomMethod = computed(() => activeMethod.value === CUSTOM_METHOD);

const hasDevices = computed(() => selectedDevices.value.length > 0);
const ALLOWED_COMPONENT_NAMES = Object.keys(defaultRpc);
const componentMethods = computed<Record<string, any>>(
    () => defaultRpc[activeComponent.value] ?? {}
);
const componentMethodNames = computed(() =>
    Object.keys(componentMethods.value)
);
const methodOptionsWithCustom = computed(() => [
    ...componentMethodNames.value,
    CUSTOM_METHOD
]);

// ── Initialize ──

function initFromAction(action: action_t) {
    const step = action.actions?.[0];
    selectedDevices.value = step?.dst ?? [];
    name.value = action.name ?? '';
    selectedIcon.value = action.icon ?? '';
    json.value = step ? {...step} : createDefaultPayload([]);
    activeMethod.value = CUSTOM_METHOD;
}

function initEmpty() {
    selectedDevices.value = [];
    name.value = '';
    selectedIcon.value = '';
    json.value = createDefaultPayload([]);
    activeMethod.value = 'GetStatus';
}

watch(
    () => props.action,
    (a) => (a ? initFromAction(a) : initEmpty()),
    {immediate: true}
);

// ── Pure helpers (ANSWER only) ──

function createDefaultPayload(dst: string[]): Record<string, any> {
    return {id: 1, method: 'Shelly.GetStatus', params: {}, dst};
}

function createPresetPayload(
    comp: string,
    method: string,
    dst: string[]
): Record<string, any> {
    return {id: 1, ...(defaultRpc[comp]?.[method] ?? {}), dst};
}

function resolveDst(): string[] {
    const d = json.value.dst;
    return Array.isArray(d) && d.length ? d : selectedDevices.value;
}

// ── Validation (ANSWER only) ──

function validateName(): boolean {
    nameError.value = !name.value?.trim() ? 'Action name is required' : '';
    return !nameError.value;
}

function validateDevices(): boolean {
    if (hasDevices.value) {
        deviceError.value = '';
        return true;
    }
    deviceError.value = 'Select at least one device';
    return false;
}

// ── Actions (DO only) ──

function applyIcon(icon: string) {
    selectedIcon.value = icon;
    if (icon) iconPickerOpen.value = false;
}

function applyComponentPreset(comp: string | number | boolean) {
    const c = String(comp);
    if (!ALLOWED_COMPONENT_NAMES.includes(c)) return;
    activeComponent.value = c;
    activeMethod.value = componentMethodNames.value[0] ?? '';
    json.value = createPresetPayload(
        c,
        activeMethod.value,
        selectedDevices.value
    );
}

function applyMethodPreset(m: string | number | boolean) {
    const method = String(m);
    if (method === CUSTOM_METHOD) {
        activeMethod.value = CUSTOM_METHOD;
        return;
    }
    if (!componentMethods.value[method]) return;
    activeMethod.value = method;
    json.value = createPresetPayload(
        activeComponent.value,
        method,
        selectedDevices.value
    );
}

function copyToClipboard(text: string, label: string) {
    navigator.clipboard
        .writeText(text)
        .then(() => toastStore.success(label))
        .catch(() => toastStore.error('Copy failed'));
}

function copyPayload() {
    copyToClipboard(JSON.stringify(json.value, null, 2), 'Payload copied');
}

// ── Test run ──

const editRunResults = ref<Record<string, any> | null>(null);
const editRunning = ref(false);
const resultsSearch = ref('');

const okCount = computed(() => {
    if (!editRunResults.value) return 0;
    return Object.values(editRunResults.value).filter((r: any) => !isFailed(r))
        .length;
});

const failCount = computed(() => {
    if (!editRunResults.value) return 0;
    return Object.values(editRunResults.value).filter(isFailed).length;
});

const visibleResults = computed((): [string, any][] => {
    if (!editRunResults.value) return [];
    const entries = Object.entries(editRunResults.value);
    if (!resultsSearch.value) return entries;
    const q = resultsSearch.value.toLowerCase();
    return entries.filter(([id]) => id.toLowerCase().includes(q));
});

function buildTestAction(): action_t {
    const dst = resolveDst();
    return {
        name: name.value || 'Test',
        id: 'test',
        type: 'action',
        actions: [{...json.value, dst}]
    };
}

async function runTest() {
    editRunning.value = true;
    editRunResults.value = null;
    try {
        const {runAction} = await import('@/helpers/commands');
        editRunResults.value = await runAction(buildTestAction());
        resultsSearch.value = '';
    } catch {
        toastStore.error('Failed to run action');
    } finally {
        editRunning.value = false;
    }
}

function copySingleResult(deviceId: string, result: any) {
    copyToClipboard(
        JSON.stringify(stripInternal(result), null, 2),
        `Copied ${deviceId}`
    );
}

function copyAllResults() {
    if (!editRunResults.value) return;
    copyToClipboard(
        JSON.stringify(editRunResults.value, null, 2),
        'All results copied'
    );
}

// ── Save ──

function buildSavePayload(): Record<string, any> | null {
    if (!validateName()) return null;
    const dst = resolveDst();
    const payload: any = {
        name: name.value,
        actions: JSON.stringify([{...json.value, dst}])
    };
    if (selectedIcon.value) payload.icon = selectedIcon.value;
    if (isEditMode.value && props.action?.id)
        payload.id = Number.parseInt(props.action.id, 10);
    return payload;
}

async function handleSave() {
    const payload = buildSavePayload();
    if (!payload) return;
    saving.value = true;
    try {
        await getRegistry('actions').setItem('rpc', payload);
        onClose();
    } catch {
        toastStore.error('Failed to save action');
    } finally {
        saving.value = false;
    }
}

// Ctrl+Enter / Cmd+Enter: save when save button is visible, advance when on step 1
function onKeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
    if (iconPickerOpen.value) return;
    e.preventDefault();
    if (isEditMode.value || stage.value === 2) handleSave();
    else if (stage.value === 1) advanceToStep2();
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

function onClose() {
    stage.value = 1;
    iconPickerOpen.value = false;
    emit('close');
}
</script>

<style>
.vjs-tree { color: var(--color-text-secondary); background-color: transparent; font-size: var(--type-body); }
.vjs-tree .vjs-key { color: var(--color-primary); }
.vjs-tree .vjs-value-string { color: var(--color-status-on); }
.vjs-tree .vjs-value-number { color: var(--color-accent-text); }
.vjs-tree .vjs-value-boolean { color: var(--color-warning-text); }
.vjs-tree .vjs-value-null { color: var(--color-text-disabled); }
</style>

<style scoped>
.ea { display: flex; flex-direction: column; gap: var(--gap-xs); }
.ea-section { display: flex; flex-direction: column; gap: var(--gap-xs); }
.ea-section-hdr { font-size: var(--type-body); font-weight: 700; color: var(--color-text-secondary); display: flex; align-items: center; gap: var(--gap-xs); }
.ea-footer { display: flex; align-items: center; gap: var(--gap-sm); }
.ea-spacer { flex: 1; }
.ea-ml-auto { margin-left: auto; }
.ea-flex-1 { flex: 1; }
.ea-error { font-size: var(--type-body); color: var(--color-danger-text); font-weight: 600; }

/* Step pills */
.ea-create-title { display: flex; flex-direction: column; gap: var(--gap-xs); }
.ea-step-pills { display: flex; gap: var(--gap-xs); }
.ea-pill {
    display: flex; align-items: center; gap: var(--gap-xs);
    padding: var(--gap-xs) var(--gap-sm); border-radius: var(--radius-md);
    font-size: var(--type-body); font-weight: 600; color: var(--color-text-quaternary);
    border: 1px solid transparent; cursor: pointer; transition: all var(--duration-fast);
}
.ea-pill:hover { color: var(--color-text-secondary); }
.ea-pill--active { color: var(--color-primary); border-color: color-mix(in srgb, var(--color-primary) 30%, transparent); background: color-mix(in srgb, var(--color-primary) 6%, transparent); }
.ea-pill--disabled { opacity: 0.4; pointer-events: none; }
.ea-pill-num {
    width: var(--gap-md); height: var(--gap-md); border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: var(--type-body); font-weight: 700;
    background: var(--color-surface-3); color: var(--color-text-tertiary);
}
.ea-pill--active .ea-pill-num { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }

/* Name + icon */
.ea-name-row { display: flex; align-items: center; gap: var(--gap-sm); }
.ea-icon-circle {
    width: var(--touch-target-min); height: var(--touch-target-min); min-width: var(--touch-target-min); border-radius: 50%; cursor: pointer;
    display: flex; align-items: center; justify-content: center; font-size: var(--type-body);
    background: rgba(var(--ar-action), 0.06); border: 1.5px solid rgba(var(--ar-action), 0.18); color: var(--a-action);
    transition: background var(--duration-fast), border-color var(--duration-fast);
}
.ea-icon-circle:hover { background: rgba(var(--ar-action), 0.12); border-color: rgba(var(--ar-action), 0.35); }

/* Command */
.ea-preset-row { display: flex; gap: var(--gap-xs); flex-wrap: wrap; align-items: center; }
.ea-dropdown { min-width: 140px; flex: 1; }
/* JSON editor handled by JsonEditor component */

/* Device grid (3 columns) */
.ea-device-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gap-xs); }
.ea-device-chip {
    font-size: var(--type-body); font-family: monospace;
    padding: var(--gap-xs); border-radius: var(--radius-sm);
    background: var(--color-surface-3); color: var(--color-text-tertiary);
    border: 1px solid var(--color-border-medium);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ea-device-chip--more { font-family: inherit; color: var(--color-text-quaternary); text-align: center; }

/* Run bar */
.ea-run-bar { display: flex; align-items: center; gap: var(--gap-xs); }

/* Results (inline) */
.ea-stat { font-size: var(--type-body); font-weight: 700; display: flex; align-items: center; gap: var(--gap-xs); }
.ea-stat--ok { color: var(--color-status-on); }
.ea-stat--fail { color: var(--color-status-off); }
.ea-results { display: flex; flex-direction: column; gap: var(--gap-xs); max-height: 300px; overflow-y: auto; }
.ea-result { border-radius: var(--radius-md); border: 1px solid var(--color-border-medium); background: var(--color-surface-1); overflow: hidden; }
.ea-result--fail { border-color: color-mix(in srgb, var(--color-danger-text) 25%, transparent); }
.ea-result-head { display: flex; align-items: center; gap: var(--gap-sm); padding: var(--gap-xs) var(--gap-sm); background: var(--color-surface-2); }
.ea-result-device { font-weight: 700; font-family: monospace; font-size: var(--type-body); color: var(--color-text-primary); }
.ea-result-badge { font-size: var(--type-body); font-weight: 700; padding: var(--gap-xs); border-radius: var(--radius-sm); }
.ea-result-badge--ok { color: var(--color-status-on); background: color-mix(in srgb, var(--color-status-on) 8%, transparent); }
.ea-result-badge--fail { color: var(--color-status-off); background: color-mix(in srgb, var(--color-status-off) 8%, transparent); }
.ea-result-body { padding: var(--gap-xs) var(--gap-sm); max-height: 200px; overflow-y: auto; }
</style>
