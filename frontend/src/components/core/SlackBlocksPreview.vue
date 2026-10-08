<template>
    <div class="sbp">
        <div class="sbp__msg">
            <div class="sbp__avatar" aria-hidden="true">FM</div>
            <div class="sbp__body">
                <div class="sbp__head">
                    <span class="sbp__name">Fleet Manager</span>
                    <span class="sbp__badge">APP</span>
                </div>

                <template v-for="(block, i) in blocks" :key="i">
                    <p
                        v-if="block.type === 'section'"
                        class="sbp__section"
                        v-html="sectionHtml(block)"
                    />
                    <div v-else-if="block.type === 'context'" class="sbp__context">
                        <span
                            v-for="(el, j) in contextElements(block)"
                            :key="j"
                            v-html="mrkdwn(el)"
                        />
                    </div>
                    <hr v-else-if="block.type === 'divider'" class="sbp__divider" />
                    <!-- Unknown block: show it rather than silently dropping it. -->
                    <pre v-else class="sbp__raw">{{ stringify(block) }}</pre>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {escapeHtml} from '@/helpers/texts';

const props = defineProps<{payload: unknown}>();

type Block = Record<string, unknown>;

// Slack accepts either a bare array or {blocks: [...]}.
const blocks = computed<Block[]>(() => {
    const raw = props.payload;
    if (Array.isArray(raw)) return raw as Block[];
    const wrapped = (raw as {blocks?: unknown})?.blocks;
    return Array.isArray(wrapped) ? (wrapped as Block[]) : [];
});

function readText(value: unknown): string {
    if (typeof value === 'string') return value;
    const text = (value as {text?: unknown})?.text;
    return typeof text === 'string' ? text : '';
}

function sectionHtml(block: Block): string {
    return mrkdwn(readText(block.text));
}

function contextElements(block: Block): string[] {
    const elements = block.elements;
    return Array.isArray(elements) ? elements.map(readText) : [];
}

/**
 * Slack mrkdwn, enough of it to recognise the message: *bold*, _italic_,
 * `code`, <url|label> links and :emoji: shortcodes. Input is escaped first,
 * so a template cannot inject markup through the preview.
 */
function mrkdwn(input: string): string {
    return escapeHtml(input)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
        .replace(/_([^_]+)_/g, '<em>$1</em>')
        .replace(/&lt;(https?:[^|&]+)\|([^&]+)&gt;/g, '<u>$2</u>')
        .replace(/:([a-z0-9_+-]+):/gi, (whole, name: string) => EMOJI[name] ?? whole)
        .replace(/\n/g, '<br>');
}

// Only the shortcodes the shipped templates use; anything else stays literal
// so it is obvious the preview did not invent it.
const EMOJI: Record<string, string> = {
    rotating_light: '🚨',
    warning: '⚠️',
    white_check_mark: '✅',
    large_blue_circle: '🔵',
    red_circle: '🔴',
    bell: '🔔'
};

function stringify(block: Block): string {
    return JSON.stringify(block, null, 2);
}
</script>

<style scoped>
.sbp {
    padding: var(--space-4);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: #1a1d21;
    color: #d1d2d3;
}
.sbp__msg {
    display: flex;
    gap: var(--space-3);
}
.sbp__avatar {
    flex: 0 0 36px;
    height: 36px;
    border-radius: 4px;
    background: #4a154b;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--type-caption);
    font-weight: 700;
}
.sbp__body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.sbp__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.sbp__name {
    font-weight: 700;
    color: #fff;
}
.sbp__badge {
    padding: 0 4px;
    border-radius: 2px;
    background: #35373b;
    font-size: var(--type-caption);
    letter-spacing: 0.04em;
}
.sbp__section {
    margin: 0;
    line-height: 1.5;
    word-break: break-word;
}
.sbp__context {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    color: #9a9b9d;
    font-size: var(--type-caption);
}
.sbp__divider {
    border: 0;
    border-top: 1px solid #35373b;
    margin: var(--space-1) 0;
}
.sbp__raw {
    margin: 0;
    padding: var(--space-2);
    background: #101214;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    white-space: pre-wrap;
}
.sbp :deep(code) {
    padding: 1px 4px;
    border-radius: 3px;
    background: #232529;
    color: #e01e5a;
    font-family: var(--font-mono);
}
</style>
