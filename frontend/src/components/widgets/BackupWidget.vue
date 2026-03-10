<template>
    <Widget>
        <template #upper-corner>
            <i class="mr-1 fas fa-database"></i>
            Backup
        </template>

        <template #image>
            <div
                class="w-full h-full flex items-center justify-center text-3xl text-[var(--color-text-tertiary)]"
            >
                <i class="fas fa-archive"></i>
            </div>
        </template>

        <template #name>
            <span class="text-ellipsis line-clamp-2">{{ backup.name }}</span>
        </template>

        <template #description>
            <div class="text-[var(--color-text-tertiary)] text-xs leading-4 w-full overflow-hidden px-1">
                <div class="truncate" :title="backup.model">{{ backup.model }}</div>
                <div class="truncate">{{ formattedDate }} &middot; {{ formattedSize }}</div>
            </div>
        </template>
    </Widget>
</template>

<script lang="ts" setup>
import {computed} from 'vue';
import type {BackupMetadata} from '@/stores/backups';
import Widget from './WidgetsTemplates/VanilaWidget.vue';

const props = defineProps<{
    backup: BackupMetadata;
}>();

const formattedDate = computed(() => {
    const d = new Date(props.backup.createdAt);
    return d.toLocaleDateString();
});

const formattedSize = computed(() => {
    const bytes = props.backup.fileSize;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});
</script>
