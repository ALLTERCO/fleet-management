import {defineConfig, devices} from '@playwright/test';

function positiveTimeout(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

const SWEEP_TEST_TIMEOUT_MS = positiveTimeout(
    'FM_BM_VISUAL_SWEEP_TIMEOUT_MS',
    15 * 60_000
);

export default defineConfig({
    testDir: './e2e/system',
    testMatch: '**/fm-bm-visual-sweep.spec.ts',
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    // The sweep never opens a secret surface, so its diffs are safe to keep.
    preserveOutput: 'failures-only',
    reporter: 'list',
    timeout: SWEEP_TEST_TIMEOUT_MS,
    expect: {timeout: 30_000},
    snapshotPathTemplate:
        '{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}',
    use: {
        ignoreHTTPSErrors: false,
        serviceWorkers: 'block',
        trace: 'off',
        screenshot: 'off',
        video: 'off'
    },
    projects: [
        {
            name: 'chromium-sweep',
            use: {...devices['Desktop Chrome']}
        }
    ]
});
