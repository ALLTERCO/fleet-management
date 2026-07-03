<template>
    <PageTemplate
        v-model:search="searchQuery"
        :selectable="canWrite"
        title="Automations"
        :tabs="automationsTabs"
        :count="`${filteredActionItems.length} action${filteredActionItems.length === 1 ? '' : 's'}`"
        :searchable="true"
        search-placeholder="Search actions…"
        :loading="loading && actionItems.length === 0"
        :empty="!loading && filteredActionItems.length === 0"
        empty-title="No actions yet"
        empty-sub="Use the Add button in the top right to create your first action."
        :items="filteredActionItems"
        :page-size="50"
        pagination-mode="infinite"
        url-key="actions"
        :item-key="actionItemKey"
    >
        <template #actions>
            <Button
                v-if="canWrite"
                type="green"
                size="sm"
                title="New action"
                aria-label="New action"
                @click="addActionVisible = true"
            >
                <i class="fas fa-plus" aria-hidden="true" />
            </Button>
            <Button
                type="blue-hollow"
                size="sm"
                narrow
                title="Refresh"
                aria-label="Refresh"
                @click="refresh"
            >
                <i class="fas fa-sync-alt" />
            </Button>
        </template>

        <template #item="{item, selecting, selected, toggleSelect}">
            <CardValue_Action
                :action="item"
                size="1x1"
                :selected="selected"
                :run-state="cardRunStates[item.id]"
                @open-detail="selecting ? toggleSelect() : previewAction(item)"
                @run="runAction(item)"
            />
        </template>

        <template #bulk-actions="{selectedItems, clear}">
            <Button
                type="red"
                size="sm"
                title="Delete"
                aria-label="Delete selected"
                @click="bulkDeleteActions(selectedItems, clear)"
            >
                <i class="fas fa-trash" aria-hidden="true" />
            </Button>
        </template>

        <template #modals>
            <CreateAndEditActionModal
                v-if="addActionVisible"
                :visible="addActionVisible"
                @close="closeCreateModal"
            />
            <CreateAndEditActionModal
                v-if="editActionVisible"
                :visible="editActionVisible"
                :action="selectedAction"
                @close="closeEditModal"
            />
            <Modal
                v-if="previewVisible"
                :visible="previewVisible"
                wide
                @close="previewVisible = false"
            >
                <template #title>
                    <div class="ap-title">
                        <div class="ap-title-icon">
                            <i :class="previewTarget?.icon || 'fas fa-bolt'" />
                        </div>
                        <div class="ap-title-text">
                            <div class="ap-title-name">
                                {{ previewTarget?.name }}
                            </div>
                            <div class="ap-title-meta">
                                {{ previewDeviceCount }} device{{
                                    previewDeviceCount === 1 ? '' : 's'
                                }}
                                · {{ previewTarget?.actions?.length ?? 0 }} step{{
                                    (previewTarget?.actions?.length ?? 0) === 1
                                        ? ''
                                        : 's'
                                }}
                            </div>
                        </div>
                    </div>
                </template>
                <template #default>
                    <div v-if="previewTarget" class="ap">
                        <div class="ap-section">
                            <div class="ap-section-hdr">Commands</div>
                            <div class="ap-commands">
                                <div
                                    v-for="(step, i) in previewTarget.actions"
                                    :key="i"
                                    class="ap-cmd"
                                >
                                    <div class="ap-cmd-head">
                                        <span class="ap-cmd-num">
                                            {{ i + 1 }}
                                        </span>
                                        <span class="ap-cmd-method">
                                            {{ step.method }}
                                        </span>
                                    </div>
                                    <div
                                        v-if="
                                            normalizeDeviceList(step.dst).length
                                        "
                                        class="ap-cmd-targets"
                                    >
                                        <div
                                            v-for="d in normalizeDeviceList(
                                                step.dst
                                            )"
                                            :key="d"
                                            class="ap-cmd-target"
                                        >
                                            <i class="fas fa-microchip" />
                                            <span class="ap-cmd-target-name">
                                                {{ getDeviceName(d) }}
                                            </span>
                                            <span class="ap-cmd-target-id">
                                                {{ d }}
                                            </span>
                                        </div>
                                    </div>
                                    <div
                                        v-if="hasParams(step)"
                                        class="ap-cmd-params"
                                    >
                                        <span
                                            v-for="(val, key) in step.params"
                                            :key="key"
                                            class="ap-cmd-param"
                                        >
                                            {{ key }}:
                                            <b>{{ formatParamValue(val) }}</b>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="ap-section">
                            <div class="ap-section-hdr">
                                Payload
                                <Button
                                    type="blue-hollow"
                                    size="xs"
                                    class="ap-ml-auto"
                                    @click="copyPreviewPayload"
                                >
                                    Copy
                                </Button>
                            </div>
                            <div class="ap-json">
                                <VueJsonPretty
                                    :data="previewTarget.actions"
                                    :deep="Infinity"
                                    :show-line="false"
                                />
                            </div>
                        </div>

                        <div v-if="previewResults" class="ap-section">
                            <div class="ap-section-hdr">
                                Results
                                <span class="ap-result-stat ap-result-stat--ok">
                                    <i class="fas fa-check" />
                                    {{ previewOkCount }}
                                </span>
                                <span
                                    class="ap-result-stat ap-result-stat--fail"
                                >
                                    <i class="fas fa-xmark" />
                                    {{ previewFailCount }}
                                </span>
                                <Button
                                    type="blue-hollow"
                                    size="xs"
                                    class="ap-ml-auto"
                                    @click="copyPreviewResults"
                                >
                                    Copy all
                                </Button>
                            </div>
                            <Input
                                v-model="previewResultsSearch"
                                placeholder="Search results..."
                            />
                            <div class="ap-results">
                                <div
                                    v-for="[deviceId, result] in filteredPreviewResults"
                                    :key="deviceId"
                                    class="ap-result"
                                    :class="{'ap-result--fail': isFailed(result)}"
                                >
                                    <div class="ap-result-head">
                                        <span class="ap-result-device">
                                            {{ getDeviceName(String(deviceId)) }}
                                        </span>
                                        <span class="ap-result-id">
                                            {{ deviceId }}
                                        </span>
                                        <span
                                            v-if="isFailed(result)"
                                            class="ap-result-badge ap-result-badge--fail"
                                        >
                                            Error {{ result.code }}
                                        </span>
                                        <span
                                            v-else
                                            class="ap-result-badge ap-result-badge--ok"
                                        >
                                            <i class="fas fa-check" /> OK
                                        </span>
                                        <Button
                                            type="blue-hollow"
                                            size="xs"
                                            class="ap-ml-auto"
                                            @click="
                                                copySinglePreviewResult(
                                                    String(deviceId),
                                                    result
                                                )
                                            "
                                            title="Copy"
                                            aria-label="Copy"
                                        >
                                            <i class="fas fa-copy" aria-hidden="true" />
                                        </Button>
                                    </div>
                                    <div
                                        v-if="hasResponseData(result)"
                                        class="ap-result-body"
                                    >
                                        <VueJsonPretty
                                            :data="stripInternal(result)"
                                            :deep="3"
                                            :show-line="false"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
                <template #footer>
                    <div class="ap-footer">
                        <Button
                            type="red"
                            size="sm"
                            @click="deleteFromPreview"
                        >
                            Delete
                        </Button>
                        <div class="ap-footer-spacer" />
                        <Button
                            type="blue"
                            :loading="previewRunning"
                            size="sm"
                            @click="runFromPreview"
                        >
                            {{ previewResults ? 'Run again' : 'Run' }}
                        </Button>
                        <Button type="blue-hollow" size="sm" @click="editFromPreview">
                            Edit
                        </Button>
                    </div>
                </template>
            </Modal>

            <ConfirmationModal ref="deleteModalRef">
                <template #title>
                    <h3>{{ deleteLabel }}</h3>
                </template>
            </ConfirmationModal>
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import '@/styles/card-system.css';
import '@/styles/device-page.css';
import {
    type ComputedRef,
    computed,
    defineAsyncComponent,
    inject,
    onUnmounted,
    ref,
    watch
} from 'vue';
import CardValue_Action from '@/components/cards/CardValue_Action.vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import CreateAndEditActionModal from '@/components/modals/CreateAndEditActionModal.vue';
import Modal from '@/components/modals/Modal.vue';
import {useMinDelay} from '@/composables/useMinDelay';
import {usePermissions} from '@/composables/usePermissions';
import useRegistry from '@/composables/useRegistry';
import {
    countResults,
    hasResponseData,
    isFailed,
    stripInternal
} from '@/helpers/actionResults';
import {getDeviceName as getDeviceNameHelper} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {getRegistry} from '@/tools/websocket';
import type {action_t} from '@/types';
import type {RouteTab} from '@/types/page-template';

const VueJsonPretty = defineAsyncComponent(() => import('vue-json-pretty'));

const automationsTabs = inject<RouteTab[] | ComputedRef<RouteTab[]>>(
    'automationsTabs',
    [] as RouteTab[]
);

const {canWrite} = usePermissions();
const toastStore = useToastStore();
const devicesStore = useDevicesStore();

const {
    data: actions,
    loading: rawLoading,
    refresh,
    upload
} = useRegistry<action_t[]>('actions', 'rpc');
const loading = useMinDelay(rawLoading, 500);
const actionItems = computed(() => actions.value || []);

const searchQuery = ref('');
const deleteLabel = ref('Delete this action?');

function actionMatchesSearch(action: action_t, query: string): boolean {
    if (action.name?.toLowerCase().includes(query)) return true;
    for (const step of action.actions ?? []) {
        if (step.method?.toLowerCase().includes(query)) return true;
        const targets = Array.isArray(step.dst)
            ? step.dst
            : step.dst
              ? [step.dst]
              : [];
        for (const d of targets) {
            if (d.toLowerCase().includes(query)) return true;
            const dev = devicesStore.devices[d];
            const name = dev?.info?.name || dev?.settings?.name;
            if (name?.toLowerCase().includes(query)) return true;
        }
    }
    return false;
}

const filteredActionItems = computed(() => {
    if (!searchQuery.value) return actionItems.value;
    const q = searchQuery.value.toLowerCase();
    return actionItems.value.filter((a: action_t) =>
        actionMatchesSearch(a, q)
    );
});


function actionItemKey(action: {id: number | string}): string | number {
    return action.id;
}

// Initialise the registry once data lands; rawLoading flips first
watch(rawLoading, () => {
    if (!rawLoading.value && actions.value == null) {
        actions.value = [];
        upload();
    }
});

const deleteModalRef = ref<InstanceType<typeof ConfirmationModal>>();

const addActionVisible = ref(false);
const editActionVisible = ref(false);
const selectedAction = ref<action_t | null>(null);

function getDeviceName(shellyID: string): string {
    const dev = devicesStore.devices[shellyID];
    if (dev) return getDeviceNameHelper(dev.info, shellyID);
    return shellyID;
}

// Per-card run indicator: 'running' | 'ok' | 'error', auto-clears after 3s
const cardRunStates = ref<Record<string, 'running' | 'ok' | 'error'>>({});
const cardRunTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setCardRunState(actionId: string, state: 'running' | 'ok' | 'error') {
    cardRunStates.value[actionId] = state;
    const prev = cardRunTimers.get(actionId);
    if (prev) clearTimeout(prev);
    if (state !== 'running') {
        cardRunTimers.set(
            actionId,
            setTimeout(() => {
                delete cardRunStates.value[actionId];
                cardRunTimers.delete(actionId);
            }, 3000)
        );
    }
}

async function runAction(action: action_t) {
    setCardRunState(action.id, 'running');
    try {
        const {runAction: execute} = await import('@/helpers/commands');
        const results = await execute(action);
        const {total, failed} = countResults(results);
        setCardRunState(action.id, failed === 0 ? 'ok' : 'error');
        if (failed === 0)
            toastStore.success(`Action "${action.name}" — ${total}/${total} OK`);
        else
            toastStore.error(
                `Action "${action.name}" — ${failed}/${total} failed`
            );
    } catch {
        setCardRunState(action.id, 'error');
        toastStore.error(`Failed to run action "${action.name}"`);
    }
}

function deleteAction(action: action_t) {
    deleteLabel.value = 'Delete this action?';
    deleteModalRef.value?.storeAction(async () => {
        try {
            await getRegistry('actions').removeItem('rpc', {id: action.id});
            refresh();
        } catch {
            toastStore.error('Failed to delete action');
        }
    });
}

function bulkDeleteActions(items: action_t[], clear: () => void) {
    deleteLabel.value =
        items.length === 1
            ? 'Delete this action?'
            : `Delete ${items.length} actions?`;
    deleteModalRef.value?.storeAction(async () => {
        try {
            await Promise.all(
                items.map((a) =>
                    getRegistry('actions').removeItem('rpc', {id: a.id})
                )
            );
            clear();
            refresh();
        } catch {
            toastStore.error('Failed to delete actions');
        }
    });
}

function editAction(action: action_t) {
    selectedAction.value = action;
    editActionVisible.value = true;
}

function closeEditModal() {
    editActionVisible.value = false;
    refresh();
}

function closeCreateModal() {
    addActionVisible.value = false;
    refresh();
}

// ── Preview modal ──

const previewVisible = ref(false);
const previewTarget = ref<action_t | null>(null);
const previewResults = ref<Record<string, any> | null>(null);
const previewRunning = ref(false);
const previewResultsSearch = ref('');

const previewDeviceCount = computed(() => {
    if (!previewTarget.value) return 0;
    return previewTarget.value.actions.reduce(
        (acc: number, step: any) =>
            acc +
            (Array.isArray(step?.dst) ? step.dst.length : step?.dst ? 1 : 0),
        0
    );
});

const previewOkCount = computed(() => {
    if (!previewResults.value) return 0;
    return Object.values(previewResults.value).filter(
        (r: any) => !isFailed(r)
    ).length;
});

const previewFailCount = computed(() => {
    if (!previewResults.value) return 0;
    return Object.values(previewResults.value).filter(isFailed).length;
});

const filteredPreviewResults = computed((): [string, any][] => {
    if (!previewResults.value) return [];
    const entries = Object.entries(previewResults.value);
    if (!previewResultsSearch.value) return entries;
    const q = previewResultsSearch.value.toLowerCase();
    return entries.filter(([id]) => id.toLowerCase().includes(q));
});

function previewAction(action: action_t) {
    previewTarget.value = action;
    previewResults.value = null;
    previewVisible.value = true;
}

async function runFromPreview() {
    if (!previewTarget.value) return;
    previewRunning.value = true;
    previewResults.value = null;
    try {
        const {runAction: execute} = await import('@/helpers/commands');
        previewResults.value = await execute(previewTarget.value);
    } catch {
        toastStore.error('Failed to run action');
    } finally {
        previewRunning.value = false;
    }
}

function editFromPreview() {
    if (!previewTarget.value) return;
    previewVisible.value = false;
    editAction(previewTarget.value);
}

function deleteFromPreview() {
    if (!previewTarget.value) return;
    const action = previewTarget.value;
    previewVisible.value = false;
    deleteAction(action);
}

function normalizeDeviceList(dst: any): string[] {
    if (Array.isArray(dst)) return dst;
    if (dst) return [dst];
    return [];
}

function hasParams(step: any): boolean {
    return step?.params && Object.keys(step.params).length > 0;
}

function formatParamValue(val: any): string {
    return typeof val === 'object' ? JSON.stringify(val) : String(val);
}

function copyToClipboard(text: string, label: string) {
    navigator.clipboard
        .writeText(text)
        .then(() => toastStore.success(label))
        .catch(() => toastStore.error('Copy failed'));
}

function copyPreviewPayload() {
    if (!previewTarget.value) return;
    copyToClipboard(
        JSON.stringify(previewTarget.value.actions, null, 2),
        'Payload copied'
    );
}

function copyPreviewResults() {
    if (!previewResults.value) return;
    copyToClipboard(
        JSON.stringify(previewResults.value, null, 2),
        'Results copied'
    );
}

function copySinglePreviewResult(deviceId: string, result: any) {
    copyToClipboard(
        JSON.stringify(stripInternal(result), null, 2),
        `Copied ${deviceId}`
    );
}

onUnmounted(() => {
    for (const t of cardRunTimers.values()) clearTimeout(t);
    cardRunTimers.clear();
});
</script>

<style scoped>
/* ═══ Action Preview ═══ */
.ap {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.ap-title {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.ap-title-icon {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: 50%;
    background: rgba(var(--ar-action), 0.08);
    border: 1.5px solid rgba(var(--ar-action), 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--a-action);
    font-size: var(--type-body);
    flex-shrink: 0;
}
.ap-title-text {
    display: flex;
    flex-direction: column;
}
.ap-title-name {
    font-size: var(--type-body);
    font-weight: 800;
    color: var(--color-text-primary);
}
.ap-title-meta {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.ap-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.ap-section-hdr {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-secondary);
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.ap-ml-auto {
    margin-left: auto;
}

/* Commands */
.ap-commands {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.ap-cmd {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-left: 3px solid var(--color-primary);
}
.ap-cmd-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.ap-cmd-num {
    width: var(--space-5);
    height: var(--space-5);
    border-radius: 50%;
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-primary);
    flex-shrink: 0;
}
.ap-cmd-method {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-primary);
    font-family: var(--font-mono);
}
.ap-cmd-targets {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-left: var(--space-5);
}
.ap-cmd-target {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.ap-cmd-target i {
    color: var(--color-text-disabled);
}
.ap-cmd-target-name {
    font-weight: 600;
    color: var(--color-text-primary);
}
.ap-cmd-target-id {
    font-family: var(--font-mono);
    color: var(--color-text-quaternary);
}
.ap-cmd-params {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-left: var(--space-5);
}
.ap-cmd-param {
    font-size: var(--type-body);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    color: var(--color-text-tertiary);
}
.ap-cmd-param b {
    color: var(--color-text-primary);
}

/* Payload */
.ap-json {
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-medium);
    background: var(--color-surface-0);
    padding: var(--space-3);
    max-height: 250px;
    overflow-y: auto;
}

/* Results */
.ap-result-stat {
    font-size: var(--type-body);
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.ap-result-stat--ok {
    color: var(--color-status-on);
}
.ap-result-stat--fail {
    color: var(--color-status-off);
}
.ap-results {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 300px;
    overflow-y: auto;
}
.ap-result {
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-medium);
    background: var(--color-surface-1);
    overflow: hidden;
}
.ap-result--fail {
    border-color: color-mix(in srgb, var(--color-danger-text) 25%, transparent);
}
.ap-result-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
}
.ap-result-device {
    font-weight: 700;
    font-size: var(--type-body);
    color: var(--color-text-primary);
}
.ap-result-id {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
}
.ap-result-badge {
    font-size: var(--type-body);
    font-weight: 700;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    margin-left: auto;
}
.ap-result-badge--ok {
    color: var(--color-status-on);
    background: color-mix(in srgb, var(--color-status-on) 8%, transparent);
}
.ap-result-badge--fail {
    color: var(--color-status-off);
    background: color-mix(in srgb, var(--color-status-off) 8%, transparent);
}
.ap-result-body {
    padding: var(--space-2) var(--space-3);
    max-height: 200px;
    overflow-y: auto;
}

/* Footer */
.ap-footer {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.ap-footer-spacer {
    flex: 1;
}
</style>
