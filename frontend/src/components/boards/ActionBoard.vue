<template>
    <BoardTabs @back="rightSideMenu.clearActiveComponent">
        <template #title>
            <span class="text-lg font-semibold line-clamp-2">{{ action?.name || 'Action Details' }}</span>
        </template>

        <template #info>
            <div v-if="action" class="flex flex-col gap-3 h-full">
                <div class="flex-grow space-y-3">
                    <div v-for="(item, index) in action.actions" :key="index">
                        <template v-if="resultCount > 0">
                            <Notification type="success"> {{ fulfilledPromises }} fulfilled </Notification>
                            <Notification type="error">
                                {{ resultCount - fulfilledPromises }} errored
                            </Notification>
                        </template>

                        <div class="space-y-1">
                            <h2 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-disabled)]">Command</h2>
                            <pre class="action-code p-3 rounded-lg text-xs font-mono overflow-auto max-h-48">{{ JSON.stringify({ ...item, dst: undefined }, undefined, 2) }}</pre>
                        </div>

                        <div class="space-y-2 mt-3">
                            <h2 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-disabled)]">Target Devices</h2>
                            <ul v-if="'dst' in item" class="space-y-1">
                                <li v-for="shellyID in item.dst" :key="shellyID">
                                    <DeviceWidget v-memo="shellyID" :device-id="shellyID" vertical />
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div class="action-footer sticky bottom-0 p-3 -mx-3 -mb-3 rounded-b-lg">
                    <Button class="w-full" :loading="waitingForResponse" :disabled="waitingForResponse" @click="run">
                        <i class="fas fa-play mr-2"></i> Run Action
                    </Button>
                </div>
            </div>
        </template>

        <template #debug>
            <div v-if="resultCount > 0">
                <div v-for="(device, shellyID) in deviceResults" :key="shellyID" class="mb-4">
                    <Collapse :title="shellyID">
                        <Spinner v-if="device.loading" />
                        <JSONViewer v-else :data="device.result" />
                    </Collapse>
                </div>
            </div>
            <div v-else class="text-center py-8">
                <i class="fas fa-terminal text-2xl text-[var(--color-text-disabled)] mb-2"></i>
                <p class="text-sm text-[var(--color-text-tertiary)]">Run the action to see results here.</p>
            </div>
        </template>
    </BoardTabs>
</template>

<script setup lang="ts">
import {computed, ref, toRef, watch} from 'vue';
import BoardTabs from '@/components/boards/BoardTabs.vue';
import Button from '@/components/core/Button.vue';
import Collapse from '@/components/core/Collapse.vue';
import Spinner from '@/components/core/Spinner.vue';
import JSONViewer from '@/components/JSONViewer.vue';
import DeviceWidget from '@/components/widgets/DeviceWidget.vue';
import {runAction} from '@/helpers/commands';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import type {action_t} from '@/types';
import Notification from '../core/Notification.vue';

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
        toastStore.error(
            'Something went wrong with the action.' + String(error)
        );
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
.action-code {
    background-color: var(--color-surface-0);
    color: var(--color-code-text);
    border: 1px solid var(--color-border-default);
}
.action-footer {
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border-top: 1px solid var(--glass-border);
}
</style>
