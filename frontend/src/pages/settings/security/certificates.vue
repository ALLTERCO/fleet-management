<template>
    <PageTemplate
        fill
        v-model:search="search"
        title="Certificates"
        :count="certificatesCountLabel"
        :tabs="tabs"
        searchable
        search-placeholder="Search certificates…"
        filterable
        :has-active-filter="activeFilterCount > 0"
        :filter-count="activeFilterCount === 0 ? undefined : activeFilterCount"
        @filter-click="filterVisible = true"
    >
        <template #toggles>
            <DeviceAuthSubTabs />
        </template>

        <template #actions>
            <Button
                type="green"
                narrow
                title="New certificate"
                aria-label="New certificate"
                @click="openCertModal"
            >
                <i class="fas fa-plus" />
            </Button>
        </template>

        <div class="certificates-layout">
            <h2 class="sr-only">Certificates</h2>

            <DataList
                :rows="filtered"
                :columns="columns"
                row-key="id"
                :loading="store.loading"
                empty-message="No certificates yet."
            >
                    <template #cell-name="{row}">
                        <button
                            type="button"
                            class="cert-name cert-name--btn"
                            @click="openDetails(row)"
                        >
                            {{ row.name }}
                        </button>
                        <span class="cert-fp">{{ formatFp(row.fingerprint_sha256) }}</span>
                    </template>
                    <template #cell-kind="{row}">
                        <span class="cert-kind" :class="`cert-kind--${row.kind}`">
                            {{ KIND.labelOf(row.kind as CertificateKind) }}
                        </span>
                    </template>
                    <template #cell-source="{row}">
                        <span class="cert-source">
                            {{ row.source === 'fm-issued' ? 'FM-issued' : 'Imported' }}
                        </span>
                    </template>
                    <template #cell-validity="{row}">
                        <span :class="validityClass(row)">
                            {{ formatValidity(row) }}
                        </span>
                    </template>
                    <template #cell-actions="{row}">
                        <button
                            type="button"
                            class="cert-action-btn"
                            :title="`Details for ${row.name}`"
                            @click="openDetails(row)"
                        >
                            <i class="fas fa-circle-info" />
                        </button>
                        <button
                            type="button"
                            class="cert-action-btn cert-action-btn--push"
                            :title="`Push ${row.name} to devices`"
                            :disabled="!hasSlotCompat(row)"
                            @click="openPush(row)"
                        >
                            <i class="fas fa-arrow-up-from-bracket" />
                        </button>
                        <button
                            type="button"
                            class="cert-action-btn cert-action-btn--delete"
                            :title="`Delete ${row.name}`"
                            @click="confirmDelete(row)"
                        >
                            <i class="fas fa-trash" />
                        </button>
                    </template>
            </DataList>
        </div>

        <template #modals>
            <Modal :visible="certModalOpen" compact tall @close="closeCertModal">
                <template #title>New certificate</template>
                <div class="cert-modal">
                    <ViewToggle
                        v-model="certTab"
                        :options="CERT_TAB_OPTIONS"
                        class="cert-modal__switch"
                    />

                    <div v-if="certTab === 'import'" class="cert-form">
                    <FormField label="Name" :error="errors.name">
                        <Input v-model="importForm.name" placeholder="e.g. Internal CA 2026" />
                    </FormField>
                    <FormField label="What are you importing?">
                        <Dropdown
                            :options="importKindLabels"
                            :default="KIND.labelOf(importForm.kind)"
                            @selected="(label: string) => (importForm.kind = KIND.keyOf(label))"
                        />
                        <p class="cert-kind-desc">{{ importKindDesc }}</p>
                    </FormField>
                    <FormField
                        label="Certificate"
                        :error="errors.pem"
                        hint="Paste the certificate, or upload a file."
                    >
                        <div class="cert-upload-row">
                            <FileUploadField
                                accept=".pem,.crt,.cer,.txt,application/x-pem-file,application/x-x509-ca-cert"
                                upload-label="Upload file"
                                :show-delete="false"
                                @upload="onCertFileSelected"
                            />
                            <span v-if="certFileName" class="cert-upload-name">
                                <i class="fas fa-file" /> {{ certFileName }}
                            </span>
                        </div>
                        <Textarea
                            v-model="importForm.pem"
                            class="cert-textarea"
                            spellcheck="false"
                            placeholder="-----BEGIN CERTIFICATE-----"
                        />
                    </FormField>
                    <FormField
                        v-if="needsPrivateKey"
                        label="Private key"
                        :error="errors.privateKey"
                        hint="Unencrypted key only."
                    >
                        <div class="cert-upload-row">
                            <FileUploadField
                                accept=".pem,.key,.txt,application/x-pem-file"
                                upload-label="Upload key file"
                                :show-delete="false"
                                @upload="onKeyFileSelected"
                            />
                            <span v-if="keyFileName" class="cert-upload-name">
                                <i class="fas fa-file" /> {{ keyFileName }}
                            </span>
                        </div>
                        <Textarea
                            v-model="importForm.privateKeyPem"
                            class="cert-textarea"
                            spellcheck="false"
                            placeholder="-----BEGIN PRIVATE KEY-----"
                        />
                    </FormField>
                    <div class="cert-form-actions">
                        <Button type="blue-hollow" @click="closeCertModal">Cancel</Button>
                        <Button type="blue" :disabled="saving" @click="submitImport">
                            Import
                        </Button>
                    </div>
                    </div>

                    <div v-if="certTab === 'issue'" class="cert-form">
                    <template v-if="!issueResult">
                        <p class="cert-form-hint">
                            Signs a certificate for one Shelly device.
                        </p>
                        <FormField label="Device" :error="issueErrors.shellyId">
                            <DeviceIdField v-model="issueForm.shellyId" />
                        </FormField>
                        <FormField label="Validity (days)" :error="issueErrors.validityDays">
                            <Input
                                v-model.number="issueForm.validityDays"
                                type="number"
                                :min="1"
                                :max="issueDefaults.maxValidityDays"
                            />
                        </FormField>
                        <FormField label="Name (optional)">
                            <Input
                                v-model="issueForm.name"
                                placeholder="Defaults to 'Device cert — <shellyId>'"
                            />
                        </FormField>
                        <div class="cert-form-actions">
                            <Button type="blue-hollow" @click="closeCertModal">Cancel</Button>
                            <Button type="green" :disabled="issuing" @click="submitIssue">
                                Issue
                            </Button>
                        </div>
                    </template>

                    <template v-if="issueResult">
                        <div class="cert-issued">
                            <div class="cert-issued__head">
                                <i class="fas fa-circle-check cert-issued__icon" />
                                Certificate issued
                            </div>
                            <dl class="cert-issued__grid">
                                <div><dt>Name</dt><dd>{{ issueResult.name }}</dd></div>
                                <div><dt>Valid</dt><dd>{{ formatValidity(issueResult) }}</dd></div>
                            </dl>
                            <p class="cert-form-hint">
                                Download the PEM now, or find it any time from the
                                certificate's details.
                            </p>
                        </div>
                        <div class="cert-form-actions">
                            <Button type="blue-hollow" @click="downloadCertPem(issueResult)">
                                <i class="fas fa-download" /> Download PEM
                            </Button>
                            <Button type="green" @click="closeCertModal">Done</Button>
                        </div>
                    </template>
                    </div>
                </div>
            </Modal>

            <Modal :visible="pushOpen" @close="closePush">
                <template #title>Push certificate to devices</template>
                <div class="cert-form">
                    <p v-if="pushTarget" class="cert-form-hint">
                        Pushing <strong>{{ pushTarget.name }}</strong>
                        (slot compat: {{ (pushTarget.slot_compat ?? []).join(', ') || '—' }}).
                    </p>
                    <FormField label="Slot" :error="pushErrors.slot">
                        <Dropdown
                            :options="availableSlots"
                            :default="pushForm.slot"
                            @selected="(s) => (pushForm.slot = s as CertificateSlot)"
                        />
                    </FormField>
                    <FormField
                        label="Device IDs (one per line)"
                        :error="pushErrors.deviceIds"
                        hint="Push fans out to these specific shellyIDs."
                    >
                        <Textarea
                            v-model="pushForm.deviceIds"
                            class="cert-textarea"
                            spellcheck="false"
                            placeholder="shellyplus1pm-aabbccddeeff"
                        />
                    </FormField>
                    <div v-if="pushProgress" class="cert-push-progress">
                        <p class="cert-form-hint">
                            Job <code>{{ pushProgress.job.id }}</code> —
                            {{ pushProgress.job.status }} ({{ appliedCount }}/{{ pushProgress.rows.length }})
                        </p>
                        <ul class="cert-push-rows">
                            <li
                                v-for="r in pushProgress.rows"
                                :key="r.id"
                                :class="`cert-push-row cert-push-row--${r.status}`"
                            >
                                <span class="cert-push-row__device">{{ r.device_id }}</span>
                                <span class="cert-push-row__status">{{ r.status }}</span>
                                <span v-if="r.last_error" class="cert-push-row__error">
                                    {{ r.last_error }}
                                </span>
                            </li>
                        </ul>
                    </div>
                    <div class="cert-form-actions">
                        <Button type="blue-hollow" @click="closePush">Close</Button>
                        <Button
                            type="blue"
                            :disabled="pushing || pushProgress?.job?.status === 'done'"
                            @click="submitPush"
                        >
                            {{ pushProgress ? 'Refresh' : 'Start push' }}
                        </Button>
                    </div>
                </div>
            </Modal>

            <ConfirmationModal ref="deleteRef">
                <template #title>
                    <h3>Delete "{{ deleteTargetName }}"?</h3>
                </template>
                <template #subText>
                    <p class="cert-delete-hint">
                        Removing this certificate cannot be undone.
                    </p>
                </template>
            </ConfirmationModal>

            <FilterModal
                :visible="filterVisible"
                title="Filter Certificates"
                match-label="certificates"
                :match-count="filtered.length"
                :sections="filterSections"
                :initial-state="currentFilterState"
                @close="filterVisible = false"
                @apply-generic="applyFilters"
            />

            <Modal :visible="detailsOpen" @close="closeDetails">
                <template #title>
                    Certificate details — {{ detailsCert?.name }}
                </template>
                <div v-if="detailsCert" class="cert-details">
                    <section class="cert-details-section">
                        <h4>Identity</h4>
                        <dl class="cert-meta-grid">
                            <dt>Subject CN</dt><dd>{{ detailsCert.subject_cn ?? '—' }}</dd>
                            <dt>Subject O</dt><dd>{{ detailsCert.metadata?.subject_o ?? '—' }}</dd>
                            <dt>Subject OU</dt><dd>{{ detailsCert.metadata?.subject_ou ?? '—' }}</dd>
                            <dt>Issuer CN</dt><dd>{{ detailsCert.issuer_cn ?? '—' }}</dd>
                            <dt>Issuer O</dt><dd>{{ detailsCert.metadata?.issuer_o ?? '—' }}</dd>
                            <dt>Serial</dt><dd class="cert-mono">{{ detailsCert.metadata?.serial_number ?? '—' }}</dd>
                            <dt>Fingerprint (SHA-256)</dt><dd class="cert-mono">{{ formatFp(detailsCert.fingerprint_sha256) }}</dd>
                        </dl>
                    </section>

                    <section class="cert-details-section">
                        <h4>Validity</h4>
                        <dl class="cert-meta-grid">
                            <dt>Status</dt>
                            <dd>
                                <span :class="validityClass(detailsCert)">{{ formatValidity(detailsCert) }}</span>
                            </dd>
                            <dt>Not before</dt><dd>{{ detailsCert.not_before ?? '—' }}</dd>
                            <dt>Not after</dt><dd>{{ detailsCert.not_after ?? '—' }}</dd>
                        </dl>
                    </section>

                    <section class="cert-details-section">
                        <h4>Key</h4>
                        <dl class="cert-meta-grid">
                            <dt>Algorithm</dt><dd>{{ detailsCert.key_algo ?? '—' }}</dd>
                            <dt>Size / Curve</dt>
                            <dd>
                                {{ detailsCert.metadata?.key_bits
                                    ? `${detailsCert.metadata.key_bits} bits`
                                    : detailsCert.metadata?.key_curve ?? '—' }}
                            </dd>
                            <dt>Signature alg.</dt><dd>{{ detailsCert.metadata?.signature_algorithm ?? '—' }}</dd>
                            <dt>Key usage</dt>
                            <dd>
                                <span v-if="!detailsCert.metadata?.key_usage?.length">—</span>
                                <span v-for="ku in detailsCert.metadata?.key_usage ?? []" :key="ku" class="cert-chip">{{ ku }}</span>
                            </dd>
                            <dt>Extended key usage</dt>
                            <dd>
                                <span v-if="!detailsCert.metadata?.extended_key_usage?.length">—</span>
                                <span v-for="eku in detailsCert.metadata?.extended_key_usage ?? []" :key="eku" class="cert-chip">{{ eku }}</span>
                            </dd>
                        </dl>
                    </section>

                    <section class="cert-details-section">
                        <h4>Subject Alternative Names</h4>
                        <div v-if="!hasAnySan(detailsCert)" class="cert-meta-empty">—</div>
                        <div v-else>
                            <div v-if="detailsCert.metadata?.san_dns?.length" class="cert-san-row">
                                <strong>DNS:</strong>
                                <span v-for="d in detailsCert.metadata.san_dns" :key="`dns-${d}`" class="cert-chip">{{ d }}</span>
                            </div>
                            <div v-if="detailsCert.metadata?.san_ip?.length" class="cert-san-row">
                                <strong>IP:</strong>
                                <span v-for="ip in detailsCert.metadata.san_ip" :key="`ip-${ip}`" class="cert-chip">{{ ip }}</span>
                            </div>
                        </div>
                    </section>

                    <section class="cert-details-section">
                        <h4>Chain</h4>
                        <dl class="cert-meta-grid">
                            <dt>Depth</dt><dd>{{ detailsCert.chain_depth ?? '—' }}</dd>
                            <dt>Leaf is CA</dt><dd>{{ detailsCert.basic_constraints_ca ? 'yes' : 'no' }}</dd>
                            <dt>Includes root</dt>
                            <dd>
                                <span v-if="detailsCert.metadata?.chain_includes_root" class="cert-warn">
                                    yes (Shelly KB: chain should be leaf + intermediates only)
                                </span>
                                <span v-else>no</span>
                            </dd>
                        </dl>
                    </section>

                    <section v-if="detailsCert.incompat_reasons?.length" class="cert-details-section">
                        <h4>Compatibility warnings</h4>
                        <ul class="cert-warn-list">
                            <li v-for="r in detailsCert.incompat_reasons" :key="r">{{ r }}</li>
                        </ul>
                    </section>

                    <section class="cert-details-section">
                        <h4>Tags</h4>
                        <div class="cert-tag-edit">
                            <input
                                v-model="tagsDraft"
                                type="text"
                                class="cert-tag-input"
                                placeholder="comma-separated, e.g. prod, mtls-leaf"
                            />
                            <button type="button" class="cert-action-btn" @click="saveTags">Save</button>
                        </div>
                        <div class="cert-tag-row">
                            <span v-if="!detailsCert.tags?.length" class="cert-meta-empty">No tags</span>
                            <span v-for="t in detailsCert.tags ?? []" :key="t" class="cert-chip">{{ t }}</span>
                        </div>
                    </section>

                    <section class="cert-details-section">
                        <h4>Device groups</h4>
                        <div class="cert-tag-edit">
                            <input
                                v-model="groupsDraft"
                                type="text"
                                class="cert-tag-input"
                                placeholder="comma-separated group IDs, e.g. 1, 4, 7"
                            />
                            <button type="button" class="cert-action-btn" @click="saveGroups">Save</button>
                        </div>
                        <p v-if="groupsError" class="cert-field-error">
                            {{ groupsError }}
                        </p>
                        <div class="cert-tag-row">
                            <span v-if="!detailsCert.device_group_ids?.length" class="cert-meta-empty">No groups</span>
                            <span v-for="g in detailsCert.device_group_ids ?? []" :key="g" class="cert-chip">#{{ g }}</span>
                        </div>
                    </section>

                    <section class="cert-details-section">
                        <button type="button" class="cert-action-btn" @click="downloadCertPem(detailsCert)">
                            <i class="fas fa-download" /> Download PEM
                        </button>
                    </section>
                </div>
            </Modal>
        </template>

    </PageTemplate>
</template>

<script setup lang="ts">
import {
    CERTIFICATE_KIND_LABELS,
    type CertificateJobResponse,
    type CertificateKind,
    type CertificatePushRow,
    type CertificateResponse,
    type CertificateSlot
} from '@api/certificate';
import {
    type ComputedRef,
    computed,
    inject,
    onMounted,
    reactive,
    ref
} from 'vue';
import Button from '@/components/core/Button.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import DeviceIdField from '@/components/core/DeviceIdField.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FileUploadField from '@/components/core/FileUploadField.vue';
import FilterModal, {
    type FilterSection,
    type FilterState
} from '@/components/core/FilterModal.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import Textarea from '@/components/core/Textarea.vue';
import ViewToggle from '@/components/core/ViewToggle.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import DeviceAuthSubTabs from '@/components/pages/device-auth/DeviceAuthSubTabs.vue';
import {useEnumLabels} from '@/composables/useEnumLabels';
import {
    certKindNeedsPrivateKey, 
    IMPORT_CERT_KIND_INFO,
    IMPORT_CERT_KINDS
} from '@/helpers/certificateKinds';
import {useCertificatesStore} from '@/stores/certificates';
import {useToastStore} from '@/stores/toast';
import type {RouteTab} from '@/types/page-template';

const tabs = inject<RouteTab[] | ComputedRef<RouteTab[]>>(
    'settingsTabs',
    [] as RouteTab[]
);

const store = useCertificatesStore();
const toast = useToastStore();

const search = ref('');
const filterVisible = ref(false);
const kindFilter = ref<CertificateKind[]>([]);
const sourceFilter = ref<string[]>([]);

const certificates = computed(() => Object.values(store.certificates));
const certificatesCountLabel = computed(() => {
    const total = certificates.value.length;
    if (total === 0) return undefined;
    const word = total === 1 ? 'certificate' : 'certificates';
    return `${total} ${word}`;
});
const filtered = computed(() => {
    const all = certificates.value;
    const q = search.value.toLowerCase();
    return all.filter((c) => {
        if (kindFilter.value.length && !kindFilter.value.includes(c.kind as CertificateKind)) {
            return false;
        }
        if (sourceFilter.value.length && !sourceFilter.value.includes(c.source ?? '')) {
            return false;
        }
        if (!q) return true;
        return (
            c.name.toLowerCase().includes(q) ||
            c.fingerprint_sha256.toLowerCase().includes(q) ||
            (c.subject_cn?.toLowerCase().includes(q) ?? false)
        );
    });
});

const filterSections = computed<FilterSection[]>(() => [
    {
        key: 'kind',
        label: 'Kind',
        icon: 'fa-certificate',
        options: Object.entries(CERTIFICATE_KIND_LABELS).map(([key, label]) => ({
            key,
            label
        }))
    },
    {
        key: 'source',
        label: 'Source',
        icon: 'fa-tag',
        options: [
            {key: 'imported', label: 'Imported'},
            {key: 'fm-issued', label: 'FM-issued'}
        ]
    }
]);

const currentFilterState = computed<FilterState>(() => ({
    kind: [...kindFilter.value],
    source: [...sourceFilter.value]
}));

const activeFilterCount = computed(
    () => kindFilter.value.length + sourceFilter.value.length
);

function applyFilters(state: FilterState): void {
    kindFilter.value = (state.kind ?? []) as CertificateKind[];
    sourceFilter.value = state.source ?? [];
    filterVisible.value = false;
}

const columns: DataColumn[] = [
    {key: 'name', label: 'Name', role: 'primary'},
    {key: 'kind', label: 'Kind'},
    {key: 'source', label: 'Source'},
    {key: 'validity', label: 'Validity'},
    {key: 'actions', label: '', role: 'action', align: 'right'}
];

const certModalOpen = ref(false);
type CertTab = 'issue' | 'import';
const CERT_TAB_OPTIONS: {value: CertTab; label: string}[] = [
    {value: 'issue', label: 'Issue'},
    {value: 'import', label: 'Import'}
];
const certTab = ref<CertTab>('issue');
const saving = ref(false);
const errors = reactive({name: '', pem: '', privateKey: ''});
const importForm = reactive({
    name: '',
    kind: 'root_ca' as CertificateKind,
    pem: '',
    privateKeyPem: ''
});

const needsPrivateKey = computed(() =>
    certKindNeedsPrivateKey(importForm.kind)
);

const certFileName = ref('');
const keyFileName = ref('');
const PEM_FILE_MAX_BYTES = 256 * 1024;

function openImport(): void {
    errors.name = '';
    errors.pem = '';
    errors.privateKey = '';
    importForm.name = '';
    importForm.kind = 'root_ca';
    importForm.pem = '';
    importForm.privateKeyPem = '';
    certFileName.value = '';
    keyFileName.value = '';
}

async function openCertModal(): Promise<void> {
    openImport();
    await openIssue();
    certTab.value = 'issue';
    certModalOpen.value = true;
}

function closeCertModal(): void {
    certModalOpen.value = false;
    issueResult.value = null;
}

interface PemUpload {
    name: string;
    text: string;
}

// Reads the picked PEM atomically: file captured before input reset so a
// rapid double-pick can't race the text() promise, and returns name+body
// together so the caller updates both or neither.
async function readPemFile(event: Event): Promise<PemUpload | null> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return null;
    if (file.size > PEM_FILE_MAX_BYTES) {
        toast.error(
            `${file.name} is too large (limit ${PEM_FILE_MAX_BYTES / 1024} KB).`
        );
        return null;
    }
    try {
        return {name: file.name, text: await file.text()};
    } catch {
        toast.error(`Could not read ${file.name}.`);
        return null;
    }
}

async function onCertFileSelected(event: Event): Promise<void> {
    const upload = await readPemFile(event);
    if (!upload) {
        certFileName.value = '';
        return;
    }
    importForm.pem = upload.text;
    certFileName.value = upload.name;
}

async function onKeyFileSelected(event: Event): Promise<void> {
    const upload = await readPemFile(event);
    if (!upload) {
        keyFileName.value = '';
        return;
    }
    importForm.privateKeyPem = upload.text;
    keyFileName.value = upload.name;
}

async function submitImport(): Promise<void> {
    errors.name = '';
    errors.pem = '';
    errors.privateKey = '';
    if (!importForm.name.trim()) {
        errors.name = 'Name is required.';
        return;
    }
    if (!importForm.pem.includes('-----BEGIN CERTIFICATE-----')) {
        errors.pem = 'PEM must contain a BEGIN CERTIFICATE block.';
        return;
    }
    if (needsPrivateKey.value && !importForm.privateKeyPem.trim()) {
        errors.privateKey = 'This kind needs its private key.';
        return;
    }
    saving.value = true;
    const result = await store.importPem({
        name: importForm.name.trim(),
        kind: importForm.kind,
        pem: importForm.pem,
        privateKeyPem: importForm.privateKeyPem.trim() || undefined
    });
    saving.value = false;
    if (result) closeCertModal();
}

const issuing = ref(false);
// Set on success so the modal shows a result step (like the token modal) instead
// of closing immediately.
const issueResult = ref<CertificateResponse | null>(null);
const issueErrors = reactive({shellyId: '', validityDays: ''});
const issueDefaults = reactive({defaultValidityDays: 365, maxValidityDays: 3650});
const issueForm = reactive({
    shellyId: '',
    validityDays: 365,
    name: ''
});

async function openIssue(): Promise<void> {
    const d = await store.getIssueDefaults();
    if (d) {
        issueDefaults.defaultValidityDays = d.defaultValidityDays;
        issueDefaults.maxValidityDays = d.maxValidityDays;
    }
    issueErrors.shellyId = '';
    issueErrors.validityDays = '';
    issueForm.shellyId = '';
    issueForm.validityDays = issueDefaults.defaultValidityDays;
    issueForm.name = '';
    issueResult.value = null;
}

async function submitIssue(): Promise<void> {
    issueErrors.shellyId = '';
    issueErrors.validityDays = '';
    const id = issueForm.shellyId.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        issueErrors.shellyId = 'Shelly ID may only contain A-Z, a-z, 0-9, _ and -.';
        return;
    }
    const max = issueDefaults.maxValidityDays;
    if (
        !Number.isInteger(issueForm.validityDays) ||
        issueForm.validityDays < 1 ||
        issueForm.validityDays > max
    ) {
        issueErrors.validityDays = `Validity must be 1–${max} days.`;
        return;
    }
    issuing.value = true;
    const result = await store.issueDeviceCert({
        shellyId: id,
        validityDays: issueForm.validityDays,
        name: issueForm.name.trim() || undefined
    });
    issuing.value = false;
    if (result) issueResult.value = result;
}

async function downloadCertPem(cert: CertificateResponse): Promise<void> {
    const safeName = cert.name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'cert';
    await store.downloadPem(cert.id, `${safeName}.pem`);
}

const pushOpen = ref(false);
const pushTarget = ref<CertificateResponse | null>(null);
const pushing = ref(false);
const pushErrors = reactive({slot: '', deviceIds: ''});
const pushForm = reactive({
    slot: '' as CertificateSlot | '',
    deviceIds: ''
});
const pushProgress = ref<{
    job: CertificateJobResponse;
    rows: CertificatePushRow[];
} | null>(null);

const availableSlots = computed<CertificateSlot[]>(() => {
    return (pushTarget.value?.slot_compat ?? []) as CertificateSlot[];
});
const appliedCount = computed(
    () =>
        pushProgress.value?.rows.filter((r) => r.status === 'applied').length ??
        0
);

function hasSlotCompat(c: CertificateResponse): boolean {
    return (c.slot_compat?.length ?? 0) > 0;
}

function openPush(c: CertificateResponse): void {
    pushTarget.value = c;
    pushErrors.slot = '';
    pushErrors.deviceIds = '';
    pushForm.slot = (c.slot_compat?.[0] ?? '') as CertificateSlot | '';
    pushForm.deviceIds = '';
    pushProgress.value = null;
    pushOpen.value = true;
}

function closePush(): void {
    pushOpen.value = false;
    pushTarget.value = null;
    pushProgress.value = null;
}

async function submitPush(): Promise<void> {
    pushErrors.slot = '';
    pushErrors.deviceIds = '';
    if (!pushTarget.value) return;
    if (pushProgress.value) {
        // refresh path
        const r = await store.pushStatus(pushProgress.value.job.id);
        if (r) pushProgress.value = r;
        return;
    }
    if (!pushForm.slot) {
        pushErrors.slot = 'Pick a slot.';
        return;
    }
    const ids = pushForm.deviceIds
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (ids.length === 0) {
        pushErrors.deviceIds = 'Add at least one shellyID.';
        return;
    }
    pushing.value = true;
    const r = await store.pushToDevices(
        {
            certificateId: pushTarget.value.id,
            slot: pushForm.slot,
            target: {deviceIds: ids}
        },
        {
            deviceIds: ids,
            label: `Push ${pushTarget.value.name} → ${pushForm.slot} (${ids.length} device${ids.length === 1 ? '' : 's'})`
        }
    );
    pushing.value = false;
    if (!r) return;
    const status = await store.pushStatus(r.jobId);
    if (status) pushProgress.value = status;
}

const deleteRef = ref<InstanceType<typeof ConfirmationModal> | null>(null);
const deleteTargetName = ref('');
function confirmDelete(row: CertificateResponse): void {
    deleteTargetName.value = row.name;
    deleteRef.value?.storeAction(async () => {
        await store.remove(row.id);
    });
}

const KIND = useEnumLabels<CertificateKind>(CERTIFICATE_KIND_LABELS, 'other');

const importKindLabels = computed(() =>
    IMPORT_CERT_KINDS.map((k) => KIND.labelOf(k))
);
const importKindDesc = computed(
    () => IMPORT_CERT_KIND_INFO[importForm.kind] ?? ''
);

function formatFp(fp: string): string {
    return fp.length > 16 ? `${fp.slice(0, 8)}…${fp.slice(-8)}` : fp;
}

function daysUntil(date: string | null): number | null {
    if (!date) return null;
    const t = new Date(date).getTime();
    if (Number.isNaN(t)) return null;
    return Math.round((t - Date.now()) / 86_400_000);
}

function formatValidity(c: CertificateResponse): string {
    const d = daysUntil(c.not_after);
    if (d === null) return '—';
    if (d < 0) return `Expired ${-d}d ago`;
    if (d === 0) return 'Expires today';
    return `${d}d remaining`;
}

function validityClass(c: CertificateResponse): string {
    const d = daysUntil(c.not_after);
    if (d === null) return 'cert-validity';
    if (d < 0) return 'cert-validity cert-validity--expired';
    if (d <= 14) return 'cert-validity cert-validity--soon';
    return 'cert-validity';
}

const detailsOpen = ref(false);
const detailsCert = ref<CertificateResponse | null>(null);
const tagsDraft = ref('');
const groupsDraft = ref('');
const groupsError = ref('');

function openDetails(row: CertificateResponse): void {
    detailsCert.value = row;
    tagsDraft.value = (row.tags ?? []).join(', ');
    groupsDraft.value = (row.device_group_ids ?? []).join(', ');
    groupsError.value = '';
    detailsOpen.value = true;
}

function closeDetails(): void {
    detailsOpen.value = false;
    detailsCert.value = null;
}

function hasAnySan(c: CertificateResponse): boolean {
    const dns = c.metadata?.san_dns?.length ?? 0;
    const ip = c.metadata?.san_ip?.length ?? 0;
    return dns + ip > 0;
}

function parseCsv(raw: string): string[] {
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

async function saveTags(): Promise<void> {
    const cert = detailsCert.value;
    if (!cert) return;
    const ok = await store.setTags(cert.id, parseCsv(tagsDraft.value));
    if (ok) {
        const updated = store.certificates[cert.id];
        if (updated) detailsCert.value = updated;
    }
}

async function saveGroups(): Promise<void> {
    const cert = detailsCert.value;
    if (!cert) return;
    groupsError.value = '';
    const parts = parseCsv(groupsDraft.value);
    const invalid = parts.filter((s) => !/^[1-9]\d*$/.test(s));
    if (invalid.length > 0) {
        groupsError.value = `Not a group ID: ${invalid.join(', ')} — use positive numbers, e.g. 1, 4, 7.`;
        return;
    }
    const ids = parts.map((s) => Number.parseInt(s, 10));
    const ok = await store.setGroups(cert.id, ids);
    if (ok) {
        const updated = store.certificates[cert.id];
        if (updated) detailsCert.value = updated;
    }
}

onMounted(() => {
    void store.fetchAll();
});
</script>

<style scoped>
.certificates-layout {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
/* Issue result step */
.cert-issued {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.cert-issued__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.cert-issued__icon {
    color: var(--color-success-text);
}
.cert-issued__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0;
}
.cert-issued__grid dt {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.cert-issued__grid dd {
    margin: 0;
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
}
.cert-name {
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
}
.cert-name--btn {
    display: block;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.cert-name--btn:hover {
    text-decoration: underline;
}
.cert-fp {
    display: block;
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
}
.cert-kind {
    display: inline-block;
    padding: var(--space-px) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}
.cert-source {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}
.cert-validity--soon {
    color: var(--color-warning-text);
}
.cert-validity--expired {
    color: var(--color-danger-text);
}
.cert-action-btn {
    background: transparent;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: var(--space-2);
    transition: color var(--motion-hover);
}
.cert-action-btn:disabled {
    cursor: not-allowed;
    opacity: var(--opacity-disabled);
}
.cert-action-btn--push:hover:not(:disabled) {
    color: var(--color-primary-text);
}
.cert-action-btn--delete:hover:not(:disabled) {
    color: var(--color-danger-text);
}
.cert-modal__switch {
    margin-bottom: var(--space-4);
}
.cert-kind-desc {
    margin: var(--space-1) 0 0;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
}
.cert-field-error {
    margin: var(--space-1) 0 0;
    font-size: var(--type-caption);
    color: var(--color-danger-text);
}
.cert-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-width: var(--floating-w-xs);
}
.cert-textarea {
    /* Textarea atom supplies border/color/size; add a paste-friendly floor
       and a mono face for PEM / device-ID blocks. */
    min-height: 8rem;
    font-family: var(--font-mono);
}
.cert-form-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    margin-top: var(--space-3);
}
.cert-push-progress {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    background: var(--color-surface-2);
}
.cert-push-rows {
    list-style: none;
    margin: var(--space-2) 0 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 240px;
    overflow-y: auto;
}
.cert-push-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    font-size: var(--type-caption);
}
.cert-push-row--applied {
    border-left: 3px solid var(--color-success-text);
}
.cert-push-row--in_progress {
    border-left: 3px solid var(--color-warning-text);
}
.cert-push-row--failed,
.cert-push-row--rolled_back {
    border-left: 3px solid var(--color-danger-text);
}
.cert-push-row__device {
    font-family: var(--font-mono);
}
.cert-push-row__status {
    color: var(--color-text-secondary);
}
.cert-push-row__error {
    color: var(--color-danger-text);
}

.cert-upload-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
}
.cert-upload-name {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-family: var(--font-mono, monospace);
}
</style>
