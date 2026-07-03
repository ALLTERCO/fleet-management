<template>
    <!--
        Back-compat redirect for `/organize/locations/[id]` deep-links.
        The redesigned locations workspace lives at /organize/locations and
        encodes the selected node in `?selected=`. Old bookmarks, alert
        notifications, and dashboard links that point at /[id] still work.
    -->
</template>

<script setup lang="ts">
import {onBeforeMount} from 'vue';
import {useRoute, useRouter} from 'vue-router';

const route = useRoute();
const router = useRouter();

onBeforeMount(() => {
    const raw = (route.params as Record<string, string | string[]>).id;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        router.replace('/organize/locations');
        return;
    }
    router.replace({
        path: '/organize/locations',
        query: {selected: String(id)}
    });
});
</script>
