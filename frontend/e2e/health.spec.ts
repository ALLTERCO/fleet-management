import {test, expect} from '@playwright/test';

test.describe('Fleet Manager health checks', () => {
    test('backend health endpoint returns 200', async ({request}) => {
        const response = await request.get('/health');
        expect(response.status()).toBe(200);
    });

    test('frontend loads login page', async ({page}) => {
        await page.goto('/');
        // The page should load without errors
        await expect(page).toHaveTitle(/Fleet Manager|Shelly/i);
    });

    test('API variables endpoint is accessible', async ({request}) => {
        const response = await request.get('/api/variables');
        expect(response.status()).toBe(200);
        const data = await response.json();
        expect(data).toHaveProperty('dev-mode');
    });
});

test.describe('Authentication flow', () => {
    test('unauthenticated API returns 401 or redirect', async ({request}) => {
        const response = await request.fetch('/api/device-proxy/test/rpc', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            data: {jsonrpc: '2.0', id: 1, src: 'e2e', method: 'Shelly.GetStatus'}
        });
        // Should not return 200 without auth
        expect(response.status()).not.toBe(200);
    });
});
