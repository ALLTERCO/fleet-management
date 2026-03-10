<template>
    <div class="flex flex-col gap-2 w-full">
        <Dropdown :options="dropdownOptions" class="w-full [&>*]:w-[20.75rem]" @selected="dropdownChanged" />
        <iframe id="grafana-iframe" :src="url" height="300" frameborder="0" class="w-full"></iframe>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, toRef} from 'vue';
import Dropdown from '@/components/core/Dropdown.vue';
import {useSystemStore} from '@/stores/system';

const ONE_HOUR_MS = 1000 * 60 * 60;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

const dropdownOptions = ['Last 1 hour', 'Last 24 hours', 'Last 7 days'];
const dropdownValues = [ONE_HOUR_MS, ONE_DAY_MS, 7 * ONE_DAY_MS];

const props = defineProps<{
    deviceId: string;
}>();

const system = useSystemStore();

const deviceId = toRef(props, 'deviceId');
const from = ref(String(new Date(Date.now() - ONE_HOUR_MS)));
const to = ref(String(Date.now()));

const url = computed(() => {
    const dashboard = system.config?.grafana?.dashboards?.find(
        (dash: {slug: string}) => dash.slug === 'templates'
    );
    if (!dashboard) return;

    const url = dashboard.url.replace('/d/', '/d-solo/');
    return `${url}?orgId=1&var-device_id=${deviceId.value}&from=${from.value}&to=${to.value}&panelId=1`;
});

function dropdownChanged(_option: string, index: number) {
    const ms = dropdownValues[index];
    const now = Date.now();
    const start = now - ms;
    from.value = String(start);
    to.value = String(now);
}
</script>
