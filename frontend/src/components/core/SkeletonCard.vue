<template>
    <div class="sk" :class="[`sk--${variant}`, `sk--${size}`]">
        <!-- ── Entity 1x1: centered icon + value + footer ── -->
        <template v-if="variant === 'entity' && size === '1x1'">
            <div class="sk__body sk__body--center">
                <Skeleton variant="circle" width="var(--gap-lg)" height="var(--gap-lg)" />
                <Skeleton variant="text" width="50%" />
            </div>
            <div class="sk__footer"><Skeleton variant="text" :width="nameWidth" /></div>
        </template>

        <!-- ── Entity 2x1: icon left + value right ── -->
        <template v-else-if="variant === 'entity' && size === '2x1'">
            <div class="sk__body sk__body--row">
                <Skeleton variant="circle" width="var(--touch-target-min)" height="var(--touch-target-min)" />
                <div class="sk__lines">
                    <Skeleton variant="text" width="60%" />
                    <Skeleton variant="text" width="40%" />
                </div>
            </div>
            <div class="sk__footer"><Skeleton variant="text" :width="nameWidth" /></div>
        </template>

        <!-- ── Entity 2x2: icon + value + controls + footer ── -->
        <template v-else-if="variant === 'entity' && size === '2x2'">
            <div class="sk__body sk__body--hero">
                <div class="sk__hero-top">
                    <Skeleton variant="text" width="50%" />
                    <Skeleton variant="text" width="30%" />
                </div>
                <div class="sk__hero-controls">
                    <Skeleton variant="rect" height="var(--touch-target-min)" />
                </div>
                <div class="sk__hero-chips">
                    <Skeleton variant="text" width="25%" />
                    <Skeleton variant="text" width="25%" />
                    <Skeleton variant="text" width="25%" />
                </div>
            </div>
            <div class="sk__footer"><Skeleton variant="text" :width="nameWidth" /></div>
        </template>

        <!-- ── Device: name + status + model ── -->
        <template v-else-if="variant === 'device'">
            <div class="sk__body sk__body--center">
                <Skeleton variant="circle" width="var(--gap-lg)" height="var(--gap-lg)" />
                <Skeleton variant="text" width="55%" />
                <Skeleton variant="text" width="35%" />
            </div>
            <div class="sk__footer"><Skeleton variant="text" :width="nameWidth" /></div>
        </template>

        <!-- ── Group: folder icon + name + count ── -->
        <template v-else-if="variant === 'group'">
            <div class="sk__body sk__body--center">
                <Skeleton variant="circle" width="var(--gap-lg)" height="var(--gap-lg)" />
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="30%" />
            </div>
            <div class="sk__footer"><Skeleton variant="text" :width="nameWidth" /></div>
        </template>

        <!-- ── Action: icon + name + run button ── -->
        <template v-else-if="variant === 'action'">
            <div class="sk__body sk__body--center">
                <Skeleton variant="circle" width="var(--gap-lg)" height="var(--gap-lg)" />
                <Skeleton variant="text" width="55%" />
            </div>
            <div class="sk__action-foot">
                <Skeleton variant="rect" height="var(--gap-lg)" />
            </div>
        </template>

        <!-- ── Generic fallback ── -->
        <template v-else>
            <div class="sk__top">
                <Skeleton v-if="avatar" variant="circle" />
                <div class="sk__lines">
                    <Skeleton variant="text" :width="nameWidth" />
                    <Skeleton v-if="subtitle" variant="text" width="60%" />
                </div>
            </div>
            <Skeleton v-if="body" variant="rect" height="2rem" />
            <Skeleton v-if="action" variant="rect" height="2.5rem" />
        </template>
    </div>
</template>

<script setup lang="ts">
import Skeleton from './Skeleton.vue';

withDefaults(
    defineProps<{
        variant?: 'entity' | 'device' | 'group' | 'action' | 'generic';
        size?: '1x1' | '2x1' | '2x2';
        avatar?: boolean;
        subtitle?: boolean;
        body?: boolean;
        action?: boolean;
        nameWidth?: string;
    }>(),
    {
        variant: 'generic',
        size: '1x1',
        avatar: true,
        subtitle: false,
        body: false,
        action: false,
        nameWidth: '70%'
    }
);
</script>

<style scoped>
.sk {
    display: flex;
    flex-direction: column;
    border-radius: var(--dcard-radius, var(--radius-lg));
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
    overflow: hidden;
}

/* Size: match grid cell */
.sk--entity, .sk--device, .sk--group, .sk--action {
    height: var(--grid-cell, 200px);
    min-height: var(--grid-cell, 200px);
}
.sk--entity.sk--2x1 { grid-column: span 2; }
.sk--entity.sk--2x2 { grid-column: span 2; grid-row: span 2; height: auto; min-height: calc(var(--grid-cell, 200px) * 2 + var(--card-grid-gap, 12px)); }

/* Body variants */
.sk__body { flex: 1; display: flex; flex-direction: column; padding: var(--gap-sm); gap: var(--gap-xs); min-height: 0; }
.sk__body--center { align-items: center; justify-content: center; }
.sk__body--row { flex-direction: row; align-items: center; gap: var(--gap-sm); }
.sk__body--hero { justify-content: space-between; }

.sk__hero-top { display: flex; flex-direction: column; gap: var(--gap-xs); }
.sk__hero-controls { padding: var(--gap-xs) 0; }
.sk__hero-chips { display: flex; gap: var(--gap-xs); }

/* Footer: matches .dc-name */
.sk__footer {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: var(--touch-target-min);
    padding: 0 var(--gap-sm);
    border-top: 1px solid var(--color-border-default);
}

/* Action card footer: run button area */
.sk__action-foot {
    padding: 0 var(--gap-sm) var(--gap-xs);
}

/* Lines column (for row layout) */
.sk__lines { flex: 1; display: flex; flex-direction: column; gap: var(--gap-xs); }

/* Generic variant */
.sk__top { display: flex; align-items: center; gap: var(--gap-sm); padding: var(--gap-sm); }
.sk:not(.sk--entity):not(.sk--device):not(.sk--group):not(.sk--action) {
    padding: var(--gap-sm);
    gap: var(--gap-xs);
}
</style>
