<template>
    <div class="etf-ov" @click.self="emit('close')">
        <div class="etf-modal" role="dialog" aria-modal="true" aria-label="Tariff editor">
            <div class="etf-hd">
                <div>
                    <h3>{{ editingId ? 'Edit tariff' : 'New tariff' }}</h3>
                    <p class="etf-sub">Reusable across your organisation</p>
                </div>
                <button type="button" class="etf-x" aria-label="Close" @click="emit('close')">✕</button>
            </div>

            <div class="etf-body">
                <div class="etf-field">
                    <label>Name</label>
                    <input v-model="editor.name" class="etf-input" type="text" maxlength="128" placeholder="My tariff" />
                </div>

                <div class="etf-grid2">
                    <div class="etf-field">
                        <label>Currency</label>
                        <select v-model="editor.currency" class="etf-input">
                            <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
                        </select>
                    </div>
                    <div class="etf-field">
                        <label>Billing day (1–28)</label>
                        <input v-model.number="editor.billingDay" class="etf-input" type="number" min="1" max="28" />
                    </div>
                </div>

                <div class="etf-field">
                    <label>Timezone (IANA)</label>
                    <input v-model="editor.timezone" class="etf-input" type="text" placeholder="Europe/Sofia" />
                </div>

                <div class="etf-field">
                    <label>Rate type</label>
                    <div class="etf-seg">
                        <button
                            v-for="k in KIND_OPTIONS"
                            :key="k.value"
                            type="button"
                            :class="{on: editor.kind === k.value}"
                            @click="editor.kind = k.value"
                        >{{ k.label }}</button>
                    </div>
                </div>

                <!-- Single -->
                <template v-if="editor.kind === 'single'">
                    <div class="etf-field">
                        <label>Rate (per kWh)</label>
                        <div class="etf-row">
                            <span class="etf-badge">{{ editor.currency }}</span>
                            <input v-model.number="editor.rate" class="etf-input" type="number" step="0.01" min="0" />
                        </div>
                    </div>
                    <SeasonalEditor v-model="editor.seasons" :simple="true" />
                </template>

                <!-- Day / night -->
                <template v-else-if="editor.kind === 'day_night'">
                    <div class="etf-grid2">
                        <div class="etf-field">
                            <label>Day rate (per kWh)</label>
                            <input v-model.number="editor.dayRate" class="etf-input" type="number" step="0.01" min="0" />
                        </div>
                        <div class="etf-field">
                            <label>Night rate (per kWh)</label>
                            <input v-model.number="editor.nightRate" class="etf-input" type="number" step="0.01" min="0" />
                        </div>
                        <div class="etf-field">
                            <label>Day starts</label>
                            <input v-model="editor.dayStart" class="etf-input" type="time" />
                        </div>
                        <div class="etf-field">
                            <label>Day ends</label>
                            <input v-model="editor.dayEnd" class="etf-input" type="time" />
                        </div>
                    </div>
                    <SeasonalEditor v-model="editor.seasons" :simple="true" />
                </template>

                <!-- Time of use -->
                <template v-else-if="editor.kind === 'tou'">
                    <SeasonalEditor v-model="editor.seasons" :simple="false" />
                </template>

                <!-- Live -->
                <template v-else-if="editor.kind === 'live'">
                    <div class="etf-field">
                        <label>Live price mode</label>
                        <div class="etf-seg">
                            <button type="button" :class="{on: editor.liveMode === 'push'}" @click="editor.liveMode = 'push'">Push</button>
                            <button type="button" :class="{on: editor.liveMode === 'pull'}" @click="editor.liveMode = 'pull'">Pull</button>
                        </div>
                    </div>
                    <template v-if="editor.liveMode === 'pull'">
                        <div class="etf-field">
                            <label>Provider</label>
                            <select v-model="editor.liveProvider" class="etf-input">
                                <option value="entsoe">ENTSO-E</option>
                            </select>
                        </div>
                        <div class="etf-field">
                            <label>API token</label>
                            <input v-model="editor.liveToken" class="etf-input" type="text" placeholder="ENTSO-E security token" />
                        </div>
                        <div class="etf-field">
                            <label>Area / zone</label>
                            <input v-model="editor.liveArea" class="etf-input" type="text" placeholder="BG" />
                        </div>
                    </template>
                    <p v-if="editor.liveMode === 'push'" class="etf-hint">
                        Save the tariff first — then a one-time push token and URL are shown.
                    </p>
                </template>

                <!-- Extra charges — all kinds -->
                <div class="etf-subhead">Extra charges</div>
                <div class="etf-grid2">
                    <div class="etf-field">
                        <label>Standing charge</label>
                        <div class="etf-row">
                            <span class="etf-badge">{{ editor.currency }}</span>
                            <input v-model.number="editor.standingCharge" class="etf-input" type="number" step="0.01" min="0" />
                        </div>
                    </div>
                    <div class="etf-field">
                        <label>Period</label>
                        <div class="etf-seg">
                            <button type="button" :class="{on: editor.standingChargePeriod === 'day'}" @click="editor.standingChargePeriod = 'day'">Day</button>
                            <button type="button" :class="{on: editor.standingChargePeriod === 'month'}" @click="editor.standingChargePeriod = 'month'">Month</button>
                        </div>
                    </div>
                </div>
                <div class="etf-grid2">
                    <div class="etf-field">
                        <label>VAT % (optional)</label>
                        <input
                            :value="editor.vatPct ?? ''"
                            class="etf-input"
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            placeholder="(none)"
                            @input="editor.vatPct = numOrNull(($event.target as HTMLInputElement).value)"
                        />
                    </div>
                    <div class="etf-field">
                        <label>Demand rate (per kW / month)</label>
                        <div class="etf-row">
                            <span class="etf-badge">{{ editor.currency }}</span>
                            <input
                                :value="editor.demandRate ?? ''"
                                class="etf-input"
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="(none)"
                                @input="editor.demandRate = numOrNull(($event.target as HTMLInputElement).value)"
                            />
                        </div>
                    </div>
                </div>

                <div v-if="livePushResult" class="etf-push">
                    <p class="etf-push-title">Shown once — save the token now</p>
                    <div class="etf-push-row">
                        <span>Token</span>
                        <code>{{ livePushResult.token }}</code>
                        <button type="button" class="etf-ghost etf-ghost--sm" @click="copyToClipboard(livePushResult.token)">Copy</button>
                    </div>
                    <div class="etf-push-row">
                        <span>URL</span>
                        <code>{{ livePushResult.url }}</code>
                        <button type="button" class="etf-ghost etf-ghost--sm" @click="copyToClipboard(livePushResult.url)">Copy</button>
                    </div>
                </div>

                <p v-if="tariffSaveError" class="etf-error">{{ tariffSaveError }}</p>
            </div>

            <div class="etf-ft">
                <button type="button" class="etf-ghost" @click="emit('close')">Cancel</button>
                <button
                    type="button"
                    class="etf-primary"
                    :disabled="savingTariff || !editor.name.trim()"
                    @click="saveTariff"
                >{{ savingTariff ? 'Saving…' : 'Save tariff' }}</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {TariffSeasonSpec, TariffSpec, TariffWindowSpec} from '@api/tariff';
import {defineComponent, h, onMounted, reactive, ref} from 'vue';
import {CURRENCIES} from '@/helpers/currencies';
import * as ws from '@/tools/websocket';
import {buildTariffSpec, defaultEditor, emptySeason, emptyWindow} from './tariffSpecBuilder';

const props = defineProps<{
    /** Tariff id to edit; null creates a new tariff. */
    editingId: number | null;
    /** Seed currency / timezone for a new tariff. */
    defaultCurrency?: string;
    defaultTimezone?: string;
}>();
const emit = defineEmits<{close: []; saved: [id: number]}>();

const KIND_OPTIONS = [
    {value: 'single' as const, label: 'Single'},
    {value: 'day_night' as const, label: 'Day / night'},
    {value: 'tou' as const, label: 'Time of use'},
    {value: 'live' as const, label: 'Live'}
];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const editor = reactive(
    defaultEditor({
        currency: props.defaultCurrency || 'EUR',
        timezone: props.defaultTimezone || 'UTC'
    })
);
const savingTariff = ref(false);
const tariffSaveError = ref<string | null>(null);
const livePushResult = ref<{token: string; url: string} | null>(null);

// An optional numeric field is null when cleared — never '' or 0, both of which
// the backend would reject or misread as a real zero.
function numOrNull(v: string): number | null {
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
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
        editor.name = t.name;
        editor.currency = t.currency;
        editor.timezone = t.timezone;
        editor.billingDay = t.billingDay;
        editor.kind = t.kind;
        editor.standingCharge = t.standingCharge;
        editor.standingChargePeriod = t.standingChargePeriod;
        editor.vatPct = t.vatPct;
        editor.demandRate = t.demandRate;
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

        return () => {
            const seasons = seProps.modelValue;
            return h('div', {class: 'etf-seasons'}, [
                ...seasons.map((season, si) =>
                    h('div', {class: 'etf-season', key: si}, [
                        !seProps.simple || seasons.length > 1
                            ? h('div', {class: 'etf-season-hd'}, [
                                  h('span', {class: 'etf-season-lbl'}, `Season ${si + 1}`),
                                  h('input', {
                                      class: 'etf-input etf-input--date',
                                      value: season.startMonthDay,
                                      placeholder: 'MM-DD',
                                      onInput: (e: Event) => patchSeason(si, {startMonthDay: val(e)})
                                  }),
                                  h('span', {class: 'etf-arrow'}, '→'),
                                  h('input', {
                                      class: 'etf-input etf-input--date',
                                      value: season.endMonthDay,
                                      placeholder: 'MM-DD',
                                      onInput: (e: Event) => patchSeason(si, {endMonthDay: val(e)})
                                  }),
                                  seasons.length > 1
                                      ? h('button', {class: 'etf-del', type: 'button', onClick: () => removeSeason(si)}, '✕')
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
                                                  class: 'etf-input etf-input--time',
                                                  value: win.startTime,
                                                  onInput: (e: Event) => patchWindow(si, wi, {startTime: val(e)})
                                              }),
                                              h('span', {class: 'etf-arrow'}, '–'),
                                              h('input', {
                                                  type: 'time',
                                                  class: 'etf-input etf-input--time',
                                                  value: win.endTime,
                                                  onInput: (e: Event) => patchWindow(si, wi, {endTime: val(e)})
                                              }),
                                              h('input', {
                                                  type: 'number',
                                                  step: '0.01',
                                                  min: '0',
                                                  class: 'etf-input etf-input--price',
                                                  value: win.price,
                                                  onInput: (e: Event) => patchWindow(si, wi, {price: Number(val(e))})
                                              }),
                                              season.windows.length > 1
                                                  ? h('button', {class: 'etf-del', type: 'button', onClick: () => removeWindow(si, wi)}, '✕')
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
.etf-ov {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(6, 8, 12, 0.72);
    backdrop-filter: blur(3px);
}
.etf-modal {
    width: 620px;
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
.etf-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 22px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.055);
}
.etf-hd h3 {
    font-size: 15px;
    font-weight: 650;
    letter-spacing: -0.02em;
}
.etf-sub {
    font-size: 11.5px;
    color: #5d646f;
}
.etf-x {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: transparent;
    border: none;
    color: #9aa1ac;
    cursor: pointer;
    font-size: 15px;
}
.etf-x:hover {
    background: #181c23;
    color: #f5f6f8;
}
.etf-body {
    padding: 20px 22px;
    overflow: auto;
}
.etf-field {
    margin-bottom: 16px;
}
.etf-field > label {
    display: block;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #5d646f;
    margin-bottom: 8px;
}
.etf-grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 14px;
}
.etf-input {
    width: 100%;
    background: #0e1116;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 9px 11px;
    color: #f5f6f8;
    font: 500 13px 'Inter', system-ui, sans-serif;
}
.etf-row {
    display: flex;
    gap: 8px;
    align-items: center;
}
.etf-badge {
    flex: none;
    padding: 6px 9px;
    border-radius: 8px;
    background: #181c23;
    color: #9aa1ac;
    font-size: 11px;
    font-weight: 600;
}
.etf-seg {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 2px;
    background: #14171d;
    border: 1px solid rgba(255, 255, 255, 0.055);
    border-radius: 11px;
    padding: 3px;
}
.etf-seg button {
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
.etf-seg button:hover {
    color: #f5f6f8;
}
.etf-seg button.on {
    background: #252a33;
    color: #f5f6f8;
    font-weight: 600;
}
.etf-hint {
    font-size: 11px;
    color: #5d646f;
    line-height: 1.45;
    margin: 6px 2px 0;
}
.etf-subhead {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #c9ced6;
    margin: 4px 0 14px;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.055);
}
/* Seasons / windows */
.etf-season {
    border: 1px solid rgba(255, 255, 255, 0.055);
    border-radius: 12px;
    padding: 12px;
    margin-bottom: 10px;
}
.etf-season-hd {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}
.etf-season-lbl {
    font-size: 11px;
    font-weight: 600;
    color: #9aa1ac;
    margin-right: auto;
}
.etf-input--date {
    width: 74px;
    padding: 6px 8px;
    text-align: center;
}
.etf-input--time {
    width: 96px;
}
.etf-input--price {
    width: 84px;
}
.etf-arrow {
    color: #5d646f;
}
.etf-windows {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.etf-window {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}
.etf-days {
    display: flex;
    gap: 3px;
}
.etf-day {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    font-size: 9px;
    color: #5d646f;
    cursor: pointer;
    user-select: none;
}
.etf-day input {
    width: 13px;
    height: 13px;
    accent-color: #0a84ff;
}
.etf-wfields {
    display: flex;
    align-items: center;
    gap: 6px;
}
.etf-del {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #d16a6a;
    cursor: pointer;
    font-size: 12px;
}
.etf-del:hover {
    background: #1c1416;
}
.etf-add {
    align-self: flex-start;
    margin-top: 2px;
    background: transparent;
    border: 1px dashed rgba(255, 255, 255, 0.15);
    color: #9aa1ac;
    border-radius: 9px;
    padding: 7px 12px;
    font: 500 12px 'Inter', system-ui, sans-serif;
    cursor: pointer;
}
.etf-add:hover {
    color: #f5f6f8;
    border-color: rgba(255, 255, 255, 0.28);
}
.etf-push {
    border: 1px solid rgba(10, 132, 255, 0.4);
    background: rgba(10, 132, 255, 0.08);
    border-radius: 12px;
    padding: 12px;
    margin-top: 6px;
}
.etf-push-title {
    font-size: 11px;
    font-weight: 700;
    color: #6cb2ff;
    margin-bottom: 8px;
}
.etf-push-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
}
.etf-push-row > span {
    width: 42px;
    font-size: 10px;
    color: #5d646f;
    text-transform: uppercase;
}
.etf-push-row code {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    color: #c9ced6;
}
.etf-error {
    color: #e5484d;
    font-size: 12px;
    margin-top: 10px;
}
.etf-ft {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 22px;
    border-top: 1px solid rgba(255, 255, 255, 0.055);
}
.etf-primary {
    background: #0a84ff;
    color: #fff;
    border: none;
    border-radius: 11px;
    padding: 9px 18px;
    font: 600 13px 'Inter', system-ui, sans-serif;
    cursor: pointer;
}
.etf-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.etf-primary:not(:disabled):hover {
    filter: brightness(1.08);
}
.etf-ghost {
    background: transparent;
    color: #9aa1ac;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 11px;
    padding: 9px 16px;
    font: 500 13px 'Inter', system-ui, sans-serif;
    cursor: pointer;
}
.etf-ghost:hover {
    color: #f5f6f8;
}
.etf-ghost--sm {
    padding: 5px 10px;
    font-size: 11px;
    border-radius: 8px;
}
</style>
