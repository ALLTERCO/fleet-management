import type {
    ItaliaHotWaterBlockPolicy,
    ItaliaHotWaterPolicy
} from '../../types/api/operations';

export type {ItaliaHotWaterPolicy} from '../../types/api/operations';

export interface ItaliaHotWaterReading {
    readonly observedAt: string;
    readonly valueC: number;
    readonly minimumC: number;
}

export type ItaliaHotWaterBlockStatus =
    | 'data_missing'
    | 'stale'
    | 'at_or_above_limit'
    | 'below_limit';

export interface ItaliaHotWaterBlockVerdict {
    readonly blockId: string;
    readonly deviceId: string;
    readonly status: ItaliaHotWaterBlockStatus;
    readonly limitC: number;
    readonly currentC: number | null;
    readonly observedAt: string | null;
    readonly minimumC: number | null;
    readonly minutesBelowNow: number | null;
    readonly minutesBelowInPeriod: number | null;
    readonly samples: number;
}

export interface ItaliaHotWaterVerdict {
    readonly siteId: number;
    readonly status: 'config_missing' | 'configured';
    readonly from: string | null;
    readonly to: string | null;
    readonly blocks: readonly ItaliaHotWaterBlockVerdict[];
}

export type ItaliaReopeningFlushBlockStatus =
    | 'data_missing'
    | 'pending'
    | 'reached'
    | 'not_reached';

export interface ItaliaReopeningFlushBlockVerdict {
    readonly blockId: string;
    readonly deviceId: string;
    readonly status: ItaliaReopeningFlushBlockStatus;
    readonly limitC: number;
    readonly holdMinutes: number;
    readonly heldMinutes: number | null;
    readonly reachedAt: string | null;
    readonly heldUntil: string | null;
    readonly peakC: number | null;
    readonly samples: number;
}

export interface ItaliaReopeningFlushVerdict {
    readonly siteId: number;
    readonly status: 'config_missing' | 'configured';
    readonly from: string | null;
    readonly to: string | null;
    readonly blocks: readonly ItaliaReopeningFlushBlockVerdict[];
}

interface Sample {
    readonly at: number;
    readonly valueC: number;
    readonly minimumC: number;
}

const MINUTE_MS = 60_000;

function samplesOf(readings: readonly ItaliaHotWaterReading[]): Sample[] {
    return readings
        .map((reading) => ({
            at: Date.parse(reading.observedAt),
            valueC: reading.valueC,
            minimumC: reading.minimumC
        }))
        .filter(
            (sample) =>
                Number.isFinite(sample.at) &&
                Number.isFinite(sample.valueC) &&
                Number.isFinite(sample.minimumC)
        )
        .sort((left, right) => left.at - right.at);
}

function minutesBetween(from: number, to: number): number {
    return Math.round(((to - from) / MINUTE_MS) * 10) / 10;
}

function emptyBlock(
    block: ItaliaHotWaterBlockPolicy
): ItaliaHotWaterBlockVerdict {
    return {
        blockId: block.blockId,
        deviceId: block.deviceId,
        status: 'data_missing',
        limitC: block.limitC,
        currentC: null,
        observedAt: null,
        minimumC: null,
        minutesBelowNow: null,
        minutesBelowInPeriod: null,
        samples: 0
    };
}

export function evaluateItaliaHotWaterVerdict(
    policy: ItaliaHotWaterPolicy | null,
    readingsByBlock: ReadonlyMap<string, readonly ItaliaHotWaterReading[]>,
    period: {from: Date; to: Date}
): ItaliaHotWaterVerdict {
    if (policy === null) {
        return {
            siteId: 0,
            status: 'config_missing',
            from: null,
            to: null,
            blocks: []
        };
    }
    const maxGapMs = policy.maxGapMinutes * MINUTE_MS;
    const blocks = policy.blocks.map((block) => {
        const samples = samplesOf(readingsByBlock.get(block.blockId) ?? []);
        if (samples.length === 0) return emptyBlock(block);
        const latest = samples.at(-1);
        if (!latest) return emptyBlock(block);
        let belowMs = 0;
        for (let index = 0; index < samples.length - 1; index += 1) {
            if (samples[index].valueC >= block.limitC) continue;
            const gap = samples[index + 1].at - samples[index].at;
            if (gap <= 0 || gap > maxGapMs) continue;
            belowMs += gap;
        }
        const shared = {
            blockId: block.blockId,
            deviceId: block.deviceId,
            limitC: block.limitC,
            currentC: latest.valueC,
            observedAt: new Date(latest.at).toISOString(),
            minimumC: samples.reduce(
                (minimum, sample) => Math.min(minimum, sample.minimumC),
                samples[0].minimumC
            ),
            minutesBelowInPeriod: Math.round((belowMs / MINUTE_MS) * 10) / 10,
            samples: samples.length
        };
        if (period.to.getTime() - latest.at > policy.freshnessSeconds * 1000) {
            return {
                ...shared,
                status: 'stale' as const,
                minutesBelowNow: null
            };
        }
        if (latest.valueC >= block.limitC) {
            return {
                ...shared,
                status: 'at_or_above_limit' as const,
                minutesBelowNow: null
            };
        }
        let start = samples.length - 1;
        while (start > 0) {
            const previous = samples[start - 1];
            const current = samples[start];
            if (
                previous.valueC >= block.limitC ||
                current.at - previous.at > maxGapMs
            )
                break;
            start -= 1;
        }
        return {
            ...shared,
            status: 'below_limit' as const,
            minutesBelowNow: minutesBetween(samples[start].at, latest.at)
        };
    });
    return {
        siteId: policy.siteId,
        status: 'configured',
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        blocks
    };
}

function emptyFlushBlock(
    policy: ItaliaHotWaterPolicy,
    block: ItaliaHotWaterBlockPolicy
): ItaliaReopeningFlushBlockVerdict {
    return {
        blockId: block.blockId,
        deviceId: block.deviceId,
        status: 'data_missing',
        limitC: block.limitC,
        holdMinutes: policy.holdMinutes,
        heldMinutes: null,
        reachedAt: null,
        heldUntil: null,
        peakC: null,
        samples: 0
    };
}

export function evaluateItaliaReopeningFlushVerdict(
    policy: ItaliaHotWaterPolicy | null,
    readingsByBlock: ReadonlyMap<string, readonly ItaliaHotWaterReading[]>,
    period: {from: Date; to: Date},
    now: Date
): ItaliaReopeningFlushVerdict {
    if (policy === null) {
        return {
            siteId: 0,
            status: 'config_missing',
            from: null,
            to: null,
            blocks: []
        };
    }
    const maxGapMs = policy.maxGapMinutes * MINUTE_MS;
    const blocks = policy.blocks.map((block) => {
        const samples = samplesOf(
            readingsByBlock.get(block.blockId) ?? []
        ).filter(
            (sample) =>
                sample.at >= period.from.getTime() &&
                sample.at <= period.to.getTime()
        );
        if (samples.length === 0) return emptyFlushBlock(policy, block);
        let longestMs = 0;
        let longestStart: Sample | null = null;
        let longestEnd: Sample | null = null;
        let runStart: Sample | null = null;
        let previous: Sample | null = null;
        let peakC = samples[0].valueC;
        for (const sample of samples) {
            peakC = Math.max(peakC, sample.valueC);
            const gapBroken =
                previous !== null && sample.at - previous.at > maxGapMs;
            if (sample.valueC >= block.limitC) {
                if (runStart === null || gapBroken) runStart = sample;
                const span = sample.at - runStart.at;
                if (span >= longestMs) {
                    longestMs = span;
                    longestStart = runStart;
                    longestEnd = sample;
                }
            } else {
                runStart = null;
            }
            previous = sample;
        }
        const heldMinutes = longestStart
            ? minutesBetween(longestStart.at, longestEnd?.at ?? longestStart.at)
            : 0;
        const reached = heldMinutes >= policy.holdMinutes;
        return {
            blockId: block.blockId,
            deviceId: block.deviceId,
            status: reached
                ? ('reached' as const)
                : period.to.getTime() > now.getTime()
                  ? ('pending' as const)
                  : ('not_reached' as const),
            limitC: block.limitC,
            holdMinutes: policy.holdMinutes,
            heldMinutes,
            reachedAt:
                reached && longestStart
                    ? new Date(longestStart.at).toISOString()
                    : null,
            heldUntil:
                reached && longestEnd
                    ? new Date(longestEnd.at).toISOString()
                    : null,
            peakC,
            samples: samples.length
        };
    });
    return {
        siteId: policy.siteId,
        status: 'configured',
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        blocks
    };
}
