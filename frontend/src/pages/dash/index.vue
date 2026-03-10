<template>
    <span>Failed to redirect</span>
</template>

<script setup lang="ts">
import {onMounted} from 'vue';
import {useRouter} from 'vue-router/auto';

const router = useRouter();

onMounted(() => {
    router.replace('/dash/1');
});
</script>
