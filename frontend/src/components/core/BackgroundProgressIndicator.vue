<template>
    <section class="background-progress" role="status" aria-live="polite">
        <div class="background-progress__header">
            <div>
                <strong>{{ title }}</strong>
                <span>{{ detail }}</span>
            </div>
            <button v-if="items.length" type="button" @click="expanded = !expanded">
                {{ expanded ? 'Hide details' : 'Show details' }}
            </button>
        </div>
        <div
            class="background-progress__track"
            role="progressbar"
            :aria-valuenow="progress"
            aria-valuemin="0"
            aria-valuemax="100"
        >
            <span :style="{width: `${progress}%`}" />
        </div>
        <div class="background-progress__footer">
            <span>
                <strong>{{ progress.toFixed(1) }}%</strong>
                {{ progressLabel }}
            </span>
            <span>{{ eta }}</span>
        </div>
        <!-- The per-device list can run to dozens of rows. Inline it pushed the
             dashboard down; a modal keeps the bar a one-line status. -->
        <Modal :visible="expanded" large tall @close="expanded = false">
            <template #title>
                <ModalHeader :title="title" :description="detail" />
            </template>
            <template #default>
                <div class="background-progress__modal">
                    <div class="background-progress__summary">
                        <span>
                            <strong>{{ progress.toFixed(1) }}%</strong>
                            {{ progressLabel }}
                        </span>
                        <span>{{ eta }}</span>
                    </div>
                    <ul>
                        <li v-for="item in items" :key="item">{{ item }}</li>
                    </ul>
                </div>
            </template>
        </Modal>
    </section>
</template>

<script setup lang="ts">
import {ref} from 'vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import Modal from '@/components/modals/Modal.vue';

defineProps<{
    title: string;
    detail: string;
    progress: number;
    progressLabel?: string;
    eta: string;
    items: string[];
}>();

const expanded = ref(false);
</script>

<style scoped>
.background-progress {
    margin: var(--space-3) var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}

.background-progress__modal {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.background-progress__summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
}

.background-progress__modal ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.background-progress__modal li {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}

.background-progress__header,
.background-progress__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.background-progress__header div {
    display: grid;
    gap: 2px;
}

.background-progress__header span,
.background-progress__footer,
.background-progress li {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}

.background-progress__footer strong {
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
}

.background-progress__header button {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
}

.background-progress__track {
    height: 6px;
    margin: 10px 0 6px;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 15%, transparent);
}

.background-progress__track span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--color-primary);
}

.background-progress ul {
    max-height: 180px;
    margin: 10px 0 0;
    padding-left: 20px;
    overflow: auto;
}
</style>
