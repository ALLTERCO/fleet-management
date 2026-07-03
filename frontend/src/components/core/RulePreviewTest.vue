<template>
    <div class="rpt">
        <Button
            type="blue-hollow"
            size="sm"
            :loading="running"
            @click="run"
        >
            <i class="fas fa-vial" aria-hidden="true" /> Test on my devices
        </Button>

        <p v-if="running" class="rpt__line">Scanning…</p>

        <template v-else-if="result">
            <p v-if="!result.supportedKind" class="rpt__line rpt__line--muted">
                <i class="fas fa-circle-info" aria-hidden="true" />
                {{ result.note ?? 'Preview not available for this rule kind.' }}
            </p>
            <template v-else>
                <p class="rpt__line">
                    Scanned {{ result.scanned }}
                    device{{ result.scanned === 1 ? '' : 's' }}.
                    <strong>{{ result.matchCount }}</strong>
                    would fire now.
                    <span v-if="result.truncated" class="rpt__trunc">
                        (truncated — narrow the scope)
                    </span>
                </p>
                <ul v-if="result.matches.length > 0" class="rpt__matches">
                    <li
                        v-for="(m, i) in result.matches"
                        :key="i"
                        class="rpt__match"
                    >
                        <span class="rpt__match-title">{{ m.title }}</span>
                        <span class="rpt__match-subject">
                            {{ m.subject.subjectType }} · {{ m.subject.subjectId }}
                        </span>
                    </li>
                </ul>
            </template>
        </template>
    </div>
</template>

<script setup lang="ts">
import type {
    AlertRuleKind,
    AlertRulePreviewMatch,
    AlertSeverity,
    ScopeSelector
} from '@api/alert';
import {ref} from 'vue';
import Button from '@/components/core/Button.vue';
import {useAlertsStore} from '@/stores/alerts';

const props = defineProps<{
    kind: AlertRuleKind;
    severity?: AlertSeverity;
    scope: ScopeSelector;
    config: Record<string, unknown>;
}>();

interface PreviewResult {
    matches: AlertRulePreviewMatch[];
    matchCount: number;
    scanned: number;
    supportedKind: boolean;
    truncated: boolean;
    note: string | null;
}

const store = useAlertsStore();
const running = ref(false);
const result = ref<PreviewResult | null>(null);

async function run(): Promise<void> {
    running.value = true;
    try {
        result.value = await store.previewRule({
            kind: props.kind,
            severity: props.severity,
            scope: props.scope,
            config: props.config
        });
    } finally {
        running.value = false;
    }
}
</script>

<style scoped>
.rpt {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.rpt__line {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}

.rpt__line--muted {
    color: var(--color-text-tertiary);
}

.rpt__trunc {
    color: var(--color-warning-text);
    font-weight: var(--font-semibold);
}

.rpt__matches {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.rpt__match {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--glass-input);
    border-radius: var(--radius-md);
}

.rpt__match-title {
    font-size: var(--type-body);
    color: var(--color-text-primary);
}

.rpt__match-subject {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    white-space: nowrap;
}
</style>
