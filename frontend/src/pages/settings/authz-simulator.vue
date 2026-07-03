<template>
    <PageTemplate title="Authz Simulator" :tabs="tabs">
        <div class="sim-shell">
            <!-- LEFT: form -->
            <BasicBlock darker title="Permission check" class="sim-form-block">
                <div class="sim-form">
                    <FormField label="User">
                        <select v-model="userId" class="sim-input">
                            <option value="">— Select user —</option>
                            <optgroup label="Human users">
                                <option
                                    v-for="u in users.filter(x => x.kind === 'human')"
                                    :key="u.userId"
                                    :value="u.userId"
                                >
                                    {{ u.userName }} ({{ u.userId }})
                                </option>
                            </optgroup>
                            <optgroup label="Service users">
                                <option
                                    v-for="u in users.filter(x => x.kind === 'service')"
                                    :key="u.userId"
                                    :value="u.userId"
                                >
                                    {{ u.userName }} ({{ u.userId }})
                                </option>
                            </optgroup>
                        </select>
                    </FormField>

                    <div class="sim-row">
                        <FormField label="Action">
                            <Dropdown
                                :options="ACTION_OPTIONS"
                                :default="action"
                                :searchable="true"
                                @selected="(v: string) => (action = v)"
                            />
                        </FormField>
                        <FormField label="Resource type">
                            <Dropdown
                                :options="RESOURCE_OPTIONS"
                                :default="resourceType"
                                :searchable="true"
                                @selected="(v: string) => (resourceType = v)"
                            />
                        </FormField>
                    </div>

                    <FormField label="Resource ID (optional)">
                        <Input v-model="resourceId" placeholder="* or specific id" />
                    </FormField>

                    <FormField v-if="userId" label="User's JWT roles">
                        <div class="sim-jwt-roles">
                            <Spinner v-if="rolesLoading" />
                            <span v-else-if="rolesError" class="sim-jwt-roles__error">
                                {{ rolesError }}
                            </span>
                            <template v-else-if="actualRoles.length">
                                <span
                                    v-for="r in actualRoles"
                                    :key="r"
                                    class="sim-jwt-roles__chip"
                                >
                                    {{ r }}
                                </span>
                            </template>
                            <span v-else class="sim-jwt-roles__empty">
                                No built-in roles granted in Zitadel
                            </span>
                        </div>
                    </FormField>

                    <Collapse title="What-if: override JWT roles">
                        <FormField
                            label="Roles to use instead"
                            hint="Leave empty to simulate a user with no JWT roles"
                        >
                            <ChipInput
                                v-model="rolesOverride"
                                :suggestions="AUTHZ_SYSTEM_PERSONA_KEYS"
                                placeholder="admin, installer …"
                            />
                        </FormField>
                        <Checkbox
                            v-model="overrideEnabled"
                            label="Use override instead of actual JWT roles"
                            hint="Off = simulate with the user's real roles"
                        />
                    </Collapse>

                    <Collapse title="Request context (MFA, IP, time)">
                        <div class="sim-context">
                            <Checkbox
                                v-model="mfaPresent"
                                label="Token has MFA factor"
                                hint="amr claim includes mfa"
                            />
                            <FormField label="Source IP">
                                <Input
                                    v-model="sourceIp"
                                    placeholder="10.0.0.42 or ::1"
                                />
                            </FormField>
                            <FormField label="Now (for time-window gate)">
                                <Input v-model="nowLocal" type="datetime-local" />
                            </FormField>
                        </div>
                    </Collapse>

                    <div class="sim-actions">
                        <Button
                            type="green"
                            :disabled="!canSubmit || running"
                            @click="run"
                        >
                            <i class="fas fa-bolt" /> Simulate
                        </Button>
                    </div>
                </div>
            </BasicBlock>

            <!-- RIGHT: result -->
            <BasicBlock darker title="Result" class="sim-result-block">
                <div v-if="error" class="sim-error">
                    <i class="fas fa-exclamation-triangle" />
                    <span>{{ error }}</span>
                </div>

                <div v-else-if="running" class="sim-state">
                    <Spinner />
                    <span>Running simulation…</span>
                </div>

                <div v-else-if="result" class="sim-result">
                    <!-- Hero verdict -->
                    <div
                        class="sim-hero"
                        :class="result.decision
                            ? 'sim-hero--allow'
                            : 'sim-hero--deny'"
                    >
                        <i
                            class="sim-hero__icon"
                            :class="result.decision
                                ? 'fas fa-check-circle'
                                : 'fas fa-times-circle'"
                        />
                        <div class="sim-hero__main">
                            <div class="sim-hero__verdict">
                                {{ result.decision ? 'Allow' : 'Deny' }}
                            </div>
                            <div class="sim-hero__detail">
                                <code>{{ action }}</code> on
                                <code>{{ resourceType }}</code
                                ><span v-if="resourceId.trim() && resourceId !== '*'">
                                    (<code>{{ resourceId }}</code
                                    >)</span
                                >
                            </div>
                        </div>
                    </div>

                    <!-- Matched-by trace -->
                    <h3 class="sim-trace__title">
                        Matched by ({{ result.matchedBy.length }})
                    </h3>
                    <div
                        v-if="result.matchedBy.length"
                        class="sim-match-list"
                    >
                        <div
                            v-for="(m, i) in result.matchedBy"
                            :key="i"
                            class="sim-match-card"
                        >
                            <div class="sim-match-card__head">
                                <span
                                    class="sim-match-source"
                                    :class="`sim-match-source--${m.source}`"
                                >
                                    {{ sourceLabel(m.source) }}
                                </span>
                                <code class="sim-match-persona">{{
                                    m.persona
                                }}</code>
                            </div>
                            <div v-if="m.scope" class="sim-match-scope">
                                Scope:
                                <code>{{ formatScope(m.scope) }}</code>
                            </div>
                        </div>
                    </div>
                    <p v-else class="sim-trace__empty">
                        No matching personas — denied by default.
                    </p>
                </div>

                <div v-else class="sim-state sim-state--empty">
                    <i class="fas fa-bolt sim-state__icon" />
                    <p>Run a simulation to see the decision and trace.</p>
                </div>
            </BasicBlock>
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    AUTHZ_ACTION_SUGGESTIONS,
    AUTHZ_RESOURCE_SUGGESTIONS,
    AUTHZ_SYSTEM_PERSONA_KEYS
} from '@api/authzCatalog';
import {storeToRefs} from 'pinia';
import {type ComputedRef, computed, inject, onMounted, ref, watch} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import ChipInput from '@/components/core/ChipInput.vue';
import Collapse from '@/components/core/Collapse.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import Spinner from '@/components/core/Spinner.vue';
import {useAuthStore} from '@/stores/auth';
import {useUsersStore, type ZitadelUser } from '@/stores/users';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

interface SimulationMatch {
    source: 'built-in-jwt' | 'group-assignment' | 'user-assignment';
    persona: string;
    scope?: Record<string, unknown>;
}

interface SimulationResult {
    decision: boolean;
    matchedBy: SimulationMatch[];
}

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

const usersStore = useUsersStore();
const authStore = useAuthStore();
const {canAccessPlatformAdmin} = storeToRefs(authStore);
const serviceUsers = ref<ZitadelUser[]>([]);
const users = computed(() => {
    const humans = usersStore.users.map((u) => ({
        ...u,
        kind: 'human' as const
    }));
    const services = serviceUsers.value.map((u) => ({
        ...u,
        kind: 'service' as const
    }));
    return [...humans, ...services].sort((a, b) =>
        a.userName.localeCompare(b.userName)
    );
});

// Dropdown takes flat T[] — build the option lists once.
const ACTION_OPTIONS = [...AUTHZ_ACTION_SUGGESTIONS];
const RESOURCE_OPTIONS = [...AUTHZ_RESOURCE_SUGGESTIONS];

const userId = ref('');
const action = ref('device:read');
const resourceType = ref('device');
const resourceId = ref('*');
const actualRoles = ref<string[]>([]);
const rolesLoading = ref(false);
const rolesError = ref<string | null>(null);
const overrideEnabled = ref(false);
const rolesOverride = ref<string[]>([]);
const mfaPresent = ref(false);
const sourceIp = ref('');
const nowLocal = ref('');

const running = ref(false);
const result = ref<SimulationResult | null>(null);
const error = ref<string | null>(null);

const canSubmit = computed(
    () => !!userId.value && !!action.value.trim() && !!resourceType.value.trim()
);

async function fetchServiceUsers(): Promise<void> {
    // Service users are instance-wide; skip without provider support so we
    // do not produce a noisy backend 403.
    if (!canAccessPlatformAdmin.value) return;
    try {
        const result = await sendRPC<{items: ZitadelUser[]}>(
            'FLEET_MANAGER',
            'User.ListServiceUsers',
            {}
        );
        serviceUsers.value = (result?.items ?? []).filter((u) => !!u.userId);
    } catch {
        // Non-fatal — humans-only is still useful.
    }
}

onMounted(() => {
    if (usersStore.zitadelAvailable && usersStore.users.length === 0) {
        void usersStore.fetchUsers();
    }
    void fetchServiceUsers();
});

watch(userId, (id) => {
    actualRoles.value = [];
    rolesError.value = null;
    if (!id) return;
    void loadActualRoles(id);
});

async function loadActualRoles(id: string): Promise<void> {
    rolesLoading.value = true;
    rolesError.value = null;
    try {
        const res = await sendRPC<{userId: string; roleKeys: string[]}>(
            'FLEET_MANAGER',
            'permission.GetRoles',
            {userId: id}
        );
        if (userId.value !== id) return;
        actualRoles.value = res.roleKeys ?? [];
    } catch (err) {
        if (userId.value !== id) return;
        rolesError.value = err instanceof Error ? err.message : String(err);
    } finally {
        if (userId.value === id) rolesLoading.value = false;
    }
}

function localToEpoch(local: string): number | null {
    if (!local) return null;
    const t = new Date(local).getTime();
    return Number.isFinite(t) ? t : null;
}

async function run(): Promise<void> {
    if (!canSubmit.value || running.value) return;
    error.value = null;
    result.value = null;
    running.value = true;
    try {
        const params: Record<string, unknown> = {
            userId: userId.value,
            action: action.value.trim(),
            resourceType: resourceType.value.trim()
        };
        if (resourceId.value.trim())
            params.resourceId = resourceId.value.trim();
        if (overrideEnabled.value) params.builtInRoles = rolesOverride.value;

        const ctx: Record<string, unknown> = {};
        if (mfaPresent.value) ctx.mfaPresent = true;
        if (sourceIp.value.trim()) ctx.sourceIp = sourceIp.value.trim();
        const nowMs = localToEpoch(nowLocal.value);
        if (nowMs !== null) ctx.now = nowMs;
        if (Object.keys(ctx).length > 0) params.context = ctx;

        result.value = await sendRPC<SimulationResult>(
            'FLEET_MANAGER',
            'User.SimulateV2',
            params
        );
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        running.value = false;
    }
}

function sourceLabel(s: SimulationMatch['source']): string {
    switch (s) {
        case 'built-in-jwt':
            return 'JWT role';
        case 'group-assignment':
            return 'Group';
        case 'user-assignment':
            return 'Direct';
    }
}

function formatScope(scope: Record<string, unknown>): string {
    return JSON.stringify(scope);
}
</script>

<style scoped>
.sim-shell {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    padding-top: var(--space-3);
}
@media (min-width: 1024px) {
    .sim-shell {
        grid-template-columns: var(--split-minor) 1fr;
        align-items: start;
    }
}
.sim-form,
.sim-context {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.sim-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
}
.sim-row > * {
    flex: 1 1 var(--space-20);
    min-width: 0;
}
/* Native <select> styled to match the input system. */
.sim-input {
    width: 100%;
    min-height: var(--touch-target-min);
    padding: var(--input-padding) var(--space-3);
    background-color: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--input-radius);
    color: var(--color-text-primary);
    font-size: var(--input-font-size);
    transition: border-color var(--duration-fast),
        box-shadow var(--duration-fast);
}
.sim-input:hover {
    border-color: var(--input-border-hover);
}
.sim-input:focus {
    outline: none;
    border-color: var(--input-focus-ring);
    box-shadow: 0 0 0 var(--focus-ring-width)
        rgba(var(--color-primary-rgb), 0.25);
}
.sim-jwt-roles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target-min);
    padding: var(--input-padding) var(--space-3);
    background-color: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--input-radius);
}
.sim-jwt-roles__chip {
    display: inline-flex;
    align-items: center;
    padding: var(--space-px) var(--space-2);
    border-radius: var(--radius-full);
    background-color: var(--color-primary-subtle);
    color: var(--color-primary-text);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
}
.sim-jwt-roles__empty {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.sim-jwt-roles__error {
    color: var(--color-danger-text);
    font-size: var(--type-caption);
}
.sim-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-2);
}
.sim-error {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-danger-subtle);
    color: var(--color-danger-text);
}
.sim-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-8);
    color: var(--color-text-tertiary);
}
.sim-state--empty {
    flex-direction: column;
    text-align: center;
}
.sim-state__icon {
    font-size: var(--icon-size-xl);
    opacity: 0.4;
}

/* Hero verdict — large pass/fail signal. */
.sim-hero {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    border: 1px solid transparent;
    margin-bottom: var(--space-5);
}
.sim-hero--allow {
    background-color: var(--color-success-subtle);
    border-color: color-mix(
        in srgb,
        var(--color-success-text) 30%,
        transparent
    );
    color: var(--color-success-text);
}
.sim-hero--deny {
    background-color: var(--color-danger-subtle);
    border-color: color-mix(
        in srgb,
        var(--color-danger-text) 30%,
        transparent
    );
    color: var(--color-danger-text);
}
.sim-hero__icon {
    font-size: var(--icon-size-xl);
    flex-shrink: 0;
}
.sim-hero__main {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}
.sim-hero__verdict {
    font-size: var(--type-subheading);
    font-weight: var(--font-bold);
    line-height: var(--leading-tight);
}
.sim-hero__detail {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.sim-hero__detail code {
    color: var(--color-text-primary);
    font-family: var(--font-mono);
}

/* Matched-by trace */
.sim-trace__title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    margin: 0 0 var(--space-3);
}
.sim-match-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.sim-match-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
}
.sim-match-card__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.sim-match-source {
    display: inline-flex;
    align-items: center;
    padding: var(--space-px) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    background-color: var(--color-surface-3);
    color: var(--color-text-tertiary);
}
.sim-match-source--built-in-jwt {
    background-color: var(--color-info-subtle);
    color: var(--color-info-text);
}
.sim-match-source--group-assignment {
    background-color: var(--color-accent-subtle);
    color: var(--color-accent-text);
}
.sim-match-source--user-assignment {
    background-color: var(--color-success-subtle);
    color: var(--color-success-text);
}
.sim-match-persona {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--color-text-primary);
}
.sim-match-scope {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.sim-match-scope code {
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
}
.sim-trace__empty {
    color: var(--color-text-quaternary);
    font-style: italic;
}
</style>
