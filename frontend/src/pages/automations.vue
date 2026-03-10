<template>
    <div>
        <h1 class="text-lg font-semibold mb-1">Automations</h1>
        <TabPageSelector :tabs="tabs" />
    </div>
</template>

<script setup lang="ts">
import {onMounted, ref} from 'vue';
import TabPageSelector from '@/components/core/TabPageSelector.vue';
import {sendRPC} from '@/tools/websocket';

const tabs = ref<[string, string, string][]>([['Actions', '/automations/actions', 'fas fa-play']]);

onMounted(async () => {
    try {
        const config = await sendRPC(
            'FLEET_MANAGER',
            'Storage.GetUIConfig',
            {}
        );
        const nodeRedEnabled = config.find(
            (item: any) => item.name === 'node_red_enable'
        )?.icon_path;
        if (nodeRedEnabled) {
            tabs.value.push(['Node Red', '/automations/node-red', 'fas fa-diagram-project']);
        }
    } catch (error) {
        console.error('Failed to fetch config:', error);
    }
});
</script>
