import fs from 'node:fs';

export interface ContainerResources {
    cpuLimitCores: number | null;
    memoryLimitBytes: number | null;
    memoryCurrentBytes: number | null;
}

let cachedResources: ContainerResources | null = null;
let cachedAtMs = 0;

function readFirst(paths: readonly string[]): string | null {
    for (const path of paths) {
        try {
            return fs.readFileSync(path, 'utf8').trim();
        } catch {
            // Try the next cgroup layout.
        }
    }
    return null;
}

function positiveNumber(value: string | null): number | null {
    if (!value || value === 'max') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function memoryLimit(value: string | null): number | null {
    const parsed = positiveNumber(value);
    // cgroup v1 uses a very large integer to mean "unlimited".
    return parsed !== null && parsed < 2 ** 60 ? parsed : null;
}

export function parseCpuLimit(
    cpuMax: string | null,
    quota: string | null,
    period: string | null
): number | null {
    if (cpuMax) {
        const [rawQuota, rawPeriod] = cpuMax.split(/\s+/);
        const q = positiveNumber(rawQuota);
        const p = positiveNumber(rawPeriod);
        return q !== null && p && p > 0 ? q / p : null;
    }
    const q = positiveNumber(quota);
    const p = positiveNumber(period);
    return q !== null && q > 0 && p && p > 0 ? q / p : null;
}

export function readContainerResources(): ContainerResources {
    return {
        cpuLimitCores: parseCpuLimit(
            readFirst(['/sys/fs/cgroup/cpu.max']),
            readFirst([
                '/sys/fs/cgroup/cpu/cpu.cfs_quota_us',
                '/sys/fs/cgroup/cpu.cfs_quota_us'
            ]),
            readFirst([
                '/sys/fs/cgroup/cpu/cpu.cfs_period_us',
                '/sys/fs/cgroup/cpu.cfs_period_us'
            ])
        ),
        memoryLimitBytes: memoryLimit(
            readFirst([
                '/sys/fs/cgroup/memory.max',
                '/sys/fs/cgroup/memory/memory.limit_in_bytes'
            ])
        ),
        memoryCurrentBytes: positiveNumber(
            readFirst([
                '/sys/fs/cgroup/memory.current',
                '/sys/fs/cgroup/memory/memory.usage_in_bytes'
            ])
        )
    };
}

export function readContainerResourcesCached(
    nowMs = Date.now()
): ContainerResources {
    if (!cachedResources || nowMs - cachedAtMs >= 1_000) {
        cachedResources = readContainerResources();
        cachedAtMs = nowMs;
    }
    return cachedResources;
}
