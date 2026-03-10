<template>
    <Notification v-if="MODE === 'development'" type="warning">
        Grafana is <b>not</b> available in <b>development</b> mode
    </Notification>
    <div v-else class="h-[calc(100%-1rem)]">
        <iframe :src="`/grafana/?orgId=1`" width="100%" height="100%" />
    </div>
</template>

<script setup lang="ts">
import Notification from '@/components/core/Notification.vue';

const {MODE} = import.meta.env;
</script>
