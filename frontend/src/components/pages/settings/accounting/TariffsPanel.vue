<template>
    <div class="ua-section-stack">
        <TariffLibraryPanel @updated="revision += 1" />
        <TariffAssignmentsPanel :key="revision" />
    </div>
</template>

<script setup lang="ts">
import {ref} from 'vue';
import TariffAssignmentsPanel from './TariffAssignmentsPanel.vue';
import TariffLibraryPanel from './TariffLibraryPanel.vue';

const revision = ref(0);
</script>
