<template>
    <div class="grid grid-cols-1 gap-2">
        <button
            v-for="type in DOMAIN_TYPES"
            :key="type"
            class="flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all"
            :class="selected === type
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-surface hover:border-primary/60 hover:bg-surface-raised'"
            @click="emit('select', type)"
        >
            <i :class="[DOMAIN_TYPE_META[type].icon, 'w-4 text-center text-sm flex-shrink-0', selected === type ? 'text-primary' : 'text-muted']" />
            <div class="flex flex-col min-w-0">
                <span class="text-sm font-semibold">{{ DOMAIN_TYPE_META[type].label }}</span>
                <span class="text-xs text-muted leading-snug truncate">{{ DOMAIN_TYPE_META[type].description }}</span>
            </div>
            <i v-if="selected === type" class="fas fa-check ml-auto text-xs text-primary flex-shrink-0" />
        </button>
    </div>
</template>

<script setup lang="ts">
import {
    DOMAIN_TYPE_META,
    DOMAIN_TYPES,
    type DomainDashboardType
} from '@/types/dashboard';

defineProps<{selected: DomainDashboardType | null}>();
const emit = defineEmits<{select: [type: DomainDashboardType]}>();
</script>
