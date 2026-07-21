<template />

<script setup lang="ts">
import {onMounted} from 'vue';
import {useRouter} from 'vue-router';
import {SETTINGS_PATH} from '@/constants';

const router = useRouter();

onMounted(() => {
    void router.replace(SETTINGS_PATH);
});
</script>
