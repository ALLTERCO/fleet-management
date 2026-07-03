// One declaration of what a metric semantically IS (energy, power, voltage, …)
// and one formatter per type. Everything that renders a value — report engine,
// HTML, CSV — calls format() so a kWh looks the same everywhere. Raw numbers
// stay raw until the edge; only display goes through here.

import {incrementLabeledCounter} from '../../modules/Observability';
import {SEMANTIC_TYPES, type SemanticType} from '../../types/api/semantic';

export {SEMANTIC_TYPES, type SemanticType};

export interface FormatterContext {
    locale: string;
    currency?: string;
    unitSystem: 'metric' | 'imperial';
    precision?: number;
}

export type Formatter = (value: number, ctx: FormatterContext) => string;

// ── Number + unit primitives ────────────────────────────────────────────────

// Locale-aware fixed-precision number. ctx.precision overrides the per-type
// default when the caller wants a specific scale.
function formatNum(
    value: number,
    ctx: FormatterContext,
    precision: number
): string {
    const digits = ctx.precision ?? precision;
    return new Intl.NumberFormat(ctx.locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
    }).format(value);
}

function withUnit(
    value: number,
    ctx: FormatterContext,
    precision: number,
    unit: string
): string {
    return `${formatNum(value, ctx, precision)} ${unit}`;
}

function celsiusToFahrenheit(celsius: number): number {
    return celsius * 1.8 + 32;
}

// ── Per-type formatters ─────────────────────────────────────────────────────

// Energy arrives in kWh. Below 1 kWh we drop to Wh so small values stay legible.
function formatEnergy(kWh: number, ctx: FormatterContext): string {
    if (Math.abs(kWh) < 1) return withUnit(kWh * 1000, ctx, 0, 'Wh');
    return withUnit(kWh, ctx, 0, 'kWh');
}

// Power arrives in W. At or above 1 kW we show kW so big values stay legible.
function formatPower(watts: number, ctx: FormatterContext): string {
    if (Math.abs(watts) >= 1000) return withUnit(watts / 1000, ctx, 2, 'kW');
    return withUnit(watts, ctx, 0, 'W');
}

function formatTemperature(celsius: number, ctx: FormatterContext): string {
    if (ctx.unitSystem === 'imperial') {
        return withUnit(celsiusToFahrenheit(celsius), ctx, 0, '°F');
    }
    return withUnit(celsius, ctx, 0, '°C');
}

function formatCurrency(amount: number, ctx: FormatterContext): string {
    return new Intl.NumberFormat(ctx.locale, {
        style: 'currency',
        currency: ctx.currency ?? 'EUR'
    }).format(amount);
}

function formatPercent(value: number, ctx: FormatterContext): string {
    return `${formatNum(value, ctx, 0)} %`;
}

// A 0..1 ratio shown as a percentage (0.42 -> "42 %").
function formatRatio(value: number, ctx: FormatterContext): string {
    return `${formatNum(value * 100, ctx, 0)} %`;
}

function formatState(value: number, _ctx: FormatterContext): string {
    return value ? 'On' : 'Off';
}

export const FORMATTERS: Record<SemanticType, Formatter> = {
    energy: formatEnergy,
    power: formatPower,
    voltage: (v, ctx) => withUnit(v, ctx, 0, 'V'),
    current: (v, ctx) => withUnit(v, ctx, 1, 'A'),
    frequency: (v, ctx) => withUnit(v, ctx, 1, 'Hz'),
    power_factor: (v, ctx) => formatNum(v, ctx, 2),
    temperature: formatTemperature,
    humidity: formatPercent,
    illuminance: (v, ctx) => withUnit(v, ctx, 0, 'lux'),
    ratio: formatRatio,
    duration: (v, ctx) => withUnit(v, ctx, 0, 's'),
    state: formatState,
    enum: (v, ctx) => formatNum(v, ctx, 0),
    count: (v, ctx) => formatNum(v, ctx, 0),
    currency: formatCurrency,
    area: (v, ctx) => withUnit(v, ctx, 1, 'm²'),
    volume: (v, ctx) => withUnit(v, ctx, 1, 'm³'),
    mass: (v, ctx) => withUnit(v, ctx, 1, 'kg'),
    flow_rate: (v, ctx) => withUnit(v, ctx, 1, 'L/s'),
    pressure: (v, ctx) => withUnit(v, ctx, 0, 'Pa'),
    co2: (v, ctx) => withUnit(v, ctx, 1, 'kg CO₂e'),
    percent_pct: formatPercent
};

// ── Public entry point ──────────────────────────────────────────────────────

function formatterFor(semantic: SemanticType): Formatter {
    const formatter = FORMATTERS[semantic];
    if (!formatter) {
        throw new Error(`No formatter for semantic type "${semantic}"`);
    }
    return formatter;
}

// Dispatch, degrading one cell to empty if Intl throws on a malformed
// locale/currency. An unknown semantic is a programming error and is left to
// throw — formatterFor runs before the guard.
function dispatchOrFallback(
    numeric: number,
    semantic: SemanticType,
    ctx: FormatterContext
): string {
    const formatter = formatterFor(semantic);
    incrementLabeledCounter('formatter_invoked', {semantic});
    try {
        return formatter(numeric, ctx);
    } catch {
        incrementLabeledCounter('formatter_fallback', {semantic});
        return '';
    }
}

// Single display path. Nullish/blank renders empty; a non-numeric string is
// already display text and passes through; a non-finite number records a
// fallback; everything else is dispatched to its semantic formatter.
export function format(
    value: number | string | null,
    semantic: SemanticType,
    ctx: FormatterContext
): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        // Blank check first: Number('') is 0, not NaN.
        if (value.trim() === '') return '';
        if (!Number.isFinite(Number(value))) return value;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        incrementLabeledCounter('formatter_fallback', {semantic});
        return '';
    }
    return dispatchOrFallback(numeric, semantic, ctx);
}
