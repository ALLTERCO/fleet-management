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
    test('unauthenticated API returns 401', async ({request}) => {
        const response = await request.get('/api/device-proxy/test/info');
        // Protected endpoint should reject unauthenticated requests
        expect(response.status()).toBe(401);
    });
});
