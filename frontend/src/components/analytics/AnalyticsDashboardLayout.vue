<template>
    <div class="p-4 space-y-6">
        <!-- Header -->
        <div class="flex justify-between items-center">
            <div class="flex items-center gap-4">
                <button
                    v-if="showBackButton"
                    class="p-2 adl-icon-btn rounded-lg transition-colors"
                    @click="$emit('back')"
                >
                    <i class="fas fa-arrow-left text-xl"></i>
                </button>
                <div>
                    <h1 class="text-xl font-bold adl-title">{{ title }}</h1>
                    <p v-if="subtitle" class="text-sm adl-subtitle">{{ subtitle }}</p>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <slot name="header-actions">
                    <button
                        class="p-2 adl-icon-btn rounded-lg transition-colors"
                        title="Refresh"
                        :disabled="refreshing"
                        @click="$emit('refresh')"
                    >
                        <i class="fas fa-sync-alt" :class="{ 'adl-spin': refreshing }"></i>
                    </button>
                    <button
                        class="p-2 adl-icon-btn rounded-lg transition-colors"
                        title="Settings"
                        @click="$emit('settings')"
                    >
                        <i class="fas fa-cog"></i>
                    </button>
                </slot>
            </div>
        </div>

        <!-- Date Range -->
        <div class="adl-panel rounded-lg p-4">
            <slot name="date-range" />
        </div>

        <!-- Metrics Grid -->
        <section v-if="$slots.metrics">
            <h2 class="text-lg font-semibold adl-title mb-3">
                <i class="fas fa-tachometer-alt mr-2 adl-icon-primary"></i>
                Live Metrics
            </h2>
            <slot name="metrics" />
        </section>

        <!-- Charts -->
        <section v-if="$slots.charts" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <slot name="charts" />
        </section>

        <!-- Reports -->
        <section v-if="$slots.reports">
            <h2 class="text-lg font-semibold adl-title mb-3">
                <i class="fas fa-file-export mr-2 adl-icon-success"></i>
                Reports
            </h2>
            <slot name="reports" />
        </section>

        <!-- Uptime -->
        <section v-if="$slots.uptime">
            <slot name="uptime" />
        </section>

        <!-- Loading Overlay -->
        <div
            v-if="loading"
            class="fixed inset-0 adl-loading-overlay flex items-center justify-center z-40 pointer-events-none"
        >
            <div class="adl-panel rounded-lg p-4 flex items-center gap-3">
                <i class="fas fa-spinner fa-spin adl-icon-primary text-xl"></i>
                <span class="adl-title">Loading...</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
withDefaults(
    defineProps<{
        title: string;
        subtitle?: string;
        loading?: boolean;
        refreshing?: boolean;
        showBackButton?: boolean;
    }>(),
    {
        loading: false,
        refreshing: false,
        showBackButton: true
    }
);

defineEmits<{
    back: [];
    refresh: [];
    settings: [];
}>();
</script>

<style scoped>
.adl-title { color: var(--color-text-primary); }
.adl-subtitle { color: var(--color-text-tertiary); }
.adl-panel {
    background-color: var(--color-surface-3);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}
.adl-icon-btn:hover { background-color: var(--glass-hover); }
.adl-icon-primary { color: var(--color-primary-text); }
.adl-icon-success { color: var(--color-success-text); }
.adl-loading-overlay { background-color: rgba(0, 0, 0, 0.2); }

/* Smooth refresh spin (slower than animate-spin for a polished feel) */
.adl-spin {
    animation: adl-rotate 0.8s linear infinite;
}
@keyframes adl-rotate {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
</style>
