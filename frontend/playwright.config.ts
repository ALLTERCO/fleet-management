import {defineConfig, devices} from '@playwright/test';

const E2E_PORT = 4173;
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
    testDir: './e2e/smoke',
    testMatch: '**/*.spec.ts',
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    reporter: 'list',
    timeout: 30_000,
    expect: {timeout: 10_000},
    use: {
        baseURL: E2E_BASE_URL,
        ignoreHTTPSErrors: false,
        serviceWorkers: 'block',
        trace: 'off',
        screenshot: 'off',
        video: 'off'
    },
    webServer: {
        command: `npm run dev -- --host localhost --port ${E2E_PORT} --strictPort`,
        url: `${E2E_BASE_URL}/login`,
        reuseExistingServer: false,
        timeout: 120_000
    },
    projects: [
        {
            name: 'chromium-smoke',
            use: {...devices['Desktop Chrome']}
        }
    ]
});
