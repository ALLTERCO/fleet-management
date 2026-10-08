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

const SYSTEM_TEST_TIMEOUT_MS = positiveTimeout(
    'FM_BM_SYSTEM_TEST_TIMEOUT_MS',
    60 * 60_000
);

export default defineConfig({
    testDir: './e2e/system',
    testMatch: '**/*.spec.ts',
    // The read-only sweep has its own config and never runs the physical journey.
    testIgnore: '**/fm-bm-visual-sweep.spec.ts',
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    preserveOutput: 'never',
    reporter: 'list',
    timeout: SYSTEM_TEST_TIMEOUT_MS,
    expect: {timeout: 60_000},
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
            name: 'chromium-system',
            use: {...devices['Desktop Chrome']}
        }
    ]
});
