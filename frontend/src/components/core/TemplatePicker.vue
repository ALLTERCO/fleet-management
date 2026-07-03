<template>
    <div class="tpk">
        <button
            type="button"
            class="tpk__trigger core-input"
            @click="open = !open"
        >
            <span class="tpk__current">
                <i class="fas fa-file-lines tpk__icon" aria-hidden="true" />
                {{ currentLabel }}
            </span>
            <i class="fas fa-chevron-down tpk__caret" aria-hidden="true" />
        </button>

        <ul v-if="open" class="tpk__menu">
            <li>
                <button type="button" class="tpk__opt" @click="choose(null)">
                    <span class="tpk__opt-main">Default wording</span>
                    <span class="tpk__opt-sub">No template — use the rule's own text</span>
                </button>
            </li>
            <li v-for="t in templates" :key="t.id">
                <button type="button" class="tpk__opt" @click="choose(t.id)">
                    <span class="tpk__opt-main">{{ t.name }}</span>
                    <span class="tpk__opt-sub">{{ channelSummary(t) }}</span>
                </button>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';

export interface TemplateSummary {
    id: number;
    name: string;
    channels: string[]; // e.g. ['email','slack','teams']
}

const model = defineModel<number | null>({default: null});

const props = defineProps<{templates: TemplateSummary[]}>();

const open = ref(false);

const currentLabel = computed(() => {
    if (model.value == null) return 'Default wording';
    return props.templates.find((t) => t.id === model.value)?.name ?? 'Template';
});

function channelSummary(t: TemplateSummary): string {
    return t.channels.length ? t.channels.join(' · ') : 'fallback only';
}

function choose(id: number | null): void {
    model.value = id;
    open.value = false;
}
</script>

<style scoped>
.tpk {
    position: relative;
    max-width: 24rem;
}
.tpk__trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    cursor: pointer;
}
.tpk__current {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tpk__icon {
    color: var(--color-primary);
}
.tpk__caret {
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-xs);
}
.tpk__menu {
    position: absolute;
    z-index: var(--z-dropdown, 50);
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg, 0 8px 24px #0008);
    max-height: 18rem;
    overflow-y: auto;
}
.tpk__opt {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: var(--space-0-5);
    padding: var(--space-2) var(--space-3);
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
}
.tpk__opt:hover {
    background: var(--color-surface-3);
}
.tpk__opt-main {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.tpk__opt-sub {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
</style>
