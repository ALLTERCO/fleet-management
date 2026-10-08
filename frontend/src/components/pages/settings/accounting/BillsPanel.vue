<template>
    <section class="ua-panel" aria-labelledby="recorded-bills-title">
        <header class="ua-panel__header">
            <div class="ua-panel__heading">
                <h2 id="recorded-bills-title">Recorded bills</h2>
                <p>
                    Reconcile calculated charges with the amount on the utility
                    invoice. Identity fields are matched exactly; they are never
                    guessed from a date range.
                </p>
            </div>
            <div v-if="canWrite" class="ua-panel__actions">
                <Button type="blue-hollow" size="sm" @click="toggleImport">
                    Import CSV
                </Button>
                <Button type="green" size="sm" @click="toggleCreate">
                    Add bill
                </Button>
            </div>
        </header>

        <div v-if="loadFailed" class="ua-state ua-state--error" role="alert">
            <div>
                <strong>Couldn’t load recorded bills.</strong>
                <span>Check the connection and try again.</span>
            </div>
            <Button type="blue-hollow" size="sm" @click="refresh">Retry</Button>
        </div>

        <form
            v-if="showCreate"
            ref="createRoot"
            class="ua-editor"
            aria-labelledby="bill-editor-title"
            @submit.prevent="saveBill"
        >
            <div class="ua-editor__head">
                <div>
                    <h3 id="bill-editor-title">Add a recorded bill</h3>
                    <p>Use the invoice period and total exactly as issued.</p>
                </div>
                <button
                    type="button"
                    class="ua-icon-button"
                    aria-label="Close bill form"
                    @click="closeCreate"
                >
                    <i class="fas fa-xmark" aria-hidden="true" />
                </button>
            </div>

            <div class="ua-form-grid">
                <FormField field-id="bill-period-start" label="Period start" :error="fieldErrors.periodStart">
                    <input
                        id="bill-period-start"
                        v-model="billForm.periodStart"
                        class="ua-input"
                        type="date"
                        required
                    />
                </FormField>
                <FormField field-id="bill-period-end" label="Period end" :error="fieldErrors.periodEnd">
                    <input
                        id="bill-period-end"
                        v-model="billForm.periodEnd"
                        class="ua-input"
                        type="date"
                        required
                    />
                </FormField>
                <FormField field-id="bill-actual-total" label="Actual total" :error="fieldErrors.actualCost">
                    <input
                        id="bill-actual-total"
                        v-model="billForm.actualCost"
                        class="ua-input"
                        type="number"
                        min="0"
                        step="any"
                        required
                    />
                </FormField>
                <FormField
                    field-id="bill-currency"
                    label="Currency"
                    hint="Three-letter ISO 4217 code, for example USD or JPY."
                >
                    <select id="bill-currency" v-model="billForm.currency" class="ua-select" required>
                        <option value="" disabled>Select currency</option>
                        <option v-for="currency in CURRENCIES" :key="currency" :value="currency">{{ currency }}</option>
                    </select>
                </FormField>
                <FormField
                    label="Utility account ID"
                    optional
                    hint="Use the identifier printed by the utility."
                >
                    <Input
                        v-model="billForm.utilityAccountId"
                        :maxlength="120"
                        :spellcheck="false"
                    />
                </FormField>
                <FormField label="Meter identifier" optional>
                    <Input
                        v-model="billForm.meterIdentifier"
                        :maxlength="120"
                        :spellcheck="false"
                    />
                </FormField>
                <FormField label="Service-point identifier" optional>
                    <Input
                        v-model="billForm.servicePointIdentifier"
                        :maxlength="120"
                        :spellcheck="false"
                    />
                </FormField>
            </div>

            <div class="ua-coverage" role="status">
                <i class="fas fa-link" aria-hidden="true" />
                <div>
                    <strong>{{ coveragePreview }}</strong>
                    <span>
                        Reports must supply the same populated identifiers for
                        this bill to reconcile.
                    </span>
                </div>
            </div>
            <p v-if="formError" class="ua-form-error" role="alert">
                {{ formError }}
            </p>
            <div class="ua-editor__footer">
                <Button type="blue-hollow" size="sm" @click="closeCreate">
                    Cancel
                </Button>
                <Button type="green" size="sm" submit :loading="saving">
                    Save bill
                </Button>
            </div>
        </form>

        <form
            v-if="showImport"
            ref="importRoot"
            class="ua-editor"
            aria-labelledby="bill-import-title"
            @submit.prevent="importBills"
        >
            <div class="ua-editor__head">
                <div>
                    <h3 id="bill-import-title">Import recorded bills</h3>
                    <p>
                        CSV columns: periodStart, periodEnd, actualCost, currency,
                        utilityAccountId, meterIdentifier, servicePointIdentifier.
                    </p>
                </div>
                <button
                    type="button"
                    class="ua-icon-button"
                    aria-label="Close bill import"
                    @click="closeImport"
                >
                    <i class="fas fa-xmark" aria-hidden="true" />
                </button>
            </div>
            <label class="ua-file">
                <span>Select CSV file</span>
                <input
                    ref="fileInput"
                    type="file"
                    accept=".csv,text/csv"
                    @change="readImportFile"
                />
                <small>Maximum 1 MB and {{ RECORDED_BILL_IMPORT_LIMIT }} bills.</small>
            </label>
            <div v-if="importIssues.length" class="ua-state ua-state--error" role="alert">
                <div>
                    <strong>Fix the CSV before importing.</strong>
                    <ul>
                        <li v-for="issue in importIssues.slice(0, 8)" :key="`${issue.row}-${issue.message}`">
                            Row {{ issue.row }}: {{ issue.message }}
                        </li>
                    </ul>
                    <span v-if="importIssues.length > 8">
                        {{ importIssues.length - 8 }} more issue{{ importIssues.length - 8 === 1 ? '' : 's' }}.
                    </span>
                </div>
            </div>
            <div v-else-if="importRows.length" class="ua-coverage" role="status">
                <i class="fas fa-file-csv" aria-hidden="true" />
                <div>
                    <strong>{{ importRows.length }} bill{{ importRows.length === 1 ? '' : 's' }} ready</strong>
                    <span>
                        The whole batch is validated and written atomically. A
                        failed row does not leave a partial import.
                    </span>
                </div>
            </div>
            <section v-if="importRows.length" class="ua-import-preview" aria-label="Import preview">
                <div v-for="(row, index) in importRows.slice(0, 3)" :key="`${row.periodStart}-${row.periodEnd}-${index}`">
                    <strong>{{ row.periodStart }} – {{ row.periodEnd }}</strong>
                    <span>{{ formatMoney(row.actualCost, row.currency) }}</span>
                    <small>{{ billCoverageLabel(row) }}</small>
                </div>
            </section>
            <p v-if="importError" class="ua-form-error" role="alert">
                {{ importError }}
            </p>
            <div class="ua-editor__footer">
                <Button type="blue-hollow" size="sm" @click="closeImport">
                    Cancel
                </Button>
                <Button
                    type="green"
                    size="sm"
                    submit
                    :loading="importing"
                    :disabled="importRows.length === 0 || importIssues.length > 0"
                >
                    Import bills
                </Button>
            </div>
        </form>

        <DataList
            v-if="!loadFailed"
            :rows="bills"
            :columns="columns"
            row-key="id"
            :loading="loading"
            empty-message="No recorded bills yet. Add an invoice total to start comparing calculated and actual charges."
        >
            <template #cell-period="{row}">
                <span class="ua-primary">{{ formatPeriod(row) }}</span>
            </template>
            <template #cell-amount="{row}">
                <span class="ua-number">{{ formatMoney(row.actualCost, row.currency) }}</span>
            </template>
            <template #cell-coverage="{row}">
                <span
                    class="ua-badge"
                    :class="hasCompleteIdentity(row) ? 'ua-badge--ok' : 'ua-badge--warn'"
                >
                    {{ billCoverageLabel(row) }}
                </span>
            </template>
            <template #cell-identity="{row}">
                <dl class="ua-identity" dir="auto">
                    <div v-if="row.utilityAccountId">
                        <dt>Account</dt><dd>{{ row.utilityAccountId }}</dd>
                    </div>
                    <div v-if="row.meterIdentifier">
                        <dt>Meter</dt><dd>{{ row.meterIdentifier }}</dd>
                    </div>
                    <div v-if="row.servicePointIdentifier">
                        <dt>Service point</dt><dd>{{ row.servicePointIdentifier }}</dd>
                    </div>
                    <div v-if="!hasAnyIdentity(row)">
                        <dt>Identity</dt><dd>Not recorded</dd>
                    </div>
                </dl>
            </template>
            <template #cell-actions="{row}">
                <div v-if="canWrite" class="ua-row-actions">
                    <template v-if="pendingDeleteId === row.id">
                        <span>Delete this bill?</span>
                        <Button
                            type="red"
                            size="xs"
                            :loading="deletingId === row.id"
                            @click="deleteBill(row)"
                        >
                            Confirm
                        </Button>
                        <Button type="blue-hollow" size="xs" @click="pendingDeleteId = null">
                            Cancel
                        </Button>
                    </template>
                    <button
                        v-else
                        type="button"
                        class="ua-icon-button"
                        title="Delete bill"
                        aria-label="Delete bill"
                        @click="pendingDeleteId = row.id"
                    >
                        <i class="fas fa-trash" aria-hidden="true" />
                    </button>
                </div>
            </template>
        </DataList>
        <div v-if="nextCursor && !loadFailed" class="ua-load-more">
            <Button type="blue-hollow" size="sm" :loading="loadingMore" @click="loadOlderBills">
                Load older bills
            </Button>
        </div>
    </section>
</template>

<script setup lang="ts">
import {computed, nextTick, reactive, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import useWsRpc from '@/composables/useWsRpc';
import {CURRENCIES} from '@/helpers/currencies';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {
    type BillImportIssue,
    billCoverageLabel,
    formatMoney,
    parseRecordedBillCsv,
    RECORDED_BILL_IMPORT_LIMIT,
    type RecordedBillInput,
    type RecordedBillRow,
    recordedBillFileSizeIssue,
    validateRecordedBillInput
} from '@/helpers/utilityAccounting';
import {useAuthStore} from '@/stores/auth';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';

// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const auth = useAuthStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const toast = useToastStore();
const canWrite = computed(() =>
    auth.canPerformComponent('reports', 'update')
);

type BillCursor = {periodStart: string; id: number};
type BillListResult = {bills: RecordedBillRow[]; nextCursor: BillCursor | null};
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const billsRpc = useWsRpc<BillListResult>('bill.list', {limit: 100});
const {data, loading, error: loadFailed, refresh} = billsRpc;
const bills = computed(() => data.value?.bills ?? []);
const nextCursor = computed(() => data.value?.nextCursor ?? null);
const loadingMore = ref(false);

const columns: DataColumn<RecordedBillRow>[] = [
    {key: 'period', label: 'Billing period', role: 'primary'},
    {key: 'amount', label: 'Actual total', role: 'secondary', align: 'right'},
    {key: 'coverage', label: 'Reconciliation coverage', role: 'status'},
    {key: 'identity', label: 'Recorded identity', role: 'meta'},
    {key: 'actions', label: '', role: 'action', align: 'right'}
];

const showCreate = ref(false);
const createRoot = ref<HTMLFormElement | null>(null);
const importRoot = ref<HTMLFormElement | null>(null);
const saving = ref(false);
const formError = ref('');
const fieldErrors = reactive({periodStart: '', periodEnd: '', actualCost: ''});
const billForm = reactive({
    periodStart: '',
    periodEnd: '',
    actualCost: '' as string | number,
    currency: '',
    utilityAccountId: '',
    meterIdentifier: '',
    servicePointIdentifier: ''
});

const coveragePreview = computed(() => billCoverageLabel(normalizedIdentity()));

function toggleCreate(): void {
    showImport.value = false;
    showCreate.value = !showCreate.value;
    formError.value = '';
    if (showCreate.value) {
        void nextTick(() =>
            createRoot.value?.querySelector<HTMLElement>('input, select')?.focus()
        );
    }
}

function closeCreate(): void {
    showCreate.value = false;
    formError.value = '';
}

function normalizedIdentity() {
    return {
        utilityAccountId: billForm.utilityAccountId.trim() || undefined,
        meterIdentifier: billForm.meterIdentifier.trim() || undefined,
        servicePointIdentifier:
            billForm.servicePointIdentifier.trim() || undefined
    };
}

function normalizedBill(): RecordedBillInput {
    return {
        periodStart: billForm.periodStart,
        periodEnd: billForm.periodEnd,
        actualCost: Number(billForm.actualCost),
        currency: billForm.currency.trim().toUpperCase(),
        ...normalizedIdentity()
    };
}

async function saveBill(): Promise<void> {
    if (!canWrite.value || saving.value) return;
    fieldErrors.periodStart = '';
    fieldErrors.periodEnd = '';
    fieldErrors.actualCost = '';
    formError.value = '';
    const input = normalizedBill();
    const validation = validateRecordedBillInput(input);
    if (validation) {
        if (!billForm.periodStart) fieldErrors.periodStart = 'Start date is required.';
        if (!billForm.periodEnd) fieldErrors.periodEnd = 'End date is required.';
        if (
            billForm.actualCost === '' ||
            !Number.isFinite(Number(billForm.actualCost)) ||
            Number(billForm.actualCost) < 0
        ) {
            fieldErrors.actualCost = 'Enter an amount of zero or greater.';
        }
        formError.value = validation;
        return;
    }
    saving.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'bill.set', input);
        toast.success('Recorded bill saved');
        resetBillForm();
        showCreate.value = false;
        refresh();
    } catch (error) {
        formError.value = rpcErrorMessage(error, 'Could not save the bill');
    } finally {
        saving.value = false;
    }
}

async function loadOlderBills(): Promise<void> {
    if (!nextCursor.value || loadingMore.value) return;
    loadingMore.value = true;
    try {
        const result = (await sendRPC('FLEET_MANAGER', 'bill.list', {
            limit: 100,
            cursor: nextCursor.value
        })) as BillListResult;
        data.value = {
            bills: [...bills.value, ...result.bills],
            nextCursor: result.nextCursor
        };
    } catch (error) {
        toast.error(rpcErrorMessage(error, 'Could not load older bills'));
    } finally {
        loadingMore.value = false;
    }
}

function resetBillForm(): void {
    billForm.periodStart = '';
    billForm.periodEnd = '';
    billForm.actualCost = '';
    billForm.currency = '';
    billForm.utilityAccountId = '';
    billForm.meterIdentifier = '';
    billForm.servicePointIdentifier = '';
}

const showImport = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const importRows = ref<RecordedBillInput[]>([]);
const importIssues = ref<BillImportIssue[]>([]);
const importError = ref('');
const importing = ref(false);

function toggleImport(): void {
    showCreate.value = false;
    showImport.value = !showImport.value;
    importError.value = '';
    if (showImport.value) {
        void nextTick(() => importRoot.value?.querySelector<HTMLElement>('input')?.focus());
    }
}

function closeImport(): void {
    showImport.value = false;
    importRows.value = [];
    importIssues.value = [];
    importError.value = '';
    if (fileInput.value) fileInput.value.value = '';
}

async function readImportFile(event: Event): Promise<void> {
    importRows.value = [];
    importIssues.value = [];
    importError.value = '';
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const sizeIssue = recordedBillFileSizeIssue(file.size);
    if (sizeIssue) {
        importIssues.value = [
            {row: 1, message: sizeIssue}
        ];
        return;
    }
    try {
        const parsed = parseRecordedBillCsv(await file.text());
        importRows.value = parsed.rows;
        importIssues.value = parsed.issues;
    } catch (error) {
        importError.value = rpcErrorMessage(error, 'Could not read the CSV file');
    }
}

async function importBills(): Promise<void> {
    if (
        !canWrite.value ||
        importing.value ||
        importRows.value.length === 0 ||
        importIssues.value.length > 0
    ) {
        return;
    }
    importing.value = true;
    importError.value = '';
    try {
        await sendRPC('FLEET_MANAGER', 'bill.import', {
            bills: importRows.value
        });
        toast.success(
            `${importRows.value.length} recorded bill${importRows.value.length === 1 ? '' : 's'} imported`
        );
        closeImport();
        refresh();
    } catch (error) {
        importError.value = rpcErrorMessage(error, 'Could not import the bills');
    } finally {
        importing.value = false;
    }
}

const pendingDeleteId = ref<number | null>(null);
const deletingId = ref<number | null>(null);

async function deleteBill(row: RecordedBillRow): Promise<void> {
    if (!canWrite.value || deletingId.value !== null) return;
    deletingId.value = row.id;
    try {
        await sendRPC('FLEET_MANAGER', 'bill.delete', {id: row.id});
        toast.success('Recorded bill deleted');
        pendingDeleteId.value = null;
        refresh();
    } catch (error) {
        toast.error(rpcErrorMessage(error, 'Could not delete the bill'));
    } finally {
        deletingId.value = null;
    }
}

function hasAnyIdentity(row: RecordedBillRow): boolean {
    return Boolean(
        row.utilityAccountId || row.meterIdentifier || row.servicePointIdentifier
    );
}

function hasCompleteIdentity(row: RecordedBillRow): boolean {
    return Boolean(
        row.utilityAccountId && row.meterIdentifier && row.servicePointIdentifier
    );
}

function formatPeriod(row: RecordedBillRow): string {
    return `${row.periodStart} – ${row.periodEnd}`;
}

</script>
