<template>
    <div class="space-y-3">
        <BasicBlock darker>
            <div class="space-y-2">
                <h2 class="heading-section">App Version</h2>
                <span>{{ version }}</span>
            </div>
        </BasicBlock>
        <AppSettings />

        <Developer v-if="systemStore.devMode" />
    </div>
</template>

<script setup lang="ts">
import BasicBlock from '@/components/core/BasicBlock.vue';
import AppSettings from '@/components/pages/settings/AppSettings.vue';
import Developer from '@/components/pages/settings/Developer.vue';
import {useSystemStore} from '@/stores/system';

declare const NPM_APP_VERSION: string;
declare const GIT_LAST_COMMIT_TIME: string;

const commit_time = GIT_LAST_COMMIT_TIME;
const version = NPM_APP_VERSION;
const systemStore = useSystemStore();
</script>
