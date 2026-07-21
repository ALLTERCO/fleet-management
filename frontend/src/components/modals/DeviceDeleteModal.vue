<script setup lang="ts">
import {ref, watch} from 'vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import BasicBlock from '../core/BasicBlock.vue';
import Button from '../core/Button.vue';
import Input from '../core/Input.vue';
import Modal from './Modal.vue';

const props = defineProps<{
    visible: boolean;
    shellyID: string;
    deviceName: string;
}>();

const emit = defineEmits<{
    close: [];
    done: [mode: 'retire' | 'purge'];
}>();

const toast = useToastStore();
const busy = ref<'retire' | 'purge' | null>(null);
const purgeInput = ref('');
const error = ref<string | null>(null);

watch(
    () => props.visible,
    (open) => {
        if (!open) {
            busy.value = null;
            purgeInput.value = '';
            error.value = null;
        }
    }
);

async function run(mode: 'retire' | 'purge', method: string): Promise<void> {
    if (busy.value) return;
    busy.value = mode;
    error.value = null;
    try {
        await ws.sendRPC('FLEET_MANAGER', method, {shellyID: props.shellyID});
        toast.success(mode === 'retire' ? 'Device retired' : 'Device deleted');
        emit('done', mode);
    } catch (err) {
        error.value = rpcErrorMessage(err, 'Action failed');
    } finally {
        busy.value = null;
    }
}

function handleClose(): void {
    if (busy.value) return;
    emit('close');
}
</script>

<template>
    <Modal :visible="visible" @close="handleClose">
        <template #title>Delete device</template>

        <div class="ddm">
            <p class="ddm__lead">
                How do you want to remove <strong>{{ deviceName }}</strong>?
            </p>

            <BasicBlock padding="md">
                <div class="ddm__opt">
                    <div class="ddm__opt-text">
                        <strong>Retire</strong>
                        <span>
                            Hide it from your fleet but keep its ID and full
                            history. You can restore it at any time.
                        </span>
                    </div>
                    <Button
                        type="blue"
                        :loading="busy === 'retire'"
                        :disabled="busy !== null"
                        @click="run('retire', 'device.Retire')"
                    >
                        Retire
                    </Button>
                </div>
            </BasicBlock>

            <BasicBlock darker padding="md">
                <div class="ddm__opt ddm__opt--danger">
                    <div class="ddm__opt-text">
                        <strong>Delete permanently</strong>
                        <span>
                            Erase this device and all of its history for good.
                            This cannot be undone.
                        </span>
                    </div>
                    <div class="ddm__purge">
                        <Input
                            v-model="purgeInput"
                            placeholder="Type DELETE to confirm"
                            custom-class="text-center"
                        />
                        <Button
                            type="red"
                            :loading="busy === 'purge'"
                            :disabled="purgeInput !== 'DELETE' || busy !== null"
                            @click="run('purge', 'device.Delete')"
                        >
                            Delete permanently
                        </Button>
                    </div>
                </div>
            </BasicBlock>

            <p v-if="error" class="ddm__error" role="alert">{{ error }}</p>
        </div>

        <template #footer>
            <Button
                type="blue-hollow"
                :disabled="busy !== null"
                @click="handleClose"
            >
                Cancel
            </Button>
        </template>
    </Modal>
</template>

<style scoped>
.ddm {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
}
.ddm__lead {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.ddm__opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
}
.ddm__opt-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.ddm__opt-text strong {
    font-size: var(--type-body);
    color: var(--color-text-primary);
}
.ddm__opt-text span {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.ddm__opt--danger .ddm__opt-text strong {
    color: var(--color-danger-text);
}
.ddm__purge {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: stretch;
    min-width: 12rem;
}
.ddm__error {
    font-size: var(--type-caption);
    color: var(--color-danger-text);
}
</style>
