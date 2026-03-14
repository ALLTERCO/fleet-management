<template>
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xs">
        <div
            class="bg-[var(--color-surface-2)] border border-[var(--color-border-strong)] shadow-md rounded px-8 pt-6 pb-8 mb-4 flex flex-col gap-4"
        >
            <p class="text-xl font-semibold pb-2 text-center text-[var(--color-text-secondary)]">Logging you in, please wait</p>
            <div class="w-full flex justify-around">
                <Spinner />
            </div>
            <p v-if="error" class="text-center text-[var(--color-danger-text)] text-sm">{{ error }}</p>
            <button
                v-if="error"
                class="mt-2 text-sm underline text-[var(--color-primary)]"
                type="button"
                @click="router.replace('/login')"
            >
                Return to login
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {onMounted, ref} from 'vue';
import {useRouter} from 'vue-router/auto';
import Spinner from '@/components/core/Spinner.vue';
import {getZitadelAuth} from '@/helpers/zitadelAuth';

const router = useRouter();
const error = ref<string | null>(null);

onMounted(() => {
    console.log('OIDC callback handler started');

    const zitadelAuth = getZitadelAuth();
    if (zitadelAuth == undefined) {
        console.error('Zitadel auth not configured');
        error.value = 'Authentication is not configured';
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
        return;
    }

    // Always process the redirect callback — startup() does NOT consume it
    // (it only handles popup/silent callbacks, not redirect).
    zitadelAuth.oidcAuth.mgr
        .signinRedirectCallback()
        .then((data) => {
            console.debug('OIDC signin callback success');
            // Store access token in localStorage for axios interceptor
            if (data?.access_token) {
                localStorage.setItem('access_token', data.access_token);
            }
            // Navigate to the original route or dashboard
            const redirect = data.state?.to || '/dash/1';
            if (router) {
                router.replace(redirect);
            } else {
                window.location.href = redirect;
            }
        })
        .catch((err) => {
            console.error('OIDC signin callback error:', err?.message || err, err);
            const errorMessage = err?.message || 'unknown error';
            if (/network|fetch|load failed|certificate|ssl|tls/i.test(errorMessage)) {
                error.value = 'Login failed during the secure callback request. If you are using Safari with a self-signed certificate, trust the Fleet Manager CA in Keychain and try again.';
            } else {
                error.value = `Login failed: ${errorMessage}. Please try again.`;
            }
        });
});
</script>
