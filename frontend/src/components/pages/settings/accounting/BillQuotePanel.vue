<template>
    <section class="ua-panel" aria-labelledby="bill-quote-title">
        <header class="ua-panel__header">
            <div class="ua-panel__heading">
                <h2 id="bill-quote-title">Bill</h2>
                <p>What a period cost, and why.</p>
            </div>
        </header>

        <div
            v-if="setupError"
            class="ua-state ua-state--error"
            role="alert"
            data-test="bill-setup-error"
        >
            <div>
                <strong>Couldn’t load the tariffs.</strong>
                <span>{{ setupError }}</span>
            </div>
            <Button type="blue-hollow" size="sm" @click="loadTariffs">
                Retry
            </Button>
        </div>

        <div v-else-if="noTariff" class="ua-state" data-test="bill-no-tariff">
            <div>
                <strong>No tariff is set up yet.</strong>
                <span>
                    A bill needs a price. Add one on the
                    <RouterLink to="/settings/energy/tariffs">
                        Tariffs page
                    </RouterLink>
                    and assign it to this organization, a location, a device or
                    a channel.
                </span>
            </div>
        </div>

        <div class="ua-editor">
            <div class="ua-form-grid">
                <FormField field-id="bill-from" label="From">
                    <input
                        id="bill-from"
                        v-model="from"
                        class="ua-input"
                        type="date"
                        data-test="bill-from"
                        @input="clearChosenPeriod"
                    />
                </FormField>
                <FormField field-id="bill-to" label="To">
                    <input
                        id="bill-to"
                        v-model="to"
                        class="ua-input"
                        type="date"
                        data-test="bill-to"
                        @input="clearChosenPeriod"
                    />
                </FormField>
                <FormField field-id="bill-commodity" label="Energy type">
                    <select
                        id="bill-commodity"
                        v-model="commodity"
                        class="ua-select"
                        data-test="bill-commodity"
                    >
                        <option
                            v-for="option in COMMODITY_OPTIONS"
                            :key="option.value"
                            :value="option.value"
                        >
                            {{ option.label }}
                        </option>
                    </select>
                </FormField>
                <FormField
                    field-id="bill-tariff"
                    label="Bill on this tariff’s calendar"
                    optional
                >
                    <select
                        id="bill-tariff"
                        v-model="tariffId"
                        class="ua-select"
                        data-test="bill-tariff"
                    >
                        <option :value="null">No tariff chosen</option>
                        <option
                            v-for="tariff in tariffs"
                            :key="tariff.id"
                            :value="tariff.id"
                        >
                            {{ tariff.name }}
                        </option>
                    </select>
                </FormField>
                <FormField field-id="bill-scope-mode" label="What to bill">
                    <select
                        id="bill-scope-mode"
                        v-model="scopeMode"
                        class="ua-select"
                        data-test="bill-scope-mode"
                    >
                        <option
                            v-for="mode in BILL_SCOPE_MODES"
                            :key="mode.value"
                            :value="mode.value"
                        >
                            {{ mode.label }}
                        </option>
                    </select>
                </FormField>
                <FormField
                    v-if="scopeMode === 'location'"
                    field-id="bill-location"
                    label="Location"
                >
                    <select
                        id="bill-location"
                        v-model="locationId"
                        class="ua-select"
                        data-test="bill-location"
                    >
                        <option :value="null">Not chosen</option>
                        <option
                            v-for="location in locationOptions"
                            :key="location.id"
                            :value="location.id"
                        >
                            {{ location.name }}
                        </option>
                    </select>
                </FormField>
                <FormField
                    v-if="scopeMode === 'device' || scopeMode === 'channel'"
                    field-id="bill-device"
                    label="Device"
                >
                    <select
                        id="bill-device"
                        v-model="deviceId"
                        class="ua-select"
                        data-test="bill-device"
                    >
                        <option :value="null">Not chosen</option>
                        <option
                            v-for="device in deviceOptions"
                            :key="device.id"
                            :value="device.id"
                        >
                            {{ device.label }}
                        </option>
                    </select>
                </FormField>
                <FormField
                    v-if="scopeMode === 'channel'"
                    field-id="bill-channel"
                    label="Channel"
                >
                    <select
                        id="bill-channel"
                        v-model="channel"
                        class="ua-select"
                        data-test="bill-channel"
                    >
                        <option :value="null">Not chosen</option>
                        <option
                            v-for="number in channelOptions"
                            :key="number"
                            :value="number"
                        >
                            Channel {{ number }}
                        </option>
                    </select>
                </FormField>
                <FormField
                    field-id="bill-series"
                    label="Usage over time"
                    optional
                    hint="Adds a priced row per interval. Long periods at a fine interval are refused."
                >
                    <select
                        id="bill-series"
                        v-model="seriesBucket"
                        class="ua-select"
                        data-test="bill-series"
                    >
                        <option :value="null">No breakdown</option>
                        <option
                            v-for="bucket in SERIES_BUCKETS"
                            :key="bucket"
                            :value="bucket"
                        >
                            {{ bucket }}
                        </option>
                    </select>
                </FormField>
            </div>

            <p class="bq-hint" data-test="bill-period-zone">
                {{ periodZoneLine }}
            </p>

            <div v-if="scopeMode === 'meters'" class="bq-meters">
                <p v-if="metersError" class="ua-form-error">
                    {{ metersError }}
                </p>
                <p v-else-if="meters.length === 0" class="bq-hint">
                    No logical meters exist yet. Build them on the Meters page.
                </p>
                <label
                    v-for="meter in meters"
                    :key="meter.id"
                    class="ua-check"
                >
                    <input
                        type="checkbox"
                        :value="meter.id"
                        :checked="meterIds.includes(meter.id)"
                        :data-test="`bill-meter-${meter.id}`"
                        @change="toggleMeter(meter.id)"
                    />
                    <span>{{ meter.name }}</span>
                </label>
            </div>

            <p v-if="tariffError" class="ua-form-error">
                {{ tariffError }}
            </p>

            <p v-if="periodsError" class="ua-form-error">
                {{ periodsError }}
            </p>

            <p v-if="assignmentsError" class="ua-form-error">
                {{ assignmentsError }}
            </p>

            <p
                v-if="zoneConflict"
                class="ua-form-error"
                role="alert"
                data-test="bill-zone-conflict"
            >
                {{ zoneConflict }}
            </p>

            <p
                v-if="zoneCheckGap"
                class="bq-hint"
                data-test="bill-zone-check-gap"
            >
                {{ zoneCheckGap }}
            </p>

            <div v-if="periodChips.length > 0">
                <p class="bq-hint">
                    Pick a billing period to bill exactly the days the tariff
                    counts.
                </p>
                <div class="ua-segment bq-periods">
                    <button
                        v-for="period in periodChips"
                        :key="period.key"
                        type="button"
                        :class="{'is-active': period.key === chosenPeriodKey}"
                        :aria-pressed="period.key === chosenPeriodKey"
                        :data-test="`bill-period-${period.key}`"
                        @click="choosePeriod(period)"
                    >
                        {{ period.key }} · {{ period.days }} days
                    </button>
                </div>
            </div>

            <label class="ua-check">
                <input v-model="avoidedImportCost" type="checkbox" />
                <span>
                    Also estimate the import cost avoided by using on-site
                    generation. It is never part of the bill.
                </span>
            </label>

            <div class="ua-editor__footer">
                <span v-if="requestIssue" class="ua-form-error">
                    {{ requestIssue }}
                </span>
                <Button
                    type="blue"
                    :loading="calculating"
                    :disabled="calculateIssue !== null"
                    @click="calculate"
                >
                    Calculate
                </Button>
            </div>
        </div>

        <div
            v-if="quoteError"
            class="ua-state ua-state--error"
            role="alert"
            data-test="bill-error"
        >
            <div>
                <strong>Couldn’t calculate the bill.</strong>
                <span>{{ quoteError }}</span>
            </div>
        </div>

        <div v-if="!result" class="ua-state" data-test="bill-empty">
            <div>
                <strong>No bill yet.</strong>
                <span>
                    Choose the period and what to bill, then press Calculate.
                </span>
            </div>
        </div>

        <div v-else class="ua-section-stack" data-test="bill-result">
            <div class="ua-section-heading">
                <div>
                    <h3>{{ resultPeriodLine }}</h3>
                    <p>
                        Priced from the tariffs that apply to what you billed.
                    </p>
                    <dl class="bq-total">
                        <dt class="bq-total__label">Net cost</dt>
                        <dd
                            class="bq-total__value ua-number"
                            data-test="bill-net-cost"
                        >
                            {{ amountText(result.netCost) }}
                        </dd>
                    </dl>
                </div>
                <span class="ua-badge" :class="statusBadgeClass">
                    {{ statusLabel }}
                </span>
            </div>

            <dl class="ua-summary-grid">
                <div>
                    <dt>Quantity</dt>
                    <dd class="ua-number" data-test="bill-quantity">
                        {{ quantityText(result.quantity) }}
                    </dd>
                </div>
                <div>
                    <dt>Priced</dt>
                    <dd class="ua-number">
                        {{ quantityText(result.pricedQuantity) }}
                    </dd>
                </div>
                <div>
                    <dt>Not priced</dt>
                    <dd class="ua-number">
                        {{ quantityText(result.unpricedQuantity) }}
                    </dd>
                </div>
                <div>
                    <dt>Returned to the grid</dt>
                    <dd class="ua-number">
                        {{ quantityText(result.returnedQuantity) }}
                    </dd>
                </div>
            </dl>

            <dl class="ua-summary-grid" data-test="bill-charges">
                <div>
                    <dt>Usage charge</dt>
                    <dd class="ua-number" data-test="bill-usage-charge">
                        {{ amountText(result.usageCharge) }}
                    </dd>
                </div>
                <div>
                    <dt>Standing charge</dt>
                    <dd class="ua-number" data-test="bill-standing-charge">
                        {{ amountText(result.standingCharge) }}
                    </dd>
                </div>
                <div>
                    <dt>Demand charge</dt>
                    <dd class="ua-number" data-test="bill-demand-charge">
                        {{ amountText(result.demandCharge) }}
                    </dd>
                </div>
                <div>
                    <dt>Export credit</dt>
                    <dd class="ua-number" data-test="bill-export-credit">
                        {{ amountText(result.exportCredit) }}
                    </dd>
                </div>
            </dl>

            <div
                v-if="result.missingConfigurationReasons.length > 0"
                class="ua-state ua-state--error"
                data-test="bill-missing"
            >
                <div>
                    <strong>What is missing</strong>
                    <span
                        v-for="(reason, index) in result
                            .missingConfigurationReasons"
                        :key="index"
                    >
                        {{ reason }}
                    </span>
                    <span>
                        Set prices on the
                        <RouterLink to="/settings/energy/tariffs"
                            >Tariffs page</RouterLink
                        >.
                    </span>
                </div>
            </div>

            <div
                v-if="result.warnings.length > 0"
                class="ua-state"
                data-test="bill-warnings"
            >
                <div>
                    <strong>Worth knowing</strong>
                    <span
                        v-for="(warning, index) in result.warnings"
                        :key="index"
                    >
                        {{ warning.message }}
                    </span>
                </div>
            </div>

            <div class="ua-state" data-test="bill-difference">
                <div>
                    <strong>Against the recorded bill</strong>
                    <template v-if="difference && difference.status === 'ready'">
                        <span>
                            Recorded {{ amountText(difference.recorded) }} ·
                            Our estimate {{ amountText(difference.shadow) }}
                        </span>
                        <span>{{ differenceSentence }}</span>
                        <span>{{ difference.coverageWarning }}</span>
                    </template>
                    <span v-else-if="difference">{{ difference.message }}</span>
                </div>
            </div>

            <div v-if="result.components.length > 0">
                <div class="ua-subsection-heading">
                    <h4>Price components</h4>
                </div>
                <DataList
                    :rows="result.components"
                    :columns="columns.components"
                    row-key="code"
                    empty-message="This tariff carries no named components."
                >
                    <template #cell-amount="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.amount) }}
                        </span>
                    </template>
                    <template #cell-taxable="{row}">
                        <span>{{ row.taxable ? 'Yes' : 'No' }}</span>
                    </template>
                </DataList>
            </div>

            <div v-if="result.taxes.length > 0">
                <div class="ua-subsection-heading">
                    <h4>Taxes</h4>
                </div>
                <DataList
                    :rows="result.taxes"
                    :columns="columns.taxes"
                    row-key="code"
                    empty-message="This tariff carries no taxes."
                >
                    <template #cell-ratePct="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.ratePct) }}%
                        </span>
                    </template>
                    <template #cell-base="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.base) }}
                        </span>
                    </template>
                    <template #cell-amount="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.amount) }}
                        </span>
                    </template>
                    <template #cell-exempt="{row}">
                        <span>{{ row.exempt ? 'Yes' : 'No' }}</span>
                    </template>
                </DataList>
            </div>

            <div v-if="result.demand" data-test="bill-demand">
                <div class="ua-subsection-heading">
                    <h4>Demand</h4>
                    <p>
                        The highest average over one interval, and the peak the
                        tariff actually bills.
                    </p>
                </div>
                <dl class="ua-summary-grid">
                    <div>
                        <dt>Averaged over</dt>
                        <dd>{{ result.demand.intervalMinutes }} minutes</dd>
                    </div>
                    <div>
                        <dt>Charged per</dt>
                        <dd>{{ result.demand.chargePeriod }}</dd>
                    </div>
                    <div>
                        <dt>Measured in</dt>
                        <dd>{{ result.demand.unit }}</dd>
                    </div>
                    <div>
                        <dt>Every period proven</dt>
                        <dd>{{ result.demand.complete ? 'Yes' : 'No' }}</dd>
                    </div>
                </dl>
                <p v-if="result.demand.reason" class="bq-hint">
                    {{ result.demand.reason }}
                </p>
                <DataList
                    :rows="result.demand.periods"
                    :columns="columns.demand"
                    row-key="periodKey"
                    empty-message="No demand period was measured."
                >
                    <template #cell-measuredPeak="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.measuredPeak) }}
                        </span>
                    </template>
                    <template #cell-billedPeak="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.billedPeak) }}
                        </span>
                    </template>
                    <template #cell-peakAt="{row}">
                        <span>{{ formatBillInstant(row.peakAt) }}</span>
                    </template>
                    <template #cell-ratchetApplied="{row}">
                        <span>{{ row.ratchetApplied ? 'Yes' : 'No' }}</span>
                    </template>
                    <template #cell-charge="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.charge) }}
                        </span>
                    </template>
                </DataList>
            </div>

            <div v-if="result.avoidedImportCost" data-test="bill-avoided">
                <div class="ua-subsection-heading">
                    <h4>Import cost avoided</h4>
                    <p>
                        An estimate of what on-site generation saved. It is not
                        billed and is not part of any total above.
                    </p>
                </div>
                <dl class="ua-summary-grid">
                    <div>
                        <dt>Generated</dt>
                        <dd class="ua-number">
                            {{
                                avoidedQuantityText(
                                    result.avoidedImportCost,
                                    result.avoidedImportCost.generationQuantity
                                )
                            }}
                        </dd>
                    </div>
                    <div>
                        <dt>Used on site</dt>
                        <dd class="ua-number">
                            {{
                                avoidedQuantityText(
                                    result.avoidedImportCost,
                                    result.avoidedImportCost
                                        .selfConsumedQuantity
                                )
                            }}
                        </dd>
                    </div>
                    <div>
                        <dt>Cost avoided</dt>
                        <dd class="ua-number" data-test="bill-avoided-cost">
                            {{
                                avoidedAmountText(result.avoidedImportCost)
                            }}
                        </dd>
                    </div>
                </dl>
            </div>

            <div v-if="result.deviceBreakdown.length > 0">
                <div class="ua-subsection-heading">
                    <h4>Per device</h4>
                    <p>
                        Measured usage only. Standing, demand, component and tax
                        amounts belong to the contract and are never split.
                    </p>
                </div>
                <DataList
                    :rows="result.deviceBreakdown"
                    :columns="columns.devices"
                    row-key="device"
                    empty-message="No device reported usage in this period."
                >
                    <template #cell-device="{row}">
                        <span class="ua-primary">
                            {{ deviceLabel(row.device) }}
                        </span>
                    </template>
                    <template #cell-status="{row}">
                        <span class="ua-badge" :class="billStatusBadgeClass(row.status)">
                            {{ billStatusLabel(row.status) }}
                        </span>
                    </template>
                    <template #cell-quantity="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.quantity) }}
                        </span>
                    </template>
                    <template #cell-usageCharge="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.usageCharge) }}
                        </span>
                    </template>
                    <template #cell-exportCredit="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.exportCredit) }}
                        </span>
                    </template>
                    <template #cell-netUsageCharge="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.netUsageCharge) }}
                        </span>
                    </template>
                </DataList>
            </div>

            <div v-if="result.series && result.series.length > 0">
                <div class="ua-subsection-heading">
                    <h4>Usage over time</h4>
                    <p>
                        Measured usage priced per {{ result.seriesBucket }}. A
                        row is not a small bill.
                    </p>
                </div>
                <DataList
                    :rows="result.series"
                    :columns="columns.series"
                    row-key="bucketStart"
                    empty-message="No interval was measured."
                >
                    <template #cell-bucketStart="{row}">
                        <span>{{ formatBillInstant(row.bucketStart) }}</span>
                    </template>
                    <template #cell-quantity="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.quantity) }}
                        </span>
                    </template>
                    <template #cell-usageCharge="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.usageCharge) }}
                        </span>
                    </template>
                    <template #cell-netUsageCharge="{row}">
                        <span class="ua-number">
                            {{ formatBillNumber(row.netUsageCharge) }}
                        </span>
                    </template>
                </DataList>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import {
    BILL_QUOTE_SERIES_BUCKETS,
    type BillQuoteAvoidedImportCost,
    type BillQuoteParams,
    type BillQuoteResponse,
    type BillQuoteSeriesBucket
} from '@api/bill';
import {
    ENERGY_COMMODITIES,
    type EnergyCommodity,
    type EnergyLogicalMeter
} from '@api/energy';
import {computed, onMounted, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import DataList from '@/components/core/DataList.vue';
import FormField from '@/components/core/FormField.vue';
import {
    compareRecordedBill,
    type RecordedBillLookup
} from '@/components/dashboard/energy/billReconciliation';
import {deviceChannelNumbers} from '@/helpers/utilityAccounting';
import {
    type TariffBillingPeriod,
    type TariffSummary,
    useBillingStore
} from '@/stores/billing';
import {useDevicesStore} from '@/stores/devices';
import {useLocationsStore} from '@/stores/locations';
import {listLogicalMeters} from '@/tools/logicalMeters';
import {
    BILL_SCOPE_MODES,
    type BillPeriod,
    type BillScopeMode,
    billDifferenceSentence,
    billErrorText,
    billPeriodDates,
    billPeriodDaysLine,
    billPeriodZoneLine,
    billQuoteColumns,
    billScopePoints,
    billStatusBadgeClass,
    billStatusLabel,
    billZoneCheckGap,
    defaultBillPeriod,
    formatBillAmount,
    formatBillInstant,
    formatBillNumber,
    formatBillQuantity,
    mixedBillingZoneIssue,
    recordedBillLookupFor,
    resolveBillQuoteRequest,
    tariffIdsInResolution,
    zoneCheckKey,
} from './billQuoteView';

/** One page of recorded bills is enough to spot an exact period match; more
 *  than that and the identity is too broad to compare against. */
const RECORDED_BILL_PAGE_LIMIT = 200;

const COMMODITY_LABELS: Record<EnergyCommodity, string> = {
    electricity: 'Electricity',
    water: 'Water',
    gas: 'Gas',
    heat: 'Heat'
};
const COMMODITY_OPTIONS = ENERGY_COMMODITIES.map((value) => ({
    value,
    label: COMMODITY_LABELS[value]
}));
const SERIES_BUCKETS = BILL_QUOTE_SERIES_BUCKETS;

const billing = useBillingStore();
const deviceStore = useDevicesStore();
const locationStore = useLocationsStore();

const openingPeriod = defaultBillPeriod(new Date());
const from = ref(openingPeriod.from);
const to = ref(openingPeriod.to);
const commodity = ref<EnergyCommodity>('electricity');
const scopeMode = ref<BillScopeMode>('organization');
const locationId = ref<number | null>(null);
const deviceId = ref<string | null>(null);
const channel = ref<number | null>(null);
const meterIds = ref<number[]>([]);
const seriesBucket = ref<BillQuoteSeriesBucket | null>(null);
const avoidedImportCost = ref(false);

const tariffs = ref<TariffSummary[]>([]);
const tariffId = ref<number | null>(null);
const tariffsLoaded = ref(false);
const setupError = ref('');
// One read per tariff: the zone a tariff bills on cannot change while the page
// is open, and both the chips and the period line ask for the same zones.
const tariffTimezones = ref(new Map<number, string>());
const tariffError = ref('');
const assignmentsError = ref('');
const billingPeriods = ref<TariffBillingPeriod[]>([]);
const periodsError = ref('');
const chosenPeriodKey = ref<string | null>(null);
const meters = ref<EnergyLogicalMeter[]>([]);
const metersError = ref('');

const result = ref<BillQuoteResponse | null>(null);
// The period the bill on screen was asked for, and the zone that counted its
// days. Held still, so a later tariff choice cannot re-label a bill.
const billedPeriod = ref<BillPeriod | null>(null);
const billedTimezone = ref<string | null>(null);
const calculating = ref(false);
const quoteError = ref('');
const recordedBill = ref<RecordedBillLookup | null>(null);

const noTariff = computed(
    () => tariffsLoaded.value && tariffs.value.length === 0
);

const tariffTimezone = computed(() =>
    tariffId.value === null
        ? null
        : (tariffTimezones.value.get(tariffId.value) ?? null)
);

// A chip writes an instant into the date boxes, and only the tariff's own zone
// says which day that instant falls on. No zone, no chips.
const periodChips = computed(() =>
    tariffTimezone.value === null ? [] : billingPeriods.value
);

const chosenPeriod = computed(
    () =>
        periodChips.value.find(
            (period) => period.key === chosenPeriodKey.value
        ) ?? null
);

const selection = computed(() => ({
    from: chosenPeriod.value?.from ?? from.value,
    to: chosenPeriod.value?.to ?? to.value,
    commodity: commodity.value,
    scope: {
        mode: scopeMode.value,
        locationId: locationId.value,
        deviceId: deviceId.value,
        channel: channel.value,
        meterIds: meterIds.value
    },
    seriesBucket: seriesBucket.value,
    avoidedImportCost: avoidedImportCost.value
}));

const periodZoneLine = computed(() =>
    billPeriodZoneLine(selection.value, tariffTimezone.value)
);

const resultPeriodLine = computed(() =>
    billedPeriod.value === null
        ? ''
        : billPeriodDaysLine(billedPeriod.value, billedTimezone.value)
);

// What the zone check asks about. The backend decides which tariff prices
// each point; this only names the points the chosen scope covers.
const zoneCheckAsk = computed(() =>
    billScopePoints({
        scope: selection.value.scope,
        commodity: commodity.value,
        devices: Object.values(deviceStore.devices).map((device) => ({
            id: device.id,
            deviceExternalId: device.shellyID,
            locationId: device.locationId ?? null,
            channels: deviceChannelNumbers(device.status)
        })),
        meterPoints: new Map(
            meters.value.map((meter) => [
                meter.id,
                meter.points.map((point) => ({
                    deviceId: point.deviceId,
                    channel: point.channel
                }))
            ])
        )
    })
);

const scopeTariffIds = ref<number[] | null>(null);

const tariffIdsToRead = computed(() => {
    const ids = new Set(scopeTariffIds.value ?? []);
    if (tariffId.value !== null) ids.add(tariffId.value);
    return [...ids];
});

const scopeZones = computed(() =>
    (scopeTariffIds.value ?? []).flatMap((id) => {
        const zone = tariffTimezones.value.get(id);
        return zone ? [zone] : [];
    })
);

const zoneCheckGap = computed(() =>
    scopeTariffIds.value === null ? null : billZoneCheckGap(zoneCheckAsk.value)
);

const zoneConflict = computed(() => mixedBillingZoneIssue(scopeZones.value));

const quoteRequest = computed(() => resolveBillQuoteRequest(selection.value));
const requestIssue = computed(() =>
    'issue' in quoteRequest.value ? quoteRequest.value.issue : null
);
// Two tariffs on two clocks bill different days, so nothing is added up until
// the scope is narrowed to one of them.
const calculateIssue = computed(() => requestIssue.value ?? zoneConflict.value);

const currency = computed(() => result.value?.currency ?? null);
const billedUnit = computed(() => result.value?.billedUnit ?? '');
const statusLabel = computed(() =>
    result.value ? billStatusLabel(result.value.status) : ''
);
const statusBadgeClass = computed(() =>
    result.value ? billStatusBadgeClass(result.value.status) : ''
);

const difference = computed(() => {
    if (!result.value || !recordedBill.value) return null;
    return compareRecordedBill(
        recordedBill.value,
        result.value.netCost,
        result.value.currency
    );
});
const differenceSentence = computed(() =>
    difference.value?.status === 'ready'
        ? billDifferenceSentence(difference.value, currency.value)
        : ''
);

const locationOptions = computed(() =>
    Object.values(locationStore.locations)
        .map((location) => ({id: location.id, name: location.name}))
        .sort((a, b) => a.name.localeCompare(b.name))
);

const deviceOptions = computed(() =>
    Object.values(deviceStore.devices)
        .map((device) => ({
            id: device.shellyID,
            label: deviceLabel(device.shellyID)
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
);

const channelOptions = computed(() =>
    deviceId.value === null
        ? []
        : deviceChannelNumbers(deviceStore.devices[deviceId.value]?.status)
);

const columns = computed(() =>
    billQuoteColumns({
        currency: currency.value,
        billedUnit: billedUnit.value,
        demandUnit: result.value?.demand?.unit ?? ''
    })
);

function amountText(value: number | null): string {
    return formatBillAmount(value, currency.value);
}

function quantityText(value: number | null): string {
    return formatBillQuantity(value, billedUnit.value);
}

// The avoided-cost estimate carries its own currency and unit: it is priced
// against the import tariff, which need not be the tariff that billed.
function avoidedAmountText(avoided: BillQuoteAvoidedImportCost): string {
    return formatBillAmount(avoided.avoidedCost, avoided.currency);
}

function avoidedQuantityText(
    avoided: BillQuoteAvoidedImportCost,
    value: number | null
): string {
    return formatBillQuantity(value, avoided.billedUnit);
}

function deviceLabel(shellyId: string): string {
    const name = deviceStore.devices[shellyId]?.info?.name;
    return name ? `${name} (${shellyId})` : shellyId;
}

// Latest wins: a date typed while a lookup is in flight owns the chip row.
let billingPeriodsRun = 0;

function clearChosenPeriod(): void {
    chosenPeriodKey.value = null;
}

function choosePeriod(period: TariffBillingPeriod): void {
    chosenPeriodKey.value = period.key;
    const dates = billPeriodDates(period, tariffTimezone.value);
    from.value = dates.from;
    to.value = dates.to;
}

function toggleMeter(id: number): void {
    meterIds.value = meterIds.value.includes(id)
        ? meterIds.value.filter((meterId) => meterId !== id)
        : [...meterIds.value, id];
}

async function loadTariffs(): Promise<void> {
    setupError.value = '';
    try {
        tariffs.value = await billing.listTariffs();
    } catch (error) {
        setupError.value = billErrorText(
            error,
            'Could not load the tariffs.'
        );
    } finally {
        tariffsLoaded.value = true;
    }
}

// One check per set of points. A late answer to an older set is dropped, so a
// stale zone conflict can never block a scope the user has already changed.
let zoneCheckToken = '';

async function checkScopeZones(): Promise<void> {
    const ask = zoneCheckAsk.value;
    const token = zoneCheckKey(ask.points);
    zoneCheckToken = token;
    assignmentsError.value = '';
    if (ask.points.length === 0) {
        scopeTariffIds.value = null;
        return;
    }
    try {
        const resolution = await billing.resolveTariffAssignments(ask.points);
        if (zoneCheckToken !== token) return;
        scopeTariffIds.value = tariffIdsInResolution(resolution);
    } catch (error) {
        if (zoneCheckToken !== token) return;
        scopeTariffIds.value = null;
        assignmentsError.value = billErrorText(
            error,
            'Could not check which tariffs price this scope.'
        );
    }
}

// Only the zones still unknown are read, so no tariff is fetched twice.
async function loadTariffTimezones(ids: readonly number[]): Promise<void> {
    const missing = ids.filter((id) => !tariffTimezones.value.has(id));
    if (missing.length === 0) return;
    const reads = await Promise.all(
        missing.map(async (id) => ({id, read: await readTariffTimezone(id)}))
    );
    const known = new Map(tariffTimezones.value);
    const failures: string[] = [];
    for (const {id, read} of reads) {
        if ('error' in read) failures.push(read.error);
        else known.set(id, read.timezone);
    }
    tariffTimezones.value = known;
    tariffError.value = failures[0] ?? '';
}

// Its own try/catch: a tariff nobody can read has no billing day to bill on.
async function readTariffTimezone(
    id: number
): Promise<{timezone: string} | {error: string}> {
    try {
        const tariff = await billing.getTariff(id);
        return {timezone: tariff.timezone};
    } catch (error) {
        return {error: billErrorText(error, 'Could not load the tariff.')};
    }
}

async function loadBillingPeriods(): Promise<void> {
    periodsError.value = '';
    if (tariffId.value === null) {
        billingPeriods.value = [];
        chosenPeriodKey.value = null;
        return;
    }
    // The window is asked for in the tariff's own days, so its zone comes first.
    if (tariffTimezone.value === null) return;
    const run = ++billingPeriodsRun;
    const dates = billPeriodDates(
        {from: from.value, to: to.value},
        tariffTimezone.value
    );
    try {
        const periods = await billing.listBillingPeriods({
            tariffId: tariffId.value,
            from: dates.from,
            to: dates.to
        });
        if (run !== billingPeriodsRun) return;
        billingPeriods.value = periods;
    } catch (error) {
        if (run !== billingPeriodsRun) return;
        billingPeriods.value = [];
        periodsError.value = billErrorText(
            error,
            'Could not load the billing periods.'
        );
    }
}

async function loadMeters(): Promise<void> {
    metersError.value = '';
    try {
        meters.value = await listLogicalMeters();
    } catch (error) {
        meters.value = [];
        metersError.value = billErrorText(
            error,
            'Could not load the logical meters.'
        );
    }
}

async function calculate(): Promise<void> {
    const request = quoteRequest.value;
    if (calculateIssue.value !== null || 'issue' in request) return;
    calculating.value = true;
    await runQuote(request.params);
    calculating.value = false;
}

// A refused or rate-limited quote shows its reason and keeps the last bill.
async function runQuote(params: BillQuoteParams): Promise<void> {
    try {
        const quote = await billing.quoteBill(params);
        quoteError.value = '';
        result.value = quote;
        billedPeriod.value = {from: params.from, to: params.to};
        billedTimezone.value = tariffTimezone.value;
        await loadRecordedBill(quote);
    } catch (error) {
        quoteError.value = billErrorText(
            error,
            'Could not calculate the bill.'
        );
    }
}

async function loadRecordedBill(quote: BillQuoteResponse): Promise<void> {
    const period = {from: quote.from, to: quote.to};
    const timezone = tariffTimezone.value;
    const days = billPeriodDates(period, timezone);
    try {
        const page = await billing.listRecordedBills({
            from: days.from,
            to: days.to,
            limit: RECORDED_BILL_PAGE_LIMIT
        });
        recordedBill.value = recordedBillLookupFor({
            bills: page.bills,
            period,
            timezone,
            truncated: page.nextCursor !== null
        });
    } catch (error) {
        recordedBill.value = {
            status: 'unavailable',
            message: billErrorText(
                error,
                'Could not load the recorded bills.'
            )
        };
    }
}

watch(tariffIdsToRead, (ids) => {
    void loadTariffTimezones(ids);
});

watch([tariffId, tariffTimezone, from, to], () => {
    void loadBillingPeriods();
});

watch(scopeMode, (mode) => {
    if (mode === 'meters' && meters.value.length === 0) void loadMeters();
});

// The points change with the scope, the commodity and the devices the page
// holds, so the check follows them rather than a single field.
watch(
    () => zoneCheckKey(zoneCheckAsk.value.points),
    () => {
        void checkScopeZones();
    }
);

onMounted(() => {
    void loadTariffs();
    void checkScopeZones();
    void deviceStore.fetchDevices();
    void locationStore.fetchLocations();
});
</script>

<style scoped>
.bq-total {
    margin: var(--gap-sm) 0 0;
}

.bq-total__label {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.bq-total__value {
    margin: var(--space-1) 0 0;
    color: var(--color-text-primary);
    font-size: var(--type-heading);
    font-weight: var(--font-semibold);
    /* Hero-number tracking, same as .evolt .kpi in voltaine.css. */
    letter-spacing: -0.03em;
    line-height: var(--leading-tight);
}

.bq-periods {
    flex-wrap: wrap;
}

.bq-meters {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--gap-xs);
    max-height: 14rem;
    overflow-y: auto;
}

.bq-hint {
    margin: 0 0 var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    line-height: var(--leading-relaxed);
}
</style>
