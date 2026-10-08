<template>
    <Modal :visible="true" large tall @close="emit('close')">
        <template #title>
            <ModalHeader
                :title="editingId ? 'Edit tariff' : 'New tariff'"
                description="Reusable across your organisation"
            />
        </template>

        <template #default>
            <div class="etf-body">
                <FormField label="Name">
                    <Input v-model="editor.name" placeholder="My tariff" :maxlength="128" />
                </FormField>

                <div class="etf-row2">
                    <FormField label="Currency">
                        <Dropdown
                            :groups="currencyGroups"
                            :default="editor.currency"
                            :searchable="true"
                            aria-label="Currency"
                            @selected="onCurrencyPicked"
                        />
                    </FormField>
                    <FormField label="Billing day (1–28)">
                        <input v-model.number="editor.billingDay" :class="INPUT_CLASS" type="number" min="1" max="28" />
                    </FormField>
                </div>

                <div class="etf-row2">
                    <FormField label="Commodity">
                        <Dropdown
                            :groups="COMMODITY_GROUPS"
                            :default="editor.commodity"
                            aria-label="Commodity"
                            @selected="onCommodityPicked"
                        />
                    </FormField>
                    <FormField label="Billed unit">
                        <Dropdown
                            :groups="billedUnitGroups"
                            :default="editor.blockUnit"
                            aria-label="Billed unit"
                            @selected="onBilledUnitPicked"
                        />
                    </FormField>
                </div>

                <FormField label="Billing time zone" :hint="organizationZoneNote">
                    <Dropdown
                        :groups="timezoneGroups"
                        :default="editor.timezone"
                        :searchable="true"
                        aria-label="Timezone"
                        @selected="onTimezonePicked"
                    />
                </FormField>

                <FormField label="Rate type">
                    <ViewToggle v-model="editor.kind" :options="KIND_OPTIONS" />
                </FormField>

                <!-- Single -->
                <template v-if="editor.kind === 'single'">
                    <FormField :label="`Rate (per ${blockUnitLabel})`">
                        <div class="etf-amount">
                            <span class="etf-badge">{{ editor.currency }}</span>
                            <input v-model.number="editor.rate" :class="INPUT_CLASS" type="number" step="0.01" min="0" />
                        </div>
                    </FormField>
                    <SeasonalEditor v-model="editor.seasons" :simple="true" />
                </template>

                <!-- Day / night -->
                <template v-else-if="editor.kind === 'day_night'">
                    <div class="etf-row2">
                        <FormField :label="`Day rate (per ${blockUnitLabel})`">
                            <input v-model.number="editor.dayRate" :class="INPUT_CLASS" type="number" step="0.01" min="0" />
                        </FormField>
                        <FormField :label="`Night rate (per ${blockUnitLabel})`">
                            <input v-model.number="editor.nightRate" :class="INPUT_CLASS" type="number" step="0.01" min="0" />
                        </FormField>
                        <FormField label="Day starts">
                            <input v-model="editor.dayStart" :class="INPUT_CLASS" type="time" />
                        </FormField>
                        <FormField label="Day ends">
                            <input v-model="editor.dayEnd" :class="INPUT_CLASS" type="time" />
                        </FormField>
                    </div>
                    <SeasonalEditor v-model="editor.seasons" :simple="true" />
                </template>

                <!-- Time of use -->
                <template v-else-if="editor.kind === 'tou'">
                    <SeasonalEditor v-model="editor.seasons" :simple="false" />
                </template>

                <!-- Live -->
                <template v-else-if="editor.kind === 'live'">
                    <FormField label="Live price mode">
                        <ViewToggle v-model="editor.liveMode" :options="LIVE_MODE_OPTIONS" />
                    </FormField>
                    <template v-if="editor.liveMode === 'pull'">
                        <FormField label="Provider">
                            <Dropdown
                                :groups="PROVIDER_GROUPS"
                                :default="editor.liveProvider"
                                aria-label="Provider"
                                @selected="onProviderPicked"
                            />
                        </FormField>
                        <FormField label="API token">
                            <Input v-model="editor.liveToken" placeholder="ENTSO-E security token" />
                        </FormField>
                        <FormField label="Area / zone">
                            <Input v-model="editor.liveArea" placeholder="BG" />
                        </FormField>
                    </template>
                    <p v-if="editor.liveMode === 'push'" class="etf-hint">
                        Save the tariff first — then a one-time push token and URL are shown.
                    </p>
                </template>

                <!-- Stepped blocks -->
                <template v-else-if="editor.kind === 'block'">
                    <FormField
                        :label="`Surcharge (per ${blockUnitLabel})`"
                        field-id="etf-block-surcharge"
                        hint="Added to every unit whichever block it falls in. Many utilities reset it each period."
                    >
                        <div class="etf-amount">
                            <span class="etf-badge">{{ editor.currency }}</span>
                            <input
                                id="etf-block-surcharge"
                                :value="editor.blockSurcharge ?? ''"
                                :class="INPUT_CLASS"
                                class="etf-typed-number"
                                type="number"
                                inputmode="decimal"
                                step="any"
                                min="0"
                                placeholder="0.00"
                                @input="editor.blockSurcharge = numOrNull(($event.target as HTMLInputElement).value)"
                            />
                        </div>
                    </FormField>

                    <FormSection title="Consumption blocks">
                        <div class="etf-blocks">
                            <div v-for="(step, bi) in editor.blockSteps" :key="bi" class="etf-block">
                                <span class="etf-block-no">Block {{ bi + 1 }}</span>
                                <div class="etf-block-fields">
                                    <div class="etf-block-cell">
                                        <label class="etf-block-lbl" :for="`etf-block-upto-${bi}`">
                                            Up to ({{ blockUnitLabel }})
                                        </label>
                                        <input
                                            v-if="!isLastBlock(bi)"
                                            :id="`etf-block-upto-${bi}`"
                                            :value="step.upTo ?? ''"
                                            :class="INPUT_CLASS"
                                            class="etf-typed-number"
                                            type="number"
                                            inputmode="decimal"
                                            step="any"
                                            min="0"
                                            :aria-label="`Block ${bi + 1} upper limit in ${blockUnitLabel}`"
                                            placeholder="0"
                                            @input="step.upTo = numOrNull(($event.target as HTMLInputElement).value)"
                                        />
                                        <p v-else :id="`etf-block-upto-${bi}`" class="etf-block-open">
                                            {{ openBlockLabel }}
                                        </p>
                                    </div>
                                    <div class="etf-block-cell">
                                        <label class="etf-block-lbl" :for="`etf-block-rate-${bi}`">
                                            Rate per {{ blockUnitLabel }}
                                        </label>
                                        <div class="etf-amount">
                                            <span class="etf-badge">{{ editor.currency }}</span>
                                            <input
                                                :id="`etf-block-rate-${bi}`"
                                                :value="step.rate ?? ''"
                                                :class="INPUT_CLASS"
                                                class="etf-typed-number"
                                                type="number"
                                                inputmode="decimal"
                                                step="any"
                                                min="0"
                                                :aria-label="`Block ${bi + 1} rate per ${blockUnitLabel}`"
                                                placeholder="0.00"
                                                @input="step.rate = numOrNull(($event.target as HTMLInputElement).value)"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <button
                                    v-if="!isLastBlock(bi)"
                                    type="button"
                                    class="etf-block-del"
                                    :aria-label="`Remove block ${bi + 1}`"
                                    @click="removeBlockStep(bi)"
                                >
                                    <i class="fas fa-xmark" aria-hidden="true" />
                                </button>
                            </div>
                            <button
                                type="button"
                                class="etf-add etf-block-add"
                                :disabled="editor.blockSteps.length >= MAX_BLOCK_STEPS"
                                @click="addBlockStep"
                            >
                                + Add block
                            </button>
                        </div>
                        <p v-if="blockError" class="etf-error" role="alert">{{ blockError }}</p>
                        <p class="etf-hint">
                            Only the units above a block line cost the higher rate — passing a line never
                            reprices the units below it. Use adds up over the billing period and starts
                            again on day {{ editor.billingDay }} in {{ editor.timezone }}.
                        </p>
                    </FormSection>
                </template>

                <!-- Extra charges — all kinds -->
                <FormSection title="Extra charges">
                    <div class="etf-row2">
                        <FormField label="Standing charge">
                            <div class="etf-amount">
                                <span class="etf-badge">{{ editor.currency }}</span>
                                <input
                                    v-model.number="editor.standingCharge"
                                    :class="INPUT_CLASS"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                />
                            </div>
                        </FormField>
                        <FormField label="Period">
                            <ViewToggle v-model="editor.standingChargePeriod" :options="STANDING_PERIOD_OPTIONS" />
                        </FormField>
                    </div>
                    <div class="etf-row2">
                        <FormField label="Demand charge">
                            <label class="etf-check">
                                <input
                                    v-model="editor.demandEnabled"
                                    type="checkbox"
                                    :disabled="editor.commodity !== 'electricity'"
                                />
                                <span>Use contracted demand pricing</span>
                            </label>
                            <p v-if="editor.commodity !== 'electricity'" class="etf-hint">
                                Demand charges are currently available only for electricity tariffs.
                            </p>
                            <p v-if="!editor.demandEnabled && editor.demandRate != null" class="etf-hint">
                                Legacy kW/month rate {{ editor.demandRate }} is preserved. Enable contracted demand pricing to replace it.
                            </p>
                        </FormField>
                        <FormField v-if="editor.demandEnabled" label="Demand rate">
                            <div class="etf-amount">
                                <span class="etf-badge">{{ editor.currency }}</span>
                                <input
                                    :value="editor.demandRate ?? ''"
                                    :class="INPUT_CLASS"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    aria-label="Demand rate"
                                    placeholder="0.00"
                                    @input="editor.demandRate = numOrNull(($event.target as HTMLInputElement).value)"
                                />
                            </div>
                        </FormField>
                    </div>
                    <template v-if="editor.demandEnabled">
                        <div class="etf-row2">
                            <FormField label="Demand unit">
                                <select v-model="editor.demandUnit" :class="INPUT_CLASS" aria-label="Demand unit">
                                    <option value="kW">kW</option>
                                    <option value="kVA">kVA</option>
                                </select>
                            </FormField>
                            <FormField label="Rate period">
                                <select v-model="editor.demandChargePeriod" :class="INPUT_CLASS" aria-label="Demand rate period">
                                    <option value="month">Per month</option>
                                    <option value="day">Per day in billing period</option>
                                </select>
                            </FormField>
                            <FormField label="Demand interval">
                                <select v-model.number="editor.demandIntervalMinutes" :class="INPUT_CLASS" aria-label="Demand interval">
                                    <option :value="15">15 minutes</option>
                                    <option :value="30">30 minutes</option>
                                </select>
                            </FormField>
                            <FormField label="Ratchet lookback">
                                <select v-model.number="editor.demandRatchetMonths" :class="INPUT_CLASS" aria-label="Ratchet lookback including current month">
                                    <option v-for="months in 12" :key="months" :value="months">
                                        {{ months }} {{ months === 1 ? 'month' : 'months' }} including current
                                    </option>
                                </select>
                            </FormField>
                        </div>
                        <fieldset class="etf-demand-seasons">
                            <legend class="sr-only">Demand seasons and windows</legend>
                            <div v-for="(season, si) in editor.demandSeasons" :key="si" class="etf-season">
                                <div class="etf-season-hd">
                                    <strong>Demand season {{ si + 1 }}</strong>
                                    <input v-model="season.startMonthDay" :class="INPUT_CLASS" :aria-label="`Demand season ${si + 1} start MM-DD`" placeholder="MM-DD" />
                                    <span>to</span>
                                    <input v-model="season.endMonthDay" :class="INPUT_CLASS" :aria-label="`Demand season ${si + 1} end MM-DD`" placeholder="MM-DD" />
                                    <button v-if="editor.demandSeasons.length > 1" type="button" class="etf-del" :aria-label="`Remove demand season ${si + 1}`" @click="removeDemandSeason(si)">Remove</button>
                                </div>
                                <div v-for="(window, wi) in season.windows" :key="wi" class="etf-demand-window">
                                    <div class="etf-days">
                                        <label v-for="(day, di) in DAYS" :key="day" class="etf-day">
                                            <input :checked="Boolean(window.daysMask & (1 << di))" type="checkbox" :aria-label="`${day}, demand season ${si + 1}, window ${wi + 1}`" @change="toggleDemandDay(si, wi, di, ($event.target as HTMLInputElement).checked)" />
                                            <span>{{ day }}</span>
                                        </label>
                                    </div>
                                    <input v-model="window.startTime" :class="INPUT_CLASS" type="time" :aria-label="`Demand window ${wi + 1} starts`" />
                                    <input v-model="window.endTime" :class="INPUT_CLASS" type="time" :aria-label="`Demand window ${wi + 1} ends`" />
                                    <button v-if="season.windows.length > 1" type="button" class="etf-del" :aria-label="`Remove demand window ${wi + 1}`" @click="removeDemandWindow(si, wi)">Remove</button>
                                </div>
                                <button type="button" class="etf-add" @click="addDemandWindow(si)">+ Add demand window</button>
                            </div>
                            <button type="button" class="etf-add" @click="addDemandSeason">+ Add demand season</button>
                        </fieldset>
                    </template>

                    <details class="etf-components-advanced" :open="editor.components.length > 0 || undefined">
                        <summary>
                            <span>Advanced price components</span>
                            <small>Supply, network, levy and minimum-bill lines</small>
                        </summary>
                    <section class="etf-taxes" aria-labelledby="etf-components-title">
                        <div class="etf-taxes-hd">
                            <div>
                                <h3 id="etf-components-title">Price components</h3>
                                <p class="etf-hint">
                                    Add independently disclosed supply, network, levy, tax, and minimum-bill lines in calculation order.
                                </p>
                            </div>
                            <button type="button" class="etf-add" @click="addPriceComponent">
                                + Add component
                            </button>
                        </div>
                        <fieldset
                            v-for="(component, ci) in editor.components"
                            :key="component.code || ci"
                            class="etf-tax-rule"
                        >
                            <legend>Component {{ ci + 1 }} · {{ component.name || 'Unnamed' }}</legend>
                            <div class="etf-tax-grid">
                                <FormField label="Name">
                                    <input v-model="component.name" :class="INPUT_CLASS" maxlength="120" />
                                </FormField>
                                <FormField label="Code">
                                    <input v-model="component.code" :class="INPUT_CLASS" maxlength="64" />
                                </FormField>
                                <FormField label="Class">
                                    <input v-model="component.chargeClass" :class="INPUT_CLASS" placeholder="supply, network, levy, tax" />
                                </FormField>
                                <FormField label="Calculation">
                                    <select :value="component.chargeType" :class="INPUT_CLASS" @change="setComponentType(ci, ($event.target as HTMLSelectElement).value)">
                                        <option value="per_unit">Per billed unit</option>
                                        <option value="fixed_day">Fixed per day</option>
                                        <option value="fixed_month">Fixed per month</option>
                                        <option value="percentage">Percentage of named lines</option>
                                        <option value="minimum">Minimum bill adjustment</option>
                                    </select>
                                </FormField>
                                <FormField :label="component.chargeType === 'percentage' ? 'Percentage' : 'Rate'">
                                    <input v-model.number="component.rate" :class="INPUT_CLASS" type="number" step="any" />
                                </FormField>
                                <FormField v-if="component.chargeType === 'percentage' || component.chargeType === 'minimum'" label="Earlier line codes">
                                    <input
                                        :value="(component.appliesTo ?? []).join(', ')"
                                        :class="INPUT_CLASS"
                                        placeholder="supply, network"
                                        @input="setComponentAppliesTo(ci, ($event.target as HTMLInputElement).value)"
                                    />
                                </FormField>
                                <FormField label="Effective from">
                                    <input v-model="component.effectiveFrom" :class="INPUT_CLASS" type="date" />
                                </FormField>
                                <FormField label="Effective to">
                                    <input v-model="component.effectiveTo" :class="INPUT_CLASS" type="date" />
                                </FormField>
                            </div>
                            <label class="etf-check">
                                <input v-model="component.taxable" type="checkbox" />
                                <span>This line may be included in a tax basis</span>
                            </label>
                            <button type="button" class="etf-tax-remove" @click="removePriceComponent(ci)">Remove component</button>
                        </fieldset>
                        <p v-if="componentError" class="etf-error" role="alert">{{ componentError }}</p>
                    </section>
                    </details>

                    <section class="etf-taxes" aria-labelledby="etf-taxes-title">
                        <div class="etf-taxes-hd">
                            <div>
                                <h3 id="etf-taxes-title">Taxes</h3>
                                <p class="etf-hint">
                                    Add taxes in calculation order. Names and rules are tariff data, so this works for GST,
                                    sales tax, VAT and other jurisdictions.
                                </p>
                            </div>
                            <button
                                type="button"
                                class="etf-add"
                                :disabled="editor.taxes.length >= MAX_TAX_RULES"
                                @click="addTaxRule"
                            >
                                + Add tax
                            </button>
                        </div>

                        <p v-if="editor.taxes.length === 0" class="etf-tax-empty">
                            No taxes configured. This tariff will be treated as tax-free.
                        </p>

                        <fieldset
                            v-for="(tax, ti) in editor.taxes"
                            :key="taxEditorKey(tax)"
                            class="etf-tax-rule"
                            :data-tax-index="ti"
                        >
                            <legend>
                                Tax {{ ti + 1 }}
                                <span v-if="tax.name.trim()">· {{ tax.name.trim() }}</span>
                            </legend>
                            <div class="etf-tax-actions">
                                <button
                                    type="button"
                                    :disabled="ti === 0"
                                    :aria-label="`Move tax ${ti + 1} up`"
                                    @click="moveTaxRule(ti, ti - 1)"
                                >
                                    Move up
                                </button>
                                <button
                                    type="button"
                                    :disabled="ti === editor.taxes.length - 1"
                                    :aria-label="`Move tax ${ti + 1} down`"
                                    @click="moveTaxRule(ti, ti + 1)"
                                >
                                    Move down
                                </button>
                                <button
                                    type="button"
                                    class="etf-tax-remove"
                                    :aria-label="`Remove tax ${ti + 1}${tax.name.trim() ? `, ${tax.name.trim()}` : ''}`"
                                    @click="removeTaxRule(ti)"
                                >
                                    Remove
                                </button>
                            </div>

                            <div class="etf-tax-grid">
                                <FormField
                                    :label="`Tax ${ti + 1} name`"
                                    :field-id="`etf-tax-name-${ti}`"
                                >
                                    <input
                                        :id="`etf-tax-name-${ti}`"
                                        v-model="tax.name"
                                        :class="INPUT_CLASS"
                                        type="text"
                                        maxlength="100"
                                        placeholder="GST, sales tax, VAT…"
                                        :aria-invalid="Boolean(taxFieldError(ti, 'name'))"
                                        :aria-describedby="taxFieldError(ti, 'name') ? taxFieldErrorId(ti, 'name') : undefined"
                                    />
                                    <p
                                        v-if="taxFieldError(ti, 'name')"
                                        :id="taxFieldErrorId(ti, 'name')"
                                        class="etf-field-error"
                                    >
                                        {{ taxFieldError(ti, 'name') }}
                                    </p>
                                </FormField>
                                <FormField
                                    :label="`Tax ${ti + 1} percentage`"
                                    :field-id="`etf-tax-rate-${ti}`"
                                >
                                    <div class="etf-percent">
                                        <input
                                            :id="`etf-tax-rate-${ti}`"
                                            :value="tax.ratePct ?? ''"
                                            :class="INPUT_CLASS"
                                            type="number"
                                            inputmode="decimal"
                                            step="0.01"
                                            min="0"
                                            max="100"
                                            placeholder="0"
                                            :aria-invalid="Boolean(taxFieldError(ti, 'ratePct'))"
                                            :aria-describedby="taxFieldError(ti, 'ratePct') ? taxFieldErrorId(ti, 'ratePct') : undefined"
                                            @input="tax.ratePct = numOrNull(($event.target as HTMLInputElement).value)"
                                        />
                                        <span aria-hidden="true">%</span>
                                    </div>
                                    <p
                                        v-if="taxFieldError(ti, 'ratePct')"
                                        :id="taxFieldErrorId(ti, 'ratePct')"
                                        class="etf-field-error"
                                    >
                                        {{ taxFieldError(ti, 'ratePct') }}
                                    </p>
                                </FormField>
                                <FormField
                                    :label="`Tax ${ti + 1} calculation`"
                                    :field-id="`etf-tax-calculation-${ti}`"
                                >
                                    <select
                                        :id="`etf-tax-calculation-${ti}`"
                                        :value="tax.calculation"
                                        :class="INPUT_CLASS"
                                        :aria-invalid="Boolean(taxFieldError(ti, 'calculation'))"
                                        :aria-describedby="taxFieldError(ti, 'calculation') ? taxFieldErrorId(ti, 'calculation') : undefined"
                                        @change="setTaxCalculation(ti, ($event.target as HTMLSelectElement).value as TariffTaxCalculation)"
                                    >
                                        <option value="exclusive">Added to total</option>
                                        <option value="inclusive">Included in prices</option>
                                    </select>
                                    <p
                                        v-if="taxFieldError(ti, 'calculation')"
                                        :id="taxFieldErrorId(ti, 'calculation')"
                                        class="etf-field-error"
                                    >
                                        {{ taxFieldError(ti, 'calculation') }}
                                    </p>
                                </FormField>
                            </div>

                            <details class="etf-tax-advanced">
                                <summary>Advanced</summary>
                                <FormField
                                    :label="`Tax ${ti + 1} stable code`"
                                    :field-id="`etf-tax-code-${ti}`"
                                    hint="Used when a later tax compounds on this rule. Avoid changing it after setup."
                                >
                                    <input
                                        :id="`etf-tax-code-${ti}`"
                                        :value="tax.code"
                                        :class="INPUT_CLASS"
                                        type="text"
                                        maxlength="64"
                                        pattern="[a-z][a-z0-9_-]{0,63}"
                                        autocapitalize="none"
                                        spellcheck="false"
                                        :aria-invalid="Boolean(taxFieldError(ti, 'code'))"
                                        :aria-describedby="taxFieldError(ti, 'code') ? taxFieldErrorId(ti, 'code') : undefined"
                                        @input="updateTaxCode(ti, ($event.target as HTMLInputElement).value)"
                                    />
                                    <p
                                        v-if="taxFieldError(ti, 'code')"
                                        :id="taxFieldErrorId(ti, 'code')"
                                        class="etf-field-error"
                                    >
                                        {{ taxFieldError(ti, 'code') }}
                                    </p>
                                </FormField>
                            </details>

                            <label class="etf-check etf-tax-exempt">
                                <input
                                    :checked="tax.exempt"
                                    type="checkbox"
                                    @change="setTaxExempt(ti, ($event.target as HTMLInputElement).checked)"
                                />
                                <span>Exempt — record this rule but charge no tax</span>
                            </label>

                            <fieldset
                                class="etf-tax-options"
                                data-tax-option="appliesTo"
                                :aria-invalid="Boolean(taxFieldError(ti, 'appliesTo'))"
                                :aria-describedby="taxFieldError(ti, 'appliesTo') ? taxFieldErrorId(ti, 'appliesTo') : undefined"
                            >
                                <legend>Applies to</legend>
                                <label v-for="basis in TAX_BASES" :key="basis.value" class="etf-check">
                                    <input
                                        :checked="tax.appliesTo.includes(basis.value)"
                                        type="checkbox"
                                        @change="toggleTaxBasis(ti, basis.value, ($event.target as HTMLInputElement).checked)"
                                    />
                                    <span>{{ basis.label }}</span>
                                </label>
                                <p
                                    v-if="taxFieldError(ti, 'appliesTo')"
                                    :id="taxFieldErrorId(ti, 'appliesTo')"
                                    class="etf-field-error etf-tax-wide-error"
                                >
                                    {{ taxFieldError(ti, 'appliesTo') }}
                                </p>
                            </fieldset>

                            <fieldset
                                v-if="ti > 0"
                                class="etf-tax-options"
                                data-tax-option="compoundOn"
                                :disabled="tax.calculation === 'inclusive'"
                                :aria-invalid="Boolean(taxFieldError(ti, 'compoundOn'))"
                                :aria-describedby="taxFieldError(ti, 'compoundOn') ? taxFieldErrorId(ti, 'compoundOn') : undefined"
                            >
                                <legend>Compound on earlier taxes (optional)</legend>
                                <label
                                    v-for="prior in editor.taxes.slice(0, ti)"
                                    :key="prior.code"
                                    class="etf-check"
                                >
                                    <input
                                        :checked="tax.compoundOn.includes(prior.code)"
                                        :disabled="!prior.code"
                                        type="checkbox"
                                        @change="toggleCompoundTax(ti, prior.code, ($event.target as HTMLInputElement).checked)"
                                    />
                                    <span>{{ prior.name.trim() || prior.code || 'Unnamed earlier tax' }}</span>
                                </label>
                                <p v-if="tax.calculation === 'inclusive'" class="etf-tax-option-hint">
                                    Included taxes are reconciled within prices and cannot compound.
                                </p>
                                <p
                                    v-if="taxFieldError(ti, 'compoundOn')"
                                    :id="taxFieldErrorId(ti, 'compoundOn')"
                                    class="etf-field-error etf-tax-wide-error"
                                >
                                    {{ taxFieldError(ti, 'compoundOn') }}
                                </p>
                            </fieldset>
                        </fieldset>
                        <p v-if="taxError" class="etf-error" role="alert">{{ taxError }}</p>
                        <p
                            v-if="taxReorderNotice"
                            class="etf-tax-reorder-notice"
                            role="status"
                            aria-live="polite"
                        >
                            {{ taxReorderNotice }}
                        </p>
                    </section>
                </FormSection>

                <FormSection title="Contract details">
                    <div class="etf-row2">
                        <FormField label="Effective from">
                            <input v-model="editor.effectiveFrom" :class="INPUT_CLASS" type="date" aria-label="Tariff effective from" />
                        </FormField>
                        <FormField label="Effective to">
                            <input v-model="editor.effectiveTo" :class="INPUT_CLASS" type="date" aria-label="Tariff effective to" />
                        </FormField>
                    </div>
                    <FormField label="Source reference">
                        <Input v-model="editor.sourceReference" placeholder="Contract, network schedule or source URL" :maxlength="500" />
                    </FormField>
                </FormSection>

                <div v-if="livePushResult" class="etf-push">
                    <p class="etf-push-title">Shown once — save the token now</p>
                    <div class="etf-push-row">
                        <span>Token</span>
                        <code>{{ livePushResult.token }}</code>
                        <Button type="blue-hollow" size="xs" @click="copyToClipboard(livePushResult.token)">
                            Copy
                        </Button>
                    </div>
                    <div class="etf-push-row">
                        <span>URL</span>
                        <code>{{ livePushResult.url }}</code>
                        <Button type="blue-hollow" size="xs" @click="copyToClipboard(livePushResult.url)">
                            Copy
                        </Button>
                    </div>
                </div>

                <p v-if="tariffSaveError" class="etf-error" role="alert">{{ tariffSaveError }}</p>
            </div>
        </template>

        <template #footer>
            <ModalFooter>
                <template #meta>
                    <p v-if="formError" id="etf-form-error" class="etf-footer-error" role="status">
                        {{ formError }}
                    </p>
                </template>
                <template #secondary>
                    <Button type="blue-hollow" :disabled="savingTariff" @click="emit('close')">Cancel</Button>
                </template>
                <template #primary>
                    <Button
                        type="blue"
                        :loading="savingTariff"
                        :disabled="Boolean(formError)"
                        :aria-describedby="formError ? 'etf-form-error' : undefined"
                        @click="saveTariff"
                    >
                        Save tariff
                    </Button>
                </template>
            </ModalFooter>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import type {EnergyCommodity} from '@api/energy';
import type {
    TariffBilledUnit,
    TariffComponentBasis,
    TariffComponentChargeType,
    TariffSeasonSpec,
    TariffSpec,
    TariffTaxBasis,
    TariffTaxCalculation,
    TariffWindowSpec
} from '@api/tariff';
import {TARIFF_BAND_LABELS, TARIFF_BANDS} from '@api/tariff';
import {computed, defineComponent, h, onMounted, reactive, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FormField from '@/components/core/FormField.vue';
import FormSection from '@/components/core/FormSection.vue';
import Input from '@/components/core/Input.vue';
import ModalFooter from '@/components/core/ModalFooter.vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import ViewToggle, {type ViewToggleOption} from '@/components/core/ViewToggle.vue';
import Modal from '@/components/modals/Modal.vue';
import {CURRENCIES} from '@/helpers/currencies';
import * as ws from '@/tools/websocket';
import {
    billedUnitsForCommodity,
    blockFormError,
    buildTariffSpec,
    defaultEditor,
    emptyBlockStep,
    emptyDemandSeason,
    emptySeason,
    emptyTaxRule,
    emptyWindow, 
    MAX_BLOCK_STEPS,
    MAX_TAX_RULES,
    type TariffTaxDraftField,
    taxDraftsFromTariff,
    taxFormIssue
} from './tariffSpecBuilder';

const props = defineProps<{
    /** Tariff id to edit; null creates a new tariff. */
    editingId: number | null;
    /** Seed currency / timezone for a new tariff. */
    defaultCurrency?: string;
    defaultTimezone?: string;
    /** The organization default zone itself, absent when none is set. */
    organizationTimezone?: string;
}>();
const emit = defineEmits<{close: []; saved: [id: number]}>();

// The shared Input atom renders exactly these classes; native number/time
// inputs reuse them so every field in the modal looks identical.
const INPUT_CLASS = 'core-input border text-base rounded-lg block w-full p-2';

// The kinds this editor can represent. It currently covers every kind in the
// contract, but the set stays named here so the loader can refuse a kind added
// later rather than coercing it into one of these and rewriting the tariff.
type EditableTariffKind = 'single' | 'day_night' | 'tou' | 'live' | 'block';
const EDITABLE_KINDS: readonly EditableTariffKind[] = [
    'single',
    'day_night',
    'tou',
    'live',
    'block'
];

const KIND_OPTIONS: ViewToggleOption<EditableTariffKind>[] = [
    {value: 'single', label: 'Single'},
    {value: 'day_night', label: 'Day / night'},
    {value: 'tou', label: 'Time of use'},
    {value: 'live', label: 'Live'},
    {value: 'block', label: 'Stepped blocks'}
];
const LIVE_MODE_OPTIONS: ViewToggleOption<'push' | 'pull'>[] = [
    {value: 'push', label: 'Push'},
    {value: 'pull', label: 'Pull'}
];
const STANDING_PERIOD_OPTIONS: ViewToggleOption<'day' | 'month'>[] = [
    {value: 'day', label: 'Day'},
    {value: 'month', label: 'Month'}
];
const PROVIDER_GROUPS = [
    {label: 'Providers', items: [{value: 'entsoe', label: 'ENTSO-E'}]}
];
const COMMODITY_GROUPS = [
    {
        label: 'Commodity',
        items: [
            {value: 'electricity', label: 'Electricity'},
            {value: 'water', label: 'Water'},
            {value: 'gas', label: 'Gas'},
            {value: 'heat', label: 'Heat'}
        ]
    }
];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TAX_BASES: {value: TariffTaxBasis; label: string}[] = [
    {value: 'energy', label: 'Energy'},
    {value: 'demand', label: 'Demand'},
    {value: 'standing', label: 'Standing'}
];

const editor = reactive(
    defaultEditor({
        currency: props.defaultCurrency || 'EUR',
        timezone: props.defaultTimezone || 'UTC'
    })
);
const taxKeys = new WeakMap<object, string>();
let nextTaxKey = 1;
function taxEditorKey(tax: object): string {
    const existing = taxKeys.get(tax);
    if (existing) return existing;
    const key = `tax-editor-${nextTaxKey++}`;
    taxKeys.set(tax, key);
    return key;
}
const savingTariff = ref(false);
const tariffSaveError = ref<string | null>(null);
const livePushResult = ref<{token: string; url: string} | null>(null);
const taxReorderNotice = ref('');
// Shown under the block list, not only used to disable Save: a stepped tariff
// has enough rules that a dead button with no reason is a support ticket.
const blockError = computed(() => blockFormError(editor));
const taxIssue = computed(() => taxFormIssue(editor));
const taxError = computed(() => taxIssue.value?.message ?? null);
function taxFieldError(
    taxIndex: number,
    field: TariffTaxDraftField
): string | null {
    const issue = taxIssue.value;
    return issue?.taxIndex === taxIndex && issue.field === field
        ? issue.message
        : null;
}
function taxFieldErrorId(
    taxIndex: number,
    field: TariffTaxDraftField
): string {
    return `etf-tax-${taxIndex}-${field}-error`;
}
const formError = computed(() => {
    if (!editor.name.trim()) return 'Enter a tariff name.';
    if (editor.effectiveFrom && editor.effectiveTo && editor.effectiveFrom > editor.effectiveTo) return 'Effective from must be before effective to.';
    if (!billedUnitsForCommodity(editor.commodity).includes(editor.blockUnit as TariffBilledUnit)) {
        return `${editor.commodity} tariffs cannot be billed in ${editor.blockUnit || 'that unit'}.`;
    }
    if (blockError.value) return blockError.value;
    if (taxError.value) return taxError.value;
    if (componentError.value) return componentError.value;
    if (!editor.demandEnabled) return null;
    if (editor.demandRate == null || editor.demandRate <= 0) return 'Enter a demand rate greater than zero.';
    if (editor.demandSeasons.length === 0) return 'Add a demand season.';
    if (editor.demandSeasons.some((season) => season.windows.length === 0)) return 'Every demand season needs a window.';
    if (editor.demandSeasons.some((season) => season.windows.some((window) => window.daysMask === 0))) return 'Every demand window needs at least one day.';
    return null;
});

const COMPONENT_BASIS: Record<TariffComponentChargeType, TariffComponentBasis> = {
    per_unit: 'consumption',
    fixed_day: 'standing',
    fixed_month: 'standing',
    percentage: 'subtotal',
    minimum: 'subtotal'
};
const componentError = computed(() => {
    const codes = new Set<string>();
    for (const [index, component] of editor.components.entries()) {
        if (!component.name.trim()) return `Component ${index + 1} needs a name.`;
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(component.code)) return `Component ${index + 1} needs a lowercase code.`;
        if (codes.has(component.code)) return `Component code '${component.code}' must be unique.`;
        for (const code of component.appliesTo ?? []) {
            if (!codes.has(code) && !code.startsWith('legacy_')) return `Component ${index + 1} can reference only earlier lines.`;
        }
        codes.add(component.code);
    }
    return null;
});
function addPriceComponent() {
    const sequence = editor.components.length + 1;
    editor.components.push({
        code: `component_${sequence}`,
        name: '',
        sequence,
        chargeType: 'per_unit',
        chargeClass: 'supply',
        basis: 'consumption',
        rate: 0,
        appliesTo: [],
        taxable: true,
        effectiveFrom: null,
        effectiveTo: null,
        sourceReference: null
    });
}
function removePriceComponent(index: number) {
    editor.components.splice(index, 1);
    editor.components.forEach((component, position) => {
        component.sequence = position + 1;
    });
}
function setComponentType(index: number, value: string) {
    const type = value as TariffComponentChargeType;
    editor.components[index].chargeType = type;
    editor.components[index].basis = COMPONENT_BASIS[type];
    if (type !== 'percentage' && type !== 'minimum') {
        editor.components[index].appliesTo = [];
    }
}
function setComponentAppliesTo(index: number, value: string) {
    editor.components[index].appliesTo = value
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean);
}

// A tariff saved with a currency outside the shared contract list (e.g. via the
// API) must stay selectable — never silently reassign it on edit.
const currencyGroups = computed(() => {
    const items = CURRENCIES.map((c) => ({value: c, label: c}));
    if (editor.currency && !CURRENCIES.includes(editor.currency)) {
        items.unshift({value: editor.currency, label: editor.currency});
    }
    return [{label: 'Currency', items}];
});
function onCurrencyPicked(code: string) {
    editor.currency = code;
}

const billedUnitGroups = computed(() => [
    {
        label: 'Billed unit',
        items: billedUnitsForCommodity(editor.commodity).map((unit) => ({
            value: unit,
            label: unit
        }))
    }
]);
function onCommodityPicked(value: string) {
    const commodity = value as EnergyCommodity;
    editor.commodity = commodity;
    const units = billedUnitsForCommodity(commodity);
    if (!units.includes(editor.blockUnit as TariffBilledUnit)) {
        editor.blockUnit = units[0];
    }
    if (commodity !== 'electricity') editor.demandEnabled = false;
}
function onBilledUnitPicked(value: string) {
    editor.blockUnit = value;
}

// IANA / Olson zones from the JS runtime — the standard list, no shipped
// catalogue to drift. Older engines without supportedValuesOf still get the
// common cases; the stored zone is merged in so it stays selectable.
function listTimezones(): string[] {
    try {
        return Intl.supportedValuesOf('timeZone');
    } catch {
        return ['UTC', 'Europe/London', 'Europe/Sofia', 'America/New_York'];
    }
}
const timezoneGroups = computed(() => {
    const zones = listTimezones();
    if (editor.timezone && !zones.includes(editor.timezone)) {
        zones.unshift(editor.timezone);
    }
    const byRegion = new Map<string, {value: string; label: string}[]>();
    for (const zone of zones) {
        const region = zone.includes('/') ? zone.split('/')[0] : 'Other';
        const items = byRegion.get(region) ?? [];
        items.push({value: zone, label: zone});
        byRegion.set(region, items);
    }
    return [...byRegion.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, items]) => ({label, items}));
});
// True once the zone belongs to the tariff, not to the seed. A new tariff still
// showing the seeded default has chosen nothing, so it has nothing to report.
const timezoneChosen = ref(false);
// The tariff's own zone anchors its billing periods. When it is not the
// organization default, say both out loud: a fact, not a problem.
const organizationZoneNote = computed(() => {
    const organizationZone = props.organizationTimezone;
    if (!organizationZone) return undefined;
    if (!timezoneChosen.value) return undefined;
    if (editor.timezone === organizationZone) return undefined;
    return `This tariff bills on ${editor.timezone} time; your organization default is ${organizationZone}.`;
});

function onTimezonePicked(zone: string) {
    editor.timezone = zone;
    timezoneChosen.value = true;
}

function onProviderPicked(provider: string) {
    editor.liveProvider = provider;
}

// An optional numeric field is null when cleared — never '' or 0, both of which
// the backend would reject or misread as a real zero.
function numOrNull(v: string): number | null {
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// Keep rate and block copy tied to the selected unit.
const blockUnitLabel = computed(() => editor.blockUnit.trim() || 'unit');

function isLastBlock(index: number): boolean {
    return index === editor.blockSteps.length - 1;
}

// The last block has no upper-limit field, so name what it covers instead of
// leaving an empty cell nobody knows how to fill.
const openBlockLabel = computed(() => {
    const previous =
        editor.blockSteps.length > 1
            ? editor.blockSteps[editor.blockSteps.length - 2].upTo
            : null;
    return previous == null
        ? 'Everything used — no upper limit'
        : `Above ${previous} ${blockUnitLabel.value} — no upper limit`;
});

// New blocks slot in below the unbounded one, which stays last by contract.
function addBlockStep() {
    if (editor.blockSteps.length >= MAX_BLOCK_STEPS) return;
    editor.blockSteps.splice(editor.blockSteps.length - 1, 0, emptyBlockStep());
}
function removeBlockStep(index: number) {
    editor.blockSteps.splice(index, 1);
}

function nextTaxCode(): string {
    const used = new Set(editor.taxes.map((tax) => tax.code));
    for (let number = 1; number <= MAX_TAX_RULES + 1; number++) {
        const candidate = `tax_${number}`;
        if (!used.has(candidate)) return candidate;
    }
    return 'tax';
}
function addTaxRule() {
    if (editor.taxes.length >= MAX_TAX_RULES) return;
    editor.taxes.push(emptyTaxRule(nextTaxCode()));
}
function removeTaxRule(index: number) {
    const removedCode = editor.taxes[index]?.code;
    editor.taxes.splice(index, 1);
    if (!removedCode) return;
    for (const tax of editor.taxes) {
        tax.compoundOn = tax.compoundOn.filter((code) => code !== removedCode);
    }
}
function reconcileTaxCompoundOrder(): string[] {
    const earlierCodes = new Set<string>();
    const dropped: string[] = [];
    for (const tax of editor.taxes) {
        tax.compoundOn = tax.compoundOn.filter((code) => {
            if (earlierCodes.has(code)) return true;
            dropped.push(`${tax.name.trim() || tax.code} → ${code}`);
            return false;
        });
        earlierCodes.add(tax.code);
    }
    return dropped;
}
function moveTaxRule(from: number, to: number) {
    if (
        from < 0 ||
        from >= editor.taxes.length ||
        to < 0 ||
        to >= editor.taxes.length
    ) {
        return;
    }
    const [moved] = editor.taxes.splice(from, 1);
    editor.taxes.splice(to, 0, moved);
    const dropped = reconcileTaxCompoundOrder();
    const movedName = moved.name.trim() || moved.code;
    taxReorderNotice.value = dropped.length
        ? `Moved ${movedName} to tax ${to + 1}. Removed compound references that are no longer earlier: ${dropped.join(', ')}.`
        : `Moved ${movedName} to tax ${to + 1}.`;
}
function updateTaxCode(index: number, code: string) {
    const previousCode = editor.taxes[index].code;
    editor.taxes[index].code = code;
    if (!previousCode || previousCode === code) return;
    for (const laterTax of editor.taxes.slice(index + 1)) {
        laterTax.compoundOn = laterTax.compoundOn.map((reference) =>
            reference === previousCode ? code : reference
        );
    }
}
function toggleTaxBasis(index: number, basis: TariffTaxBasis, enabled: boolean) {
    const tax = editor.taxes[index];
    tax.appliesTo = enabled
        ? [...new Set([...tax.appliesTo, basis])]
        : tax.appliesTo.filter((candidate) => candidate !== basis);
}
function toggleCompoundTax(index: number, code: string, enabled: boolean) {
    if (!code) return;
    const tax = editor.taxes[index];
    tax.compoundOn = enabled
        ? [...new Set([...tax.compoundOn, code])]
        : tax.compoundOn.filter((candidate) => candidate !== code);
}
function setTaxCalculation(index: number, calculation: TariffTaxCalculation) {
    const tax = editor.taxes[index];
    tax.calculation = calculation;
    if (calculation === 'inclusive') {
        tax.exempt = false;
        tax.compoundOn = [];
    }
}
function setTaxExempt(index: number, exempt: boolean) {
    const tax = editor.taxes[index];
    tax.exempt = exempt;
    if (exempt) tax.calculation = 'exclusive';
}

function focusTaxIssue() {
    const issue = taxIssue.value;
    if (issue?.taxIndex == null) return;
    const index = issue.taxIndex;
    const directIds: Partial<Record<TariffTaxDraftField, string>> = {
        code: `etf-tax-code-${index}`,
        name: `etf-tax-name-${index}`,
        ratePct: `etf-tax-rate-${index}`,
        calculation: `etf-tax-calculation-${index}`
    };
    const directId = directIds[issue.field];
    const option = issue.field === 'compoundOn' ? 'compoundOn' : 'appliesTo';
    const target = directId
        ? document.getElementById(directId)
        : document.querySelector<HTMLElement>(
              `.etf-tax-rule[data-tax-index="${index}"] [data-tax-option="${option}"] input`
          );
    target?.focus();
}

function addDemandSeason() {
    editor.demandSeasons.push(emptyDemandSeason());
}
function removeDemandSeason(index: number) {
    editor.demandSeasons.splice(index, 1);
}
function addDemandWindow(seasonIndex: number) {
    editor.demandSeasons[seasonIndex].windows.push({daysMask: 127, startTime: '00:00', endTime: '00:00'});
}
function removeDemandWindow(seasonIndex: number, windowIndex: number) {
    editor.demandSeasons[seasonIndex].windows.splice(windowIndex, 1);
}
function toggleDemandDay(seasonIndex: number, windowIndex: number, bit: number, enabled: boolean) {
    const window = editor.demandSeasons[seasonIndex].windows[windowIndex];
    window.daysMask = enabled ? window.daysMask | (1 << bit) : window.daysMask & ~(1 << bit);
}

onMounted(async () => {
    if (props.editingId == null) return;
    try {
        const res = await ws.sendRPC<{tariff: TariffSpec & {id: number}}>(
            'FLEET_MANAGER',
            'tariff.get',
            {id: props.editingId}
        );
        const t = res?.tariff;
        if (!t) return;
        // A kind this editor cannot represent must not be coerced into one it
        // can: saving would silently rewrite the tariff. Refuse, and say why.
        if (!EDITABLE_KINDS.includes(t.kind as EditableTariffKind)) {
            tariffSaveError.value = `This is a ${t.kind} tariff, which cannot be edited here yet.`;
            return;
        }
        editor.kind = t.kind as EditableTariffKind;
        editor.name = t.name;
        editor.currency = t.currency;
        editor.timezone = t.timezone;
        timezoneChosen.value = true;
        editor.billingDay = t.billingDay;
        editor.commodity = t.commodity ?? 'electricity';
        editor.blockUnit = t.billedUnit ?? 'kWh';
        editor.standingCharge = t.standingCharge;
        editor.standingChargePeriod = t.standingChargePeriod;
        editor.taxes = taxDraftsFromTariff(t.taxes, t.vatPct);
        editor.components = (t.components ?? []).map((component) => ({
            ...component,
            appliesTo: [...(component.appliesTo ?? [])]
        }));
        editor.demandRate = t.demandRate ?? null;
        editor.effectiveFrom = t.effectiveFrom ?? '';
        editor.effectiveTo = t.effectiveTo ?? '';
        editor.sourceReference = t.sourceReference ?? '';
        if (t.demand) {
            editor.demandEnabled = true;
            editor.demandRate = t.demand.rate;
            editor.demandUnit = t.demand.unit;
            editor.demandChargePeriod = t.demand.chargePeriod;
            editor.demandIntervalMinutes = t.demand.intervalMinutes;
            editor.demandRatchetMonths = Math.min(12, Math.max(1, t.demand.ratchetMonths));
            editor.demandSeasons = t.demand.seasons;
        }
        if (t.kind === 'block' && t.blocks) {
            editor.blockUnit = t.billedUnit ?? t.blocks.unit;
            editor.blockSurcharge = t.blocks.surcharge;
            // Stored order and the single unbounded last block were validated
            // when written, so they are loaded as-is and saved back unchanged.
            if (t.blocks.steps.length) {
                editor.blockSteps = t.blocks.steps.map((step) => ({
                    upTo: step.upTo,
                    rate: step.rate
                }));
            }
        }
        if (t.kind === 'single') {
            editor.rate = t.seasons?.[0]?.windows?.[0]?.price ?? 0;
        } else if (t.kind === 'day_night') {
            const wins = t.seasons?.[0]?.windows ?? [];
            editor.dayRate = wins[0]?.price ?? 0;
            editor.nightRate = wins[1]?.price ?? 0;
            editor.dayStart = wins[0]?.startTime ?? '07:00';
            editor.dayEnd = wins[0]?.endTime ?? '23:00';
        }
        if (t.seasons?.length) editor.seasons = t.seasons;
    } catch (err) {
        tariffSaveError.value = (err as {message?: string})?.message ?? 'Failed to load tariff';
    }
});

async function saveTariff() {
    tariffSaveError.value = null;
    livePushResult.value = null;
    savingTariff.value = true;
    try {
        if (formError.value) {
            focusTaxIssue();
            throw new Error(formError.value);
        }
        const isNew = props.editingId == null;
        const spec = buildTariffSpec(editor, props.editingId);
        const res = await ws.sendRPC<{id: number}>(
            'FLEET_MANAGER',
            isNew ? 'tariff.add' : 'tariff.update',
            spec
        );
        const savedId = res?.id ?? props.editingId;
        if (savedId == null) return;
        // Re-running setlivesource for an existing push tariff mints a fresh
        // token and breaks the operator's push URL — only on a new tariff or a
        // pull source (which carries the user's own token).
        if (editor.kind === 'live' && (isNew || editor.liveMode === 'pull')) {
            const kept = await configureLiveSource(savedId);
            if (kept) return; // push result shown — keep editor open
        }
        emit('saved', savedId);
    } catch (err) {
        tariffSaveError.value = (err as {message?: string})?.message ?? 'Failed to save tariff';
    } finally {
        savingTariff.value = false;
    }
}

// Returns true when the editor should stay open (push token to copy).
async function configureLiveSource(tariffId: number): Promise<boolean> {
    if (editor.liveMode === 'push') {
        const res = await ws.sendRPC<{token: string; url: string}>(
            'FLEET_MANAGER',
            'tariff.setlivesource',
            {tariffId, mode: 'push'}
        );
        if (res?.token) {
            livePushResult.value = {token: res.token, url: res.url};
            return true;
        }
        return false;
    }
    await ws.sendRPC('FLEET_MANAGER', 'tariff.setlivesource', {
        tariffId,
        mode: 'pull',
        provider: editor.liveProvider,
        providerConfig: {token: editor.liveToken, area: editor.liveArea}
    });
    return false;
}

function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => undefined);
}

// Inline season / window editor. "simple" hides per-season date pickers and
// window rows — single / day_night expose multi-season only as an override.
const SeasonalEditor = defineComponent({
    props: {
        modelValue: {type: Array as () => TariffSeasonSpec[], required: true},
        simple: {type: Boolean, default: false}
    },
    emits: ['update:modelValue'],
    setup(seProps, {emit: emitSE}) {
        const patchSeason = (idx: number, patch: Partial<TariffSeasonSpec>) =>
            emitSE('update:modelValue', seProps.modelValue.map((s, i) => (i === idx ? {...s, ...patch} : s)));
        const addSeason = () => emitSE('update:modelValue', [...seProps.modelValue, emptySeason()]);
        const removeSeason = (idx: number) =>
            emitSE('update:modelValue', seProps.modelValue.filter((_, i) => i !== idx));
        const patchWindow = (si: number, wi: number, patch: Partial<TariffWindowSpec>) =>
            patchSeason(si, {windows: seProps.modelValue[si].windows.map((w, i) => (i === wi ? {...w, ...patch} : w))});
        const addWindow = (si: number) =>
            patchSeason(si, {windows: [...seProps.modelValue[si].windows, emptyWindow()]});
        const removeWindow = (si: number, wi: number) =>
            patchSeason(si, {windows: seProps.modelValue[si].windows.filter((_, i) => i !== wi)});
        const toggleDay = (si: number, wi: number, bit: number, on: boolean) => {
            const mask = seProps.modelValue[si].windows[wi].daysMask;
            patchWindow(si, wi, {daysMask: on ? mask | (1 << bit) : mask & ~(1 << bit)});
        };
        const val = (e: Event) => (e.target as HTMLInputElement).value;
        const deleteIcon = () => h('i', {class: 'fas fa-xmark', 'aria-hidden': 'true'});

        return () => {
            const seasons = seProps.modelValue;
            return h('div', {class: 'etf-seasons'}, [
                ...seasons.map((season, si) =>
                    h('div', {class: 'etf-season', key: si}, [
                        !seProps.simple || seasons.length > 1
                            ? h('div', {class: 'etf-season-hd'}, [
                                  h('span', {class: 'etf-season-lbl'}, `Season ${si + 1}`),
                                  h('input', {
                                      class: 'core-input etf-input etf-input--date',
                                      value: season.startMonthDay,
                                      placeholder: 'MM-DD',
                                      onInput: (e: Event) => patchSeason(si, {startMonthDay: val(e)})
                                  }),
                                  h('span', {class: 'etf-arrow'}, '→'),
                                  h('input', {
                                      class: 'core-input etf-input etf-input--date',
                                      value: season.endMonthDay,
                                      placeholder: 'MM-DD',
                                      onInput: (e: Event) => patchSeason(si, {endMonthDay: val(e)})
                                  }),
                                  seasons.length > 1
                                      ? h(
                                            'button',
                                            {
                                                class: 'etf-del',
                                                type: 'button',
                                                'aria-label': 'Remove season',
                                                onClick: () => removeSeason(si)
                                            },
                                            [deleteIcon()]
                                        )
                                      : null
                              ])
                            : null,
                        !seProps.simple
                            ? h('div', {class: 'etf-windows'}, [
                                  ...season.windows.map((win, wi) =>
                                      h('div', {class: 'etf-window', key: wi}, [
                                          h('div', {class: 'etf-days'}, DAYS.map((day, di) =>
                                              h('label', {class: 'etf-day', key: di, title: day}, [
                                                  h('input', {
                                                      type: 'checkbox',
                                                      checked: !!(win.daysMask & (1 << di)),
                                                      onChange: (e: Event) => toggleDay(si, wi, di, (e.target as HTMLInputElement).checked)
                                                  }),
                                                  h('span', day.slice(0, 1))
                                              ])
                                          )),
                                          h('div', {class: 'etf-wfields'}, [
                                              h('input', {
                                                  type: 'time',
                                                  class: 'core-input etf-input etf-input--time',
                                                  value: win.startTime,
                                                  onInput: (e: Event) => patchWindow(si, wi, {startTime: val(e)})
                                              }),
                                              h('span', {class: 'etf-arrow'}, '–'),
                                              h('input', {
                                                  type: 'time',
                                                  class: 'core-input etf-input etf-input--time',
                                                  value: win.endTime,
                                                  onInput: (e: Event) => patchWindow(si, wi, {endTime: val(e)})
                                              }),
                                              h('input', {
                                                  type: 'number',
                                                  step: '0.01',
                                                  min: '0',
                                                  class: 'core-input etf-input etf-input--price',
                                                  'aria-label': `Season ${si + 1}, window ${wi + 1} price`,
                                                  value: win.price,
                                                  onInput: (e: Event) => patchWindow(si, wi, {price: Number(val(e))})
                                              }),
                                              h(
                                                  'select',
                                                  {
                                                      class: 'core-input etf-input etf-input--band',
                                                      'aria-label': `Season ${si + 1}, window ${wi + 1} band`,
                                                      value: win.band ?? '',
                                                      onChange: (e: Event) =>
                                                          patchWindow(si, wi, {
                                                              band: (val(e) || undefined) as TariffWindowSpec['band']
                                                          })
                                                  },
                                                  [
                                                      // Empty is not "no band" — it is the ranking Fleet
                                                      // applies when the network's own name is unknown.
                                                      h('option', {value: ''}, 'By price'),
                                                      ...TARIFF_BANDS.map((band) =>
                                                          h('option', {value: band, key: band}, TARIFF_BAND_LABELS[band])
                                                      )
                                                  ]
                                              ),
                                              season.windows.length > 1
                                                  ? h(
                                                        'button',
                                                        {
                                                            class: 'etf-del',
                                                            type: 'button',
                                                            'aria-label': 'Remove window',
                                                            onClick: () => removeWindow(si, wi)
                                                        },
                                                        [deleteIcon()]
                                                    )
                                                  : null
                                          ])
                                      ])
                                  ),
                                  h('button', {class: 'etf-add', type: 'button', onClick: () => addWindow(si)}, '+ Add window')
                              ])
                            : null
                    ])
                ),
                h('button', {class: 'etf-add', type: 'button', onClick: addSeason}, '+ Add season')
            ]);
        };
    }
});
</script>

<style scoped>
.etf-body {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}

.etf-row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap-sm);
    align-items: start;
}

.etf-amount {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.etf-badge {
    flex: none;
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}

.etf-hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

.etf-check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target-min);
}

.etf-components-advanced {
    min-width: 0;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}

.etf-components-advanced > summary {
    display: flex;
    min-height: var(--touch-target-min);
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-primary);
    cursor: pointer;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.etf-components-advanced > summary small {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-regular);
    text-align: right;
}

.etf-taxes {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-3);
}

.etf-components-advanced > .etf-taxes {
    margin: 0;
    padding: 0 var(--space-3) var(--space-3);
}

.etf-taxes-hd {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
}

.etf-taxes-hd h3 {
    margin: 0 0 var(--space-1);
    color: var(--color-text-primary);
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
}

.etf-taxes-hd > .etf-add {
    flex: none;
    white-space: nowrap;
}

.etf-tax-empty {
    margin: 0;
    padding: var(--space-3);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.etf-tax-rule {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    margin: 0;
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}

.etf-tax-rule > legend,
.etf-tax-options > legend {
    padding: 0 var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    overflow-wrap: anywhere;
}

.etf-tax-actions {
    display: flex;
    align-self: flex-end;
    align-items: center;
    gap: var(--space-1);
}

.etf-tax-actions button {
    min-height: var(--touch-target-min);
    padding: 0 var(--space-2);
    border: 0;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: var(--type-caption);
}

.etf-tax-actions button:disabled {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
}

.etf-tax-remove {
    align-self: flex-start;
    min-height: var(--touch-target-min);
    padding: 0 var(--space-2);
    border: 0;
    background: transparent;
    color: var(--color-danger-text);
    cursor: pointer;
    font-size: var(--type-caption);
}

.etf-tax-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(6.5rem, 0.6fr) minmax(10.5rem, 1fr);
    gap: var(--space-2);
    align-items: start;
}

.etf-tax-advanced {
    align-self: flex-start;
    width: min(100%, 28rem);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.etf-tax-advanced > summary {
    cursor: pointer;
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
}

.etf-tax-advanced > :last-child {
    margin-top: var(--space-2);
}

.etf-percent {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.etf-percent > span {
    flex: none;
    color: var(--color-text-tertiary);
}

.etf-tax-exempt {
    align-self: flex-start;
    min-height: auto;
}

.etf-tax-options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    min-width: 0;
    margin: 0;
    padding: var(--space-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}

.etf-tax-options .etf-check {
    min-height: var(--space-7);
    font-size: var(--type-body);
}

.etf-tax-options:disabled {
    color: var(--color-text-tertiary);
    opacity: var(--opacity-disabled);
}

.etf-tax-option-hint {
    flex-basis: 100%;
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.etf-field-error,
.etf-footer-error {
    margin: var(--space-1) 0 0;
    color: var(--color-danger-text);
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
}

.etf-tax-wide-error {
    flex-basis: 100%;
}

.etf-tax-reorder-notice {
    margin: 0;
    padding: var(--space-2);
    border-left: 2px solid var(--color-border-focus);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
}

.etf-footer-error {
    max-width: 28rem;
    margin: 0;
}

.etf-demand-seasons {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
}

.etf-season-hd,
.etf-demand-window,
.etf-days {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.etf-season-hd input {
    width: 8rem;
}

.etf-demand-window > input {
    width: 9rem;
}

.etf-day {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-caption);
}

.etf-error {
    color: var(--color-danger-text);
    font-size: var(--type-body);
}

.etf-blocks {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.etf-block {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: end;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}

.etf-block-no {
    display: flex;
    align-items: center;
    min-height: var(--touch-target-min);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}

.etf-block-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    min-width: 0;
}

.etf-block-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.etf-block-lbl {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.etf-block-open {
    display: flex;
    align-items: center;
    margin: 0;
    min-height: var(--touch-target-min);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}

/* Prices are typed, not nudged: a stepper invites a click that moves a rate by
   a whole unit and hides the decimals a tariff actually uses. */
.etf-typed-number {
    min-height: var(--touch-target-min);
    appearance: textfield;
}

.etf-typed-number::-webkit-outer-spin-button,
.etf-typed-number::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
}

.etf-block-del {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: var(--radius-md);
    background: transparent;
    border: 1px solid var(--color-border-subtle);
    color: var(--color-danger-text);
    cursor: pointer;
    font-size: var(--type-caption);
    transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.etf-block-add {
    min-height: var(--touch-target-min);
}

.etf-block-add:disabled {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
}

.etf-push {
    border: 1px solid color-mix(in srgb, var(--color-primary) 40%, transparent);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
}

.etf-push-title {
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-primary-text);
    margin-bottom: var(--space-2);
}

.etf-push-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1-5);
}

.etf-push-row > span {
    width: var(--space-12);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}

.etf-push-row code {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}

/* SeasonalEditor renders via h() and misses the SFC scope attribute, so its
   styling reaches it through :deep() from the template-owned container. */
.etf-body :deep(.etf-seasons) {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.etf-body :deep(.etf-season) {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
}

.etf-body :deep(.etf-season-hd) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2-5);
}

.etf-body :deep(.etf-season-lbl) {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    margin-right: auto;
}

.etf-body :deep(.etf-input) {
    border-radius: var(--radius-md);
    padding: var(--input-padding);
    font-size: var(--input-font-size);
}

.etf-body :deep(.etf-input--date) {
    width: 5.5rem;
    padding: var(--space-1) var(--space-2);
    text-align: center;
}

.etf-body :deep(.etf-input--time) {
    width: 6.5rem;
}

.etf-body :deep(.etf-input--price) {
    width: 6rem;
}

.etf-body :deep(.etf-input--band) {
    width: 7.5rem;
}

.etf-body :deep(.etf-arrow) {
    color: var(--color-text-tertiary);
}

.etf-body :deep(.etf-windows) {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.etf-body :deep(.etf-window) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}

.etf-body :deep(.etf-days) {
    display: flex;
    gap: var(--space-1);
}

.etf-body :deep(.etf-day) {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    cursor: pointer;
    user-select: none;
}

.etf-body :deep(.etf-day input) {
    width: 1rem;
    height: 1rem;
    accent-color: var(--color-primary);
}

.etf-body :deep(.etf-wfields) {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
}

.etf-body :deep(.etf-del) {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: var(--radius-md);
    background: transparent;
    border: 1px solid var(--color-border-subtle);
    color: var(--color-danger-text);
    cursor: pointer;
    font-size: var(--type-caption);
    transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.etf-body :deep(.etf-add) {
    align-self: flex-start;
    background: transparent;
    border: 1px dashed var(--color-border-strong);
    color: var(--color-text-secondary);
    border-radius: var(--radius-md);
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    cursor: pointer;
    min-height: var(--touch-target-min);
    transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.etf-components-advanced > summary:focus-visible,
.etf-tax-actions button:focus-visible,
.etf-tax-remove:focus-visible,
.etf-block-del:focus-visible,
.etf-body :deep(.etf-add:focus-visible),
.etf-body :deep(.etf-del:focus-visible) {
    outline: 2px solid var(--color-border-focus);
    outline-offset: 2px;
}

.etf-tax-actions button,
.etf-tax-remove {
    transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.etf-tax-actions button:active:not(:disabled),
.etf-tax-remove:active:not(:disabled),
.etf-block-del:active:not(:disabled),
.etf-body :deep(.etf-add:active:not(:disabled)),
.etf-body :deep(.etf-del:active:not(:disabled)) {
    transform: scale(0.97);
}

@media (hover: hover) and (pointer: fine) {
    .etf-block-del:hover,
    .etf-body :deep(.etf-del:hover) {
        background: var(--color-danger-subtle);
    }

    .etf-body :deep(.etf-add:hover) {
        color: var(--color-text-primary);
        border-color: var(--color-border-focus);
    }
}

@media (prefers-reduced-motion: reduce) {
    .etf-tax-actions button,
    .etf-tax-remove,
    .etf-block-del,
    .etf-body :deep(.etf-add),
    .etf-body :deep(.etf-del) {
        transition-duration: 0ms;
    }
}

@media (max-width: 640px) {
    .etf-row2 {
        grid-template-columns: 1fr;
    }

    .etf-taxes-hd {
        align-items: stretch;
        flex-direction: column;
    }

    .etf-components-advanced > summary {
        align-items: flex-start;
        flex-direction: column;
    }

    .etf-components-advanced > summary small {
        text-align: left;
    }

    .etf-tax-grid {
        grid-template-columns: 1fr;
        padding-right: 0;
    }

    .etf-taxes-hd > .etf-add,
    .etf-tax-advanced > summary,
    .etf-tax-exempt,
    .etf-tax-options .etf-check,
    .etf-tax-actions button {
        min-height: var(--touch-target-min);
    }

    .etf-tax-actions {
        align-self: stretch;
        flex-wrap: wrap;
    }

    .etf-tax-actions button,
    .etf-tax-remove {
        min-width: var(--touch-target-min);
        white-space: normal;
    }

    .etf-tax-advanced > summary,
    .etf-tax-exempt,
    .etf-tax-options .etf-check {
        display: flex;
        align-items: center;
    }

    .etf-tax-exempt {
        align-self: stretch;
    }

    .etf-tax-options .etf-check {
        padding: 0 var(--space-1);
    }

    .etf-block-fields {
        grid-template-columns: 1fr;
    }
}
</style>
