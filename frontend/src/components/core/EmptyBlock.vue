<template>
    <div class="empty-block w-full h-64 rounded-lg flex items-center justify-center">
        <div class="w-3/4 md:w-1/2 text-center flex flex-col items-center gap-3">
            <div v-if="$slots.icon" class="empty-block__icon">
                <slot name="icon" />
            </div>
            <slot></slot>
        </div>
    </div>
</template>

<style scoped>
.empty-block {
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border-strong);
}
.empty-block__icon {
    font-size: var(--text-2xl);
    opacity: 0.4;
    color: var(--color-text-disabled);
}
</style>
