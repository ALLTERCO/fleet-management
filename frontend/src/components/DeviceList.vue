<script lang="ts" setup>
import { ref, computed, onMounted } from "vue";
import { useDevicesStore } from '@/stores/devices';
import Badge from "@/components/Badge.vue";
import Dropdown from "@/components/Dropdown.vue";
import { useSystemStore } from "@/stores/system";
import { storeToRefs } from "pinia";

const props = defineProps<{ source: string }>();
const deviceStore = useDevicesStore();
const systemStore = useSystemStore();

const { groups } = storeToRefs(systemStore);
const selected = ref({} as Record<string, string>);
type filter_cb = (shelly: ShellyDeviceExternal) => boolean;
const filters = ref([] as filter_cb[]);

const UNASSIGNED_DEVICE_VALUE = '<unassigned>'

function resetFilters() {
    filters.value.length = 0;
    Object.keys(groups.value).forEach((key) => {
        // set default values
        selected.value[key] = '*';
    });
}

function applyFilters(){
    filters.value.length = 0; // reset filters
    for(const groupName in selected.value){
        const value = selected.value[groupName];
        if(value != '*'){
            if(value == UNASSIGNED_DEVICE_VALUE){
                filters.value.push((shelly) => shelly.groups[groupName] == undefined);
                continue;
            }
            filters.value.push((shelly) => shelly.groups[groupName] == value);
        }
    }
}

onMounted(() => {
    resetFilters();
})

const devices = computed(() => {
    let base = Object.values(deviceStore.devices).filter((d) => d.source == props.source);
    for(const filterFn of filters.value){
        base = base.filter(filterFn);
    }
    return base;
});

const showGroupsFilter = computed(() => 
    props.source == 'ws' && groups.value && Object.keys(groups.value).length > 0
)
</script>

<template>
    <div class="block" >
        <Dropdown :title="'Filter by group' + (filters.length > 0 ? ` (${filters.length} active)` : '')" v-if="showGroupsFilter">
            <div class="block filters">
                <div class="field is-horizontal" v-for="(options, name) of groups">
                    <div class="field-label is-normal">
                        <label class="label" style="text-transform: capitalize;">{{ name }}</label>
                    </div>
                    <div class="field-body">
                        <div class="field">
                            <div class="control is-expanded">
                                <div class="select">
                                    <select v-model="selected[name]">
                                        <option value="*">All</option>
                                        <option v-for="option in options">{{ option }}</option>
                                        <option :value="UNASSIGNED_DEVICE_VALUE">{{ '<unassigned>' }}</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="block buttons">
                <button class="button is-danger" @click="resetFilters">Reset</button>
                <button class="button is-link" @click="applyFilters">Apply</button>
            </div>
        </Dropdown>
        <div class="devices" v-if="devices.length > 0">
            <Badge v-for="device in devices" :device_mac="device.shellyID" :link="true" :key="device.shellyID"
                :channel="0" />
        </div>
    </div>
    <div class="notification is-danger" v-if="devices.length == 0">
        <h1 class="title has-text-white">No devices found</h1>
        <slot name="error_message">
            <span v-if="filters.length == 0">
                Connect shelly devices via their outbound websocket.
            </span>
            <span v-else>
                No devices found that match the applied filters
            </span>
        </slot>
    </div>
</template>

<style scoped>
.devices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-gap: 1rem;
}

@media screen and (max-width: 760px) {
    .devices {
        grid-template-columns: 1fr;
    }
}
</style>