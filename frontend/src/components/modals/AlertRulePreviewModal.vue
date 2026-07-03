<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>{{ rule?.name ?? 'Rule' }}</template>

        <!-- Keyed by id so switching rules starts each body fresh. -->
        <AlertRuleDetailBody
            v-if="rule"
            :key="rule.id"
            :rule="rule"
            @open-firing="openFiring"
        />

        <template #footer>
            <div class="arp__foot">
                <Button
                    v-if="canWrite && rule"
                    type="red"
                    size="sm"
                    @click="askDelete"
                >
                    Delete
                </Button>
                <span class="arp__spacer" />
                <Button
                    v-if="canWrite"
                    type="blue-hollow"
                    size="sm"
                    @click="editVisible = true"
                >
                    Edit
                </Button>
            </div>
        </template>
    </Modal>

    <EditAlertRuleModal
        v-if="rule"
        v-model="editVisible"
        mode="edit"
        :initial="rule"
    />
    <ConfirmationModal ref="deleteConfirmRef">
        <template #title><h3>Delete rule "{{ rule?.name }}"?</h3></template>
    </ConfirmationModal>
</template>

<script setup lang="ts">
import type {AlertRule} from '@api/alert';
import {computed, ref} from 'vue';
import {useRouter} from 'vue-router';
import AlertRuleDetailBody from '@/components/core/AlertRuleDetailBody.vue';
import Button from '@/components/core/Button.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import EditAlertRuleModal from '@/components/modals/EditAlertRuleModal.vue';
import Modal from '@/components/modals/Modal.vue';
import {usePermissions} from '@/composables/usePermissions';
import {useAlertsStore} from '@/stores/alerts';

const props = defineProps<{
    visible: boolean;
    ruleId: number | null;
}>();
const emit = defineEmits<{close: []}>();

const store = useAlertsStore();
const router = useRouter();
const {canWrite} = usePermissions();

const rule = computed<AlertRule | null>(() =>
    props.ruleId != null ? (store.rules[props.ruleId] ?? null) : null
);

const editVisible = ref(false);
const deleteConfirmRef = ref<InstanceType<typeof ConfirmationModal>>();

function openFiring(alertId: number): void {
    emit('close');
    void router.push(`/alerts?instance=${alertId}`);
}

function askDelete(): void {
    if (!rule.value) return;
    const id = rule.value.id;
    deleteConfirmRef.value?.storeAction(async () => {
        const ok = await store.deleteRule(id);
        if (ok) emit('close');
    });
}
</script>

<style scoped>
.arp__foot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
}
.arp__spacer {
    flex: 1;
}
</style>
