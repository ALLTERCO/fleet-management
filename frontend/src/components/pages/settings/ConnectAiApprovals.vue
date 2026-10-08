<template>
    <div class="cai-appr">
        <div v-if="canSeeOrganization" class="cai-appr__scope">
            <Switch
                :model-value="showOrganization"
                label="Show everyone in the organization"
                :disabled="approvals.loading"
                data-testid="approvals-org-toggle"
                @update:model-value="setOrganizationView"
            />
            <span class="cai-appr__scope-text" aria-hidden="true">
                Show everyone in the organization
            </span>
        </div>

        <Alert
            v-if="approvals.revokeError"
            type="danger"
            data-testid="approvals-revoke-error"
        >
            {{ approvals.revokeError }}
        </Alert>

        <div
            v-if="approvals.loading && !approvals.items.length"
            class="cai-appr__state"
            role="status"
            data-testid="approvals-loading"
        >
            <Spinner size="xs" />
            Loading remembered approvals…
        </div>

        <Alert
            v-else-if="approvals.error && !approvals.items.length"
            type="danger"
            title="Could not load remembered approvals"
            data-testid="approvals-error"
        >
            {{ approvals.error }}
            <template #action>
                <Button type="blue-hollow" size="sm" @click="reload">
                    Try again
                </Button>
            </template>
        </Alert>

        <p
            v-else-if="approvals.loaded && !approvals.items.length"
            class="cai-appr__state"
            data-testid="approvals-empty"
        >
            {{
                showOrganization
                    ? 'No one in the organization has a remembered approval.'
                    : 'You have no remembered approvals. The AI asks you every time.'
            }}
        </p>

        <template v-else-if="approvals.items.length">
            <p class="cai-appr__count" data-testid="approvals-count">
                {{ approvals.items.length }} of {{ approvals.total }}
            </p>
            <ul class="cai-appr__list" aria-label="Remembered approvals">
                <li
                    v-for="entry in approvals.items"
                    :key="entry.id"
                    class="cai-appr__item"
                    data-testid="approval-item"
                >
                    <div class="cai-appr__what">
                        <span class="cai-appr__method">{{ entry.method }}</span>
                        <span v-if="entry.subject" class="cai-appr__subject">
                            {{ entry.subject }}
                        </span>
                        <span class="cai-appr__meta">
                            <template v-if="showOrganization">
                                {{ entry.username }} ·
                            </template>
                            {{ scopeText(entry) }} · given
                            {{ formatTime(entry.grantedAt) }} · ends
                            {{ formatTime(entry.expiresAt) }}
                        </span>
                    </div>
                    <Button
                        type="red"
                        size="sm"
                        :loading="approvals.revokingId === entry.id"
                        :disabled="approvals.revokingId !== null"
                        :aria-label="`Revoke approval for ${entry.method}`"
                        data-testid="approval-revoke"
                        @click="confirmRevoke(entry)"
                    >
                        Revoke
                    </Button>
                </li>
            </ul>
            <Alert
                v-if="approvals.error"
                type="danger"
                data-testid="approvals-more-error"
            >
                {{ approvals.error }}
            </Alert>
            <Button
                v-if="approvals.hasMore"
                type="blue-hollow"
                size="sm"
                :loading="approvals.loadingMore"
                :disabled="approvals.loading"
                data-testid="approvals-more"
                @click="approvals.fetchMore()"
            >
                Show more
            </Button>
        </template>

        <ConfirmationModal ref="revokeConfirm" />
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import Alert from '@/components/core/Alert.vue';
import Button from '@/components/core/Button.vue';
import Spinner from '@/components/core/Spinner.vue';
import Switch from '@/components/core/Switch.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import {formatTime} from '@/helpers/format';
import {useAuthStore} from '@/stores/auth';
import {type McpApprovalEntry, useMcpApprovalsStore} from '@/stores/mcpApprovals';

const approvals = useMcpApprovalsStore();
const auth = useAuthStore();

// Same permission the backend asks for on scope "organization".
const canSeeOrganization = computed(() =>
    auth.canPerformComponent('organizations', 'update')
);
const showOrganization = computed(
    () => canSeeOrganization.value && approvals.scope === 'organization'
);

const revokeConfirm = ref<InstanceType<typeof ConfirmationModal>>();

function scopeText(entry: McpApprovalEntry): string {
    return entry.scope === 'forever' ? 'Long-term' : 'Short-term';
}

function setOrganizationView(on: boolean): void {
    void approvals.fetchApprovals(on ? 'organization' : 'mine');
}

function reload(): void {
    void approvals.fetchApprovals(showOrganization.value ? 'organization' : 'mine');
}

function confirmRevoke(entry: McpApprovalEntry): void {
    const target = entry.subject ? `${entry.method} on ${entry.subject}` : entry.method;
    revokeConfirm.value?.storeAction(
        async () => {
            await approvals.revokeApproval(entry.id);
        },
        {
            title: 'Revoke this approval?',
            message: `The AI will ask a person again before it runs ${target}.`,
            confirmLabel: 'Revoke'
        }
    );
}

onMounted(() => {
    // A person without the organization permission only ever sees their own.
    void approvals.fetchApprovals(
        approvals.scope === 'organization' && canSeeOrganization.value
            ? 'organization'
            : 'mine'
    );
});
</script>

<style scoped>
.cai-appr {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.cai-appr__scope {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target-min);
}
.cai-appr__scope-text {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.cai-appr__state {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.cai-appr__count {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.cai-appr__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}
.cai-appr__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}
.cai-appr__what {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}
.cai-appr__method {
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    word-break: break-all;
}
.cai-appr__subject {
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    word-break: break-all;
}
.cai-appr__meta {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
</style>
