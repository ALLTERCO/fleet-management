<template>
    <div class="ard">
        <div class="ard__badges">
            <AlertSeverityBadge :severity="rule.severity" />
            <span class="ard__kind">{{ kindLabel }}</span>
            <span
                class="ard__state"
                :class="`ard__state--${rule.enabled ? 'on' : 'off'}`"
            >
                {{ rule.enabled ? 'Enabled' : 'Disabled' }}
            </span>
        </div>

        <div class="ard__tabs">
            <button
                type="button"
                class="ard__tab"
                :class="{'ard__tab--active': tab === 'details'}"
                @click="tab = 'details'"
            >
                Details
            </button>
            <button
                type="button"
                class="ard__tab"
                :class="{'ard__tab--active': tab === 'firings'}"
                @click="showFirings"
            >
                Firings
                <span v-if="firingsTotal != null" class="ard__tab-count">
                    {{ firingsTotal }}
                </span>
            </button>
        </div>

        <template v-if="tab === 'details'">
            <dl class="ard__grid">
                <div><dt>Don't repeat within</dt><dd>{{ rule.dedupeWindowSec }}s</dd></div>
                <div><dt>Wait between</dt><dd>{{ rule.cooldownSec }}s</dd></div>
                <div>
                    <dt>Auto-resolve</dt><dd>{{ rule.autoResolve ? 'Yes' : 'No' }}</dd>
                </div>
                <div>
                    <dt>Destination groups</dt>
                    <dd>{{ rule.destinationGroupIds.length }}</dd>
                </div>
            </dl>

            <div v-if="scopeSummary" class="ard__field">
                <span class="ard__label">Applies to</span>
                <p class="ard__scope">{{ scopeSummary }}</p>
            </div>

            <div class="ard__field">
                <span class="ard__label">Condition</span>
                <RuleConditionView :kind="rule.kind" :config="rule.config" />
            </div>

            <section class="ard__preview">
                <Button
                    type="blue-hollow"
                    size="sm"
                    :loading="previewRunning"
                    @click="runPreview"
                >
                    <i class="fas fa-vial" aria-hidden="true" /> Preview matches
                </Button>
                <p
                    v-if="previewResult && !previewResult.supportedKind"
                    class="ard__muted"
                >
                    <i class="fas fa-circle-info" aria-hidden="true" />
                    {{ previewResult.note ?? 'Preview not available for this rule kind.' }}
                </p>
                <template v-else-if="previewResult">
                    <p class="ard__preview-sum">
                        Scanned {{ previewResult.scanned }}
                        device{{ previewResult.scanned === 1 ? '' : 's' }}.
                        <strong>{{ previewResult.matchCount }}</strong>
                        would fire now.
                        <span
                            v-if="previewResult.truncated"
                            class="ard__trunc"
                        >
                            (truncated — narrow the scope)
                        </span>
                    </p>
                    <ul
                        v-if="previewResult.matches.length > 0"
                        class="ard__list"
                    >
                        <li
                            v-for="(m, i) in previewResult.matches"
                            :key="i"
                            class="ard__row"
                        >
                            <AlertSeverityBadge :severity="m.severity" />
                            <div class="ard__row-main">
                                <div class="ard__row-title">{{ m.title }}</div>
                                <div class="ard__row-meta">
                                    {{ m.subject.subjectType }} · {{ m.subject.subjectId }}
                                </div>
                            </div>
                        </li>
                    </ul>
                </template>
            </section>
        </template>

        <template v-else>
            <p v-if="firingsLoading" class="ard__muted">Loading…</p>
            <p v-else-if="firings.length === 0" class="ard__muted">
                No firings yet.
            </p>
            <ul v-else class="ard__list">
                <li
                    v-for="f in firings"
                    :key="f.transitionId"
                    class="ard__row ard__row--click"
                    @click="emit('open-firing', f.alertId)"
                >
                    <AlertSeverityBadge :severity="f.severity" />
                    <div class="ard__row-main">
                        <div class="ard__row-title">{{ f.title }}</div>
                        <div class="ard__row-meta">
                            {{ f.source.subjectType }} · {{ f.source.subjectId }}
                            <span class="ard__row-action">{{ f.action }}</span>
                        </div>
                    </div>
                    <time class="ard__row-time" :title="f.firedAt">
                        {{ formatRelative(f.firedAt) }}
                    </time>
                </li>
            </ul>
            <Button
                v-if="hasMoreFirings"
                type="blue-hollow"
                size="sm"
                @click="loadMoreFirings"
            >
                Load more
            </Button>
        </template>
    </div>
</template>

<script setup lang="ts">
import type {AlertRule} from '@api/alert';
import {computed} from 'vue';
import AlertSeverityBadge from '@/components/core/AlertSeverityBadge.vue';
import Button from '@/components/core/Button.vue';
import RuleConditionView from '@/components/core/RuleConditionView.vue';
import {useAlertRuleDetail} from '@/composables/useAlertRuleDetail';
import {formatRelative} from '@/helpers/format';
import {useAlertsStore} from '@/stores/alerts';

const props = defineProps<{rule: AlertRule}>();
const emit = defineEmits<{'open-firing': [alertId: number]}>();

const store = useAlertsStore();
const ruleId = computed(() => props.rule.id);

const {
    firings,
    firingsTotal,
    firingsLoading,
    hasMoreFirings,
    previewRunning,
    previewResult,
    loadFirings,
    loadMoreFirings,
    runPreview
} = useAlertRuleDetail(ruleId);

// `tab` is local view state, not shared — each surface opens on Details.
const tab = defineModel<'details' | 'firings'>('tab', {default: 'details'});

const kindLabel = computed(
    () =>
        store.kinds.find((k) => k.key === props.rule.kind)?.label ??
        props.rule.kind
);

const scopeSummary = computed(() => {
    const s = props.rule.scope;
    const parts: string[] = [];
    if (s.deviceIds?.length) parts.push(`${s.deviceIds.length} device(s)`);
    if (s.componentIds?.length)
        parts.push(`${s.componentIds.length} component(s)`);
    if (s.groupIds?.length) parts.push(`${s.groupIds.length} group(s)`);
    if (s.locationIds?.length)
        parts.push(`${s.locationIds.length} location(s)`);
    if (s.tagIds?.length) parts.push(`${s.tagIds.length} tag(s)`);
    return parts.join(' · ');
});

function showFirings(): void {
    tab.value = 'firings';
    void loadFirings();
}
</script>

<style scoped>
.ard {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
.ard__badges {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
}
.ard__kind {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.ard__state {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
}
.ard__state--on {
    color: var(--color-success-text);
    background: var(--color-success-subtle);
}
.ard__state--off {
    color: var(--color-text-secondary);
    background: var(--glass-input);
}
.ard__tabs {
    display: flex;
    gap: var(--space-2);
    border-bottom: 1px solid var(--color-border-default);
}
.ard__tab {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.ard__tab--active {
    color: var(--color-text-primary);
    border-bottom-color: var(--color-primary);
}
.ard__tab-count {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.ard__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-3) var(--space-4);
    margin: 0;
}
.ard__grid dt {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.ard__grid dd {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-primary);
}
.ard__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.ard__label {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.ard__scope {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.ard__preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-top: 1px solid var(--color-border-default);
    padding-top: var(--space-4);
}
.ard__preview-sum {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.ard__trunc {
    color: var(--color-warning-text);
    font-weight: var(--font-semibold);
}
.ard__muted {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.ard__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.ard__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--glass-input);
}
.ard__row--click {
    cursor: pointer;
    transition: border-color var(--motion-hover);
}
.ard__row--click:hover {
    box-shadow: var(--shadow-brand-ring);
}
.ard__row-main {
    flex: 1;
    min-width: 0;
}
.ard__row-title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.ard__row-meta {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.ard__row-action {
    margin-left: var(--space-2);
}
.ard__row-time {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    white-space: nowrap;
}
</style>
