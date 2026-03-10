<template>
    <BasicBlock darker>
        <div class="space-y-2">
            <span class="text-md font-semibold">Discovery</span>
            <Collapse title="Default Websocket Address" class="mb-3">
                <Notification
                    >This will be the default websocket address that will be recommedned to non-websocket connected
                    Shelly devices.</Notification
                >

                <Input
                    v-model="websocketAddress"
                    class="max-w-xl"
                    placeholder="Enter the default websocket address"
                    label="Default Websocket Address"
                />
                <Button type="blue" class="mt-2" @click="saveWebsocketAddress">Submit</Button>
            </Collapse>
            <Collapse title="Local Discovery (mDNS)" @open="mdnsOpenned">
                <Notification
                    >Multicast DNS allows Fleet Manager to scan for Shelly devices in the local network and adds them to
                    the Discovered tab.
                </Notification>

                <Notification type="warning">mDNS discovery will be run on the server's network.</Notification>
                <Checkbox v-model="mdns.enabled">Enable</Checkbox>
                <Button type="blue" @click="mdnsSaved">Save</Button>
            </Collapse>
        </div>
    </BasicBlock>
</template>

<script setup lang="ts">
import {reactive, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Collapse from '@/components/core/Collapse.vue';
import Input from '@/components/core/Input.vue';
import Notification from '@/components/core/Notification.vue';
import {defaultWs} from '@/helpers/ui';
import {useSystemStore} from '@/stores/system';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

const systemStore = useSystemStore();
const toast = useToastStore();

const mdns = reactive({
    loading: true,
    enabled: Boolean(systemStore.config.mdns.enable)
});

async function mdnsOpenned() {
    mdns.loading = true;
    const response = await ws.sendRPC('FLEET_MANAGER', 'MDNS.GetConfig');
    if (response.enabled) {
        mdns.enabled = response.enable;
    }
    mdns.loading = false;
}

async function mdnsSaved() {
    await ws.sendRPC('FLEET_MANAGER', 'MDNS.SetConfig', {
        config: {enable: mdns.enabled}
    });
    toast.success('Updated mDNS config');
    systemStore.updateConfig();
}

const websocketAddress = ref(defaultWs.value);
function saveWebsocketAddress() {
    defaultWs.value = websocketAddress.value;
    toast.success('Saved default websocket address');
}
</script>
