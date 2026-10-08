<template>
    <div class="org-panel">
        <div class="org-panel__head">
            <span class="org-panel__title">Organization defaults</span>
        </div>
        <div class="org-panel__body">
            <div class="org-panel__field">
                <div class="org-panel__row">
                    <div class="org-panel__row-label">
                        <i class="fas fa-flag" />
                        <span>Country</span>
                    </div>
                    <div class="org-panel__control">
                        <Dropdown
                            :groups="countryGroups"
                            :default="pickedCountry ?? undefined"
                            placeholder="Pick a starting point"
                            searchable
                            :disabled="!canEdit || saving"
                            @selected="(value: string) => pickCountry(value)"
                        />
                    </div>
                </div>
                <p class="org-panel__hint">
                    A starting point, not a lock: suggests Region, Currency and
                    Unit system below from where the organization is. Nothing
                    saves until you apply it below, everything stays editable
                    after, and it never sets what a tariff bills in or the
                    clock its billing period runs on.
                </p>
                <div v-if="countryPreview" class="org-panel__country-preview">
                    <div
                        v-for="line in countryPreviewLines"
                        :key="line.key"
                        class="org-panel__country-preview-row"
                    >
                        <span class="org-panel__country-preview-label">{{
                            line.label
                        }}</span>
                        <span class="org-panel__country-preview-value">{{
                            line.value
                        }}</span>
                        <span
                            v-if="line.alreadySet"
                            class="org-panel__country-preview-note"
                        >
                            already set — left unchanged
                        </span>
                    </div>
                    <p class="org-panel__country-preview-week">
                        Week starts {{ countryPreviewWeekStartLabel }}.
                    </p>
                    <Button
                        type="green"
                        size="sm"
                        :disabled="!canEdit || saving || !countryPreviewHasChanges"
                        @click="applyCountryDefaults"
                    >
                        Apply suggested defaults
                    </Button>
                </div>
                <p
                    v-else-if="pickedCountry"
                    class="org-panel__hint org-panel__hint--muted"
                >
                    No defaults known for this country yet — nothing changed.
                    Pick values below by hand.
                </p>
            </div>
            <div v-for="field in fields" :key="field.key" class="org-panel__field">
                <div class="org-panel__row">
                    <div class="org-panel__row-label">
                        <i :class="field.icon" />
                        <span>{{ field.label }}</span>
                    </div>
                    <div class="org-panel__control">
                        <Dropdown
                            :groups="field.groups"
                            :default="selected[field.key] ?? UNSET"
                            :searchable="field.searchable"
                            :disabled="!canEdit || saving"
                            @selected="(value: string) => commit(field, value)"
                        />
                    </div>
                </div>
                <p class="org-panel__hint">{{ resolvedHint(field) }}</p>
            </div>
            <!-- Language is not a stored org default (English only, nothing to
                 pick yet), so it sits outside the data-driven fields loop
                 above — a fixed row, same shape, always disabled, kept last
                 so it never displaces which control existing tests find
                 first. -->
            <div class="org-panel__field">
                <div class="org-panel__row">
                    <div class="org-panel__row-label">
                        <i class="fas fa-language" />
                        <span>Language</span>
                    </div>
                    <div class="org-panel__control">
                        <Dropdown :groups="languageGroups" :default="'en'" disabled />
                    </div>
                </div>
                <p class="org-panel__hint">{{ languageHint }}</p>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {OrganizationProfile} from '@api/organization';
import {computed, onMounted, reactive, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import {
    listKnownCountries,
    resolveCountryDefaults
} from '@/helpers/countryDefaults';
import {useAuthStore} from '@/stores/auth';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';

/** The four defaults an organization can set. Every one is nullable on the
 * wire, and null means "no organization default" — never a substituted value,
 * because a wrong currency is worse than an absent one.
 *
 * There is a fifth row on this screen, Language, that is not here: this
 * product ships English only, so there is nothing yet to store per
 * organization. It is a fixed, non-wire display below. */
type DefaultKey =
    | 'timezoneDefault'
    | 'localeDefault'
    | 'currencyDefault'
    | 'unitSystemDefault';

interface DropdownGroup {
    label: string;
    items: {value: string; label: string}[];
}

/** Every default here is picked from a list the runtime supplies, never
 *  typed, so there is no draft to validate and no free-text control. */
interface OrgDefaultField {
    key: DefaultKey;
    label: string;
    icon: string;
    hint: string;
    searchable: boolean;
    groups: DropdownGroup[];
    /** What the stored value means, shown under the control. */
    describe?: (value: string) => string | null;
}

// Sentinel for "no org default" — distinct from a real value so clearing maps
// to a null patch (the backend treats null as "clear").
const UNSET = '__unset__';

const toast = useToastStore();
// Org settings are an admin action; the backend also enforces organizations:update.
const auth = useAuthStore();
const canEdit = computed(() => auth.isAdmin);

const selected = reactive<Record<DefaultKey, string | null>>({
    timezoneDefault: null,
    localeDefault: null,
    currencyDefault: null,
    unitSystemDefault: null
});
const drafts = reactive<Record<DefaultKey, string>>({
    timezoneDefault: '',
    localeDefault: '',
    currencyDefault: '',
    unitSystemDefault: ''
});
const extraZones = ref<string[]>([]);
const extraRegions = ref<string[]>([]);
const saving = ref(false);

// IANA / Olson tz database, read from the JS runtime — the standard zone list,
// no extra dependency. Older engines without supportedValuesOf get a small set
// that still covers the common cases; a saved zone is merged in on load.
function listTimezones(): string[] {
    try {
        return Intl.supportedValuesOf('timeZone');
    } catch {
        return ['UTC', 'Europe/London', 'Europe/Sofia', 'America/New_York'];
    }
}

// ISO 4217 codes from the same runtime table, for the same reason: a currency
// list that ships in code goes stale and always misses somebody's market.
function listCurrencies(): string[] {
    try {
        return Intl.supportedValuesOf('currency');
    } catch {
        return ['EUR', 'USD', 'GBP', 'BGN'];
    }
}

// Unlike 'currency' and 'timeZone', 'region' is not a supportedValuesOf key —
// ECMA-402 fixes that list to calendar/collation/currency/numberingSystem/
// timeZone/unit and does not cover regions. DisplayNames still IS the
// runtime's own region table, it is just not enumerable directly: it echoes
// an unrecognised code back unchanged, so trying every two-letter
// combination and keeping the ones whose resolved name differs from the
// code reads that table the only way it is exposed.
function listRegions(): string[] {
    try {
        const regionNames = new Intl.DisplayNames(['en'], {type: 'region'});
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const codes: string[] = [];
        for (const first of letters) {
            for (const second of letters) {
                const code = first + second;
                const name = regionNames.of(code);
                if (!name || name === code) continue;
                // A retired code (e.g. 'DD', the former East Germany) shares
                // its modern country's name — 'DE' does too, so keeping both
                // would list "Germany" twice. Locale canonicalisation is the
                // runtime's own map of retired subtags to their replacement;
                // a code the algorithm rewrites is the retired one, and its
                // replacement is already reached by this same scan.
                if (Intl.getCanonicalLocales(`und-${code}`)[0] !== `und-${code}`) {
                    continue;
                }
                codes.push(code);
            }
        }
        return codes;
    } catch {
        return ['US', 'GB', 'DE', 'BG'];
    }
}

// A stored region a prior free-text locale carries that the scan above does
// not turn up must still be selectable — same reasoning as extraZones for
// timezone: never silently offer to clear a real saved value.
function regionCodeOf(tag: string): string | null {
    try {
        return new Intl.Locale(tag).region ?? null;
    } catch {
        return null;
    }
}

function displayName(
    value: string,
    type: 'currency' | 'language' | 'region'
): string | null {
    try {
        return new Intl.DisplayNames(['en'], {type}).of(value) ?? null;
    } catch {
        return null;
    }
}

function unsetGroup(label: string): DropdownGroup {
    return {label: 'Default', items: [{value: UNSET, label}]};
}

const timezoneGroups = computed<DropdownGroup[]>(() => {
    const byRegion = new Map<string, {value: string; label: string}[]>();
    for (const zone of [...extraZones.value, ...listTimezones()]) {
        const region = zone.includes('/') ? zone.split('/')[0] : 'Other';
        const items = byRegion.get(region) ?? [];
        if (!items.some((item) => item.value === zone)) {
            items.push({value: zone, label: zone});
        }
        byRegion.set(region, items);
    }
    return [
        unsetGroup('System default (UTC)'),
        ...[...byRegion.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([label, items]) => ({label, items}))
    ];
});

// Value is always `en-<region>`: this product's one language plus the
// region the person picked. Picking a place can never change what a bill is
// charged in — that stays currencyDefault, wired below, untouched here.
const regionGroups = computed<DropdownGroup[]>(() => {
    const seen = new Set<string>();
    const items: {value: string; label: string}[] = [];
    for (const code of [...extraRegions.value, ...listRegions()]) {
        if (seen.has(code)) continue;
        seen.add(code);
        items.push({
            value: `en-${code}`,
            label: displayName(code, 'region') ?? code
        });
    }
    items.sort((a, b) => a.label.localeCompare(b.label));
    return [unsetGroup('No region set'), {label: 'Regions', items}];
});

const currencyGroups = computed<DropdownGroup[]>(() => [
    unsetGroup('No default currency'),
    {
        label: 'Currencies',
        items: listCurrencies().map((code) => ({
            value: code,
            label: displayName(code, 'currency')
                ? `${code} — ${displayName(code, 'currency')}`
                : code
        }))
    }
]);

const unitSystemGroups: DropdownGroup[] = [
    unsetGroup('No default unit system'),
    {
        label: 'Unit system',
        items: [
            {value: 'metric', label: 'Metric (°C, kWh, m)'},
            {value: 'imperial', label: 'Imperial (°F, kWh, ft)'}
        ]
    }
];

// Proof the region choice is live before it saves: today's date and a plain
// number, written the way that region writes them. Deliberately not
// currency-styled — a formatting preview must never look like it is
// pricing something, that is currencyDefault's job alone.
function describeRegionExample(tag: string): string | null {
    const clean = tag.trim();
    if (!clean) return null;
    try {
        const dateStr = new Date().toLocaleDateString(clean, {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        const amountStr = (1234.5).toLocaleString(clean, {
            minimumFractionDigits: 2
        });
        return `${dateStr} · ${amountStr}`;
    } catch {
        return null;
    }
}

// The one language this product ships, named the same way every other
// picker on this screen names its options: live from the runtime table, not
// a hardcoded string.
const LANGUAGE_NAME = displayName('en', 'language') ?? 'English';
const languageGroups: DropdownGroup[] = [
    {label: 'Language', items: [{value: 'en', label: LANGUAGE_NAME}]}
];
const languageHint = `The words shown in the interface. ${LANGUAGE_NAME} today — more languages are coming.`;

const fields = computed<OrgDefaultField[]>(() => [
    {
        key: 'timezoneDefault',
        label: 'Timezone',
        icon: 'fas fa-clock',
        hint: 'IANA zone name. Anchors how billing periods map to a calendar day. Reports can still override it per run.',
        searchable: true,
        groups: timezoneGroups.value
    },
    {
        key: 'localeDefault',
        label: 'Region',
        icon: 'fas fa-globe',
        hint: 'Where the organization is based. Sets how dates, numbers and amounts are written — never what a bill is charged in.',
        searchable: true,
        groups: regionGroups.value,
        describe: describeRegionExample
    },
    {
        key: 'currencyDefault',
        label: 'Currency',
        icon: 'fas fa-coins',
        hint: 'ISO 4217 code money is presented in. A tariff still bills in its own currency.',
        searchable: true,
        groups: currencyGroups.value
    },
    {
        key: 'unitSystemDefault',
        label: 'Unit system',
        icon: 'fas fa-ruler',
        hint: 'Which units readings are presented in. Energy stays in kWh either way.',
        searchable: false,
        groups: unitSystemGroups
    }
]);

// Country defaults: one country picked here suggests Region, Currency and
// Unit system together — the way Apple, Google, Microsoft and Slack all do
// it. All the facts live in helpers/countryDefaults.ts; this is only the
// wiring: show the country's suggestion before anything saves, apply it
// through the same per-field commit() every other control here uses, and
// never touch a field the organization already set. Never offers
// timezoneDefault — the billing clock stays the tariff's alone.
const COUNTRY_APPLICABLE_KEYS = [
    'localeDefault',
    'currencyDefault',
    'unitSystemDefault'
] as const;
type CountryApplicableKey = (typeof COUNTRY_APPLICABLE_KEYS)[number];

const WEEKDAY_NAMES = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday'
];

const pickedCountry = ref<string | null>(null);

const countryGroups = computed<DropdownGroup[]>(() => [
    {
        label: 'Country',
        items: listKnownCountries().map((c) => ({value: c.code, label: c.name}))
    }
]);

const countryPreview = computed(() =>
    pickedCountry.value ? resolveCountryDefaults(pickedCountry.value) : null
);

function pickCountry(code: string): void {
    pickedCountry.value = code;
}

interface CountryPreviewLine {
    key: CountryApplicableKey;
    label: string;
    value: string;
    /** Set when the org already has a value for this field — it is shown,
     *  never silently overwritten. Same test applyCountryDefaults skips on,
     *  so the row and the button can never disagree with the click. */
    alreadySet: boolean;
}

// One row per applicable field, reusing the same describe/display helpers
// the fields below already use — no second formatter for the same value.
const countryPreviewLines = computed<CountryPreviewLine[]>(() => {
    const d = countryPreview.value;
    if (!d) return [];
    const suggestions: {
        key: CountryApplicableKey;
        label: string;
        display: string;
    }[] = [
        {
            key: 'localeDefault',
            label: 'Region',
            display: describeRegionExample(d.locale) ?? d.locale
        },
        {
            key: 'currencyDefault',
            label: 'Currency',
            display: displayName(d.suggestedCurrency, 'currency')
                ? `${d.suggestedCurrency} — ${displayName(d.suggestedCurrency, 'currency')}`
                : d.suggestedCurrency
        },
        {
            key: 'unitSystemDefault',
            label: 'Unit system',
            display:
                d.measurementSystem === 'metric'
                    ? 'Metric (°C, kWh, m)'
                    : 'Imperial (°F, kWh, ft)'
        }
    ];
    return suggestions.map((s) => ({
        key: s.key,
        label: s.label,
        value: s.display,
        alreadySet: selected[s.key] !== null
    }));
});

const countryPreviewWeekStartLabel = computed(
    () => WEEKDAY_NAMES[countryPreview.value?.weekStart ?? 0]
);

const countryPreviewHasChanges = computed(() =>
    countryPreviewLines.value.some((line) => !line.alreadySet)
);

/** Applies the suggestion for every field that is currently unset. A field
 *  the organization already set is left exactly as it is — the person can
 *  still copy the suggested value onto it by hand from the row shown here. */
async function applyCountryDefaults(): Promise<void> {
    const d = countryPreview.value;
    if (!d) return;
    const suggestionByKey: Record<CountryApplicableKey, string> = {
        localeDefault: d.locale,
        currencyDefault: d.suggestedCurrency,
        unitSystemDefault: d.measurementSystem
    };
    for (const key of COUNTRY_APPLICABLE_KEYS) {
        if (selected[key] !== null) continue;
        const field = fields.value.find((f) => f.key === key);
        if (!field) continue;
        await commit(field, suggestionByKey[key]);
    }
}

function resolvedHint(field: OrgDefaultField): string {
    return field.describe?.(drafts[field.key]) ?? field.hint;
}

async function load(): Promise<void> {
    try {
        const profile = await sendRPC<OrganizationProfile>(
            'FLEET_MANAGER',
            'organization.getprofile',
            {}
        );
        // A saved zone the runtime does not list must still be selectable,
        // otherwise opening this page silently offers to clear it.
        if (profile.timezoneDefault) {
            extraZones.value = [profile.timezoneDefault];
        }
        const savedRegion = profile.localeDefault
            ? regionCodeOf(profile.localeDefault)
            : null;
        if (savedRegion) {
            extraRegions.value = [savedRegion];
        }
        for (const field of fields.value) {
            const value = profile[field.key] ?? null;
            selected[field.key] = value;
            drafts[field.key] = value ?? '';
        }
    } catch (err) {
        console.error('Failed to load organization profile', err);
    }
}

/** One write path for every default: patch, confirm, and put the previous
 * value back when the server refuses, so the control never shows a value the
 * organization does not have. */
async function commit(field: OrgDefaultField, raw: string): Promise<void> {
    const trimmed = raw === UNSET ? '' : raw.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next === selected[field.key]) return;

    const previous = selected[field.key];
    selected[field.key] = next;
    drafts[field.key] = next ?? '';
    saving.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'organization.setprofile', {
            patch: {[field.key]: next}
        });
        toast.success(`${field.label} updated`);
    } catch (err) {
        console.error(`Failed to update ${field.key}`, err);
        toast.error(`Could not update ${field.label.toLowerCase()}`);
        selected[field.key] = previous;
        drafts[field.key] = previous ?? '';
    } finally {
        saving.value = false;
    }
}

onMounted(load);
</script>

<style scoped>
.org-panel {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    overflow: hidden;
    margin-top: var(--gap-sm);
}
.org-panel__head {
    display: flex;
    align-items: center;
    padding: var(--gap-xs) var(--gap-sm);
    min-height: var(--touch-target-min);
    border-bottom: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.org-panel__title {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
}
.org-panel__body {
    padding: var(--gap-sm);
}
/* Each default is one block: control and the line explaining it stay together
   so a long hint never reads as belonging to the row below. */
.org-panel__field + .org-panel__field {
    margin-top: var(--gap-sm);
    padding-top: var(--gap-sm);
    border-top: 1px solid var(--color-border-subtle);
}
.org-panel__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--gap-xs) 0;
}
.org-panel__row-label {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.org-panel__control {
    min-width: 14rem;
    max-width: 18rem;
    flex: 1 1 auto;
}
.org-panel__hint {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    margin-top: var(--gap-xs);
    max-width: var(--prose-max-width);
}
.org-panel__hint--muted {
    color: var(--color-text-tertiary);
}
/* The country suggestion: shown before anything saves, so it reads as a
   proposal (bordered, inset) rather than more settled state. */
.org-panel__country-preview {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
    margin-top: var(--gap-xs);
    padding: var(--gap-xs) var(--gap-sm);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.org-panel__country-preview-row {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--gap-2xs) var(--gap-xs);
    font-size: var(--type-body);
}
.org-panel__country-preview-label {
    min-width: 6rem;
    color: var(--color-text-tertiary);
}
.org-panel__country-preview-value {
    color: var(--color-text-primary);
}
.org-panel__country-preview-note {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
}
.org-panel__country-preview-week {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    margin: 0;
}
</style>
