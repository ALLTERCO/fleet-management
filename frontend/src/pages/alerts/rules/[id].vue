<template>
    <DetailPageLayout
        back-to="/alerts/rules"
        back-label="Back to Rules"
        :loading="loading"
        :missing="!loading && !rule"
        missing-sub="This rule may have been deleted or you don't have access."
    >
        <template v-if="rule">
            <section class="rd-summary">
                <h2 class="rd-name">{{ rule.name }}</h2>
                <div class="rd-summary-actions">
                    <Button
                        v-if="canWrite"
                        type="blue-hollow"
                        narrow
                        @click="editVisible = true"
                    >
                        Edit
                    </Button>
                    <Button v-if="canWrite" type="red" narrow @click="askDelete">
                        Delete
                    </Button>
                </div>
            </section>

            <!-- Shared body — same component the preview popup uses. -->
            <AlertRuleDetailBody :rule="rule" @open-firing="openFiring" />
        </template>

        <EditAlertRuleModal
            v-if="rule"
            v-model="editVisible"
            mode="edit"
            :initial="rule"
            @saved="onEdited"
        />

        <ConfirmationModal ref="deleteConfirmRef">
            <template #title>
                <h3>Delete rule "{{ rule?.name }}"?</h3>
            </template>
        </ConfirmationModal>
    </DetailPageLayout>
</template>

<script setup lang="ts">
import type {AlertRule} from '@api/alert';
import {computed, onMounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import AlertRuleDetailBody from '@/components/core/AlertRuleDetailBody.vue';
import Button from '@/components/core/Button.vue';
import DetailPageLayout from '@/components/core/DetailPageLayout.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import EditAlertRuleModal from '@/components/modals/EditAlertRuleModal.vue';
import {usePermissions} from '@/composables/usePermissions';
import {useAlertsStore} from '@/stores/alerts';

const store = useAlertsStore();
const {canWrite} = usePermissions();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const editVisible = ref(false);
const deleteConfirmRef = ref<InstanceType<typeof ConfirmationModal>>();

const ruleId = computed(() => {
    const params = route.params as Record<
        string,
        string | string[] | undefined
    >;
    const raw = Array.isArray(params.id) ? params.id[0] : params.id;
    const n = Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(n) ? n : null;
});

const rule = computed<AlertRule | null>(() =>
    ruleId.value != null ? (store.rules[ruleId.value] ?? null) : null
);

async function refresh() {
    if (ruleId.value == null) return;
    loading.value = true;
    try {
        await Promise.all([store.fetchRule(ruleId.value), store.fetchKinds()]);
    } finally {
        loading.value = false;
    }
}

onMounted(refresh);
watch(ruleId, refresh);

function onEdited() {
    // Store already updated the row.
}

function openFiring(alertId: number): void {
    void router.push(`/alerts/${alertId}`);
}

function askDelete() {
    if (!rule.value) return;
    deleteConfirmRef.value?.storeAction(async () => {
        const ok = await store.deleteRule(rule.value!.id);
        if (ok) router.push('/alerts/rules');
    });
}
</script>

<style scoped>
.rd-summary {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}
.rd-name {
    margin: 0;
    font-size: var(--type-heading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
    min-width: 0;
}
.rd-summary-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
}
</style>
