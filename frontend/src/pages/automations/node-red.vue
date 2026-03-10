<template>
    <div class="h-[calc(100%-1rem)]">
        <iframe :src="NODE_RED_URL" width="100%" height="100%" />
    </div>
</template>

<script setup lang="ts">
import {useCookies} from '@vueuse/integrations/useCookies.mjs';
import {onMounted} from 'vue';
import {NODE_RED_URL} from '@/constants';
import zitadelAuth from '@/helpers/zitadelAuth';

onMounted(async () => {
    if (!zitadelAuth) return;

    const user = await zitadelAuth.oidcAuth.mgr.getUser();
    const token = user?.access_token;

    if (token) {
        const cookies = useCookies(['token']);
        cookies.set('token', token, {
            secure: false,
            httpOnly: false,
            sameSite: 'strict',
            path: '/node-red'
        });
    }
});
</script>
