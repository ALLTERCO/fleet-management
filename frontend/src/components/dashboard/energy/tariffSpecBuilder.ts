// Extracted from EnergySettingsModal — pure form → TariffSpec conversion.
// Imported by the modal and unit-tested independently.

import type {EnergyCommodity} from '@api/energy';
import type {
    TariffBilledUnit,
    TariffBlockSpec,
    TariffDemandSeasonSpec,
    TariffPriceComponentSpec,
    TariffSeasonSpec,
    TariffSpec,
    TariffTaxBasis,
    TariffTaxCalculation,
    TariffTaxSpec,
    TariffWindowSpec
} from '@api/tariff';

/** Schema cap on TariffBlockSpec.steps — mirrored so the UI stops before the RPC. */
export const MAX_BLOCK_STEPS = 20;
/** Schema cap on structured tax rules. */
export const MAX_TAX_RULES = 20;

const TAX_CODE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/** Editable tax fields. A nullable percentage lets an empty number input stay
 * empty until validation, instead of silently turning into a zero-rate tax. */
export interface TariffTaxDraft {
    code: string;
    name: string;
    ratePct: number | null;
    calculation: TariffTaxCalculation;
    appliesTo: TariffTaxBasis[];
    exempt: boolean;
    compoundOn: string[];
}

/**
 * One row of the block list while it is being edited. `upTo` is null on the
 * last block, which is unbounded by contract, and also on a bounded block
 * whose limit the operator has not typed yet; `rate` is null while its field
 * is empty. `blockFormError` resolves both before anything is sent.
 */
export interface TariffBlockStepDraft {
    upTo: number | null;
    rate: number | null;
}

export interface TariffEditorState {
    name: string;
    currency: string;
    timezone: string;
    billingDay: number;
    kind: 'single' | 'day_night' | 'tou' | 'live' | 'block';
    commodity: EnergyCommodity;
    rate: number;
    dayRate: number;
    nightRate: number;
    dayStart: string;
    dayEnd: string;
    standingCharge: number;
    standingChargePeriod: 'day' | 'month';
    taxes: TariffTaxDraft[];
    components: TariffPriceComponentSpec[];
    demandRate: number | null;
    demandEnabled: boolean;
    demandUnit: 'kW' | 'kVA';
    demandChargePeriod: 'day' | 'month';
    demandIntervalMinutes: 15 | 30;
    demandRatchetMonths: number;
    demandSeasons: TariffDemandSeasonSpec[];
    /** Billed unit the blocks count — 'kWh' for electricity, 'm3' for water. */
    blockUnit: string;
    /** Per-unit charge on every unit whatever the block. Operator data: a
     * utility resets it per period, so it is never a constant here. */
    blockSurcharge: number | null;
    blockSteps: TariffBlockStepDraft[];
    effectiveFrom: string;
    effectiveTo: string;
    sourceReference: string;
    seasons: TariffSeasonSpec[];
    liveMode: 'push' | 'pull';
    liveProvider: string;
    liveToken: string;
    liveArea: string;
}

export function emptyWindow(): TariffWindowSpec {
    return {daysMask: 127, startTime: '00:00', endTime: '00:00', price: 0};
}

export function emptySeason(): TariffSeasonSpec {
    return {
        startMonthDay: '01-01',
        endMonthDay: '12-31',
        windows: [emptyWindow()]
    };
}

export function emptyDemandSeason(): TariffDemandSeasonSpec {
    return {
        startMonthDay: '01-01',
        endMonthDay: '12-31',
        windows: [{daysMask: 127, startTime: '00:00', endTime: '00:00'}]
    };
}

export function emptyBlockStep(): TariffBlockStepDraft {
    return {upTo: null, rate: 0};
}

/** A globally neutral rule seed. Operators supply the jurisdiction-specific
 * name and rate; the identifier is stable for compounding references. */
export function emptyTaxRule(code = 'tax_1'): TariffTaxDraft {
    return {
        code,
        name: '',
        ratePct: null,
        calculation: 'exclusive',
        appliesTo: ['energy', 'demand', 'standing'],
        exempt: false,
        compoundOn: []
    };
}

/** Structured taxes take precedence even when the array is empty. Legacy VAT
 * is promoted only when taxes are absent/null, so opening and saving an old
 * tariff cannot lose its tax. */
export function taxDraftsFromTariff(
    taxes: TariffTaxSpec[] | null | undefined,
    vatPct: number | null | undefined
): TariffTaxDraft[] {
    if (taxes != null) {
        return taxes.map((tax) => ({
            code: tax.code,
            name: tax.name,
            ratePct: tax.ratePct,
            calculation: tax.calculation,
            appliesTo: [...tax.appliesTo],
            exempt: tax.exempt ?? false,
            compoundOn: [...(tax.compoundOn ?? [])]
        }));
    }
    if (vatPct == null || !Number.isFinite(vatPct) || vatPct <= 0) return [];
    return [
        {
            code: 'legacy_vat',
            name: 'VAT',
            ratePct: vatPct,
            calculation: 'exclusive',
            appliesTo: ['energy', 'demand', 'standing'],
            exempt: false,
            compoundOn: []
        }
    ];
}

export type TariffTaxDraftField =
    | 'rules'
    | 'code'
    | 'name'
    | 'ratePct'
    | 'calculation'
    | 'appliesTo'
    | 'compoundOn';

export interface TariffTaxFormIssue {
    taxIndex: number | null;
    field: TariffTaxDraftField;
    message: string;
}

/** First actionable problem in the ordered tax catalogue, including the field
 * that can resolve it so the editor can expose accessible inline feedback. */
export function taxFormIssue(
    editor: TariffEditorState
): TariffTaxFormIssue | null {
    if (editor.taxes.length > MAX_TAX_RULES) {
        return {
            taxIndex: null,
            field: 'rules',
            message: `A tariff can have at most ${MAX_TAX_RULES} tax rules. Remove one.`
        };
    }
    const earlierCodes = new Set<string>();
    for (let index = 0; index < editor.taxes.length; index++) {
        const tax = editor.taxes[index];
        const label = `Tax ${index + 1}`;
        const code = tax.code.trim();
        const name = tax.name.trim();
        const issue = (
            field: TariffTaxDraftField,
            message: string
        ): TariffTaxFormIssue => ({taxIndex: index, field, message});
        if (!code) return issue('code', `${label} needs a stable code.`);
        if (!TAX_CODE_PATTERN.test(code)) {
            return issue(
                'code',
                `${label} code must start with a lowercase letter and use only lowercase letters, numbers, _ or - (maximum 64 characters).`
            );
        }
        if (earlierCodes.has(code))
            return issue('code', `${label} code must be unique.`);
        if (!name)
            return issue(
                'name',
                `${label} needs a name such as GST, sales tax or VAT.`
            );
        if (name.length > 100)
            return issue(
                'name',
                `${label} name must be 100 characters or fewer.`
            );
        if (tax.ratePct == null || !Number.isFinite(tax.ratePct)) {
            return issue('ratePct', `${label} needs a percentage.`);
        }
        if (tax.ratePct < 0 || tax.ratePct > 100) {
            return issue(
                'ratePct',
                `${label} percentage must be between 0 and 100.`
            );
        }
        if (tax.exempt && tax.calculation === 'inclusive') {
            return issue(
                'calculation',
                `${label} is exempt and must use Added to total, not Included in prices.`
            );
        }
        if (tax.calculation === 'inclusive' && tax.compoundOn.length > 0) {
            return issue(
                'compoundOn',
                `${label} is included in prices and cannot compound on another tax.`
            );
        }
        if (!tax.exempt && tax.appliesTo.length === 0) {
            return issue(
                'appliesTo',
                `${label} must apply to at least one charge, or be marked exempt.`
            );
        }
        if (new Set(tax.appliesTo).size !== tax.appliesTo.length) {
            return issue(
                'appliesTo',
                `${label} contains a duplicate charge type.`
            );
        }
        if (new Set(tax.compoundOn).size !== tax.compoundOn.length) {
            return issue(
                'compoundOn',
                `${label} contains a duplicate compounded tax.`
            );
        }
        const invalidReference = tax.compoundOn.find(
            (reference) => !earlierCodes.has(reference)
        );
        if (invalidReference) {
            return issue(
                'compoundOn',
                `${label} can compound only on an earlier tax rule.`
            );
        }
        earlierCodes.add(code);
    }
    return null;
}

export function taxFormError(editor: TariffEditorState): string | null {
    return taxFormIssue(editor)?.message ?? null;
}

/**
 * The block rules the backend enforces (tariffCoverage.assertBlocksWellFormed),
 * restated where the operator can still act on them. Returns the first problem
 * together with its fix, or null when the blocks are safe to send.
 *
 * Kept here rather than in the editor so the save path and the disabled Save
 * button read the same rules.
 */
export function blockFormError(editor: TariffEditorState): string | null {
    if (editor.kind !== 'block') return null;
    const unit = editor.blockUnit.trim();
    if (!unit) {
        return 'Enter the billed unit — kWh for electricity, m3 for water.';
    }
    if (unit.length > 16) {
        return 'Shorten the billed unit to 16 characters or fewer.';
    }
    if (editor.blockSurcharge == null || !(editor.blockSurcharge >= 0)) {
        return (
            'Enter a surcharge of 0 or more. It is charged on every unit, ' +
            'whichever block that unit falls in.'
        );
    }
    const steps = editor.blockSteps;
    if (steps.length === 0) return 'Add at least one block.';
    if (steps.length > MAX_BLOCK_STEPS) {
        return `A tariff can have at most ${MAX_BLOCK_STEPS} blocks. Remove one.`;
    }
    let previous = 0;
    for (let index = 0; index < steps.length; index++) {
        const {upTo, rate} = steps[index];
        const isLast = index === steps.length - 1;
        if (rate == null || !(rate >= 0)) {
            return `Block ${index + 1} needs a rate of 0 or more per ${unit}.`;
        }
        if (isLast) {
            // A bounded top block would bill everything above it at nothing.
            if (upTo !== null) {
                return (
                    `The last block cannot stop at ${upTo} ${unit} — use above ` +
                    'it would cost nothing. Clear its limit, or add a block ' +
                    'above it.'
                );
            }
            continue;
        }
        if (upTo == null) {
            return (
                `Block ${index + 1} needs an upper limit — the ${unit} figure ` +
                'where the next block starts. Type it, or remove the block.'
            );
        }
        if (!(upTo > previous)) {
            return (
                `Block ${index + 1} ends at ${upTo} ${unit}, which is not ` +
                `above the previous block's ${previous} ${unit}. Blocks run ` +
                'low to high, each ending higher than the one before.'
            );
        }
        previous = upTo;
    }
    return null;
}

export function billedUnitsForCommodity(
    commodity: EnergyCommodity
): readonly TariffBilledUnit[] {
    if (commodity === 'water') return ['m3', 'l'];
    if (commodity === 'gas') return ['m3', 'kWh', 'therm', 'MMBtu', 'GJ'];
    return ['kWh'];
}

function validatedBilledUnit(editor: TariffEditorState): TariffBilledUnit {
    const unit = editor.blockUnit.trim() as TariffBilledUnit;
    if (!billedUnitsForCommodity(editor.commodity).includes(unit)) {
        throw new Error(
            `${editor.commodity} tariffs cannot be billed in '${editor.blockUnit}'.`
        );
    }
    return unit;
}

// Only kind='block' may carry blocks — the backend rejects a tariff that
// offers two answers for the same unit.
function buildBlocks(editor: TariffEditorState): TariffBlockSpec {
    const lastIndex = editor.blockSteps.length - 1;
    return {
        unit: validatedBilledUnit(editor),
        steps: editor.blockSteps.map((step, index) => ({
            // The last block is unbounded by contract; the editor keeps that
            // invariant, and this restates it so a stale draft cannot leak out.
            upTo: index === lastIndex ? null : step.upTo,
            // blockFormError has already rejected an empty rate, so the
            // fallback is unreachable and exists only to satisfy the type.
            rate: step.rate ?? 0
        })),
        surcharge: editor.blockSurcharge ?? 0
    };
}

export function buildSeasons(editor: TariffEditorState): TariffSeasonSpec[] {
    if (editor.kind === 'tou') return editor.seasons;
    // 'live' prices from the feed and 'block' from cumulative use; neither
    // reads the clock, so neither carries windows.
    if (editor.kind === 'live' || editor.kind === 'block') return [];

    // For single / day_night: first season gets canonical windows.
    // Extra seasons (advanced override) keep their own windows.
    const extra = editor.seasons.slice(1);
    const firstStart = editor.seasons[0]?.startMonthDay ?? '01-01';
    const firstEnd = editor.seasons[0]?.endMonthDay ?? '12-31';

    const firstWindows: TariffWindowSpec[] =
        editor.kind === 'single'
            ? [
                  {
                      daysMask: 127,
                      startTime: '00:00',
                      endTime: '00:00',
                      price: editor.rate
                  }
              ]
            : [
                  {
                      daysMask: 127,
                      startTime: editor.dayStart,
                      endTime: editor.dayEnd,
                      price: editor.dayRate
                  },
                  {
                      daysMask: 127,
                      startTime: editor.dayEnd,
                      endTime: editor.dayStart,
                      price: editor.nightRate
                  }
              ];

    return [
        {
            startMonthDay: firstStart,
            endMonthDay: firstEnd,
            windows: firstWindows
        },
        ...extra
    ];
}

export function buildTariffSpec(
    editor: TariffEditorState,
    editingId: number | null = null
): TariffSpec {
    if (
        editor.demandEnabled &&
        (editor.demandRate == null || editor.demandRate <= 0)
    ) {
        throw new Error('Enter a demand rate greater than zero.');
    }
    if (editor.commodity !== 'electricity' && editor.demandEnabled) {
        throw new Error('Demand charges currently require electricity.');
    }
    const billedUnit = validatedBilledUnit(editor);
    const blockProblem = blockFormError(editor);
    if (blockProblem) throw new Error(blockProblem);
    const taxProblem = taxFormError(editor);
    if (taxProblem) throw new Error(taxProblem);
    return {
        id: editingId ?? undefined,
        name: editor.name.trim(),
        currency: editor.currency,
        timezone: editor.timezone || 'UTC',
        billingDay: editor.billingDay,
        kind: editor.kind,
        commodity: editor.commodity,
        billedUnit,
        standingCharge: editor.standingCharge,
        standingChargePeriod: editor.standingChargePeriod,
        // New writes always use the global tax catalogue. Explicit [] means
        // tax-free; null vatPct prevents the backend's legacy fallback.
        vatPct: null,
        taxes: editor.taxes.map((tax) => ({
            code: tax.code.trim(),
            name: tax.name.trim(),
            ratePct: tax.ratePct ?? 0,
            calculation: tax.calculation,
            appliesTo: [...tax.appliesTo],
            exempt: tax.exempt,
            compoundOn: [...tax.compoundOn]
        })),
        components: editor.components.map((component) => ({
            ...component,
            code: component.code.trim(),
            name: component.name.trim(),
            chargeClass: component.chargeClass.trim(),
            appliesTo: [...(component.appliesTo ?? [])]
        })),
        demandRate: editor.demandEnabled ? null : editor.demandRate,
        // Both of these are JSONB columns checked for
        // `IS NULL OR jsonb_typeof = 'object'`, and fn_tariff_upsert writes
        // `p_payload->'<key>'` into them directly. `->` on a JSON null yields
        // a JSON null, whose jsonb_typeof is 'null' — neither branch of the
        // check — so the row is rejected. Absent means OMITTED, never null.
        // One rule for both, because two rules is how one of them drifts.
        demand: editor.demandEnabled
            ? {
                  rate: editor.demandRate ?? 0,
                  unit: editor.demandUnit,
                  chargePeriod: editor.demandChargePeriod,
                  intervalMinutes: editor.demandIntervalMinutes,
                  ratchetMonths: editor.demandRatchetMonths,
                  seasons: editor.demandSeasons
              }
            : undefined,
        blocks: editor.kind === 'block' ? buildBlocks(editor) : undefined,
        effectiveFrom: editor.effectiveFrom || null,
        effectiveTo: editor.effectiveTo || null,
        sourceReference: editor.sourceReference.trim() || null,
        seasons: buildSeasons(editor)
    };
}

export function defaultEditor(
    overrides: Partial<TariffEditorState> = {}
): TariffEditorState {
    return {
        name: '',
        currency: 'EUR',
        timezone: 'UTC',
        billingDay: 1,
        kind: 'single',
        commodity: 'electricity',
        rate: 0,
        dayRate: 0,
        nightRate: 0,
        dayStart: '07:00',
        dayEnd: '23:00',
        standingCharge: 0,
        standingChargePeriod: 'month',
        taxes: [],
        components: [],
        demandRate: null,
        demandEnabled: false,
        demandUnit: 'kW',
        demandChargePeriod: 'month',
        demandIntervalMinutes: 15,
        demandRatchetMonths: 1,
        demandSeasons: [emptyDemandSeason()],
        blockUnit: 'kWh',
        blockSurcharge: 0,
        // One unbounded block is the smallest valid stepped tariff; every
        // added block slots in below it. Rates are the operator's to enter.
        blockSteps: [emptyBlockStep()],
        effectiveFrom: '',
        effectiveTo: '',
        sourceReference: '',
        seasons: [emptySeason()],
        liveMode: 'push',
        liveProvider: 'entsoe',
        liveToken: '',
        liveArea: '',
        ...overrides
    };
}
