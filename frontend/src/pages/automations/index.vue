<script setup lang="ts">
import {onMounted} from 'vue';
import {useRouter} from 'vue-router';

const router = useRouter();
onMounted(() => router.replace('/automations/actions'));
</script>

<template>
    <span class="sr-only">Redirecting…</span>
</template>
