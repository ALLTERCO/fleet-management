import type {ItaliaSitePowerPolicy} from '../../types/api/operations';

export interface ItaliaSitePowerReading {
    readonly observedAt: string;
    readonly drawKw: number;
}

export type ItaliaSitePowerStatus =
    | 'config_missing'
    | 'data_missing'
    | 'freshness_missing'
    | 'normal'
    | 'warning'
    | 'overload';

export interface ItaliaSitePowerVerdict {
    readonly siteId: number;
    readonly status: ItaliaSitePowerStatus;
    readonly meterId: number | null;
    readonly observedAt: string | null;
    readonly drawKw: number | null;
    readonly contractedKw: number | null;
    readonly availableKw: number | null;
    readonly availableMarginFraction: number | null;
    readonly disconnectAfterSeconds: number | null;
    readonly contractedUsedFraction: number | null;
    readonly usedFraction: number | null;
    readonly remainingKw: number | null;
}

export function evaluateItaliaSitePower(
    policy: ItaliaSitePowerPolicy | undefined,
    reading: ItaliaSitePowerReading | undefined,
    now: Date
): ItaliaSitePowerVerdict {
    if (!policy) return unavailable(0, 'config_missing');
    const availableKw =
        policy.contractedKw * (1 + policy.availableMarginFraction);
    const base = {
        siteId: policy.siteId,
        meterId: policy.meterId,
        contractedKw: policy.contractedKw,
        availableKw,
        availableMarginFraction: policy.availableMarginFraction,
        disconnectAfterSeconds: policy.disconnectAfterSeconds
    };
    if (
        !reading ||
        !Number.isFinite(reading.drawKw) ||
        !Number.isFinite(Date.parse(reading.observedAt))
    ) {
        return {
            ...base,
            status: 'data_missing',
            observedAt: null,
            drawKw: null,
            contractedUsedFraction: null,
            usedFraction: null,
            remainingKw: null
        };
    }
    const observedMs = Date.parse(reading.observedAt);
    if (
        observedMs > now.getTime() ||
        now.getTime() - observedMs > policy.freshnessSeconds * 1000
    ) {
        return {
            ...base,
            status: 'freshness_missing',
            observedAt: reading.observedAt,
            drawKw: reading.drawKw,
            contractedUsedFraction: null,
            usedFraction: null,
            remainingKw: null
        };
    }
    const usedFraction = reading.drawKw / availableKw;
    return {
        ...base,
        status:
            usedFraction > 1
                ? 'overload'
                : usedFraction >= policy.warningFraction
                  ? 'warning'
                  : 'normal',
        observedAt: reading.observedAt,
        drawKw: reading.drawKw,
        contractedUsedFraction: reading.drawKw / policy.contractedKw,
        usedFraction,
        remainingKw: availableKw - reading.drawKw
    };
}

function unavailable(
    siteId: number,
    status: 'config_missing'
): ItaliaSitePowerVerdict {
    return {
        siteId,
        status,
        meterId: null,
        observedAt: null,
        drawKw: null,
        contractedKw: null,
        availableKw: null,
        availableMarginFraction: null,
        disconnectAfterSeconds: null,
        contractedUsedFraction: null,
        usedFraction: null,
        remainingKw: null
    };
}
