<template>
    <section class="ua-panel" aria-labelledby="carbon-title">
        <header class="ua-panel__header">
            <div class="ua-panel__heading">
                <h2 id="carbon-title">Carbon accounting</h2>
                <p>
                    Maintain versioned physical emission factors and separate
                    carbon valuations. Carbon prices are disclosures and are
                    never added to a utility bill.
                </p>
            </div>
            <Button v-if="canCreate" type="green" size="sm" @click="openEditor">
                Add {{ view === 'factors' ? 'factor' : 'carbon price' }}
            </Button>
        </header>

        <div class="ua-filterbar">
            <fieldset class="ua-segment">
                <legend class="sr-only">Carbon records</legend>
                <button
                    type="button"
                    :aria-pressed="view === 'factors'"
                    :class="{'is-active': view === 'factors'}"
                    @click="view = 'factors'"
                >
                    Emission factors
                </button>
                <button
                    type="button"
                    :aria-pressed="view === 'prices'"
                    :class="{'is-active': view === 'prices'}"
                    @click="view = 'prices'"
                >
                    Carbon prices
                </button>
            </fieldset>
        </div>

        <form
            v-if="showEditor && view === 'factors'"
            ref="editorRoot"
            class="ua-editor"
            aria-labelledby="factor-editor-title"
            @submit.prevent="saveFactor"
        >
            <div class="ua-editor__head">
                <div>
                    <h3 id="factor-editor-title">Add emission factor revision</h3>
                    <p>Factors are stored in kilograms of CO₂e per billed unit.</p>
                </div>
                <button type="button" class="ua-icon-button" aria-label="Close factor form" @click="closeEditor">
                    <i class="fas fa-xmark" aria-hidden="true" />
                </button>
            </div>
            <div class="ua-form-grid">
                <FormField field-id="carbon-factor-commodity" label="Commodity">
                    <select id="carbon-factor-commodity" v-model="factorForm.commodity" class="ua-select">
                        <option v-for="value in COMMODITIES" :key="value" :value="value">{{ titleCase(value) }}</option>
                    </select>
                </FormField>
                <FormField field-id="carbon-factor-billed-unit" label="Billed unit">
                    <select id="carbon-factor-billed-unit" v-model="factorForm.billedUnit" class="ua-select">
                        <option v-for="unit in factorUnits" :key="unit" :value="unit">{{ unit }}</option>
                    </select>
                </FormField>
                <FormField label="Region" hint="Use the published factor’s geographic or market region.">
                    <Input v-model="factorForm.region" :maxlength="120" required />
                </FormField>
                <FormField field-id="carbon-factor-accounting-basis" label="Accounting basis">
                    <select id="carbon-factor-accounting-basis" v-model="factorForm.accountingBasis" class="ua-select">
                        <option value="location_based">Location-based</option>
                        <option value="market_based">Market-based</option>
                        <option value="direct">Direct</option>
                    </select>
                </FormField>
                <FormField field-id="carbon-factor-emissions-scope" label="Emissions scope">
                    <select id="carbon-factor-emissions-scope" v-model="factorForm.emissionsScope" class="ua-select">
                        <option v-for="scope in factorScopes" :key="scope" :value="scope">{{ scopeLabel(scope) }}</option>
                    </select>
                </FormField>
                <FormField field-id="carbon-factor-value" label="kg CO₂e per billed unit">
                    <input id="carbon-factor-value" v-model="factorForm.factorKgPerUnit" class="ua-input" type="number" min="0" step="any" required />
                </FormField>
                <FormField field-id="carbon-factor-effective-from" label="Effective from">
                    <input id="carbon-factor-effective-from" v-model="factorForm.effectiveFrom" class="ua-input" type="datetime-local" required />
                </FormField>
                <FormField field-id="carbon-factor-effective-to" label="Effective to" optional hint="Exclusive. Leave empty for an open-ended revision.">
                    <input id="carbon-factor-effective-to" v-model="factorForm.effectiveTo" class="ua-input" type="datetime-local" />
                </FormField>
                <FormField label="Revision" optional hint="Defaults to the next stored revision.">
                    <Input v-model="factorForm.revision" type="number" :min="1" />
                </FormField>
                <FormField label="Source reference">
                    <Input v-model="factorForm.sourceReference" :maxlength="1000" required placeholder="Publication, dataset, or contract reference" />
                </FormField>
            </div>
            <p v-if="formError" class="ua-form-error" role="alert">{{ formError }}</p>
            <div class="ua-editor__footer">
                <Button type="blue-hollow" size="sm" @click="closeEditor">Cancel</Button>
                <Button type="green" size="sm" submit :loading="saving">Save factor</Button>
            </div>
        </form>

        <form
            v-if="showEditor && view === 'prices'"
            ref="editorRoot"
            class="ua-editor"
            aria-labelledby="price-editor-title"
            @submit.prevent="savePrice"
        >
            <div class="ua-editor__head">
                <div>
                    <h3 id="price-editor-title">Add carbon price revision</h3>
                    <p>This valuation remains separate from tariff charges and recorded bills.</p>
                </div>
                <button type="button" class="ua-icon-button" aria-label="Close carbon price form" @click="closeEditor">
                    <i class="fas fa-xmark" aria-hidden="true" />
                </button>
            </div>
            <div class="ua-form-grid">
                <FormField label="Name">
                    <Input v-model="priceForm.name" :maxlength="128" required />
                </FormField>
                <FormField field-id="carbon-price-type" label="Price type">
                    <select id="carbon-price-type" v-model="priceForm.priceType" class="ua-select">
                        <option value="shadow">Shadow price</option>
                        <option value="fee">Fee</option>
                        <option value="implicit">Implicit</option>
                        <option value="regulated">Regulated</option>
                    </select>
                </FormField>
                <FormField field-id="carbon-price-scope" label="Applies to scope">
                    <select id="carbon-price-scope" v-model="priceForm.appliesToScope" class="ua-select">
                        <option value="all">All scopes</option>
                        <option value="scope1">Scope 1</option>
                        <option value="scope2">Scope 2</option>
                        <option value="scope3">Scope 3</option>
                    </select>
                </FormField>
                <FormField label="Currency" hint="Three-letter ISO 4217 code.">
                    <Input v-model="priceForm.currency" :maxlength="3" required autocapitalize="characters" :spellcheck="false" />
                </FormField>
                <FormField field-id="carbon-price-amount" label="Amount per tonne CO₂e">
                    <input id="carbon-price-amount" v-model="priceForm.amountPerTonne" class="ua-input" type="number" min="0" step="any" required />
                </FormField>
                <FormField field-id="carbon-price-effective-from" label="Effective from">
                    <input id="carbon-price-effective-from" v-model="priceForm.effectiveFrom" class="ua-input" type="datetime-local" required />
                </FormField>
                <FormField field-id="carbon-price-effective-to" label="Effective to" optional hint="Exclusive. Leave empty for an open-ended revision.">
                    <input id="carbon-price-effective-to" v-model="priceForm.effectiveTo" class="ua-input" type="datetime-local" />
                </FormField>
                <FormField label="Revision" optional hint="Defaults to the next stored revision.">
                    <Input v-model="priceForm.revision" type="number" :min="1" />
                </FormField>
                <FormField label="Source reference">
                    <Input v-model="priceForm.sourceReference" :maxlength="1000" required />
                </FormField>
            </div>
            <div class="ua-coverage" role="note">
                <i class="fas fa-circle-info" aria-hidden="true" />
                <div>
                    <strong>Disclosure only</strong>
                    <span>Saving this price does not alter a tariff, calculated utility cost, or recorded bill.</span>
                </div>
            </div>
            <p v-if="formError" class="ua-form-error" role="alert">{{ formError }}</p>
            <div class="ua-editor__footer">
                <Button type="blue-hollow" size="sm" @click="closeEditor">Cancel</Button>
                <Button type="green" size="sm" submit :loading="saving">Save carbon price</Button>
            </div>
        </form>

        <div v-if="loadError" class="ua-state ua-state--error" role="alert">
            <div><strong>Couldn’t load carbon records.</strong><span>{{ loadError }}</span></div>
            <Button type="blue-hollow" size="sm" @click="reload">Retry</Button>
        </div>

        <div
            v-if="view === 'factors' && !loadError"
        >
            <DataList :rows="factors" :columns="factorColumns" row-key="id" :loading="loadingFactors" empty-message="No emission factors have been recorded.">
                <template #cell-factor="{row}">
                    <span class="ua-primary ua-number">{{ row.factorKgPerUnit }} kg CO₂e/{{ row.billedUnit }}</span>
                </template>
                <template #cell-source="{row}"><span dir="auto">{{ row.sourceReference }}</span></template>
                <template #cell-context="{row}">{{ titleCase(row.commodity) }} · {{ row.region }}</template>
                <template #cell-basis="{row}">
                    <span class="ua-badge">{{ titleCase(row.accountingBasis) }} · {{ scopeLabel(row.emissionsScope) }}</span>
                </template>
                <template #cell-period="{row}">{{ formatPeriod(row.effectiveFrom, row.effectiveTo) }} · rev {{ row.revision }}</template>
            </DataList>
            <div v-if="factorCursor" class="ua-load-more">
                <Button type="blue-hollow" size="sm" :loading="loadingMore" @click="loadMoreFactors">Load older factors</Button>
            </div>
        </div>

        <div
            v-if="view === 'prices' && !loadError"
        >
            <div class="ua-coverage ua-coverage--neutral" role="note">
                <i class="fas fa-scale-balanced" aria-hidden="true" />
                <div><strong>Separate valuation</strong><span>These values appear as carbon disclosures, never as utility charges.</span></div>
            </div>
            <DataList :rows="prices" :columns="priceColumns" row-key="id" :loading="loadingPrices" empty-message="No carbon prices have been recorded.">
                <template #cell-name="{row}"><span class="ua-primary" dir="auto">{{ row.name }}</span></template>
                <template #cell-amount="{row}"><span class="ua-number">{{ formatMoney(row.amountPerTonne, row.currency) }}/t CO₂e</span></template>
                <template #cell-type="{row}"><span class="ua-badge">{{ titleCase(row.priceType) }} · {{ scopeLabel(row.appliesToScope) }}</span></template>
                <template #cell-period="{row}">{{ formatPeriod(row.effectiveFrom, row.effectiveTo) }} · rev {{ row.revision }}</template>
                <template #cell-source="{row}"><span dir="auto">{{ row.sourceReference }}</span></template>
            </DataList>
            <div v-if="priceCursor" class="ua-load-more">
                <Button type="blue-hollow" size="sm" :loading="loadingMore" @click="loadMorePrices">Load older prices</Button>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import {computed, nextTick, onMounted, reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {formatMoney} from '@/helpers/utilityAccounting';
import type {HostParams, HostResult} from '@/shell/template-host/generated/contract';
import {useAuthStore} from '@/stores/auth';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';

type Factor = HostResult<'carbon.listemissionfactors'>['items'][number];
type CarbonPrice = HostResult<'carbon.listprices'>['items'][number];
type FactorInput = HostParams<'carbon.addemissionfactor'>;
type PriceInput = HostParams<'carbon.addprice'>;
type Commodity = FactorInput['commodity'];
type Scope = FactorInput['emissionsScope'];

const COMMODITIES: Commodity[] = ['electricity', 'water', 'gas', 'heat'];
const UNIT_BY_COMMODITY: Record<Commodity, string[]> = {
    electricity: ['kWh'],
    water: ['m3', 'l'],
    gas: ['m3', 'kWh', 'therm', 'MMBtu', 'GJ'],
    heat: ['kWh']
};

// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const auth = useAuthStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const toast = useToastStore();
const canCreate = computed(() => auth.canPerformComponent('reports', 'create'));
const view = ref<'factors' | 'prices'>('factors');
const showEditor = ref(false);
const editorRoot = ref<HTMLFormElement | null>(null);
const saving = ref(false);
const formError = ref('');

const factors = ref<Factor[]>([]);
const prices = ref<CarbonPrice[]>([]);
const factorCursor = ref<number | null>(null);
const priceCursor = ref<number | null>(null);
const loadingFactors = ref(true);
const loadingPrices = ref(true);
const loadingMore = ref(false);
const loadError = ref('');

const factorColumns: DataColumn<Factor>[] = [
    {key: 'factor', label: 'Factor', role: 'primary'},
    {key: 'context', label: 'Commodity / region', role: 'secondary'},
    {key: 'basis', label: 'Basis / scope', role: 'status'},
    {key: 'period', label: 'Effective period', role: 'meta'},
    {key: 'source', label: 'Source', role: 'meta'}
];
const priceColumns: DataColumn<CarbonPrice>[] = [
    {key: 'name', label: 'Carbon price', role: 'primary'},
    {key: 'amount', label: 'Valuation', role: 'secondary'},
    {key: 'type', label: 'Type / scope', role: 'status'},
    {key: 'period', label: 'Effective period', role: 'meta'},
    {key: 'source', label: 'Source', role: 'meta'}
];

async function loadFactors(beforeId?: number): Promise<void> {
    const result = (await sendRPC('FLEET_MANAGER', 'carbon.listemissionfactors', {
        limit: 100,
        ...(beforeId ? {beforeId} : {})
    })) as HostResult<'carbon.listemissionfactors'>;
    factors.value = beforeId ? [...factors.value, ...result.items] : result.items;
    factorCursor.value = result.nextBeforeId;
}

async function loadPrices(beforeId?: number): Promise<void> {
    const result = (await sendRPC('FLEET_MANAGER', 'carbon.listprices', {
        limit: 100,
        ...(beforeId ? {beforeId} : {})
    })) as HostResult<'carbon.listprices'>;
    prices.value = beforeId ? [...prices.value, ...result.items] : result.items;
    priceCursor.value = result.nextBeforeId;
}

async function reload(): Promise<void> {
    loadError.value = '';
    loadingFactors.value = true;
    loadingPrices.value = true;
    try {
        await Promise.all([loadFactors(), loadPrices()]);
    } catch (error) {
        loadError.value = rpcErrorMessage(error, 'Request failed');
    } finally {
        loadingFactors.value = false;
        loadingPrices.value = false;
    }
}

onMounted(() => void reload());

async function loadMoreFactors(): Promise<void> {
    if (!factorCursor.value || loadingMore.value) return;
    loadingMore.value = true;
    try {
        await loadFactors(factorCursor.value);
    } catch (error) {
        toast.error(rpcErrorMessage(error, 'Could not load older factors'));
    } finally {
        loadingMore.value = false;
    }
}

async function loadMorePrices(): Promise<void> {
    if (!priceCursor.value || loadingMore.value) return;
    loadingMore.value = true;
    try {
        await loadPrices(priceCursor.value);
    } catch (error) {
        toast.error(rpcErrorMessage(error, 'Could not load older carbon prices'));
    } finally {
        loadingMore.value = false;
    }
}

const factorForm = reactive({
    commodity: 'electricity' as Commodity,
    billedUnit: 'kWh',
    region: '',
    accountingBasis: 'location_based' as FactorInput['accountingBasis'],
    emissionsScope: 'scope2' as Scope,
    factorKgPerUnit: '' as string | number,
    effectiveFrom: '',
    effectiveTo: '',
    sourceReference: '',
    revision: '' as string | number
});
const priceForm = reactive({
    name: '',
    priceType: 'shadow' as PriceInput['priceType'],
    appliesToScope: 'all' as PriceInput['appliesToScope'],
    currency: '',
    amountPerTonne: '' as string | number,
    effectiveFrom: '',
    effectiveTo: '',
    sourceReference: '',
    revision: '' as string | number
});

const factorUnits = computed(() => UNIT_BY_COMMODITY[factorForm.commodity]);
const factorScopes = computed<Scope[]>(() =>
    factorForm.accountingBasis === 'direct'
        ? ['scope1', 'scope3']
        : ['scope2']
);
watch(
    () => factorForm.commodity,
    () => {
        factorForm.billedUnit = factorUnits.value[0];
    }
);
watch(
    () => factorForm.accountingBasis,
    () => {
        factorForm.emissionsScope = factorScopes.value[0];
    }
);
watch(view, () => closeEditor());

function openEditor(): void {
    showEditor.value = true;
    formError.value = '';
    void nextTick(() =>
        editorRoot.value?.querySelector<HTMLElement>('input, select')?.focus()
    );
}
function closeEditor(): void {
    showEditor.value = false;
    formError.value = '';
}

async function saveFactor(): Promise<void> {
    if (!canCreate.value || saving.value) return;
    formError.value = '';
    const input: FactorInput = {
        commodity: factorForm.commodity,
        billedUnit: factorForm.billedUnit,
        region: factorForm.region.trim(),
        accountingBasis: factorForm.accountingBasis,
        emissionsScope: factorForm.emissionsScope,
        factorKgPerUnit: Number(factorForm.factorKgPerUnit),
        effectiveFrom: toIso(factorForm.effectiveFrom),
        ...(factorForm.effectiveTo ? {effectiveTo: toIso(factorForm.effectiveTo)} : {}),
        sourceReference: factorForm.sourceReference.trim(),
        ...(factorForm.revision ? {revision: Number(factorForm.revision)} : {})
    };
    const validation = validateFactor(input);
    if (validation) {
        formError.value = validation;
        return;
    }
    saving.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'carbon.addemissionfactor', input);
        toast.success('Emission factor revision saved');
        closeEditor();
        await loadFactors();
    } catch (error) {
        formError.value = rpcErrorMessage(error, 'Could not save the emission factor');
    } finally {
        saving.value = false;
    }
}

async function savePrice(): Promise<void> {
    if (!canCreate.value || saving.value) return;
    formError.value = '';
    const input: PriceInput = {
        name: priceForm.name.trim(),
        priceType: priceForm.priceType,
        appliesToScope: priceForm.appliesToScope,
        currency: priceForm.currency.trim().toUpperCase(),
        amountPerTonne: Number(priceForm.amountPerTonne),
        effectiveFrom: toIso(priceForm.effectiveFrom),
        ...(priceForm.effectiveTo ? {effectiveTo: toIso(priceForm.effectiveTo)} : {}),
        sourceReference: priceForm.sourceReference.trim(),
        ...(priceForm.revision ? {revision: Number(priceForm.revision)} : {})
    };
    const validation = validatePrice(input);
    if (validation) {
        formError.value = validation;
        return;
    }
    saving.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'carbon.addprice', input);
        toast.success('Carbon price revision saved');
        closeEditor();
        await loadPrices();
    } catch (error) {
        formError.value = rpcErrorMessage(error, 'Could not save the carbon price');
    } finally {
        saving.value = false;
    }
}

function validateFactor(input: FactorInput): string | null {
    if (!input.region) return 'Region is required.';
    if (!Number.isFinite(input.factorKgPerUnit) || input.factorKgPerUnit < 0) return 'Factor must be zero or greater.';
    if (!input.sourceReference) return 'Source reference is required.';
    return validatePeriod(input.effectiveFrom, input.effectiveTo);
}
function validatePrice(input: PriceInput): string | null {
    if (!input.name) return 'Name is required.';
    if (!/^[A-Z]{3}$/.test(input.currency)) return 'Currency must be a three-letter ISO 4217 code.';
    if (!Number.isFinite(input.amountPerTonne) || input.amountPerTonne < 0) return 'Amount per tonne must be zero or greater.';
    if (!input.sourceReference) return 'Source reference is required.';
    return validatePeriod(input.effectiveFrom, input.effectiveTo);
}
function validatePeriod(from: string, to?: string | null): string | null {
    if (!Number.isFinite(Date.parse(from))) return 'Effective from is required.';
    if (to && Date.parse(to) <= Date.parse(from)) return 'Effective to must be after effective from.';
    return null;
}
function toIso(value: string): string {
    return value ? new Date(value).toISOString() : '';
}
function formatPeriod(from: string, to?: string | null): string {
    return `${formatTimestamp(from)} – ${to ? formatTimestamp(to) : 'Open ended'}`;
}
function formatTimestamp(value: string): string {
    return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value));
}
function scopeLabel(scope: string): string {
    return scope === 'all' ? 'All scopes' : `Scope ${scope.slice(-1)}`;
}
function titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', '-');
}
</script>
