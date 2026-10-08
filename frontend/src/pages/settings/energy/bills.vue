<template>
    <PageTemplate title="Recorded bills" fill>
        <div class="ua-workspace">
            <BillsPanel />
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import PageTemplate from '@/components/core/PageTemplate.vue';
import BillsPanel from '@/components/pages/settings/accounting/BillsPanel.vue';
</script>
