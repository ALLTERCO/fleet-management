<template>
    <EmptyBlock class="space-y-2">
        <p class="text-xl font-semibold pb-2">Logging you in, please wait</p>
        <div class="w-full flex justify-around">
            <Spinner />
        </div>
    </EmptyBlock>
</template>

<script setup lang="ts">
import {useRouter} from 'vue-router';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Spinner from '@/components/core/Spinner.vue';
import {getZitadelAuth} from '@/helpers/zitadelAuth';
import {debug, debugWarn} from '@/tools/debug';

const router = useRouter();

const zitadelAuth = getZitadelAuth();
if (zitadelAuth === undefined) {
    window.location.href = '/';
} else {
    zitadelAuth.oidcAuth.mgr
        .signinRedirectCallback()
        .then((data) => {
            debug('OIDC popup callback success');
            const state = data.state as {to?: string} | undefined;
            if (router) router.replace(state?.to || '/');
            else window.location.href = '/';
        })
        .catch((err) => {
            debugWarn('OIDC popup callback error', err);
            if (router) router.replace('/');
            else window.location.href = '/';
        });
}
</script>

<route lang="json">
{ "meta": { "layout": "basic" } }
</route>
