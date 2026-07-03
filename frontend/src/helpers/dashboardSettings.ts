import type {DashboardSettings} from '@/types/dashboard';

// Numeric DashboardSettings fields can arrive as strings from the backend
// (some pg drivers serialise NUMERIC columns as strings) or be sent that
// way from form inputs that skip v-model.number. Coerce at every boundary
// so the type contract holds.
const NUMERIC_KEYS = [
    'tariff',
    'refreshInterval',
    'dayRate',
    'nightRate',
    'emissionFactorGPerKWh',
    'emissionFactorMbmGPerKWh',
    'co2BudgetKg'
] as const;

const NUMERIC_KEYS_NULLABLE = new Set<string>([
    'dayRate',
    'nightRate',
    'emissionFactorGPerKWh',
    'emissionFactorMbmGPerKWh',
    'co2BudgetKg'
]);

export function normaliseDashboardSettings<
    T extends Partial<DashboardSettings>
>(input: T): T {
    const out: Record<string, unknown> = {
        ...(input as Record<string, unknown>)
    };
    for (const key of NUMERIC_KEYS) {
        if (!(key in out)) continue;
        const raw = out[key];
        if (raw === undefined) continue;
        if (raw === null) {
            if (NUMERIC_KEYS_NULLABLE.has(key)) out[key] = null;
            else delete out[key];
            continue;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) {
            out[key] = n;
        } else if (NUMERIC_KEYS_NULLABLE.has(key)) {
            out[key] = null;
        } else {
            delete out[key];
        }
    }
    return out as T;
}
