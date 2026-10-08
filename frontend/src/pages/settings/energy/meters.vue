<template>
    <PageTemplate title="Meters" fill>
        <div class="ua-workspace">
            <MeterTopologyPanel />
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import PageTemplate from '@/components/core/PageTemplate.vue';
import MeterTopologyPanel from '@/components/pages/settings/accounting/MeterTopologyPanel.vue';
</script>
