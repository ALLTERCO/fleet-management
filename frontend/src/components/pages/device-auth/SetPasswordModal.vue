<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>Set device password</template>

        <div class="spw">
            <template v-if="!results">
                <p class="spw__hint">
                    Sets the web-UI password for the <b>admin</b> user on the
                    chosen devices (pushed via Shelly.SetAuth). It does not affect
                    Fleet Manager's own connection.
                </p>

                <DeviceSelector v-if="!presetDevices" v-model="selectedDevices" />
                <p v-if="errors.devices" class="spw__error">{{ errors.devices }}</p>

                <div v-if="selectedDevices.length > 1" class="spw__mode">
                    <button
                        type="button"
                        class="spw__mode-btn"
                        :class="{'spw__mode-btn--on': mode === 'shared'}"
                        @click="mode = 'shared'"
                    >
                        One shared password
                    </button>
                    <button
                        type="button"
                        class="spw__mode-btn"
                        :class="{'spw__mode-btn--on': mode === 'unique'}"
                        @click="mode = 'unique'"
                    >
                        Unique per device
                    </button>
                </div>

                <FormField
                    v-if="effectiveMode === 'shared'"
                    label="Password"
                    :error="errors.password"
                    hint="8–200 characters (Fleet Manager's rule)."
                >
                    <div class="spw__pw">
                        <div class="spw__pw-field">
                            <Input
                                v-model="password"
                                :type="show ? 'text' : 'password'"
                                placeholder="Type a password, or generate one"
                            />
                        </div>
                        <button
                            type="button"
                            class="spw__icon-btn"
                            :title="show ? 'Hide' : 'Show'"
                            @click="show = !show"
                        >
                            <i :class="show ? 'fas fa-eye-slash' : 'fas fa-eye'" />
                        </button>
                        <Button type="blue-hollow" size="sm" @click="generate">
                            Generate
                        </Button>
                    </div>
                </FormField>
                <p v-else class="spw__hint">
                    A unique strong password is generated for each device. You get
                    the full list once it's done.
                </p>

                <p v-if="errors.submit" class="spw__error">
                    {{ errors.submit }}
                </p>
                <div class="spw__actions">
                    <Button type="blue-hollow" @click="emit('close')">Cancel</Button>
                    <Button
                        type="green"
                        :loading="saving"
                        :disabled="selectedDevices.length === 0"
                        @click="submit"
                    >
                        Set password ({{ selectedDevices.length }})
                    </Button>
                </div>
            </template>

            <template v-if="results">
                <template v-if="resultMode === 'shared'">
                    <SecretReveal
                        :token="results[0].password"
                        copy-label="Copy password"
                        @copy="copySharedPassword"
                    />
                    <p class="spw__hint">
                        Set on <b>{{ results.length }}</b> device{{ results.length === 1 ? '' : 's' }}. Shown once — copy it now.
                    </p>
                </template>
                <template v-else>
                    <p class="spw__hint">
                        Set on <b>{{ results.length }}</b> devices, each with its own
                        password. Download the list now — it is shown only once.
                    </p>
                    <PasswordResultList :rows="results" />
                </template>
                <template v-if="failures.length > 0">
                    <p class="spw__error">
                        Failed on <b>{{ failures.length }}</b> device{{ failures.length === 1 ? '' : 's' }} — the old password is still in place there:
                    </p>
                    <div class="spw__list">
                        <div v-for="f in failures" :key="f.deviceId" class="spw__row">
                            <span class="spw__row-id">{{ f.deviceId }}</span>
                            <span class="spw__row-err">{{ f.error }}</span>
                        </div>
                    </div>
                </template>
                <div class="spw__actions">
                    <Button type="green" @click="emit('close')">Done</Button>
                </div>
            </template>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import DeviceSelector from '@/components/core/DeviceSelector.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import SecretReveal from '@/components/core/SecretReveal.vue';
import Modal from '@/components/modals/Modal.vue';
import PasswordResultList from '@/components/pages/device-auth/PasswordResultList.vue';
import {copyText} from '@/helpers/clipboard';
import {
    type CredentialSetFailure,
    useCredentialsStore
} from '@/stores/credentials';
import {useToastStore} from '@/stores/toast';

const props = defineProps<{
    visible: boolean;
    /** Locks the target list to these devices and hides the selector. */
    presetDevices?: string[];
}>();
const emit = defineEmits<{close: []; saved: []}>();

const store = useCredentialsStore();
const toast = useToastStore();

const selectedDevices = ref<string[]>([]);
const mode = ref<'shared' | 'unique'>('shared');
const password = ref('');
const show = ref(false);
const saving = ref(false);
const errors = reactive({devices: '', password: '', submit: ''});
const results = ref<Array<{deviceId: string; password: string}> | null>(null);
const failures = ref<CredentialSetFailure[]>([]);
const resultMode = ref<'shared' | 'unique'>('shared');

// One device: nothing to share, so the flow is always 'shared'.
const effectiveMode = computed<'shared' | 'unique'>(() =>
    selectedDevices.value.length <= 1 ? 'shared' : mode.value
);

// Client-side strong password using the Web Crypto API. Shelly imposes no
// length limit (SetAuth stores a SHA256 ha1, not the plaintext); 24 chars.
const GEN_LENGTH = 24;
const GEN_CHARSET =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
function generatePassword(length: number): string {
    const bytes = new Uint32Array(length);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += GEN_CHARSET[bytes[i] % GEN_CHARSET.length];
    }
    return out;
}

function generate(): void {
    password.value = generatePassword(GEN_LENGTH);
    show.value = true;
}

async function submit(): Promise<void> {
    errors.devices = '';
    errors.password = '';
    errors.submit = '';
    if (selectedDevices.value.length === 0) {
        errors.devices = 'Pick at least one device.';
        return;
    }
    if (
        effectiveMode.value === 'shared' &&
        (password.value.length < 8 || password.value.length > 200)
    ) {
        errors.password = 'Password must be 8–200 characters.';
        return;
    }

    const items = selectedDevices.value.map((deviceId) => ({
        deviceId,
        password:
            effectiveMode.value === 'shared'
                ? password.value
                : generatePassword(GEN_LENGTH)
    }));

    saving.value = true;
    const {succeeded, failed} = await store.setMany(items);
    saving.value = false;

    if (succeeded.length === 0) {
        errors.submit =
            failed.length === 1
                ? failed[0].error
                : `Failed on all ${failed.length} devices — no passwords were changed.`;
        return;
    }
    resultMode.value = effectiveMode.value;
    results.value = succeeded.map((r) => ({
        deviceId: r.deviceId,
        password: r.password
    }));
    failures.value = failed;
    emit('saved');
}

async function copySharedPassword(): Promise<void> {
    if (!results.value?.length) return;
    const ok = await copyText(results.value[0].password);
    if (ok) toast.info('Password copied.');
    else toast.error('Could not copy — select and copy it manually.');
}

watch(
    () => props.visible,
    (open) => {
        if (open && props.presetDevices) {
            selectedDevices.value = [...props.presetDevices];
            return;
        }
        if (!open) {
            selectedDevices.value = [];
            mode.value = 'shared';
            password.value = '';
            show.value = false;
            saving.value = false;
            results.value = null;
            failures.value = [];
            errors.devices = '';
            errors.password = '';
            errors.submit = '';
        }
    }
);
</script>

<style scoped>
.spw {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
.spw__hint {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.spw__error {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-danger-text);
}
.spw__mode {
    display: flex;
    gap: var(--space-2);
}
.spw__mode-btn {
    flex: 1;
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 2px solid var(--color-border-medium);
    border-radius: var(--btn-radius);
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
}
.spw__mode-btn--on {
    background: var(--color-surface-4);
    border-color: var(--color-primary);
    color: var(--color-text-primary);
}
.spw__pw {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.spw__pw-field {
    min-width: 0;
    flex: 1;
}
.spw__icon-btn {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    flex: none;
    display: grid;
    place-items: center;
    background: none;
    border: 1px solid var(--color-border-medium);
    border-radius: var(--btn-radius);
    color: var(--color-text-secondary);
    cursor: pointer;
}
.spw__icon-btn:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
}
.spw__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 240px;
    overflow-y: auto;
    padding: var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
}
.spw__row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
}
.spw__row-id {
    color: var(--color-text-tertiary);
}
.spw__row-pw {
    color: var(--color-text-primary);
}
.spw__row-err {
    color: var(--color-danger-text);
    text-align: right;
}
.spw__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
}
</style>
