<template>
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm">
        <div
            class="bg-[var(--color-surface-2)] border border-[var(--color-border-strong)] shadow-none rounded px-8 pt-6 pb-8 mb-4 flex flex-col gap-4"
        >
            <p class="text-xl font-semibold pb-2 text-center text-[var(--color-text-secondary)]">
                {{ status || 'Logging you in, please wait' }}
            </p>
            <div v-if="!error" class="w-full flex justify-around">
                <Spinner />
            </div>
            <p v-if="error" class="text-center text-[var(--color-danger-text)] text-sm">{{ error }}</p>
            <pre v-if="debugInfo" class="text-2xs text-[var(--color-text-tertiary)] bg-[var(--color-surface-1)] rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">{{ debugInfo }}</pre>
            <button
                v-if="error"
                class="mt-2 text-sm underline text-[var(--color-primary)]"
                type="button"
                @click="router.replace(LOGIN_PATH)"
            >
                Return to login
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {nextTick, onMounted, ref} from 'vue';
import {useRouter} from 'vue-router';
import Spinner from '@/components/core/Spinner.vue';
import {LOGIN_PATH} from '@/constants';
import {getZitadelAuth} from '@/helpers/zitadelAuth';
import {debug, debugWarn} from '@/tools/debug';

const router = useRouter();
const error = ref<string | null>(null);
const status = ref<string | null>(null);
const debugInfo = ref<string | null>(null);

// Layout is pinned in the <route> block below, so this page is not
// remounted when auth state flips during the redirect.
onMounted(() => {
    // Callback diagnostics — persisted only in dev to avoid leaking auth
    // trace into prod localStorage. UI-visible debugInfo still works.
    const dbg: string[] = [
        `[${new Date().toISOString()}] callback.vue onMounted`
    ];
    const flushDbg = import.meta.env.DEV
        ? () => {
              try {
                  localStorage.setItem('_oidc_debug', dbg.join('\n'));
              } catch (error) {
                  debugWarn('OIDC debug persistence failed', error);
              }
          }
        : () => {};

    const callbackUrl = window.location.href;
    const hasCode = callbackUrl.includes('code=');
    const hasError = callbackUrl.includes('error=');
    // Strip code/state from anything we log or persist — they're
    // single-use but still secrets while live.
    const safeUrl = callbackUrl
        .replace(/([?&])code=[^&]*/g, '$1code=[redacted]')
        .replace(/([?&])state=[^&]*/g, '$1state=[redacted]');
    dbg.push(`url=${safeUrl}`, `hasCode=${hasCode} hasError=${hasError}`);
    flushDbg();
    debug('OIDC callback handler started', {
        hasCode,
        hasError,
        url: safeUrl
    });

    if (hasError) {
        const params = new URLSearchParams(window.location.search);
        const errMsg =
            params.get('error_description') ||
            params.get('error') ||
            'Unknown authorization error';
        debugWarn('OIDC authorization error from IdP:', errMsg);
        error.value = `Authorization denied: ${errMsg}`;
        debugInfo.value = `error=${params.get('error')}\nerror_description=${params.get('error_description')}`;
        return;
    }

    if (!hasCode) {
        dbg.push('ERROR: no authorization code in URL');
        flushDbg();
        debugWarn('OIDC callback: no authorization code in URL');
        error.value =
            'No authorization code received. The identity provider may have rejected the request.';
        debugInfo.value = `URL path: ${window.location.pathname}\nQuery params: ${window.location.search || '(none)'}`;
        return;
    }

    const zitadelAuth = getZitadelAuth();
    if (zitadelAuth === undefined) {
        dbg.push('ERROR: zitadelAuth is undefined');
        flushDbg();
        debugWarn('Zitadel auth not configured');
        error.value = 'Authentication is not configured';
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
        return;
    }

    dbg.push('calling signinRedirectCallback...');
    flushDbg();
    status.value = 'Exchanging authorization code…';

    // Always process the redirect callback — startup() does NOT consume it
    // (it only handles popup/silent callbacks, not redirect).
    zitadelAuth.oidcAuth.mgr
        .signinRedirectCallback()
        .then(async (data) => {
            dbg.push(
                `signinRedirectCallback SUCCESS: hasToken=${!!data?.access_token} expired=${data?.expired} expiresAt=${data?.expires_at}`
            );
            flushDbg();
            // Clear re-auth retry counter on success.
            sessionStorage.removeItem('_oidc_reauth_retry');
            debug('OIDC signin callback success', {
                hasToken: !!data?.access_token,
                expiresAt: data?.expires_at,
                expired: data?.expired,
                profile: data?.profile?.preferred_username
            });

            // Tab-scoped access token for axios interceptor.
            if (data?.access_token) {
                sessionStorage.setItem('access_token', data.access_token);
            }

            status.value = 'Establishing session…';

            // Wait for Vue reactivity to propagate the userLoaded event
            // that vue-oidc-client fires synchronously inside signinRedirectCallback.
            // Retry with increasing delays — some browsers need more ticks for the
            // reactive isAuthenticated computed to update.
            const state = data.state as {to?: string} | undefined;
            const redirect = state?.to || '/dash/1';
            let authenticated = false;
            for (const delay of [0, 50, 150, 300]) {
                if (delay > 0) await new Promise((r) => setTimeout(r, delay));
                await nextTick();
                authenticated = zitadelAuth.oidcAuth.isAuthenticated;
                if (authenticated) break;
            }

            dbg.push(`isAuthenticated=${authenticated} redirect=${redirect}`);
            flushDbg();
            if (authenticated) {
                debug('OIDC: authenticated, navigating to', redirect);
            } else {
                debugWarn(
                    'OIDC: isAuthenticated still false after callback, navigating anyway',
                    {
                        expired: data?.expired,
                        expiresAt: data?.expires_at,
                        now: Math.floor(Date.now() / 1000)
                    }
                );
            }
            // Set the HttpOnly session cookie for plain navigations.
            if (data?.access_token) {
                try {
                    await fetch('/api/auth/session', {
                        method: 'POST',
                        headers: {Authorization: `Bearer ${data.access_token}`}
                    });
                } catch (err) {
                    debugWarn('session cookie exchange failed', err);
                }
            }

            // /api/* is server-served — real navigation, not Vue router.
            if (redirect.startsWith('/api/')) {
                window.location.replace(redirect);
            } else {
                router.replace(redirect);
            }
        })
        .catch((err) => {
            dbg.push(`signinRedirectCallback ERROR: ${err?.message || err}`);
            flushDbg();
            debugWarn(
                'OIDC signin callback error:',
                err?.message || err,
                err
            );
            const errorMessage = err?.message || 'unknown error';

            // Build diagnostic info for troubleshooting
            const rtCfg = window.__FM_RUNTIME_CONFIG__?.oidc;
            const diag = [
                `error: ${errorMessage}`,
                `authority: ${rtCfg?.authority || '(not set)'}`,
                `issuer: ${rtCfg?.metadata?.issuer || '(not set)'}`,
                `token_endpoint: ${rtCfg?.metadata?.token_endpoint || '(not set)'}`,
                `redirect_uri: ${rtCfg?.redirect_uri || '(not set)'}`,
                `client_id: ${rtCfg?.client_id ? `${rtCfg.client_id.substring(0, 8)}…` : '(not set)'}`,
                `url_origin: ${window.location.origin}`
            ].join('\n');
            debugInfo.value = diag;

            if (/No matching state found/i.test(errorMessage)) {
                // Silent re-auth: instead of showing an error, automatically
                // restart the sign-in flow (like Facebook/Google do).
                // Use a retry counter to prevent infinite redirect loops.
                const retryKey = '_oidc_reauth_retry';
                const retries = Number(sessionStorage.getItem(retryKey) || '0');
                if (retries < 1) {
                    sessionStorage.setItem(retryKey, String(retries + 1));
                    dbg.push('Auto re-auth: initiating fresh sign-in redirect');
                    flushDbg();
                    debug(
                        'OIDC: stale state detected, auto re-authenticating'
                    );
                    zitadelAuth.oidcAuth.signIn();
                    return;
                }
                // Already retried once — show the error to avoid infinite loop
                sessionStorage.removeItem(retryKey);
                error.value =
                    'Login session expired before completing. This can happen if you used the back button or the page took too long to load. Please try again.';
            } else if (
                /network|fetch|load failed|certificate|ssl|tls/i.test(
                    errorMessage
                )
            ) {
                error.value =
                    'Login failed during the token exchange request. If using a self-signed certificate, trust the Fleet Manager CA in your browser/OS and try again.';
            } else {
                error.value = `Login failed: ${errorMessage}`;
            }
        });
});
</script>

<route lang="json">
{ "meta": { "layout": "basic" } }
</route>
