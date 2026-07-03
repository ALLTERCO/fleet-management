<template>
    <MenuPopover>
        <template #trigger="{open, toggle}">
            <button
                type="button"
                class="vp__trigger"
                :class="{'vp__trigger--open': open}"
                @click="onToggle(toggle)"
            >
                <i class="fas fa-code" /> Insert variable
                <i class="fas fa-chevron-down vp__chevron" />
            </button>
        </template>
        <template #default="{close}">
            <div class="vp__body">
                <div class="vp__search">
                    <i class="fas fa-search vp__search-icon" />
                    <input
                        ref="searchRef"
                        v-model="query"
                        type="text"
                        class="vp__search-input"
                        placeholder="Filter variables…"
                    />
                </div>
                <div class="vp__scroll">
                    <section
                        v-if="contextResults.length > 0"
                        class="vp__section"
                    >
                        <h5 class="vp__section-title">
                            <i class="fas fa-circle-info" /> Context
                        </h5>
                        <button
                            v-for="v in contextResults"
                            :key="v.path"
                            type="button"
                            class="vp__row"
                            @click="choose(contextToken(v.path), close)"
                        >
                            <code class="vp__code">{{
                                contextToken(v.path)
                            }}</code>
                            <span class="vp__label">{{ v.label }}</span>
                        </button>
                    </section>
                    <section
                        v-if="actionResults.length > 0"
                        class="vp__section"
                    >
                        <h5 class="vp__section-title">
                            <i class="fas fa-database" /> My variables
                        </h5>
                        <button
                            v-for="name in actionResults"
                            :key="name"
                            type="button"
                            class="vp__row"
                            @click="choose(actionToken(name), close)"
                        >
                            <code class="vp__code">{{
                                actionToken(name)
                            }}</code>
                            <span class="vp__label">
                                {{ actionVars[name] || '(empty)' }}
                            </span>
                        </button>
                    </section>
                    <div
                        v-if="contextResults.length === 0 && actionResults.length === 0"
                        class="vp__empty"
                    >
                        No matches
                    </div>
                </div>
            </div>
        </template>
    </MenuPopover>
</template>

<script setup lang="ts">
import {computed, nextTick, ref} from 'vue';
import MenuPopover from '@/components/core/MenuPopover.vue';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import type {ContextVariable} from '@/helpers/templateContext';

const props = defineProps<{
    context: ContextVariable[];
    actionVars: Record<string, string>;
}>();

const emit = defineEmits<{insert: [token: string]}>();

const query = ref('');
const searchRef = ref<HTMLInputElement | null>(null);

const actionNames = computed(() => Object.keys(props.actionVars).sort());
const contextList = computed(() => props.context);

const contextResults = useFuzzySearch(contextList, query, {
    keys: ['path', 'label']
});
const actionResults = useFuzzySearch(actionNames, query, {});

function onToggle(toggle: () => void) {
    toggle();
    query.value = '';
    void nextTick(() => searchRef.value?.focus());
}

function contextToken(path: string): string {
    return `{${path}}`;
}

function actionToken(name: string): string {
    return `\${${name}}`;
}

function choose(token: string, close: () => void) {
    emit('insert', token);
    close();
}
</script>

<style scoped>
.vp__trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color var(--duration-fast);
}
.vp__trigger:hover,
.vp__trigger--open {
    color: var(--color-text-primary);
    border-color: var(--color-primary);
}
.vp__chevron {
    font-size: var(--type-body);
    opacity: 0.7;
}
.vp__body {
    display: flex;
    flex-direction: column;
    min-width: var(--floating-w-md);
}
.vp__search {
    position: relative;
    padding: var(--space-2);
    border-bottom: 1px solid var(--color-border-default);
}
.vp__search-icon {
    position: absolute;
    left: calc(var(--space-2) + var(--space-2));
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.vp__search-input {
    width: 100%;
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-5);
    font-size: var(--type-body);
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
}
.vp__search-input:focus {
    outline: none;
    border-color: var(--color-primary);
}
.vp__scroll {
    max-height: var(--dropdown-scroll-max);
    overflow-y: auto;
    padding: var(--space-1);
}
.vp__section {
    padding: var(--space-1) 0;
}
.vp__section-title {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0 0 var(--space-1) 0;
    padding: 0 var(--space-2);
    font-size: var(--type-body);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-tertiary);
}
.vp__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
}
.vp__row:hover {
    background: var(--color-surface-2);
}
.vp__code {
    flex-shrink: 0;
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
    color: var(--color-primary);
}
.vp__label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vp__empty {
    padding: var(--space-3);
    text-align: center;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
</style>
