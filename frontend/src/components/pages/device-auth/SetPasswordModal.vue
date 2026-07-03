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

                <DeviceSelector v-model="selectedDevices" />
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
                    v-if="mode === 'shared'"
                    label="Password"
                    :error="errors.password"
                    hint="8–200 characters (Fleet Manager's rule)."
                >
                    <div class="spw__pw">
                        <Input
                            v-model="password"
                            :type="show ? 'text' : 'password'"
                            placeholder="Type a password, or generate one"
                        />
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
                    <SecretReveal :token="results[0].password" copy-label="Copy password" />
                    <p class="spw__hint">
                        Set on <b>{{ results.length }}</b> device{{ results.length === 1 ? '' : 's' }}. Shown once — copy it now.
                    </p>
                </template>
                <template v-else>
                    <p class="spw__hint">
                        Set on <b>{{ results.length }}</b> devices, each with its own
                        password. Download the list now — it is shown only once.
                    </p>
                    <div class="spw__list">
                        <div v-for="r in results" :key="r.deviceId" class="spw__row">
                            <span class="spw__row-id">{{ r.deviceId }}</span>
                            <span class="spw__row-pw">{{ r.password }}</span>
                        </div>
                    </div>
                    <Button type="blue-hollow" size="sm" @click="downloadCsv">
                        <i class="fas fa-download" /> Download CSV
                    </Button>
                </template>
                <div class="spw__actions">
                    <Button type="green" @click="emit('close')">Done</Button>
                </div>
            </template>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import {reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import DeviceSelector from '@/components/core/DeviceSelector.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import SecretReveal from '@/components/core/SecretReveal.vue';
import Modal from '@/components/modals/Modal.vue';
import {useCredentialsStore} from '@/stores/credentials';

const props = defineProps<{visible: boolean}>();
const emit = defineEmits<{close: []; saved: []}>();

const store = useCredentialsStore();

const selectedDevices = ref<string[]>([]);
const mode = ref<'shared' | 'unique'>('shared');
const password = ref('');
const show = ref(false);
const saving = ref(false);
const errors = reactive({devices: '', password: ''});
const results = ref<Array<{deviceId: string; password: string}> | null>(null);
const resultMode = ref<'shared' | 'unique'>('shared');

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
    if (selectedDevices.value.length === 0) {
        errors.devices = 'Pick at least one device.';
        return;
    }
    const single = selectedDevices.value.length === 1;
    const useMode = single ? 'shared' : mode.value;
    if (
        useMode === 'shared' &&
        (password.value.length < 8 || password.value.length > 200)
    ) {
        errors.password = 'Password must be 8–200 characters.';
        return;
    }

    saving.value = true;
    const out: Array<{deviceId: string; password: string}> = [];
    for (const deviceId of selectedDevices.value) {
        const pw = useMode === 'shared' ? password.value : generatePassword(GEN_LENGTH);
        const r = await store.setOne({deviceId, password: pw});
        if (r) out.push({deviceId: r.deviceId, password: r.password});
    }
    saving.value = false;

    if (out.length > 0) {
        resultMode.value = useMode;
        results.value = out;
        emit('saved');
    }
}

function csvCell(v: string): string {
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function downloadCsv(): void {
    if (!results.value) return;
    const rows = [
        ['device', 'password'],
        ...results.value.map((r) => [r.deviceId, r.password])
    ];
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'device-passwords.csv';
    a.click();
    URL.revokeObjectURL(url);
}

watch(
    () => props.visible,
    (open) => {
        if (!open) {
            selectedDevices.value = [];
            mode.value = 'shared';
            password.value = '';
            show.value = false;
            saving.value = false;
            results.value = null;
            errors.devices = '';
            errors.password = '';
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
.spw__pw :deep(.form-input),
.spw__pw :deep(input) {
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
.spw__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
}
</style>
