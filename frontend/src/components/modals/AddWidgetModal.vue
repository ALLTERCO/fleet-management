<template>
    <SteppedModal
        :stage="stage"
        :visible="modals.addWidget"
        :max-steps="Object.keys(STAGES).length"
        @onchange="stateChanged"
        @save="onSave"
        @close="modals.addWidget = false"
    >
        <template #stepTitle="{ stage }">
            <span v-if="stage == STAGES.TYPE" class="font-semibold">Type</span>
            <span v-if="stage == STAGES.ITEMS" class="font-semibold">Items</span>
        </template>

        <template #default="{ stage }">
            <div class="bg-[var(--color-surface-1)] rounded-lg p-2 md:p-4">
                <div v-if="stage === STAGES.TYPE">
                    <div :class="[small ? 'flex flex-col gap-2' : 'widget-grid']">
                        <Widget
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
                    <div v-if="selectedType === 'Entity'" class="space-y-2">
                        <Input v-model="entityNameFilter" class="max-w-sm" placeholder="Search" />
                        <div class="max-h-[30rem] overflow-y-scroll grid grid-cols-1 md:grid-cols-2 gap-2">
                            <EntityWidget
                                v-for="entity in Object.values(entityStore.entities).filter(filterEntity)"
                                :key="entity.id"
                                stripped
                                vertical
                                :entity
                                :selected="selectedEntities.includes(entity.id)"
                                @select="selectEntity(entity.id)"
                            />
                        </div>
                    </div>
                    <div v-else-if="selectedType === 'Group'" class="space-y-2">
                        <Input v-model="groupNameFilter" class="max-w-sm mt-2" placeholder="Search" />
                        <div class="max-h-[30rem] overflow-y-scroll grid grid-cols-1 md:grid-cols-2 gap-2">
                            <template v-for="group of groupStore.groups">
                                <template v-if="filterGroup(group.name)">
                                    <GroupWidget
                                        :key="group.id"
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
                    <div v-else-if="selectedType === 'Action'" class="space-y-2">
                        <Input v-model="groupNameFilter" class="max-w-sm mt-2" placeholder="Search" />
                        <div class="max-h-[30rem] overflow-y-scroll grid grid-cols-1 md:grid-cols-2 gap-2">
                            <template v-for="action of actions">
                                <template v-if="filterAction(action.name)">
                                    <ActionWidget
                                        :key="action.id"
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
                    <div v-else-if="selectedType === 'ui_widget'" class="space-y-2">
                        <div class="max-h-[30rem] overflow-y-scroll grid grid-cols-1 md:grid-cols-2 gap-2">
                            <ClockWidget
                                vertical
                                stripped
                                dummy
                                :selected="'clock_widget' == selectUIElement"
                                @select="selectUIElement = 'clock_widget'"
                            />
                        </div>
                    </div>
                </template>
            </div>
        </template>
    </SteppedModal>
</template>

<script lang="ts" setup>
import {ref} from 'vue';
import {modals, small} from '@/helpers/ui';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useToastStore} from '@/stores/toast';
import {getRegistry} from '@/tools/websocket';
import type {action_t, entity_t} from '@/types';
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
