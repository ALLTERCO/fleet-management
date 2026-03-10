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
        </div>
    </div>
</template>

<script setup lang="ts">
import {onMounted, ref} from 'vue';
import {useRouter} from 'vue-router/auto';
import Spinner from '@/components/core/Spinner.vue';
import zitadelAuth from '@/helpers/zitadelAuth';

const router = useRouter();
const error = ref<string | null>(null);

onMounted(async () => {
    console.log('OIDC callback handler started');

    if (zitadelAuth == undefined) {
        console.error('Zitadel auth not configured');
        error.value = 'Authentication is not configured';
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
        return;
    }

    // Check if the user was already loaded by zitadelAuth.oidcAuth.startup()
    // in main.ts. If so, the OIDC state has already been consumed and calling
    // signinRedirectCallback() again would fail with "No matching state found
    // in storage". Just redirect to the target route.
    try {
        const existingUser = await zitadelAuth.oidcAuth.mgr.getUser();
        if (existingUser && !existingUser.expired) {
            console.log(
                'OIDC callback: user already loaded by startup(), redirecting'
            );
            if (existingUser.access_token) {
                localStorage.setItem('access_token', existingUser.access_token);
            }
            const redirect = existingUser.state?.to || '/dash/1';
            if (router) {
                router.replace(redirect);
            } else {
                window.location.href = redirect;
            }
            return;
        }
    } catch {
        // No existing user, proceed with callback
    }

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
            console.error('OIDC signin callback error', err);
            error.value = 'Login failed. Please try again.';
            setTimeout(() => {
                if (router) {
                    router.replace('/login');
                } else {
                    window.location.href = '/login';
                }
            }, 2000);
        });
});
</script>
