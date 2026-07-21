<template>
    <div class="esp-mov" @click.self="emit('close')">
        <div class="esp-modal" role="dialog" aria-modal="true">
            <div class="esp-hd">
                <div><h3>Dashboard settings</h3><p class="esp-sub">Energy</p></div>
                <button type="button" class="esp-x" aria-label="Close" @click="emit('close')">✕</button>
            </div>

            <Teleport to="body">
                <EnergyTariffEditor
                    v-if="tariffEditorOpen"
                    :editing-id="tariffEditorId"
                    :default-currency="form.currency"
                    :default-timezone="form.tariffTimezone || 'UTC'"
                    @close="tariffEditorOpen = false"
                    @saved="onTariffSaved"
                />
            </Teleport>

            <div class="esp-body">
                <nav class="esp-rail">
                    <button v-for="t in TABS" :key="t.key" type="button" class="esp-tab" :class="{on: tab === t.key}" @click="tab = t.key">{{ t.label }}</button>
                </nav>

                <div class="esp-panel">
                    <!-- Scope -->
                    <section v-show="tab === 'scope'">
                        <div class="esp-field">
                            <label>Dashboard name</label>
                            <input v-model="name" class="esp-input" type="text" maxlength="120" placeholder="Energy" />
                        </div>
                        <div class="esp-field">
                            <label>What this dashboard covers</label>
                            <div class="esp-seg">
                                <button type="button" :class="{on: form.scopeType === 'fleet'}" @click="form.scopeType = 'fleet'">Whole fleet</button>
                                <button type="button" :class="{on: form.scopeType === 'group'}" @click="form.scopeType = 'group'">A group</button>
                            </div>
                        </div>
                        <div v-if="form.scopeType === 'group'" class="esp-field">
                            <label>Group</label>
                            <select v-model.number="form.groupId" class="esp-input">
                                <option :value="null">— choose a group —</option>
                                <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
                            </select>
                        </div>
                    </section>

                    <!-- Tariff -->
                    <section v-show="tab === 'tariff'">
                        <div v-if="tariffList.length" class="esp-field">
                            <label>Saved tariff</label>
                            <select v-model.number="form.tariffId" class="esp-input">
                                <option :value="null">Custom — set rates below</option>
                                <option v-for="t in tariffList" :key="t.id" :value="t.id">{{ t.name }} · {{ t.kind }} · {{ t.currency }}</option>
                            </select>
                            <p class="esp-hint">Use a tariff shared across your organisation, or leave Custom to set rates just for this dashboard.</p>
                        </div>

                        <div class="esp-field esp-tariff-actions">
                            <button type="button" class="esp-mini" @click="openTariffEditor(null)">+ New tariff</button>
                            <button v-if="form.tariffId != null" type="button" class="esp-mini" @click="openTariffEditor(form.tariffId)">Edit selected</button>
                            <p class="esp-hint">Seasonal, time-of-use and live tariffs are created here and shared across the organisation.</p>
                        </div>

                        <template v-if="form.tariffId == null">
                            <div class="esp-field">
                                <label>Tariff mode</label>
                                <div class="esp-seg">
                                    <button type="button" :class="{on: form.tariffMode === 'single'}" @click="form.tariffMode = 'single'">Single</button>
                                    <button type="button" :class="{on: form.tariffMode === 'day_night'}" @click="form.tariffMode = 'day_night'">Day / night</button>
                                    <button type="button" :class="{on: form.tariffMode === 'tou'}" @click="form.tariffMode = 'tou'">Time-of-use</button>
                                </div>
                            </div>
                            <div v-if="form.tariffMode === 'single'" class="esp-field">
                                <label>Rate ({{ form.currency }} / kWh)</label>
                                <input v-model.number="form.tariff" class="esp-input" type="number" step="0.01" min="0" />
                            </div>
                            <template v-else-if="form.tariffMode === 'day_night'">
                                <div class="esp-row">
                                    <div class="esp-field"><label>Day rate ({{ form.currency }} / kWh)</label><input v-model.number="form.dayRate" class="esp-input" type="number" step="0.01" min="0" /></div>
                                    <div class="esp-field"><label>Night rate ({{ form.currency }} / kWh)</label><input v-model.number="form.nightRate" class="esp-input" type="number" step="0.01" min="0" /></div>
                                </div>
                                <div class="esp-row">
                                    <div class="esp-field"><label>Day starts</label><input v-model="form.dayStart" class="esp-input" type="time" /></div>
                                    <div class="esp-field"><label>Day ends</label><input v-model="form.dayEnd" class="esp-input" type="time" /></div>
                                </div>
                            </template>
                            <template v-else>
                                <div class="esp-field">
                                    <label>Time-of-use windows (up to 8)</label>
                                    <EnergyTouWindows v-model="form.tariffWindows" />
                                </div>
                                <label class="esp-check"><input type="checkbox" v-model="form.weekendEnabled" /> Different rates on weekends &amp; holidays</label>
                                <div v-if="form.weekendEnabled" class="esp-field">
                                    <label>Weekend / holiday windows</label>
                                    <EnergyTouWindows v-model="form.weekendWindows" />
                                </div>
                                <div v-if="form.weekendEnabled" class="esp-field">
                                    <label>Holiday dates</label>
                                    <textarea v-model="form.holidaysText" class="esp-input" rows="2" placeholder="2026-01-01, 2026-12-25"></textarea>
                                    <p class="esp-hint">YYYY-MM-DD dates separated by commas or spaces — these follow the weekend rates.</p>
                                </div>
                            </template>
                        </template>

                        <div class="esp-row">
                            <div class="esp-field">
                                <label>Currency</label>
                                <select v-model="form.currency" class="esp-input">
                                    <option value="EUR">EUR (€)</option>
                                    <option value="USD">USD ($)</option>
                                    <option value="GBP">GBP (£)</option>
                                    <option value="BGN">BGN (лв)</option>
                                </select>
                            </div>
                            <div class="esp-field">
                                <label>Time zone</label>
                                <input v-model="form.tariffTimezone" class="esp-input" type="text" placeholder="Europe/Sofia" />
                            </div>
                        </div>

                        <template v-if="form.tariffId == null">
                            <div class="esp-subhead">Extra charges</div>
                            <div class="esp-row">
                                <div class="esp-field"><label>Standing charge ({{ form.currency }})</label><input v-model.number="form.standingCharge" class="esp-input" type="number" step="0.01" min="0" /></div>
                                <div class="esp-field"><label>Charged per</label><select v-model="form.standingPeriod" class="esp-input"><option value="day">Day</option><option value="month">Month</option></select></div>
                            </div>
                            <div class="esp-row">
                                <div class="esp-field"><label>Demand rate ({{ form.currency }} / kW·mo)</label><input v-model.number="form.demandRate" class="esp-input" type="number" step="0.01" min="0" /></div>
                                <div class="esp-field"><label>VAT (%)</label><input v-model.number="form.vatPct" class="esp-input" type="number" step="0.1" min="0" /></div>
                            </div>
                            <div class="esp-row">
                                <div class="esp-field"><label>Billing day (1–28)</label><input v-model.number="form.billingDay" class="esp-input" type="number" min="1" max="28" /></div>
                                <div class="esp-field"></div>
                            </div>
                            <p class="esp-hint">Demand, standing charge and VAT feed the bill breakdown on the Overview.</p>
                        </template>
                    </section>

                    <!-- Meters (real device pickers) -->
                    <section v-show="tab === 'meters'">
                        <div class="esp-field">
                            <label>Main meters — grid entry points ({{ form.mainMeterIds.length }} selected)</label>
                            <EnergyDevicePicker v-model="form.mainMeterIds" :devices="deviceList" />
                            <p class="esp-hint">The meters that measure your total grid import / export.</p>
                        </div>
                        <div class="esp-field">
                            <label>Peak-power devices ({{ form.peakDeviceIds.length }} selected)</label>
                            <EnergyDevicePicker v-model="form.peakDeviceIds" :devices="deviceList" />
                            <p class="esp-hint">Counted toward the peak-demand figure. Leave empty to use every device in scope.</p>
                        </div>
                    </section>

                    <!-- Display -->
                    <section v-show="tab === 'display'">
                        <div class="esp-field">
                            <label>Default date range</label>
                            <select v-model="form.defaultRange" class="esp-input">
                                <option value="last_7_days">Last 7 days</option>
                                <option value="last_30_days">Last 30 days</option>
                                <option value="mtd">This month</option>
                                <option value="last_month">Last month</option>
                            </select>
                        </div>
                        <div class="esp-field">
                            <label>Auto-refresh</label>
                            <select v-model.number="form.refreshInterval" class="esp-input">
                                <option :value="60000">Every 60 s</option>
                                <option :value="300000">Every 5 min</option>
                                <option :value="0">Off</option>
                            </select>
                        </div>
                        <div class="esp-subhead">Power quality</div>
                        <div class="esp-row">
                            <div class="esp-field"><label>Nominal voltage (V)</label><input v-model.number="form.nominalVoltage" class="esp-input" type="number" step="1" min="1" /></div>
                            <div class="esp-field"><label>Nominal frequency (Hz)</label><input v-model.number="form.nominalHz" class="esp-input" type="number" step="1" min="1" /></div>
                        </div>
                        <p class="esp-hint">Sets the EN 50160 ±10 % voltage band used for the power-quality checks and report.</p>
                    </section>

                    <!-- PV -->
                    <section v-show="tab === 'pv'">
                        <div class="esp-field">
                            <label>PV / solar</label>
                            <div class="esp-seg">
                                <button type="button" :class="{on: form.pvMode === 'parallel'}" @click="form.pvMode = 'parallel'">Parallel</button>
                                <button type="button" :class="{on: form.pvMode === 'backup'}" @click="form.pvMode = 'backup'">Backup</button>
                                <button type="button" :class="{on: form.pvMode === 'balcony'}" @click="form.pvMode = 'balcony'">Balcony</button>
                                <button type="button" :class="{on: form.pvMode === ''}" @click="form.pvMode = ''">None</button>
                            </div>
                        </div>
                        <template v-if="form.pvMode !== ''">
                            <div class="esp-field">
                                <label>Feed-in rate ({{ form.currency }} / kWh)</label>
                                <input v-model.number="form.feedInRate" class="esp-input" type="number" step="0.01" min="0" />
                            </div>
                            <div class="esp-field">
                                <label>Generation meters — PV inverters ({{ form.pvGenIds.length }} selected)</label>
                                <EnergyDevicePicker v-model="form.pvGenIds" :devices="deviceList" />
                                <p class="esp-hint">Meters that measure what your panels produce.</p>
                            </div>
                            <div class="esp-field">
                                <label>Grid meters for PV ({{ form.pvGridIds.length }} selected)</label>
                                <EnergyDevicePicker v-model="form.pvGridIds" :devices="deviceList" />
                                <p class="esp-hint">Meters at the grid connection, so exported solar is measured correctly.</p>
                            </div>
                        </template>
                    </section>

                    <!-- Carbon -->
                    <section v-show="tab === 'carbon'">
                        <div class="esp-field">
                            <label>Grid emission factor — location-based (g CO₂ / kWh)</label>
                            <input v-model.number="form.emissionFactor" class="esp-input" type="number" step="1" min="0" />
                            <p class="esp-hint">The average grid mix where these devices run.</p>
                        </div>
                        <div class="esp-field">
                            <label>Market-based factor — green tariff / RECs (g CO₂ / kWh)</label>
                            <input v-model.number="form.emissionFactorMbm" class="esp-input" type="number" step="1" min="0" placeholder="Leave blank if none" />
                            <p class="esp-hint">Set this only if you buy certified green energy.</p>
                        </div>
                        <div class="esp-field">
                            <label>CO₂ budget for the period (kg)</label>
                            <input v-model.number="form.co2Budget" class="esp-input" type="number" step="1" min="0" />
                        </div>
                    </section>
                </div>
            </div>

            <div class="esp-ft">
                <span class="esp-sub">Applied on save</span>
                <div class="esp-actions">
                    <button type="button" class="esp-ghost" @click="emit('close')">Cancel</button>
                    <button type="button" class="esp-primary" @click="save">Save</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, reactive, ref} from 'vue';
import type {DashboardSettings} from '@/types/dashboard';
import EnergyDevicePicker from './EnergyDevicePicker.vue';
import EnergyTariffEditor from './EnergyTariffEditor.vue';
import EnergyTouWindows from './EnergyTouWindows.vue';
import {type EnergySettingsForm, toSettingsPayload} from './energySettings.payload';

const props = defineProps<{
    settings: DashboardSettings;
    name: string;
    groupId: number | null;
    groups: {id: number; name: string}[];
    devices?: {id: number; shellyId: string; name: string}[];
    tariffs?: {id: number; name: string; kind: string; currency: string}[];
    dashboardId: number;
}>();
const emit = defineEmits<{
    close: [];
    save: [payload: Partial<DashboardSettings & {groupId: number | null; name: string}>];
    'reload-tariffs': [];
}>();

const TABS = [
    {key: 'scope', label: 'Scope'},
    {key: 'tariff', label: 'Tariff & rates'},
    {key: 'meters', label: 'Meters'},
    {key: 'display', label: 'Display'},
    {key: 'pv', label: 'Solar / PV'},
    {key: 'carbon', label: 'Carbon'}
];
const tab = ref('scope');
const name = ref(props.name);
const deviceList = computed(() => props.devices ?? []);
const tariffList = computed(() => props.tariffs ?? []);

// Inline tariff editor (create / edit a reusable org tariff).
const tariffEditorOpen = ref(false);
const tariffEditorId = ref<number | null>(null);
function openTariffEditor(id: number | null) {
    tariffEditorId.value = id;
    tariffEditorOpen.value = true;
}
function onTariffSaved(id: number) {
    tariffEditorOpen.value = false;
    form.tariffId = id;
    emit('reload-tariffs');
}

const cs = (props.settings.chartSettings ?? {}) as Record<string, unknown>;
const s = props.settings;
const form = reactive<EnergySettingsForm>({
    scopeType: props.groupId == null ? 'fleet' : 'group',
    groupId: props.groupId,
    tariffId: s.tariffId ?? null,
    tariffMode: s.tariffMode ?? 'single',
    tariff: s.tariff ?? 0,
    dayRate: s.dayRate ?? 0,
    nightRate: s.nightRate ?? 0,
    dayStart: (s.dayStart ?? '07:00:00').slice(0, 5),
    dayEnd: (s.dayEnd ?? '23:00:00').slice(0, 5),
    currency: s.currency ?? 'EUR',
    tariffTimezone: s.tariffTimezone ?? '',
    tariffWindows: [...(s.tariffWindows ?? [])],
    weekendEnabled: (s.tariffWeekendOverride?.length ?? 0) > 0,
    weekendWindows: [...(s.tariffWeekendOverride ?? [])],
    holidaysText: (s.tariffHolidays ?? []).join(', '),
    defaultRange: s.defaultRange ?? 'last_7_days',
    refreshInterval: s.refreshInterval ?? 60000,
    emissionFactor: s.emissionFactorGPerKWh ?? 414,
    emissionFactorMbm: s.emissionFactorMbmGPerKWh ?? null,
    co2Budget: s.co2BudgetKg ?? null,
    pvMode: s.pvMode ?? '',
    feedInRate: (cs.feedInRate as number | undefined) ?? 0,
    demandRate: (cs.demandRate as number | undefined) ?? 0,
    standingCharge: (cs.standingCharge as number | undefined) ?? 0,
    standingPeriod: (cs.standingPeriod as 'day' | 'month' | undefined) ?? 'month',
    vatPct: (cs.vatPct as number | undefined) ?? 0,
    billingDay: (cs.billingDay as number | undefined) ?? 1,
    nominalVoltage: (cs.nominalVoltage as number | undefined) ?? 230,
    nominalHz: (cs.nominalHz as number | undefined) ?? 50,
    mainMeterIds: [...((cs.mainMeterIds as string[] | undefined) ?? [])],
    peakDeviceIds: [...(s.peakDeviceIds ?? [])],
    pvGridIds: (s.pvGridRefs ?? []).map((r) => r.device),
    pvGenIds: (s.pvGenerationRefs ?? []).map((r) => r.device)
});

function save() {
    const trimmed = name.value.trim();
    const payload = toSettingsPayload(form, cs) as Partial<
        DashboardSettings & {groupId: number | null; name: string}
    >;
    // Only carry a name when it changed and is non-empty — the rename runs a
    // separate dashboard.update and an empty name would be rejected.
    if (trimmed && trimmed !== props.name) payload.name = trimmed;
    emit('save', payload);
}
</script>

<style scoped>
.esp-mov {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(6, 8, 12, 0.72);
    backdrop-filter: blur(3px);
}
.esp-modal {
    width: 940px;
    max-width: 100%;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    background: #13161c;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    overflow: hidden;
    color: #f5f6f8;
    font: 400 13px 'Inter', system-ui, sans-serif;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.esp-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 22px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.055);
}
.esp-hd h3 {
    font-size: var(--type-body);
    font-weight: 650;
    letter-spacing: -0.02em;
}
.esp-sub {
    font-size: var(--type-caption);
    color: #5d646f;
}
.esp-x {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: transparent;
    border: none;
    color: #9aa1ac;
    cursor: pointer;
    font-size: var(--type-body);
}
.esp-x:hover {
    background: #181c23;
    color: #f5f6f8;
}
.esp-body {
    display: grid;
    grid-template-columns: 186px 1fr;
    min-height: 0;
    flex: 1;
}
.esp-rail {
    border-right: 1px solid rgba(255, 255, 255, 0.055);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: #111419;
    overflow: auto;
}
.esp-tab {
    appearance: none;
    border: none;
    background: transparent;
    color: #9aa1ac;
    cursor: pointer;
    font: 500 13px 'Inter', system-ui, sans-serif;
    text-align: left;
    padding: 9px 12px;
    border-radius: 9px;
}
.esp-tab:hover {
    color: #f5f6f8;
    background: #181c23;
}
.esp-tab.on {
    color: #f5f6f8;
    background: #181c23;
    font-weight: 600;
}
.esp-panel {
    padding: 20px 22px;
    overflow: auto;
}
.esp-field {
    margin-bottom: 16px;
}
.esp-field > label {
    display: block;
    font-size: var(--type-caption);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #5d646f;
    margin-bottom: 8px;
}
.esp-input {
    width: 100%;
    background: #0e1116;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 9px 11px;
    color: #f5f6f8;
    font: 500 13px 'Inter', system-ui, sans-serif;
}
.esp-row {
    display: flex;
    gap: 10px;
}
.esp-row .esp-field {
    flex: 1;
}
.esp-seg {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 2px;
    background: #14171d;
    border: 1px solid rgba(255, 255, 255, 0.055);
    border-radius: 11px;
    padding: 3px;
}
.esp-seg button {
    appearance: none;
    border: none;
    background: transparent;
    color: #9aa1ac;
    cursor: pointer;
    font: 500 12px 'Inter', system-ui, sans-serif;
    padding: 7px 13px;
    border-radius: 8px;
    white-space: nowrap;
}
.esp-seg button:hover {
    color: #f5f6f8;
}
.esp-seg button.on {
    background: #252a33;
    color: #f5f6f8;
    font-weight: 600;
}
textarea.esp-input {
    resize: vertical;
    min-height: 44px;
    font-family: 'Inter', system-ui, sans-serif;
}
.esp-hint {
    font-size: var(--type-caption);
    color: #5d646f;
    line-height: 1.45;
    margin: 6px 2px 0;
}
.esp-tariff-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}
.esp-tariff-actions .esp-hint {
    flex-basis: 100%;
    margin-top: 2px;
}
.esp-mini {
    background: #181c23;
    color: #c9ced6;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 9px;
    padding: 7px 13px;
    font: 500 12px 'Inter', system-ui, sans-serif;
    cursor: pointer;
}
.esp-mini:hover {
    color: #f5f6f8;
    border-color: rgba(255, 255, 255, 0.25);
}
.esp-subhead {
    font-size: var(--type-caption);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #c9ced6;
    margin: 4px 0 12px;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.055);
}
.esp-check {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: var(--type-caption);
    font-weight: 500;
    color: #c9ced6;
    cursor: pointer;
    margin-bottom: 16px;
}
.esp-check input {
    width: 15px;
    height: 15px;
}
.esp-ft {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 22px;
    border-top: 1px solid rgba(255, 255, 255, 0.055);
}
.esp-actions {
    display: flex;
    gap: 10px;
}
.esp-primary {
    background: #0a84ff;
    color: #fff;
    border: none;
    border-radius: 11px;
    padding: 9px 18px;
    font: 600 13px 'Inter', system-ui, sans-serif;
    cursor: pointer;
}
.esp-primary:hover {
    filter: brightness(1.08);
}
.esp-ghost {
    background: transparent;
    color: #9aa1ac;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 11px;
    padding: 9px 16px;
    font: 500 13px 'Inter', system-ui, sans-serif;
    cursor: pointer;
}
.esp-ghost:hover {
    color: #f5f6f8;
}
@media (max-width: 560px) {
    .esp-body {
        grid-template-columns: 1fr;
    }
    .esp-rail {
        flex-direction: row;
        overflow-x: auto;
        border-right: none;
        border-bottom: 1px solid rgba(255, 255, 255, 0.055);
    }
}
</style>
