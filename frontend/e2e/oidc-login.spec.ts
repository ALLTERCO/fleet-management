import {test, expect} from '@playwright/test';

/**
 * OIDC browser login E2E test.
 *
 * Proves the full human login flow:
 *   FM login page → Zitadel SSO → credentials → callback → authenticated app
 *
 * Zitadel has 5-7s loading screens between each phase, so timeouts are generous.
 *
 * Requires env vars:
 *   E2E_BASE_URL      — FM HTTPS URL (e.g. https://10.101.1.13)
 *   E2E_USERNAME       — Zitadel username (e.g. fm-admin)
 *   E2E_PASSWORD       — Zitadel password (e.g. Admin123!)
 */

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:7011';
const username = process.env.E2E_USERNAME || '';
const password = process.env.E2E_PASSWORD || '';

test.describe('OIDC browser login', () => {
    test.skip(!username || !password, 'E2E_USERNAME and E2E_PASSWORD required');

    test('fm-admin can log in through Zitadel and reach authenticated app', async ({page}) => {
        // Forward browser console and errors to test output for debugging
        page.on('console', (msg) => {
            const type = msg.type();
            if (type === 'error' || type === 'warning') {
                console.log(`[browser:${type}] ${msg.text()}`);
            }
        });
        page.on('pageerror', (err) => {
            console.log(`[browser:pageerror] ${err.message}`);
        });

        const loginNameInput = page.locator(
            '#loginName, input[name="loginName"], input[type="email"], input[autocomplete="username"]'
        );
        const passwordInput = page.locator(
            '#password, input[name="password"], input[type="password"], input[autocomplete="current-password"]'
        );
        const namedSubmitButton = page.getByRole('button', {
            name: /next|continue|sign in|login|submit/i
        });
        const typedSubmitButton = page.locator('button[type="submit"]');

        async function clickSubmit() {
            if (await namedSubmitButton.first().isVisible().catch(() => false)) {
                await namedSubmitButton.first().click();
                return;
            }
            await typedSubmitButton.first().click();
        }

        // Total timeout — full OIDC flow with Zitadel loading screens
        test.setTimeout(120_000);

        // 1. Navigate to FM — should land on /login (or / while the app boots)
        await page.goto(baseUrl, {waitUntil: 'networkidle', timeout: 30_000});

        // The SSO button appears on /login. Wait for it directly — the router
        // may still be redirecting from / to /login when networkidle fires.
        const ssoButton = page.getByRole('button', {name: /sign in/i});
        await expect(ssoButton).toBeVisible({timeout: 20_000});

        // 2. Click "Sign In with SSO" — redirects to Zitadel login
        await ssoButton.click();

        // 3. Zitadel login form — different Zitadel versions/routes use different
        //    URL paths, so do not hard-code /loginname. Wait for either the login
        //    field, the password field, or an immediate callback/dashboard redirect.
        await Promise.race([
            loginNameInput.first().waitFor({state: 'visible', timeout: 30_000}),
            passwordInput.first().waitFor({state: 'visible', timeout: 30_000}),
            page.waitForURL(/\/callback|\/dash\/|\/devices/, {timeout: 30_000})
        ]);

        // Step 1: Enter username if Zitadel asks for it.
        if (await loginNameInput.first().isVisible().catch(() => false)) {
            await loginNameInput.first().fill(username);
            await clickSubmit();
        }

        // Step 2: Enter password if Zitadel asks for it.
        if (await passwordInput.first().isVisible().catch(() => false)) {
            await passwordInput.first().fill(password);
            await clickSubmit();
        } else {
            await expect(passwordInput.first()).toBeVisible({timeout: 20_000});
            await passwordInput.first().fill(password);
            await clickSubmit();
        }

        // Step 3: Handle MFA/passkey setup prompt (Zitadel shows this for new logins)
        //         Click "skip" if the prompt appears, otherwise proceed.
        //         There's a loading screen before this prompt too.
        const skipButton = page.getByRole('button', {name: /skip/i});
        try {
            await skipButton.waitFor({state: 'visible', timeout: 10_000});
            await skipButton.click();
        } catch {
            // No MFA prompt — already redirecting to callback
        }

        // 4. Wait for redirect back to FM through /callback → authenticated route
        //    The callback processes the OIDC code and redirects to /dash/1 or /devices.
        //    Another loading screen happens during the callback token exchange.
        await page.waitForURL(
            (url) => {
                const path = url.pathname;
                return !path.includes('/login') &&
                       !path.includes('/callback') &&
                       !path.includes('/loginname');
            },
            {timeout: 30_000}
        );

        // 5. Assert authenticated state: the app layout should render
        //    App.vue gates on permissionsLoaded — once visible, auth is complete.
        //    WebSocket connection + permission fetch adds a few more seconds.
        const authenticatedContent = page.locator('#main-content');
        await expect(authenticatedContent).toBeVisible({timeout: 20_000});

        // 6. Verify we're on an authenticated route (not login, not callback)
        const currentUrl = page.url();
        expect(currentUrl).not.toContain('/login');
        expect(currentUrl).not.toContain('/callback');
    });
});
