<script setup lang="ts">
import { ref, onMounted } from 'vue';
import * as ws from "../tools/websocket";
import { useToastStore } from '@/stores/toast';

interface PluginInfo {
    name: string,
    version: string,
    description: string
}

interface PluginData {
    location: string,
    info: PluginInfo,
    config: {
        enable: boolean
    }
}

const toast = useToastStore();

const plugins = ref({} as Record<string, PluginData>);

function updatePlugins(){
    ws.listPlugins().then(res => {
        plugins.value = res;
    });
}

onMounted(updatePlugins)

function togglePlugin(pluginData: PluginData) {
    if(pluginData.config.enable){
        ws.enablePlugin(pluginData.info.name, false).then(() => {
            toast.addToast(`Disabled plugin '${pluginData.info.name}'`, 'success');
            updatePlugins();
        }, () => {
            toast.addToast(`Failed to disable plugin '${pluginData.info.name}'`, 'danger')
        })
    } else {
        ws.enablePlugin(pluginData.info.name, true).then(() => {
            toast.addToast(`Enabled plugin '${pluginData.info.name}'`, 'success');
            updatePlugins();
        }, () => {
            toast.addToast(`Failed to enable plugin '${pluginData.info.name}'`, 'danger')
        })
    }
}

</script>

<template>
    <div>
        <div class="mb-2">
            <span class="title is-4 has-text-light">Plugins</span>
        </div>
        <div class="box is-flex is-flex-direction-row is-justify-content-space-between" v-for="plugin in plugins">
            <div>
                <b>{{ plugin.info.name }}</b> <span>({{ plugin.info.version }})</span> <br>
                <small class="has-text-grey">{{ plugin.info.description }}</small>
            </div>
            <div>
                <button class="button" :class="{
                    'is-success': !plugin.config.enable,
                    'is-danger': plugin.config.enable,
                }" @click="togglePlugin(plugin)">{{ plugin.config.enable ? 'Disable' : 'Enable' }}</button>
            </div>
        </div>
    </div>
</template>