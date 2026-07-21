<script setup lang="ts">
import {useRouter} from 'vue-router';
import Spinner from '@/components/core/Spinner.vue';

const router = useRouter();
router.replace('/settings/monitoring/overview');
</script>
<template><div class="flex items-center justify-center gap-2 py-8 text-sm text-[var(--color-text-tertiary)]"><Spinner size="xs" /> Redirecting...</div></template>
