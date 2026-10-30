import {expect, test} from '@playwright/test';

test('anonymous visitor can render the local login route', async ({page}) => {
    await page.route('**/runtime-config.js', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: 'window.__FM_RUNTIME_CONFIG__ = {devMode: true};'
        })
    );
    await page.route('**/customization.json', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{}'
        })
    );
    await page.route('https://control.shelly.cloud/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" />'
        })
    );

    const response = await page.goto('/login');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page).toHaveTitle('Shelly Fleet Management');
    await expect(
        page.getByRole('heading', {name: 'Fleet Manager', exact: true})
    ).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', {name: 'Sign in'})).toBeDisabled();
    await expect(page.locator('.boot-error')).toHaveCount(0);
});
