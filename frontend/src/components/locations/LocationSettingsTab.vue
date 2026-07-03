<template>
    <div class="lst">
        <p class="lst__intro">
            Full editing happens in the Edit modal — all fields, validation,
            and per-kind options live there.
        </p>
        <div class="lst__actions">
            <Button type="blue-hollow" size="sm" @click="$emit('open-edit')">
                Edit
            </Button>
            <Button v-if="canDelete" type="red" size="sm" @click="$emit('request-delete')">
                Delete location…
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import {usePermissions} from '@/composables/usePermissions';

defineProps<{
    canDelete: boolean;
}>();

defineEmits<{
    'open-edit': [];
    'request-delete': [];
}>();

void usePermissions;
</script>

<style scoped>
.lst {
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.lst__intro {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 60ch;
    line-height: var(--leading-relaxed);
}

.lst__actions {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
}
</style>
