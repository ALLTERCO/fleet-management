<template>
    <Modal :visible="visible" @close="close">
        <template #title>Add a device</template>

        <div v-if="!done" class="ig-form">
            <template v-if="mode === 'token'">
                <p class="qtm__hint">
                    One-time link. The device has this long to connect with it —
                    no device id needed up front.
                </p>
                <label class="ig-field">
                    <span>Security profile</span>
                    <select v-model="tokenProfileId" class="ig-select">
                        <option value="">WSS + token (recommended)</option>
                        <option
                            v-for="p in tokenProfiles"
                            :key="p.id"
                            :value="p.id"
                        >
                            {{ p.name }}
                        </option>
                    </select>
                </label>
                <label class="ig-field">
                    <span>Device has this long to connect</span>
                    <select v-model.number="minutes" class="ig-select">
                        <option :value="15">15 minutes</option>
                        <option :value="60">1 hour</option>
                        <option :value="1440">24 hours</option>
                    </select>
                </label>
            </template>

            <template v-else>
                <p class="qtm__hint">
                    Issues a certificate for one device. Download the bundle and
                    upload it to that device — it then connects over mTLS. The
                    private key is shown once.
                </p>
                <label class="ig-field">
                    <span>Device ID</span>
                    <input
                        v-model.trim="externalId"
                        class="ig-select"
                        placeholder="e.g. shellypro4pm-aabbcc112233"
                    />
                </label>
                <label class="ig-field">
                    <span>Security profile</span>
                    <!-- A dropdown only earns its place with a real choice. -->
                    <select
                        v-if="certProfiles.length > 1"
                        v-model="certProfileId"
                        class="ig-select"
                    >
                        <option value="">Select a certificate profile</option>
                        <option
                            v-for="p in certProfiles"
                            :key="p.id"
                            :value="p.id"
                        >
                            {{ p.name }}
                        </option>
                    </select>
                    <span v-else-if="certProfiles.length === 1" class="qtm__static">
                        {{ certProfiles[0].name }}
                    </span>
                    <span v-else class="qtm__static">
                        No certificate profile configured
                    </span>
                </label>
            </template>
        </div>

        <IngressSetupLink
            v-else-if="tokenResult"
            :url="tokenResult.url"
            :token="tokenResult.tokenOnce"
            :expires-at="tokenResult.expiresAt"
        />

        <div v-else-if="certResult" class="qtm__cert">
            <p class="qtm__hint">
                Upload these to <strong>{{ externalId }}</strong
                >. The private key won't be shown again.
            </p>
            <div class="qtm__downloads">
                <Button
                    type="blue-hollow"
                    size="sm"
                    @click="download('device-cert.pem', certResult.clientCertPem)"
                >
                    <i class="fas fa-download" aria-hidden="true" /> Certificate
                </Button>
                <Button
                    v-if="certResult.clientKeyPem"
                    type="blue-hollow"
                    size="sm"
                    @click="download('device-key.pem', certResult.clientKeyPem)"
                >
                    <i class="fas fa-download" aria-hidden="true" /> Private key
                </Button>
                <Button
                    type="blue-hollow"
                    size="sm"
                    @click="download('fm-ca.pem', certResult.userCaPem)"
                >
                    <i class="fas fa-download" aria-hidden="true" /> CA
                </Button>
            </div>
        </div>

        <template #footer>
            <div class="ig-foot">
                <Button type="blue-hollow" @click="close">
                    {{ done ? 'Done' : 'Cancel' }}
                </Button>
                <span class="ig-foot__spacer" />
                <Button
                    v-if="!done"
                    type="blue"
                    :loading="saving"
                    :disabled="!canGenerate"
                    @click="generate"
                >
                    Generate
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import type {DeviceIngressProfileId} from '@api/deviceIngress';
import {computed, ref, watch} from 'vue';
import {
    type CertEnrollment,
    createCertificateEnrollment,
    createEnrollmentToken,
    type EnrollmentToken,
    type IngressProfile,
    listProfiles
} from '@/api/deviceIngressRpc';
import Button from '@/components/core/Button.vue';
import IngressSetupLink from '@/components/ingress/IngressSetupLink.vue';
import Modal from '@/components/modals/Modal.vue';
import {useIngressMutation} from '@/composables/useIngressMutation';

const props = defineProps<{visible: boolean}>();
const emit = defineEmits<{close: []}>();

const {saving, run} = useIngressMutation();

const mode = ref<'token' | 'certificate'>('token');
const minutes = ref(15);
const tokenProfileId = ref<DeviceIngressProfileId | ''>('');
const certProfileId = ref<DeviceIngressProfileId | ''>('');
const externalId = ref('');
const profiles = ref<IngressProfile[]>([]);
const tokenResult = ref<EnrollmentToken | null>(null);
const certResult = ref<CertEnrollment | null>(null);

// A token modal must only offer token profiles; cert mode only cert profiles.
const tokenProfiles = computed(() =>
    profiles.value.filter((p) => p.securityModel === 'direct_token')
);
const certProfiles = computed(() =>
    profiles.value.filter((p) => p.securityModel === 'certificate')
);

// One cert profile = no choice to make; pre-select it so Generate is ready.
watch(certProfiles, (list) => {
    if (list.length === 1 && certProfileId.value === '') {
        certProfileId.value = list[0].id;
    }
});

const done = computed(
    () => tokenResult.value !== null || certResult.value !== null
);
const canGenerate = computed(
    () =>
        mode.value === 'token' ||
        (externalId.value.length > 0 && certProfileId.value !== '')
);

function generate(): void {
    if (mode.value === 'token') {
        void run(async () => {
            tokenResult.value = await createEnrollmentToken(
                minutes.value,
                tokenProfileId.value || undefined
            );
        }, 'Token ready');
        return;
    }
    void run(async () => {
        certResult.value = await createCertificateEnrollment(
            externalId.value,
            certProfileId.value as DeviceIngressProfileId
        );
    }, 'Certificate ready');
}

function download(filename: string, content: string): void {
    const url = URL.createObjectURL(
        new Blob([content], {type: 'application/x-pem-file'})
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function close(): void {
    emit('close');
}

watch(
    () => props.visible,
    async (open) => {
        if (!open) return;
        mode.value = 'token';
        minutes.value = 15;
        tokenProfileId.value = '';
        certProfileId.value = '';
        externalId.value = '';
        tokenResult.value = null;
        certResult.value = null;
        if (profiles.value.length === 0) {
            profiles.value = await listProfiles()
                .then((r) => r.items)
                .catch(() => []);
        }
    }
);
</script>

<style scoped>
.qtm__hint {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}
.qtm__modes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-sm);
}
.qtm__mode {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--gap-xs);
    min-height: var(--touch-target-min);
    border: 1px solid var(--color-border-default);
    border-radius: var(--btn-radius);
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}
.qtm__mode--active {
    border-color: var(--color-border-focus);
    background: var(--color-surface-2);
}
.qtm__cert {
    display: grid;
    gap: var(--gap-md);
}
.qtm__downloads {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-sm);
}
.qtm__static {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    padding: var(--space-1) 0;
}
</style>
