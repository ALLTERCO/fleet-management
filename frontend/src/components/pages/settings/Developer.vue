<template>
    <BasicBlock darker>
        <div class="space-y-2">
            <span class="text-md font-semibold">Developer</span>
            <Collapse title="Debug User" @open="usersOpenned">
                <Notification type="warning">
                    DEBUG user is meant to be used only during development. This
                    setting disables all security to Fleet Manager.
                </Notification>
                <Notification v-if="users.allowDebugUser" type="error">
                    All security and access management on Fleer Management has
                    been disabled.
                </Notification>
                <Checkbox v-model="users.allowDebugUser"
                    >Enable DEBUG user</Checkbox
                >
                <Button type="blue" @click="usersSaved">Save</Button>
            </Collapse>
            <Collapse :title="'App Version ' + base_version">
                <Notification v-if="users.allowDebugUser" type="warning">
                    Fleet Manager is under active development. You are currently
                    using an alpha release!
                </Notification>
                <div class="flex flex-col">
                    <span
                        ><span class="font-semibold">VERSION</span> -
                        {{ base_version }}</span
                    >
                </div>
            </Collapse>
        </div>
    </BasicBlock>
</template>

<script setup lang="ts">
import {reactive} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Collapse from '@/components/core/Collapse.vue';
import Notification from '@/components/core/Notification.vue';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

const toast = useToastStore();

declare const NPM_APP_VERSION: string; // from vite.config.ts
declare const GIT_LAST_COMMIT_TIME: string; // from vite.config.ts

const base_version = NPM_APP_VERSION;
const commit_time = GIT_LAST_COMMIT_TIME;

const users = reactive({
    loading: true,
    allowDebugUser: false
});

async function usersOpenned() {
    users.loading = true;
    const usersConfig = await ws.sendRPC('FLEET_MANAGER', 'User.GetConfig');
    if (usersConfig.allowDebugUser) {
        users.allowDebugUser = usersConfig.allowDebugUser;
    }
    users.loading = false;
}

async function usersSaved() {
    await ws.sendRPC('FLEET_MANAGER', 'User.SetConfig', {
        config: {allowDebugUser: users.allowDebugUser}
    });
    toast.success('Updated user config');
}
</script>
