<template>
    <div
        class="vc"
        :class="{'vc--orphaned': orphaned, 'vc--duplicate': duplicate, 'vc--selected': selected}"
        tabindex="0"
        @click="$emit('open')"
        @keydown.enter="$emit('open')"
    >
        <!-- Body -->
        <div class="vc-body">
            <div class="vc-top">
                <div class="vc-icon" :class="{'vc-icon--orphaned': orphaned}">
                    <i v-if="orphaned" class="fas fa-exclamation" />
                    <i v-else class="fas fa-dollar-sign" />
                </div>
                <!-- Value type badge -->
                <span v-if="valueType" class="vc-type" :title="valueType.type">
                    <i class="fas" :class="valueType.icon" />
                </span>
                <!-- Duplicate badge -->
                <span v-if="duplicate" class="vc-dupe" title="Duplicate value">
                    <i class="fas fa-clone" />
                </span>
            </div>
            <!-- Read-only value (edit happens via the detail flow) -->
            <div class="vc-value">{{ value || '—' }}</div>
            <div v-if="usageCount !== undefined" class="vc-usage">
                <i class="fas fa-play" /> {{ usageCount }} action{{ usageCount === 1 ? '' : 's' }}
            </div>
        </div>

        <!-- Footer: name only -->
        <div class="vc-foot">
            <span class="vc-name">{{ name }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    name: string;
    value: string;
    usageCount?: number;
    orphaned?: boolean;
    duplicate?: boolean;
    selected?: boolean;
    valueType?: {type: string; icon: string} | null;
}>();

defineEmits<{
    open: [];
}>();
</script>

<style scoped>
.vc {
    display: flex;
    flex-direction: column;
    position: relative;
    height: var(--grid-cell, 200px);
    min-height: var(--grid-cell, 200px);
    border-radius: var(--dcard-radius);
    background: var(--dcard-bg);
    border: 1px solid var(--dcard-border);
    overflow: hidden;
    cursor: pointer;
    transition: border-color var(--duration-fast);
}
.vc:hover { border-color: rgba(var(--ar-action), 0.25); }
.vc--orphaned { border-color: color-mix(in srgb, var(--color-warning-text) 30%, transparent); }
.vc--duplicate { border-color: color-mix(in srgb, var(--color-accent-text) 30%, transparent); }
.vc--selected {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 40%, transparent);
}

.vc-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--gap-xs);
    padding: var(--gap-sm);
    min-height: 0;
}

.vc-top {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    position: relative;
}

.vc-icon {
    width: var(--gap-lg);
    height: var(--gap-lg);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(var(--ar-action), 0.06);
    border: 1.5px solid rgba(var(--ar-action), 0.18);
    color: var(--a-action);
    font-size: var(--type-body);
    flex-shrink: 0;
}
.vc-icon--orphaned {
    background: color-mix(in srgb, var(--color-warning-text) 8%, transparent);
    border-color: color-mix(in srgb, var(--color-warning-text) 25%, transparent);
    color: var(--color-warning-text);
}

/* Type + duplicate badges */
.vc-type, .vc-dupe {
    position: absolute;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--gap-md);
    height: var(--gap-md);
    border-radius: var(--radius-full);
    font-size: var(--icon-size-2xs); /* icon-only — outside type scale */
}
.vc-type {
    left: 0;
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
}
.vc-dupe {
    left: calc(var(--gap-md) + 4px);
    background: color-mix(in srgb, var(--color-accent-text) 10%, transparent);
    color: var(--color-accent-text);
}

.vc-value {
    font-size: var(--type-body);
    font-family: var(--font-mono);
    color: var(--color-text-tertiary);
    text-align: center;
    word-break: break-all;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}

.vc-usage {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.vc-usage i { opacity: 0.5; font-size: var(--icon-size-2xs); /* icon-only */ }

/* Footer: name only — matches .dc-name */
.vc-foot {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: var(--touch-target-min);
    padding: 0 var(--gap-sm);
    border-top: 1px solid var(--color-border-default);
    text-align: center;
}
.vc-name {
    font-size: var(--type-card-footer);
    font-weight: 700;
    letter-spacing: -0.3px;
    color: var(--color-text-primary);
    line-height: 1.3;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

</style>
