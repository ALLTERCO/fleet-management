<template>
    <PageTemplate title="Carbon and gas" fill>
        <div class="ua-section-stack">
            <CarbonPanel />
            <GasConversionPanel />
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import PageTemplate from '@/components/core/PageTemplate.vue';
import CarbonPanel from '@/components/pages/settings/accounting/CarbonPanel.vue';
import GasConversionPanel from '@/components/pages/settings/accounting/GasConversionPanel.vue';
</script>
