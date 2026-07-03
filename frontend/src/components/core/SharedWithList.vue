<template>
    <section v-if="canReadPolicies" class="swl">
        <header class="swl__header">
            <h3 class="swl__title">
                <i class="fas fa-users swl__title-icon" />
                Shared with
                <span v-if="rows.length > 0" class="swl__count">{{ rows.length }}</span>
            </h3>
            <span
                class="swl__visibility"
                :class="`swl__visibility--${visibilityState}`"
                :title="visibilityTooltip"
            >
                <i class="fas" :class="visibilityIcon" />
                {{ visibilityLabel }}
            </span>
            <span v-if="loading" class="swl__loading">
                <i class="fas fa-spinner fa-spin" /> loading…
            </span>
        </header>
        <p v-if="metaLine" class="swl__meta">
            <i class="fas fa-clock-rotate-left" /> {{ metaLine }}
        </p>

        <ul v-if="rows.length > 0" class="swl__list">
            <li
                v-for="row in rows"
                :key="row.id"
                class="swl__row"
            >
                <i
                    class="fas swl__row-icon"
                    :class="row.subject_type === 'user_group' ? 'fa-users' : 'fa-user'"
                />
                <span class="swl__subject">{{ subjectLabel(row) }}</span>
                <span class="swl__persona">{{ personaLabel(row) }}</span>
                <span
                    v-if="isNarrowed(row)"
                    class="swl__chip swl__chip--narrowed"
                    :title="scopeTooltip(row)"
                >
                    <i class="fas fa-filter" />
                    Scoped
                </span>
                <button
                    v-if="canRevoke"
                    type="button"
                    class="swl__revoke"
                    :disabled="revokingId === row.id"
                    :title="`Revoke ${subjectLabel(row)}`"
                    :aria-label="`Revoke ${subjectLabel(row)}`"
                    @click="onRevoke(row.id)"
                >
                    <i
                        class="fas"
                        :class="revokingId === row.id ? 'fa-spinner fa-spin' : 'fa-trash'"
                    />
                </button>
            </li>
        </ul>

        <p v-else-if="errorState" class="swl__error">
            <i class="fas fa-exclamation-triangle" />
            Couldn't load the share list.
        </p>
        <p v-else-if="!loading" class="swl__empty">
            Only owners and admins can access this until it is shared.
        </p>
    </section>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {
    type AssignmentResourceType,
    type AssignmentResponse,
    useAssignmentsStore
} from '@/stores/assignments';
import {usePersonasStore} from '@/stores/personas';
import {useUserGroupsStore} from '@/stores/userGroups';
import {useUsersStore} from '@/stores/users';

const props = withDefaults(
    defineProps<{
        resourceType: AssignmentResourceType;
        resourceId: string | number;
        canRevoke?: boolean;
        createdAt?: string | null;
        updatedAt?: string | null;
    }>(),
    {canRevoke: true, createdAt: null, updatedAt: null}
);

const usersStore = useUsersStore();
const userGroupsStore = useUserGroupsStore();
const personasStore = usePersonasStore();
const assignments = useAssignmentsStore();
const rpc = useRpcPermissions();
// Gate on the listing RPC's required role rather than a hardcoded
// isAdmin/auditor split — keeps one source of truth in rpcPermissions.
const canReadPolicies = computed(() =>
    rpc.canCall('assignment.listforresource')
);

const rows = ref<AssignmentResponse[]>([]);
const loading = ref(false);
const errorState = ref(false);
const revokingId = ref<string | null>(null);
// Guards against out-of-order responses when resourceId changes rapidly:
// only the latest in-flight request is allowed to write rows/loading.
let fetchSeq = 0;

async function refresh(): Promise<void> {
    // Self-gate so parents calling .refresh() via defineExpose can't bypass
    // the permission check that onMounted and the watch already apply.
    if (!canReadPolicies.value) return;
    const seq = ++fetchSeq;
    loading.value = true;
    errorState.value = false;
    try {
        const items = await assignments.listForResource(
            props.resourceType,
            props.resourceId
        );
        if (seq !== fetchSeq) return;
        if (items === null) {
            errorState.value = true;
            rows.value = [];
        } else {
            rows.value = items;
        }
    } finally {
        if (seq === fetchSeq) loading.value = false;
    }
}

async function onRevoke(id: string): Promise<void> {
    if (!props.canRevoke) return;
    revokingId.value = id;
    try {
        const ok = await assignments.remove(id);
        if (ok) rows.value = rows.value.filter((r) => r.id !== id);
    } finally {
        revokingId.value = null;
    }
}

// Visibility state derives from the share list. We don't track cross-org
// sharing today, so "external" is reserved for when that signal exists.
const visibilityState = computed<'private' | 'shared'>(() =>
    rows.value.length > 0 ? 'shared' : 'private'
);
const visibilityLabel = computed(() =>
    visibilityState.value === 'shared' ? 'Shared' : 'Private'
);
const visibilityIcon = computed(() =>
    visibilityState.value === 'shared' ? 'fa-users' : 'fa-lock'
);
const visibilityTooltip = computed(() =>
    visibilityState.value === 'shared'
        ? `Shared with ${rows.value.length} ${
              rows.value.length === 1 ? 'subject' : 'subjects'
          }`
        : 'Only owners and admins can access'
);

const metaLine = computed(() => {
    const parts: string[] = [];
    if (props.createdAt) parts.push(`Created ${shortDate(props.createdAt)}`);
    if (props.updatedAt) parts.push(`updated ${relativeTime(props.updatedAt)}`);
    return parts.join(' · ');
});

function shortDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString();
}

function relativeTime(iso: string): string {
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return iso;
    const diffSec = Math.round((Date.now() - d) / 1000);
    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
    if (diffSec < 2592000) return `${Math.round(diffSec / 86400)}d ago`;
    return shortDate(iso);
}

function subjectLabel(row: AssignmentResponse): string {
    if (row.subject_type === 'user_group') {
        return userGroupsStore.groups[row.subject_id]?.name ?? row.subject_id;
    }
    const u = usersStore.users.find((x) => x.userId === row.subject_id);
    if (u) return u.displayName || u.userName || u.email || u.userId;
    return row.subject_id;
}

function personaLabel(row: AssignmentResponse): string {
    return personasStore.personas[row.persona_id]?.name ?? '(unknown persona)';
}

// scope.all === true is tenant-wide; any populated id list narrows the
// grant to a subset. The chip surfaces that the user's persona is being
// applied through a narrower lens than its default reach.
function isNarrowed(row: AssignmentResponse): boolean {
    if (row.scope?.all === true) return false;
    const s = row.scope;
    if (!s) return false;
    return (
        (s.device_ids?.length ?? 0) +
            (s.location_ids?.length ?? 0) +
            (s.device_group_ids?.length ?? 0) +
            (s.device_tags?.length ?? 0) +
            (s.dashboard_ids?.length ?? 0) +
            (s.plugin_keys?.length ?? 0) >
        0
    );
}

function scopeTooltip(row: AssignmentResponse): string {
    const s = row.scope ?? {};
    const parts: string[] = [];
    if (s.device_ids?.length) parts.push(`${s.device_ids.length} devices`);
    if (s.location_ids?.length)
        parts.push(`${s.location_ids.length} locations`);
    if (s.device_group_ids?.length)
        parts.push(`${s.device_group_ids.length} groups`);
    if (s.device_tags?.length) parts.push(`${s.device_tags.length} tags`);
    if (s.dashboard_ids?.length)
        parts.push(`${s.dashboard_ids.length} dashboards`);
    if (s.plugin_keys?.length) parts.push(`${s.plugin_keys.length} plugins`);
    return parts.length > 0
        ? `Persona is narrowed to ${parts.join(' · ')}`
        : 'Tenant-wide';
}

// All four RPCs we call require canReadPolicies (admin or auditor) on the
// backend. For regular viewers we skip the fetch entirely — without this
// gate the panel would fire four permission-denied toasts on every visit.
onMounted(() => {
    if (!canReadPolicies.value) return;
    void Promise.all([
        usersStore.fetchUsers(),
        userGroupsStore.fetchAll(),
        personasStore.fetchAll(),
        refresh()
    ]);
});

watch(
    () => [props.resourceType, props.resourceId],
    () => {
        if (!canReadPolicies.value) return;
        void refresh();
    }
);

defineExpose({refresh});
</script>

<style scoped>
.swl {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
}
.swl__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}
.swl__title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.swl__title-icon {
    color: var(--color-primary);
}
.swl__count {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    font-weight: var(--font-normal);
}
.swl__loading {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.swl__visibility {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    border: 1px solid var(--color-border-default);
}
.swl__visibility--private {
    color: var(--color-text-tertiary);
    background: var(--color-surface-2);
}
.swl__visibility--shared {
    color: var(--color-primary-text);
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    border-color: color-mix(in srgb, var(--color-primary) 28%, transparent);
}
.swl__meta {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}
.swl__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.swl__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-0);
    min-height: var(--touch-target-min);
}
.swl__row-icon {
    color: var(--color-text-tertiary);
    width: 1em;
    text-align: center;
}
.swl__subject {
    flex: 1;
    min-width: 0;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.swl__persona {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    white-space: nowrap;
}
.swl__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    white-space: nowrap;
}
.swl__chip--narrowed {
    color: var(--color-primary-text);
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 28%, transparent);
}
.swl__revoke {
    min-width: var(--touch-target-min);
    min-height: var(--touch-target-min);
    border: none;
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-md);
}
.swl__revoke:hover:not(:disabled) {
    color: var(--color-status-red);
    background: color-mix(in srgb, var(--color-status-red) 8%, transparent);
}
.swl__revoke:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
.swl__empty {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-style: italic;
}
.swl__error {
    margin: 0;
    color: var(--color-status-red);
    font-size: var(--type-caption);
}
</style>
