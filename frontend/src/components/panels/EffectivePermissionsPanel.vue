<template>
    <div class="epp">
        <header class="epp__header">
            <p class="epp__hint">
                What this user can actually do — built-in roles, group
                membership, and direct shares combined into a single picture.
            </p>
            <button
                type="button"
                class="epp__refresh"
                :disabled="loading"
                @click="refresh"
            >
                <i
                    class="fas"
                    :class="loading ? 'fa-spinner fa-spin' : 'fa-rotate'"
                />
                {{ loading ? 'Loading…' : 'Refresh' }}
            </button>
        </header>

        <p v-if="errorState" class="epp__error">
            <i class="fas fa-exclamation-triangle" />
            Couldn't load effective permissions.
        </p>

        <section
            v-if="!errorState && accessLoaded"
            class="epp__summary"
            aria-label="Effective access summary"
        >
            <div class="epp__summary-item">
                <span class="epp__summary-label">Built-in roles</span>
                <code class="epp__summary-value">{{ baseRoleText }}</code>
            </div>
            <div class="epp__summary-item">
                <span class="epp__summary-label">Direct assignments</span>
                <code class="epp__summary-value">
                    {{ provenance.directAssignments.length }}
                </code>
            </div>
            <div class="epp__summary-item">
                <span class="epp__summary-label">Group assignments</span>
                <code class="epp__summary-value">
                    {{ provenance.groupAssignments.length }}
                </code>
            </div>
            <p v-if="hasCredentialBoundary" class="epp__notice">
                Scoped credential boundary is active.
            </p>
            <p v-if="noAccessReason" class="epp__notice">
                {{ noAccessReason }}
            </p>
        </section>

        <ul
            v-if="!errorState && assignmentRows.length > 0"
            class="epp__provenance"
        >
            <li
                v-for="(entry, idx) in assignmentRows"
                :key="`${entry.source}:${entry.assignmentId || idx}`"
                class="epp__provenance-row"
            >
                <span class="epp__source">{{ sourceLabel(entry) }}</span>
                <div class="epp__provenance-main">
                    <code class="epp__cell-val">
                        {{ assignmentSummary(entry) }}
                    </code>
                    <dl
                        v-if="assignmentDetails(entry).length"
                        class="epp__details"
                    >
                        <template
                            v-for="detail in assignmentDetails(entry)"
                            :key="`${entry.assignmentId}:${detail.label}`"
                        >
                            <dt>{{ detail.label }}</dt>
                            <dd>{{ detail.value }}</dd>
                        </template>
                    </dl>
                </div>
            </li>
        </ul>

        <p
            v-if="
                !errorState &&
                !loading &&
                accessLoaded &&
                statements.length === 0
            "
            class="epp__empty"
        >
            {{ noAccessReason || 'No effective permissions in this tenant.' }}
        </p>

        <ul v-else-if="!errorState && statements.length > 0" class="epp__list">
            <li
                v-for="(s, idx) in statements"
                :key="idx"
                class="epp__row"
                :class="`epp__row--${s.effect.toLowerCase()}`"
            >
                <div class="epp__row-head">
                    <span class="epp__effect">{{ s.effect }}</span>
                    <span class="epp__scope">{{ scopeSummary(s.scope) }}</span>
                </div>
                <div class="epp__row-body">
                    <div class="epp__cell">
                        <span class="epp__cell-label">Actions</span>
                        <code class="epp__cell-val">
                            {{ s.actions.join(', ') || '(none)' }}
                        </code>
                    </div>
                    <div class="epp__cell">
                        <span class="epp__cell-label">Resource types</span>
                        <code class="epp__cell-val">
                            {{ s.resourceTypes.join(', ') || '(none)' }}
                        </code>
                    </div>
                    <div v-if="s.notActions?.length" class="epp__cell">
                        <span class="epp__cell-label">Not actions</span>
                        <code class="epp__cell-val">
                            {{ s.notActions.join(', ') }}
                        </code>
                    </div>
                    <div v-if="hasCondition(s)" class="epp__cell">
                        <span class="epp__cell-label">Conditions</span>
                        <code class="epp__cell-val">
                            {{ conditionSummary(s) }}
                        </code>
                    </div>
                </div>
            </li>
        </ul>

        <hr v-if="statements.length > 0 && canSimulate" class="epp__sep" />

        <SimulatePermissionWidget
            v-if="userId && canSimulate"
            :key="userId"
            :user-id="userId"
        />
    </div>
</template>

<script setup lang="ts">
import type {
    EffectiveAccessProvenance,
    EffectiveAccessRoleSummary,
    EffectiveStatement
} from '@api/authz';
import {computed, onMounted, ref, watch} from 'vue';
import SimulatePermissionWidget from '@/components/panels/SimulatePermissionWidget.vue';
import {
    assignmentDetails,
    emptyEffectiveAccessProvenance,
    formatAssignmentSource,
    formatAssignmentSummary,
    formatBaseRoles,
    formatConditionSummary,
    formatScopeSummary,
    hasStatementCondition
} from '@/helpers/effectiveAccessPresentation';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {
    type EffectivePermissionsResult, 
    useUsersStore
} from '@/stores/users';

const props = defineProps<{userId: string | null}>();

const usersStore = useUsersStore();
const rpc = useRpcPermissions();
const canSimulate = computed(() => rpc.canCall('User.SimulateV2'));

const statements = ref<EffectiveStatement[]>([]);
const provenance = ref<EffectiveAccessRoleSummary>(emptyProvenance());
const hasCredentialBoundary = ref(false);
const noAccessReason = ref('');
const accessLoaded = ref(false);
const loading = ref(false);
const errorState = ref(false);
const assignmentRows = computed(() => [
    ...provenance.value.directAssignments,
    ...provenance.value.groupAssignments
]);
const baseRoleText = computed(() => formatBaseRoles(provenance.value.baseRoles));
// Guards against out-of-order responses when userId changes mid-flight.
let fetchSeq = 0;

async function refresh(): Promise<void> {
    if (!props.userId) {
        resetAccessDetails();
        return;
    }
    const seq = ++fetchSeq;
    loading.value = true;
    errorState.value = false;
    resetAccessDetails();
    try {
        const res = await usersStore.getEffectivePermissions(props.userId);
        if (seq !== fetchSeq) return;
        if (!res) {
            errorState.value = true;
            resetAccessDetails();
        } else {
            applyEffectivePermissions(res);
        }
    } finally {
        if (seq === fetchSeq) loading.value = false;
    }
}

function applyEffectivePermissions(result: EffectivePermissionsResult): void {
    statements.value = result.shape.statements ?? [];
    provenance.value = result.provenance;
    hasCredentialBoundary.value = result.hasCredentialBoundary;
    noAccessReason.value = result.noAccessReason ?? '';
    accessLoaded.value = true;
}

function resetAccessDetails(): void {
    statements.value = [];
    provenance.value = emptyEffectiveAccessProvenance();
    hasCredentialBoundary.value = false;
    noAccessReason.value = '';
    accessLoaded.value = false;
}

function emptyProvenance(): EffectiveAccessRoleSummary {
    return emptyEffectiveAccessProvenance();
}

function scopeSummary(scope: EffectiveStatement['scope']): string {
    return formatScopeSummary(scope);
}

function sourceLabel(entry: EffectiveAccessProvenance): string {
    return formatAssignmentSource(entry);
}

function assignmentSummary(entry: EffectiveAccessProvenance): string {
    return formatAssignmentSummary(entry);
}

function hasCondition(s: EffectiveStatement): boolean {
    return hasStatementCondition(s);
}

function conditionSummary(s: EffectiveStatement): string {
    return formatConditionSummary(s);
}

onMounted(refresh);
watch(() => props.userId, refresh);
</script>

<style scoped>
.epp {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.epp__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
}
.epp__hint {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    flex: 1;
}
.epp__refresh {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    cursor: pointer;
}
.epp__refresh:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
.epp__error,
.epp__empty {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    background: var(--color-surface-1);
    font-size: var(--type-caption);
    font-style: italic;
}
.epp__error {
    color: var(--color-status-red);
}
.epp__summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}
.epp__summary-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}
.epp__summary-label,
.epp__source {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
.epp__summary-value {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
}
.epp__notice {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.epp__provenance {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.epp__provenance-row {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    align-items: start;
    gap: var(--space-2);
}
.epp__provenance-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}
.epp__details {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-0-5) var(--space-2);
    margin: 0;
    font-size: var(--type-caption);
}
.epp__details dt {
    color: var(--color-text-tertiary);
    font-weight: var(--font-semibold);
}
.epp__details dd {
    margin: 0;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
}
.epp__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.epp__row {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.epp__row--allow {
    border-left: 3px solid var(--color-status-on);
}
.epp__row--deny {
    border-left: 3px solid var(--color-status-red);
}
.epp__row-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.epp__effect {
    display: inline-flex;
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    background: var(--color-surface-2);
}
.epp__row--allow .epp__effect {
    color: var(--color-status-on);
    background: color-mix(in srgb, var(--color-status-on) 14%, transparent);
}
.epp__row--deny .epp__effect {
    color: var(--color-status-red);
    background: color-mix(in srgb, var(--color-status-red) 14%, transparent);
}
.epp__scope {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.epp__row-body {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-2);
}
.epp__cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.epp__cell-label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.epp__cell-val {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-primary);
    background: var(--color-surface-0);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    overflow-wrap: anywhere;
}
.epp__sep {
    border: none;
    border-top: 1px solid var(--color-border-default);
    margin: var(--space-2) 0 0;
}
</style>
