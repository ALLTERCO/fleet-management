<template>
    <Modal :visible="visible" wide @close="close">
        <template #title>
            <span class="aim-titlebar">
                <AlertSeverityBadge
                    v-if="instance"
                    :severity="instance.severity"
                />
                <span>Alert</span>
            </span>
        </template>

        <div v-if="instance" class="aim">
            <div class="aim-grid">
                <!-- Left: what happened, where, and the key facts -->
                <div class="aim-main">
                    <div class="aim-head">
                        <AlertStateBadge
                            :state="instance.state"
                            :silenced-until="instance.silencedUntil"
                        />
                        <span class="aim-age">{{ ageLabel }}</span>
                    </div>

                    <h2 class="aim-name">{{ instance.title }}</h2>
                    <p v-if="instance.message" class="aim-msg">
                        {{ instance.message }}
                    </p>

                    <div class="aim-source-block">
                        <span class="aim-source-label">Source</span>
                        <DeviceFleetCard
                            v-if="sourceDevice"
                            :device="sourceDevice"
                            class="aim-source-card"
                        />
                        <CardValue_Group
                            v-else-if="sourceGroup"
                            :group="sourceGroup"
                            size="1x1"
                            class="aim-source-card"
                        />
                        <RouterLink
                            v-else-if="source?.to"
                            :to="source.to"
                            class="aim-source aim-source--link"
                            @click="close"
                        >
                            <i :class="source.icon" aria-hidden="true" />
                            <span class="aim-source-name">{{ source.label }}</span>
                            <span class="aim-source-kind">{{ source.kind }}</span>
                        </RouterLink>
                        <div v-else-if="source" class="aim-source">
                            <i :class="source.icon" aria-hidden="true" />
                            <span class="aim-source-name">{{ source.label }}</span>
                            <span class="aim-source-kind">{{ source.kind }}</span>
                        </div>
                    </div>

                    <dl class="aim-facts">
                        <div class="aim-fact">
                            <dt>Kind</dt>
                            <dd>{{ instance.ruleKind }}</dd>
                        </div>
                        <div class="aim-fact">
                            <dt>Active since</dt>
                            <dd>{{ formatTs(instance.activeSince) }}</dd>
                        </div>
                        <div class="aim-fact">
                            <dt>Last triggered</dt>
                            <dd>{{ formatTs(instance.lastTriggeredAt) }}</dd>
                        </div>
                        <div v-if="instance.acknowledgedAt" class="aim-fact">
                            <dt>Acknowledged</dt>
                            <dd>
                                {{ formatTs(instance.acknowledgedAt) }}
                                <span v-if="instance.acknowledgedBy">
                                    ·
                                    {{
                                        instance.acknowledgedBy.displayName ||
                                        instance.acknowledgedBy.userId
                                    }}
                                </span>
                            </dd>
                        </div>
                        <div v-if="instance.resolvedAt" class="aim-fact">
                            <dt>Resolved</dt>
                            <dd>{{ formatTs(instance.resolvedAt) }}</dd>
                        </div>
                        <div v-if="silencedActive" class="aim-fact">
                            <dt>Silenced until</dt>
                            <dd>{{ formatTs(instance.silencedUntil!) }}</dd>
                        </div>
                        <div v-if="instance.silenceReason" class="aim-fact">
                            <dt>Silence reason</dt>
                            <dd>{{ instance.silenceReason }}</dd>
                        </div>
                        <div class="aim-fact">
                            <dt>Notifications</dt>
                            <dd>{{ instance.counts.notificationsCreated }}</dd>
                        </div>
                    </dl>

                    <details v-if="hasContext" class="aim-context">
                        <summary>Raw context</summary>
                        <pre>{{ contextPreview }}</pre>
                    </details>
                </div>

                <!-- Right: what the alert did over time -->
                <div class="aim-side">
                    <section class="aim-block">
                        <h3 class="aim-block-title">Activity</h3>
                        <TransitionTimeline
                            v-if="timeline.length"
                            :transitions="timeline"
                        />
                        <p v-else class="aim-empty">No transitions yet.</p>
                    </section>

                    <section class="aim-block">
                        <h3 class="aim-block-title">Deliveries</h3>
                        <div v-if="deliveryJobs.length" class="aim-deliveries">
                            <DeliveryJobCard
                                v-for="job in deliveryJobs"
                                :key="job.id"
                                :job="job"
                            />
                        </div>
                        <p v-else class="aim-empty">No deliveries recorded.</p>
                    </section>
                </div>
            </div>

            <SilenceModal v-model="silenceVisible" @silence="onSilence" />
        </div>

        <p v-else-if="loading" class="aim-state">Loading…</p>
        <EmptyBlock v-else>
            <p>This alert may have been deleted or you don't have access.</p>
        </EmptyBlock>

        <template #footer>
            <div class="aim-footer">
                <div v-if="instance && canWrite" class="aim-actions">
                    <Button
                        v-if="instance.state === 'active' && !instance.acknowledgedAt"
                        type="blue"
                        size="sm"
                        @click="ack"
                    >
                        Acknowledge
                    </Button>
                    <Button
                        v-if="instance.state === 'acknowledged'"
                        type="blue-hollow"
                        size="sm"
                        @click="unack"
                    >
                        <i class="fas fa-rotate-left" /> Un-acknowledge
                    </Button>
                    <Button
                        v-if="instance.state !== 'resolved' && !silencedActive"
                        type="blue-hollow"
                        size="sm"
                        @click="silenceVisible = true"
                    >
                        <i class="fas fa-bell-slash" /> Silence
                    </Button>
                    <Button
                        v-if="silencedActive"
                        type="blue-hollow"
                        size="sm"
                        @click="unsilence"
                    >
                        <i class="fas fa-bell" /> Un-silence
                    </Button>
                    <Button
                        v-if="instance.state !== 'resolved'"
                        type="green"
                        size="sm"
                        @click="resolve"
                    >
                        Resolve
                    </Button>
                </div>
                <span class="aim-footer-spacer" />
                <Button type="blue-hollow" size="sm" @click="close">
                    Close
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {toRef} from 'vue';
import CardValue_Group from '@/components/cards/CardValue_Group.vue';
import DeliveryJobCard from '@/components/cards/DeliveryJobCard.vue';
import DeviceFleetCard from '@/components/cards/DeviceFleetCard.vue';
import AlertSeverityBadge from '@/components/core/AlertSeverityBadge.vue';
import AlertStateBadge from '@/components/core/AlertStateBadge.vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import TransitionTimeline from '@/components/core/TransitionTimeline.vue';
import {useAlertInstance} from '@/composables/useAlertInstance';
import Modal from './Modal.vue';
import SilenceModal from './SilenceModal.vue';

// The one place an alert instance is shown — a wide popup. Left column carries
// what/where/facts; right column carries activity + deliveries.
const props = defineProps<{instanceId: number | null}>();
const visible = defineModel<boolean>({required: true});

const {
    instance,
    source,
    sourceDevice,
    sourceGroup,
    timeline,
    deliveryJobs,
    loading,
    silenceVisible,
    silencedActive,
    ageLabel,
    hasContext,
    contextPreview,
    canWrite,
    formatTs,
    ack,
    unack,
    unsilence,
    resolve,
    onSilence
} = useAlertInstance(toRef(props, 'instanceId'));

function close() {
    visible.value = false;
}
</script>

<style scoped>
.aim-titlebar {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

/* Two columns on desktop; stacks under 768px. */
.aim-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    gap: var(--space-6);
    align-items: start;
}
@media (max-width: 768px) {
    .aim-grid {
        grid-template-columns: 1fr;
        gap: var(--space-5);
    }
}

.aim-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
}

.aim-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.aim-age {
    margin-left: auto;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.aim-name {
    margin: 0;
    font-size: var(--type-subheading);
    font-weight: var(--font-bold);
    line-height: 1.15;
    letter-spacing: var(--tracking-tight);
    color: var(--color-text-primary);
}

.aim-msg {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.5;
}

.aim-source-block {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
}
.aim-source-label {
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-tertiary);
}
/* The real fleet/group card sits at its natural size, left-aligned. */
.aim-source-card {
    align-self: flex-start;
    flex: none;
    cursor: default;
}
.aim-source {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    text-decoration: none;
}
.aim-source i {
    color: var(--color-text-tertiary);
}
.aim-source--link {
    cursor: pointer;
    transition: border-color var(--duration-fast);
}
.aim-source--link:hover {
    border-color: var(--color-primary);
}
.aim-source-name {
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.aim-source-kind {
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-tertiary);
}

.aim-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-4);
    margin: var(--space-1) 0 0;
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
}
.aim-fact {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}
.aim-fact dt {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-tertiary);
}
.aim-fact dd {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-primary);
}

.aim-context {
    margin-top: var(--space-2);
}
.aim-context summary {
    cursor: pointer;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-tertiary);
}
.aim-context pre {
    margin: var(--space-2) 0 0;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface-0);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow: auto;
    max-height: 240px;
}

.aim-side {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-width: 0;
}
.aim-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.aim-block-title {
    margin: 0;
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-tertiary);
}
.aim-deliveries {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.aim-empty {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}

.aim-state {
    margin: 0;
    padding: var(--space-4) 0;
    color: var(--color-text-tertiary);
}

.aim-footer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
}
.aim-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.aim-footer-spacer {
    flex: 1;
}
</style>
