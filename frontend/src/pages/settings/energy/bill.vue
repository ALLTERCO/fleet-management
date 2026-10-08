<template>
    <PageTemplate title="Bill" fill>
        <div class="ua-workspace">
            <BillQuotePanel />
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import PageTemplate from '@/components/core/PageTemplate.vue';
import BillQuotePanel from '@/components/pages/settings/accounting/BillQuotePanel.vue';
</script>
