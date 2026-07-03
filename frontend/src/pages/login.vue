<template>
    <div class="login-stage">
        <div class="login-stage__glow" aria-hidden="true" />

        <main class="login-main">
            <header class="login-hero">
                <img
                    src="https://control.shelly.cloud/images/shelly-logo.svg"
                    width="320"
                    height="120"
                    class="login-hero__mark"
                    alt="Shelly"
                />
                <h1 class="login-hero__title">Fleet Manager</h1>
                <p class="login-hero__line">Your fleet, in one place.</p>
            </header>

            <section class="login-card">
                <div
                    v-if="ssoLoading"
                    class="login-redirecting"
                    role="status"
                    aria-live="polite"
                >
                    <div class="login-redirecting__halo" aria-hidden="true">
                        <Spinner size="lg" />
                    </div>
                    <p class="login-redirecting__title">Redirecting to sign-in…</p>
                    <p class="login-redirecting__sub">
                        Hang tight, you'll be back here once you're signed in.
                    </p>
                </div>

                <template v-else>
                    <div v-if="authStore.devMode" class="login-badge">DEV MODE</div>

                    <template v-if="authStore.devMode">
                        <form class="login-form" @submit.prevent="devLogin">
                            <label class="login-field-wrap">
                                <span class="login-field-label">Username</span>
                                <input
                                    v-model="username"
                                    class="login-field"
                                    :class="{'login-field--err': !!usernameError}"
                                    placeholder="operator"
                                    autocomplete="username"
                                    @blur="validateUsername"
                                />
                            </label>
                            <label class="login-field-wrap">
                                <span class="login-field-label">Password</span>
                                <input
                                    v-model="password"
                                    type="password"
                                    class="login-field"
                                    :class="{'login-field--err': !!passwordError}"
                                    placeholder="••••••••"
                                    autocomplete="current-password"
                                    @blur="validatePassword"
                                />
                            </label>
                            <button
                                class="login-btn"
                                type="submit"
                                :disabled="!isFormValid || loading"
                            >
                                <span v-if="loading"><Spinner size="xs" /> Signing in…</span>
                                <span v-else>Sign in</span>
                            </button>
                        </form>

                        <template v-if="zitadelAuth">
                            <div class="login-or"><span>or</span></div>
                            <button class="login-btn login-btn--ghost" type="button" @click="signIn">
                                Sign in
                            </button>
                        </template>
                    </template>

                    <template v-else>
                        <button
                            class="login-btn"
                            type="button"
                            :disabled="!zitadelAuth"
                            @click="signIn"
                        >
                            Sign in
                        </button>
                    </template>

                    <p
                        class="login-err"
                        role="status"
                        aria-live="polite"
                        :data-shown="!!currentError"
                    >
                        {{ currentError }}
                    </p>
                </template>
            </section>
        </main>

        <footer class="login-foot">
            <span>© {{ year }} Shelly Group</span>
            <span class="login-foot__sep">·</span>
            <a href="https://shelly.com/privacy" target="_blank" rel="noopener">Privacy</a>
            <span class="login-foot__sep">·</span>
            <a href="https://shelly.com/terms" target="_blank" rel="noopener">Terms</a>
        </footer>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeMount, ref} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import Spinner from '@/components/core/Spinner.vue';
import {getZitadelAuth} from '@/helpers/zitadelAuth';
import {useAuthStore} from '@/stores/auth';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

// Pulled from the backend's auth-redirect query param. e.g. when the
// user hits /api/docs while signed out, backend bounces to
// /?returnTo=/api/docs; we forward that path through OIDC state so the
// callback resumes at /api/docs after sign-in.
function returnToTarget(): string | undefined {
    const raw = route.query.returnTo;
    const candidate = Array.isArray(raw) ? raw[0] : raw;
    if (typeof candidate !== 'string' || candidate.length === 0) return;
    // Block off-site redirects: only same-origin paths survive.
    if (!candidate.startsWith('/') || candidate.startsWith('//')) return;
    return candidate;
}
const year = new Date().getFullYear();

const zitadelAuth = computed(() => getZitadelAuth());

const username = ref('');
const password = ref('');
const usernameError = ref('');
const passwordError = ref('');
const loading = ref(false);
const ssoLoading = ref(false);
const ssoError = ref<string | null>(null);

const isFormValid = computed(
    () => username.value.trim().length > 0 && password.value.length > 0
);

const currentError = computed(() => {
    if (ssoError.value) return ssoError.value;
    if (authStore.loginError) return authStore.loginError;
    if (!authStore.devMode && !zitadelAuth.value) {
        return 'Authentication is not configured. Please contact your administrator.';
    }
    return '';
});

function validateUsername(): boolean {
    usernameError.value = username.value.trim() ? '' : 'Username is required';
    return !usernameError.value;
}

function validatePassword(): boolean {
    if (!password.value) passwordError.value = 'Password is required';
    else if (password.value.length < 3)
        passwordError.value = 'Password too short';
    else passwordError.value = '';
    return !passwordError.value;
}

// Safari with an untrusted self-signed certificate fails secure-context checks,
// which breaks WebCrypto and PKCE generation before redirect.
function requiresKeychainTrust(): boolean {
    return (
        window.location.protocol === 'https:' &&
        (!window.isSecureContext || !window.crypto?.subtle)
    );
}

function interpretOidcError(err: unknown): string {
    const message =
        err instanceof Error ? err.message : String(err ?? 'unknown error');
    if (/subtle|crypto|pkce|secure context/i.test(message)) {
        return 'SSO login failed before redirect. Safari may require the Fleet Manager CA to be trusted in Keychain before PKCE can start.';
    }
    return `SSO login failed: ${message}.`;
}

async function signIn() {
    ssoError.value = null;
    const authInstance = getZitadelAuth();
    if (!authInstance) {
        ssoError.value =
            'Authentication is not configured. Please contact your administrator.';
        return;
    }
    if (requiresKeychainTrust()) {
        ssoError.value =
            'This browser cannot start secure SSO on this certificate. If you are using Safari with a self-signed certificate, trust the Fleet Manager CA in Keychain and try again.';
        return;
    }

    ssoLoading.value = true;
    try {
        await authInstance.oidcAuth.signIn(returnToTarget());
    } catch (err: unknown) {
        console.error('OIDC sign-in start failed:', err);
        ssoError.value = interpretOidcError(err);
        ssoLoading.value = false;
    }
}

async function devLogin() {
    if (!validateUsername() || !validatePassword()) return;
    loading.value = true;
    try {
        const success = await authStore.devModeLogin(
            username.value,
            password.value
        );
        if (success) router.push('/');
    } finally {
        loading.value = false;
    }
}

onBeforeMount(() => {
    if (authStore.loggedIn) router.push('/');
});
</script>

<style scoped>
/* Editorial / aesthetic register — Apple-grade whitespace, Linear-grade
   typography refinement. The hero is the typography. No card chrome
   trying to be the focal point. */

.login-stage {
    position: relative;
    min-height: 100vh;
    display: grid;
    grid-template-rows: 1fr auto;
    place-items: center;
    background: var(--color-surface-bg);
    color: var(--color-text-primary);
    font-family: var(--font-sans);
    font-feature-settings: 'ss01', 'cv01';
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
    padding: var(--space-8) var(--space-6);
}
.login-stage__glow {
    position: absolute; inset: 0;
    pointer-events: none;
    background: radial-gradient(in oklch ellipse 90vmin 70vmin at 50% 30%,
        oklch(0.64 0.13 240 / 0.24) 0%,
        oklch(0.60 0.13 242 / 0.20) 10%,
        oklch(0.56 0.13 244 / 0.16) 20%,
        oklch(0.50 0.12 248 / 0.12) 30%,
        oklch(0.42 0.10 252 / 0.06) 40%,
        oklch(0.32 0.08 256 / 0.02) 55%,
        transparent 70%);
    filter: blur(1.2px);
}

.login-main {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 440px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-10);
}

/* ───── HERO — inverted pyramid: logo (largest) → title → tagline ───── */
.login-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
}
.login-hero__mark {
    height: 120px;
    width: auto;
    opacity: 0.95;
    margin-bottom: var(--space-4);
}
.login-hero__title {
    margin: 0;
    padding: var(--space-1) var(--space-0-5) var(--space-2);
    font-size: var(--type-display);
    font-weight: var(--font-semibold);
    letter-spacing: -0.03em;
    line-height: var(--leading-tight);
    text-align: center;
    color: var(--color-text-primary);
    /* OKLCH-smooth white-to-soft-white falloff for the heading. */
    background: linear-gradient(in oklch 180deg,
        oklch(1 0 0) 0%,
        oklch(0.96 0 0) 40%,
        oklch(0.88 0.005 240 / 0.85) 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}
.login-hero__line {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-normal);
    letter-spacing: -0.005em;
    line-height: var(--leading-normal);
    color: var(--color-text-tertiary);
    text-align: center;
}

/* ───── CARD (minimal, editorial) ───── */
.login-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.login-card::before {
    content: '';
    position: absolute;
    top: calc(-1 * var(--space-5)); left: 0; right: 0;
    height: var(--space-px);
    background: linear-gradient(90deg,
        transparent 0%,
        var(--state-hover-bg-strong) 20%,
        var(--state-hover-bg-strong) 80%,
        transparent 100%);
}

.login-badge {
    align-self: center;
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    letter-spacing: var(--tracking-caps);
    color: var(--color-status-warn);
    background: rgba(var(--color-warning-rgb), 0.10);
    border: 1px solid rgba(var(--color-warning-rgb), 0.30);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    margin-bottom: var(--space-2);
}

.login-form { display: flex; flex-direction: column; gap: var(--space-3); }

/* SSO redirect in-flight — replaces the form with a centered spinner +
   copy so the user has clear feedback that we're handing off to Zitadel.
   Min-height keeps the card from collapsing as the form vanishes. */
.login-redirecting {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    min-height: 156px;
    padding: var(--space-4) var(--space-2);
    text-align: center;
}
.login-redirecting__halo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: radial-gradient(circle,
        rgba(var(--color-primary-rgb), 0.20) 0%,
        rgba(var(--color-primary-rgb), 0.06) 60%,
        transparent 100%);
}
.login-redirecting__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    letter-spacing: -0.005em;
    color: var(--color-text-primary);
}
.login-redirecting__sub {
    margin: 0;
    max-width: 28ch;
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
    color: var(--color-text-tertiary);
}

.login-field-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.login-field-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text-secondary);
}
.login-field {
    height: var(--space-12);
    padding: 0 var(--space-5);
    background: var(--state-hover-bg);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--type-body);
    outline: none;
    transition: background-color var(--duration-normal) var(--ease-out),
        border-color var(--duration-normal) var(--ease-out),
        box-shadow var(--duration-normal) var(--ease-out);
}
.login-field::placeholder { color: var(--color-text-disabled); }
.login-field:hover { background: var(--state-hover-bg-strong); }
.login-field:focus {
    background: var(--state-hover-bg-strong);
    border-color: rgba(var(--brand-light-rgb), 0.45);
    box-shadow: 0 0 0 var(--focus-ring-width) rgba(var(--color-primary-rgb), 0.30);
}
.login-field--err { border-color: rgba(var(--color-danger-rgb), 0.55); }

/* "or" divider */
.login-or {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin: var(--space-1-5) 0;
    color: var(--color-text-quaternary);
    font-size: var(--type-caption);
    letter-spacing: var(--tracking-caps);
}
.login-or::before, .login-or::after {
    content: '';
    flex: 1; height: var(--space-px);
    background: var(--color-border-default);
}

/* Primary button — Shelly Blue with oklch-interpolated gradient. The
   glow is built from layered box-shadows, NOT a blurred pseudo-element.
   Box-shadow is computed analytically (no offscreen rasterization →
   no rectangle artifacts at any zoom or transition state). */
.login-btn {
    position: relative;
    width: 100%;
    height: var(--space-12);
    display: flex; align-items: center; justify-content: center; gap: var(--space-2);
    background: linear-gradient(in oklch 180deg,
        oklch(0.72 0.13 240) 0%,
        oklch(0.66 0.13 244) 100%);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    letter-spacing: -0.005em;
    border: 1px solid rgba(var(--brand-light-rgb), 0.22);
    border-radius: var(--radius-lg);
    cursor: pointer;
    /* Four-stop halo for strong, organic glow:
         - 18px tight inner (sharp edge light)
         - 40px mid (body of halo)
         - 80px wide (soft outer bloom)
         - 140px ambient atmosphere (just-perceptible deep bloom)
       Negative spread on wider layers pulls them inward at corners so
       the halo shape stays rounded-organic, never rectangular. */
    box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.22) inset,
        0 1px 0 rgba(255, 255, 255, 0.16) inset,
        0 0 18px -3px rgba(var(--color-primary-rgb), 0.55),
        0 0 40px -8px rgba(var(--color-primary-rgb), 0.38),
        0 0 80px -18px rgba(var(--color-primary-rgb), 0.28),
        0 0 140px -36px rgba(var(--color-primary-rgb), 0.20);
    transition:
        filter 180ms cubic-bezier(0.16, 1, 0.3, 1),
        transform 100ms cubic-bezier(0.16, 1, 0.3, 1),
        box-shadow 320ms cubic-bezier(0.16, 1, 0.3, 1);
}
.login-btn:hover:not(:disabled) {
    filter: brightness(1.08);
    box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.22) inset,
        0 1px 0 rgba(255, 255, 255, 0.18) inset,
        0 0 22px -3px rgba(var(--color-primary-rgb), 0.80),
        0 0 56px -8px rgba(var(--color-primary-rgb), 0.60),
        0 0 110px -18px rgba(var(--color-primary-rgb), 0.42),
        0 0 200px -40px rgba(var(--color-primary-rgb), 0.30);
}
.login-btn:active:not(:disabled) {
    transform: scale(0.98);
    filter: brightness(0.94);
    box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.22) inset,
        0 1px 0 rgba(255, 255, 255, 0.16) inset,
        0 0 14px -3px rgba(var(--color-primary-rgb), 0.45),
        0 0 32px -8px rgba(var(--color-primary-rgb), 0.28);
}
.login-btn:focus-visible {
    outline: none;
    box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.22) inset,
        0 1px 0 rgba(255, 255, 255, 0.16) inset,
        0 0 18px -3px rgba(var(--color-primary-rgb), 0.55),
        0 0 40px -8px rgba(var(--color-primary-rgb), 0.38),
        0 0 80px -18px rgba(var(--color-primary-rgb), 0.28),
        0 0 0 4px rgba(var(--color-primary-rgb), 0.40);
}
.login-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.login-btn--ghost {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-medium);
}
.login-btn--ghost:hover:not(:disabled) {
    background: var(--state-hover-bg-strong);
    border-color: var(--color-border-strong);
}

.login-err {
    min-height: 1.25rem;
    margin: var(--space-2) 0 0;
    color: rgb(var(--accent-smoke));
    font-size: var(--type-caption);
    text-align: center;
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-out);
}
.login-err[data-shown='true'] { opacity: 1; }

/* ───── PAGE FOOT ───── */
.login-foot {
    position: relative;
    z-index: 1;
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-4) 0;
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    letter-spacing: -0.005em;
}
.login-foot a { color: inherit; text-decoration: none; transition: color var(--duration-normal) var(--ease-out); }
.login-foot a:hover { color: var(--color-text-secondary); }
.login-foot__sep { opacity: 0.5; }

@media (max-width: 480px) {
    .login-hero__title { font-size: var(--type-heading); }
}
</style>

<route lang="json">
{ "meta": { "layout": "basic" } }
</route>
