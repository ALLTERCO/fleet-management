<template>
    <BoardTabs :tabs="[{name: 'info', icon: 'fas fa-bolt'}]" @back="rightSideMenu.clearInspector">
        <template #title>
            <span class="text-lg font-semibold line-clamp-2">{{ action?.name || 'Action Details' }}</span>
        </template>

        <template #info>
            <div v-if="action" class="action-board">
                <div v-for="(item, index) in action.actions" :key="index" class="action-board__step">
                    <div v-if="action.actions.length > 1" class="action-board__step-num">Step {{ index + 1 }}</div>

                    <h2 class="action-board__label"><i class="fas fa-terminal action-board__label-icon" /> Command</h2>
                    <JSONViewer :data="stripDst(item)" />

                    <h2 class="action-board__label"><i class="fas fa-microchip action-board__label-icon" /> Target Devices</h2>
                    <div v-if="'dst' in item" class="action-board__devices">
                        <button
                            v-for="shellyID in item.dst"
                            :key="shellyID"
                            class="action-board__device"
                            :class="deviceStatusClass(shellyID)"
                        >
                            <span class="action-board__device-id">{{ shellyID }}</span>
                            <template v-if="deviceResults[shellyID]">
                                <Spinner v-if="deviceResults[shellyID].loading" size="xs" />
                                <i v-else-if="deviceResults[shellyID].result?.__promiseStatus === 'fulfilled'" class="fas fa-check action-board__icon--ok" />
                                <i v-else class="fas fa-times action-board__icon--err" />
                            </template>
                        </button>
                    </div>

                    <div v-if="index < action.actions.length - 1" class="action-board__divider" />
                </div>

                <!-- Results (inline after run) -->
                <template v-if="resultCount > 0">
                    <div class="action-board__summary">
                        <div class="action-board__summary-row">
                            <span class="action-board__summary-text">
                                {{ fulfilledPromises }}/{{ resultCount }} succeeded
                            </span>
                            <span class="action-board__summary-pct">
                                {{ Math.round((fulfilledPromises / resultCount) * 100) }}%
                            </span>
                        </div>
                        <div class="action-board__summary-bar">
                            <div class="action-board__summary-fill" :style="{ width: `${(fulfilledPromises / resultCount) * 100}%` }" />
                        </div>
                    </div>

                    <h2 class="action-board__label"><i class="fas fa-list-check action-board__label-icon" /> Results</h2>
                    <div class="action-board__results">
                        <Collapse
                            v-for="(device, shellyID) in deviceResults"
                            :key="shellyID"
                            :title="String(shellyID)"
                        >
                            <Spinner v-if="device.loading" />
                            <JSONViewer v-else :data="device.result" />
                        </Collapse>
                    </div>
                </template>

                <div class="action-board__footer">
                    <Button type="blue" class="w-full" :loading="waitingForResponse" :disabled="waitingForResponse" @click="run">
                        <i class="fas fa-play mr-2"></i> Run Action
                    </Button>
                </div>
            </div>
        </template>
    </BoardTabs>
</template>

<script setup lang="ts">
import {computed, ref, toRef, watch} from 'vue';
import BoardTabs from '@/components/boards/BoardTabs.vue';
import Button from '@/components/core/Button.vue';
import Collapse from '@/components/core/Collapse.vue';
import JSONViewer from '@/components/core/JSONViewer.vue';
import Spinner from '@/components/core/Spinner.vue';
import {runAction} from '@/helpers/commands';
import {toastRpcError} from '@/helpers/domainErrors';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import type {action_t} from '@/types';

const props = defineProps<{actionID: string}>();

const toastStore = useToastStore();
const rightSideMenu = useRightSideMenuStore();
const actionID = toRef(props, 'actionID');
const action = ref<action_t>();
const deviceResults = ref<Record<string, {loading: boolean; result: any}>>({});
const waitingForResponse = ref(false);

const resultCount = computed(() => Object.keys(deviceResults.value).length);

const fulfilledPromises = computed(() =>
    Object.values(deviceResults.value).reduce(
        (acc, curr) =>
            acc + Number(curr?.result?.__promiseStatus === 'fulfilled'),
        0
    )
);

function stripDst(item: Record<string, any>): Record<string, unknown> {
    const {dst, ...rest} = item;
    return rest;
}

function deviceStatusClass(shellyID: string): string {
    const r = deviceResults.value[shellyID];
    if (!r) return '';
    if (r.loading) return 'action-board__device--loading';
    return r.result?.__promiseStatus === 'fulfilled'
        ? 'action-board__device--ok'
        : 'action-board__device--err';
}

async function run() {
    if (!action.value) return;

    waitingForResponse.value = true;

    action.value.actions.forEach((item) => {
        if (item.dst) {
            item.dst.forEach((shellyID: string) => {
                deviceResults.value[shellyID] = {loading: true, result: null};
            });
        }
    });

    try {
        const results = await runAction(action.value);
        for (const shellyID in results) {
            const result = results[shellyID];
            deviceResults.value[shellyID] = {
                result,
                loading: false
            };
        }
    } catch (error) {
        toastRpcError(toastStore, error, 'Something went wrong with the action.');
        console.error(error);
    } finally {
        waitingForResponse.value = false;
    }
}

watch(
    actionID,
    async () => {
        const ActionsController = ws.getRegistry('actions');
        const allActions = await ActionsController.getItem<action_t[]>('rpc');
        action.value = allActions.find(
            (action) => action.id === actionID.value
        );
    },
    {immediate: true}
);
</script>

<style scoped>
.action-board {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    height: 100%;
}
.action-board__step {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}
.action-board__step-num {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-primary-text);
    background-color: var(--color-primary-subtle);
    padding: var(--space-px) var(--gap-xs);
    border-radius: var(--radius-full);
    width: fit-content;
}
.action-board__label {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    text-transform: none;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-disabled);
}
.action-board__label-icon {
    font-size: var(--type-body);
    opacity: 0.7;
}
.action-board__divider {
    height: 1px;
    background-color: var(--color-border-medium);
    margin: var(--gap-xs) 0;
}
.action-board__devices {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}
.action-board__device {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gap-xs) var(--gap-xs);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    transition: background-color var(--duration-fast) var(--ease-default);
}
.action-board__device:hover {
    background-color: var(--color-surface-3);
}
.action-board__device--ok {
    border-left: 3px solid var(--color-success);
}
.action-board__device--err {
    border-left: 3px solid var(--color-danger);
}
.action-board__device--loading {
    border-left: 3px solid var(--color-warning);
}
.action-board__device-id {
    font-size: var(--type-body);
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.action-board__icon--ok {
    color: var(--color-success-text);
}
.action-board__icon--err {
    color: var(--color-danger-text);
}

/* Results summary */
.action-board__summary {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    padding: var(--gap-xs);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.action-board__summary-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.action-board__summary-text {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.action-board__summary-pct {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}
.action-board__summary-bar {
    height: 4px;
    border-radius: var(--radius-full);
    background-color: var(--color-danger);
    overflow: hidden;
}
.action-board__summary-fill {
    height: 100%;
    border-radius: var(--radius-full);
    background-color: var(--color-success);
    transition: width var(--duration-normal) var(--ease-default);
}

/* Results list */
.action-board__results {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}
/* Footer */
.action-board__footer {
    position: sticky;
    bottom: 0;
    padding: var(--gap-sm);
    margin: 0 calc(-1 * var(--gap-sm)) calc(-1 * var(--gap-sm));
    background: var(--glass-1-bg);
    backdrop-filter: var(--glass-1-filter);
    -webkit-backdrop-filter: var(--glass-1-filter);
    border-top: 1px solid var(--glass-border);
    box-shadow: inset 0 1px 0 var(--glass-highlight);
    border-radius: 0 0 var(--radius-lg) 0;
}
</style>
