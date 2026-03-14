<template>
    <SteppedModal
        :stage="stage"
        :visible="modals.addWidget"
        :max-steps="Object.keys(STAGES).length"
        wide
        @onchange="stateChanged"
        @save="onSave"
        @close="modals.addWidget = false"
    >
        <template #stepTitle="{ stage }">
            <span v-if="stage == STAGES.TYPE" class="font-semibold">Type</span>
            <span v-if="stage == STAGES.ITEMS" class="font-semibold">Items</span>
        </template>

        <template #default="{ stage }">
            <div class="flex min-h-[34rem] min-h-0 flex-col rounded-lg bg-[var(--color-surface-1)] p-3 md:p-5">
                <div v-if="stage === STAGES.TYPE">
                    <div
                        :class="[
                            small
                                ? 'flex flex-col gap-2'
                                : 'grid gap-3 items-start md:[grid-template-columns:repeat(auto-fill,minmax(260px,320px))]'
                        ]"
                    >
                        <Widget
                            class="w-full max-w-[24rem]"
                            :selected="selectedType == 'Entity'"
                            :vertical="small"
                            :stripped="small"
                            @select="selectedType = 'Entity'"
                        >
                            <template #name>
                                <span class="font-semibold">Entity</span>
                            </template>
                            <template #description>
                                Entities allow you to see the state of a device's interactive component.
                            </template>
                        </Widget>

                        <Widget
                            class="w-full max-w-[24rem]"
                            :selected="selectedType == 'Group'"
                            :vertical="small"
                            :stripped="small"
                            @select="selectedType = 'Group'"
                        >
                            <template #name>
                                <span class="font-semibold">Group</span>
                            </template>
                            <template #description> Collection of devices. </template>
                        </Widget>

                        <Widget
                            class="w-full max-w-[24rem]"
                            :selected="selectedType == 'Action'"
                            :vertical="small"
                            :stripped="small"
                            @select="selectedType = 'Action'"
                        >
                            <template #name>
                                <span class="font-semibold">Action</span>
                            </template>
                            <template #description> Execution of commands. </template>
                        </Widget>

                        <Widget
                            class="w-full max-w-[24rem]"
                            :selected="selectedType == 'ui_widget'"
                            :vertical="small"
                            :stripped="small"
                            @select="selectedType = 'ui_widget'"
                        >
                            <template #name>
                                <span class="font-semibold">UI Elements</span>
                            </template>
                        </Widget>
                    </div>
                </div>
                <template v-if="stage === STAGES.ITEMS">
                    <div v-if="selectedType === 'Entity'" class="flex min-h-0 flex-1 flex-col space-y-2">
                        <Input v-model="entityNameFilter" class="w-full md:max-w-md" placeholder="Search entities" />
                        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
                            <div class="grid gap-3 items-start md:[grid-template-columns:repeat(auto-fill,minmax(260px,320px))]">
                            <EntityWidget
                                v-for="entity in Object.values(entityStore.entities).filter(filterEntity)"
                                :key="entity.id"
                                class="w-full"
                                stripped
                                vertical
                                :entity
                                :selected="selectedEntities.includes(entity.id)"
                                @select="selectEntity(entity.id)"
                            />
                            </div>
                        </div>
                    </div>
                    <div v-else-if="selectedType === 'Group'" class="flex min-h-0 flex-1 flex-col space-y-2">
                        <Input v-model="groupNameFilter" class="w-full md:max-w-md mt-2" placeholder="Search groups" />
                        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
                            <div class="grid gap-3 items-start md:[grid-template-columns:repeat(auto-fill,minmax(260px,320px))]">
                            <template v-for="group of groupStore.groups">
                                <template v-if="filterGroup(group.name)">
                                    <GroupWidget
                                        :key="group.id"
                                        class="w-full"
                                        vertical
                                        :members="group.devices"
                                        :name="group.name"
                                        :selected="group.id == selectedGroup"
                                        @select="selectedGroup = group.id"
                                    />
                                </template>
                            </template>
                            </div>
                        </div>
                    </div>
                    <div v-else-if="selectedType === 'Action'" class="flex min-h-0 flex-1 flex-col space-y-2">
                        <Input v-model="actionNameFilter" class="w-full md:max-w-md mt-2" placeholder="Search actions" />
                        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
                            <div class="grid gap-3 items-start md:[grid-template-columns:repeat(auto-fill,minmax(260px,320px))]">
                            <template v-for="action of actions">
                                <template v-if="filterAction(action.name)">
                                    <ActionWidget
                                        :key="action.id"
                                        class="w-full"
                                        vertical
                                        stripped
                                        :action="action"
                                        :selected="action.id == selectedAction"
                                        @select="selectedAction = action.id"
                                    />
                                </template>
                            </template>
                            </div>
                        </div>
                    </div>
                    <div v-else-if="selectedType === 'ui_widget'" class="flex min-h-0 flex-1 flex-col space-y-2">
                        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
                            <div class="grid gap-3 items-start md:[grid-template-columns:repeat(auto-fill,minmax(260px,320px))]">
                            <ClockWidget
                                class="w-full"
                                vertical
                                stripped
                                dummy
                                :selected="'clock_widget' == selectUIElement"
                                @select="selectUIElement = 'clock_widget'"
                            />
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </template>
    </SteppedModal>
</template>

<script lang="ts" setup>
import {modals, small} from '@/helpers/ui';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useToastStore} from '@/stores/toast';
import {getRegistry} from '@/tools/websocket';
import type {action_t, entity_t} from '@/types';
import {ref} from 'vue';
import Input from '../core/Input.vue';
import ActionWidget from '../widgets/ActionWidget.vue';
import EntityWidget from '../widgets/EntityWidget.vue';
import GroupWidget from '../widgets/GroupWidget.vue';
import ClockWidget from '../widgets/IntegratedWidgets/ClockWidget.vue';
import Widget from '../widgets/WidgetsTemplates/VanilaWidget.vue';
import SteppedModal from './SteppedModal.vue';

const STAGES = {
    TYPE: 1,
    ITEMS: 2
} as const;

const entityStore = useEntityStore();
const toastStore = useToastStore();
const groupStore = useGroupsStore();
const ActionsController = getRegistry('actions');

type SelectableType = 'Entity' | 'Group' | 'Action' | 'ui_widget';

const selectedType = ref<SelectableType>('Entity');
const stage = ref(1);

const selectedEntities = ref<string[]>([]);
const selectedGroup = ref(-1);
const selectedAction = ref('');
const actions = ref<action_t[]>([]);
const selectUIElement = ref('');

const emit = defineEmits<{
    added: [
        item: {
            type: 'entities' | 'group' | 'action' | 'ui_widget';
            data: any;
        }
    ];
}>();

// BEGIN Entity stage 2
const entityNameFilter = ref('');
const groupNameFilter = ref('');
const actionNameFilter = ref('');

async function stateChanged(stage: number) {
    if (stage === STAGES.ITEMS) {
        if (selectedType.value === 'Action') {
            actions.value = await ActionsController.getItem('rpc');
        }
    }
}

function filterEntity(entity: entity_t) {
    if (entityNameFilter.value.length > 1) {
        if (
            !entity.name
                .toLowerCase()
                .includes(entityNameFilter.value.toLowerCase())
        ) {
            return false;
        }
    }

    return true;
}

function filterGroup(name: string) {
    if (groupNameFilter.value.length > 1) {
        if (!name.toLowerCase().includes(groupNameFilter.value.toLowerCase())) {
            return false;
        }
    }
    return true;
}

function filterAction(name: string) {
    if (actionNameFilter.value.length > 1) {
        if (
            !name.toLowerCase().includes(actionNameFilter.value.toLowerCase())
        ) {
            return false;
        }
    }
    return true;
}

// END Entity stage 2

function onSave() {
    switch (selectedType.value) {
        case 'Entity':
            {
                if (selectedEntities.value.length === 0) {
                    toastStore.warning('You need to select an entity');
                    return;
                }

                emit('added', {
                    type: 'entities',
                    data: {
                        ids: selectedEntities.value
                    }
                });
            }

            stage.value = 1;
            // Reset stage 2 entity
            entityNameFilter.value = '';
            selectedEntities.value.length = 0;
            break;

        case 'Group': {
            if (selectedGroup.value === -1) {
                toastStore.warning('You need to select a group');
                return;
            }

            emit('added', {
                type: 'group',
                data: {
                    id: selectedGroup.value,
                    name: groupStore.groups[selectedGroup.value].name
                }
            });
            break;
        }

        case 'Action': {
            if (selectedAction.value.length === 0) {
                toastStore.warning('You need to select an action');
                return;
            }

            emit('added', {
                type: 'action',
                data: {
                    id: selectedAction.value
                }
            });
            break;
        }

        case 'ui_widget': {
            if (selectUIElement.value.length === 0) {
                toastStore.warning('You need to select an element');
                return;
            }

            emit('added', {
                type: 'ui_widget',
                data: {
                    id: selectUIElement.value
                }
            });
            break;
        }

        default:
            toastStore.warning('Not supported yet.');
    }
}

function selectEntity(entityID: string) {
    if (selectedEntities.value.includes(entityID)) {
        selectedEntities.value.splice(
            selectedEntities.value.indexOf(entityID),
            1
        );
    } else {
        selectedEntities.value.push(entityID);
    }
}
</script>
