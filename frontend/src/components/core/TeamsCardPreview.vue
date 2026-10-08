<template>
    <div class="tcp">
        <div class="tcp__card">
            <template v-for="(el, i) in elements" :key="i">
                <p
                    v-if="el.type === 'TextBlock'"
                    class="tcp__text"
                    :class="[
                        `tcp__text--${String(el.size ?? 'default').toLowerCase()}`,
                        {'tcp__text--strong': el.weight === 'Bolder'}
                    ]"
                >
                    {{ readText(el.text) }}
                </p>

                <dl v-else-if="el.type === 'FactSet'" class="tcp__facts">
                    <template v-for="(fact, j) in facts(el)" :key="j">
                        <dt>{{ fact.title }}</dt>
                        <dd>{{ fact.value }}</dd>
                    </template>
                </dl>

                <div
                    v-else-if="el.type === 'Container'"
                    class="tcp__container"
                    :class="`tcp__container--${String(el.style ?? 'default').toLowerCase()}`"
                >
                    <TeamsCardPreview :payload="{body: el.items}" />
                </div>

                <!-- Unknown element: show it rather than silently dropping it. -->
                <pre v-else class="tcp__raw">{{ stringify(el) }}</pre>
            </template>

            <div v-if="actions.length > 0" class="tcp__actions">
                <span v-for="(a, i) in actions" :key="i" class="tcp__action">
                    {{ readText(a.title) }}
                </span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{payload: unknown}>();

type Element = Record<string, unknown>;

function asArray(value: unknown): Element[] {
    return Array.isArray(value) ? (value as Element[]) : [];
}

// Teams accepts the card directly or wrapped in an attachments envelope.
const card = computed<Element>(() => {
    const raw = (props.payload ?? {}) as Element;
    const attachments = raw.attachments;
    if (Array.isArray(attachments) && attachments.length > 0) {
        const first = attachments[0] as Element;
        return (first.content as Element) ?? first;
    }
    return raw;
});

const elements = computed(() => asArray(card.value.body));
const actions = computed(() => asArray(card.value.actions));

function readText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function facts(el: Element): Array<{title: string; value: string}> {
    return asArray(el.facts).map((f) => ({
        title: readText(f.title),
        value: readText(f.value)
    }));
}

function stringify(el: Element): string {
    return JSON.stringify(el, null, 2);
}
</script>

<style scoped>
.tcp {
    padding: var(--space-4);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: #f5f5f5;
}
.tcp__card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: 6px;
    background: #fff;
    color: #242424;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.tcp__text {
    margin: 0;
    line-height: 1.4;
    word-break: break-word;
}
.tcp__text--large {
    font-size: 1.15rem;
}
.tcp__text--medium {
    font-size: 1.05rem;
}
.tcp__text--strong {
    font-weight: 700;
}
.tcp__facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    padding-top: var(--space-3);
    border-top: 1px solid #e0e0e0;
    font-size: var(--type-caption);
}
.tcp__facts dt {
    font-weight: 600;
    color: #616161;
}
.tcp__facts dd {
    margin: 0;
}
.tcp__container {
    padding: var(--space-3);
    border-radius: 4px;
    background: #fafafa;
}
.tcp__container--attention {
    background: #fdf3f4;
    border-left: 3px solid #c4314b;
}
.tcp__container--warning {
    background: #fff8f0;
    border-left: 3px solid #d83b01;
}
.tcp__container--emphasis {
    background: #f0f6ff;
    border-left: 3px solid #0f6cbd;
}
.tcp__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid #e0e0e0;
}
.tcp__action {
    padding: var(--space-1-5) var(--space-3);
    border-radius: 4px;
    background: #0f6cbd;
    color: #fff;
    font-size: var(--type-caption);
    font-weight: 600;
}
.tcp__raw {
    margin: 0;
    padding: var(--space-2);
    border-radius: 4px;
    background: #f0f0f0;
    color: #333;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    white-space: pre-wrap;
}
</style>
