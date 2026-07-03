<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import BasicBlock from '../core/BasicBlock.vue';
import Button from '../core/Button.vue';
import Input from '../core/Input.vue';
import Modal from './Modal.vue';

export interface ConfirmOptions {
    title?: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    secured?: boolean;
}

const {secured: defaultSecured, footer: _footer} = defineProps<{
    secured?: boolean;
    footer?: boolean;
}>();
const emit = defineEmits(['close', 'confirmAction']);

const visible = ref(false);
const pendingAction = ref<(() => void | Promise<void>) | null>(null);
const callOpts = ref<ConfirmOptions | null>(null);
const deletionInput = ref('');
const executing = ref(false);

const effectiveSecured = computed(
    () => callOpts.value?.secured ?? defaultSecured ?? false
);

const isDeletionConfirmed = computed(
    () => !effectiveSecured.value || deletionInput.value === 'DELETE'
);

// Reject re-entry while a confirmation is already open or executing so a
// stale pendingAction can't be silently overwritten (and confirmed) under
// a label the user is no longer looking at.
function storeAction(
    action: () => void | Promise<void>,
    opts?: ConfirmOptions
): boolean {
    if (visible.value || executing.value) return false;
    pendingAction.value = action;
    callOpts.value = opts ?? null;
    visible.value = true;
    return true;
}

async function handleConfirm() {
    if (!pendingAction.value || !isDeletionConfirmed.value || executing.value)
        return;
    executing.value = true;
    try {
        await pendingAction.value();
    } finally {
        executing.value = false;
    }
    emit('confirmAction');
    visible.value = false;
}

function handleClose() {
    // Ignore close (ESC, backdrop) while the action is in flight so the
    // user can't fire a second confirmation against the now-stale row.
    if (executing.value) return;
    visible.value = false;
    emit('close');
}

watch(visible, (newVal) => {
    if (!newVal) {
        pendingAction.value = null;
        callOpts.value = null;
        deletionInput.value = '';
    }
});

defineExpose({storeAction});
</script>

<template>
    <Modal :visible="visible" @close="handleClose">
        <template #title>
            {{ callOpts?.title ?? 'Confirmation' }}
        </template>

        <div class="cm">
            <slot name="title">
                <h3 v-if="callOpts?.title || callOpts?.message">
                    {{ callOpts?.title ?? 'Are you sure?' }}
                </h3>
                <h3 v-else>Are you sure?</h3>
            </slot>

            <p v-if="callOpts?.message" class="cm__message">
                {{ callOpts.message }}
            </p>

            <div v-if="effectiveSecured" class="cm__secured">
                <BasicBlock darker padding="md">
                    <div class="cm__secured-inner">
                        <p class="cm__secured-text">
                            To confirm deletion, please type
                            <span class="cm__secured-keyword">DELETE</span>
                            in the field below.
                        </p>
                        <Input
                            v-model="deletionInput"
                            placeholder="Type DELETE to confirm"
                            custom-class="font-bold text-center"
                        />
                    </div>
                </BasicBlock>
            </div>

            <slot name="subText" />
        </div>

        <template #footer>
            <div class="cm__footer">
                <Button
                    type="blue-hollow"
                    :disabled="executing"
                    @click="handleClose"
                >
                    {{ callOpts?.cancelLabel ?? 'Cancel' }}
                </Button>
                <Button
                    type="red"
                    :disabled="!isDeletionConfirmed || executing"
                    :loading="executing"
                    @click="handleConfirm"
                >
                    {{
                        executing
                            ? 'Processing...'
                            : (callOpts?.confirmLabel ?? 'Confirm')
                    }}
                </Button>
            </div>
        </template>
    </Modal>
</template>

<style scoped>
.cm {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: center;
    justify-content: center;
    padding: var(--space-3);
}
.cm__message {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    text-align: center;
}
.cm__secured {
    width: 100%;
}
.cm__secured-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
}
.cm__secured-text {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-2);
}
.cm__secured-keyword {
    font-weight: var(--font-bold);
    color: var(--color-danger-text);
}
.cm__footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
}
</style>
