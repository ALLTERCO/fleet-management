<template>
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xs">
        <div
            class="login-card shadow-md px-8 pt-6 pb-8 mb-4 flex flex-col gap-4"
        >
            <img src="https://control.shelly.cloud/images/shelly-logo.svg" width="112" height="28" class="m-auto" alt="Shelly logo" />
            <h2 class="text-2xl font-semibold text-center login-title">Fleet Manager</h2>
            <p class="text-center login-subtitle text-sm">Sign in to access your fleet management dashboard</p>

            <!-- Dev mode badge -->
            <div v-if="authStore.devMode" class="login-dev-badge rounded px-3 py-2 text-center">
                <span class="login-dev-badge-text text-xs font-medium">DEV MODE</span>
            </div>

            <!-- Loading state while checking dev mode -->
            <template v-if="!authStore.devModeChecked">
                <div class="flex flex-col gap-3">
                    <Skeleton variant="row" />
                    <Skeleton variant="row" />
                    <Skeleton variant="rect" height="2.5rem" />
                </div>
            </template>

            <template v-else>
                <!-- Dev mode: Show local login form -->
                <template v-if="authStore.devMode">
                    <div class="flex flex-col gap-3">
                        <input
                            v-model="username"
                            type="text"
                            placeholder="Username"
                            class="login-input w-full px-3 py-2 rounded focus:outline-none"
                            @keyup.enter="devLogin"
                        />
                        <input
                            v-model="password"
                            type="password"
                            placeholder="Password"
                            class="login-input w-full px-3 py-2 rounded focus:outline-none"
                            @keyup.enter="devLogin"
                        />
                        <p v-if="authStore.loginError" class="text-center login-error text-xs">
                            {{ authStore.loginError }}
                        </p>
                        <Button type="blue" @click="devLogin" :disabled="!username || !password || loading">
                            <span v-if="loading">Signing in...</span>
                            <span v-else>Sign In (Local)</span>
                        </Button>
                    </div>

                    <!-- Separator if Zitadel is also available -->
                    <template v-if="zitadelAuth">
                        <div class="flex items-center gap-2 login-divider-text text-sm">
                            <div class="flex-1 border-t login-divider-border"></div>
                            <span>or</span>
                            <div class="flex-1 border-t login-divider-border"></div>
                        </div>
                        <Button type="blue" @click="signIn">
                            Sign In with SSO
                        </Button>
                    </template>
                </template>

                <!-- Production: Only SSO login -->
                <template v-else>
                    <Button type="blue" @click="signIn" :disabled="!zitadelAuth">
                        Sign In with SSO
                    </Button>
                    <p v-if="!zitadelAuth" class="text-center login-error text-xs">
                        Authentication is not configured. Please contact your administrator.
                    </p>
                </template>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import {onBeforeMount, ref} from 'vue';
import {useRouter} from 'vue-router/auto';
import Button from '@/components/core/Button.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import zitadelAuth from '@/helpers/zitadelAuth';
import {useAuthStore} from '@/stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const username = ref('');
const password = ref('');
const loading = ref(false);

function signIn() {
    if (zitadelAuth) {
        zitadelAuth.oidcAuth.signIn({
            extraTokenParams: {
                'Access-Control-Allow-Credentials': true,
                'Access-Control-Allow-Methods': '*',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

async function devLogin() {
    if (!username.value || !password.value) return;

    loading.value = true;
    try {
        const success = await authStore.devModeLogin(
            username.value,
            password.value
        );
        if (success) {
            router.push('/');
        }
    } finally {
        loading.value = false;
    }
}

onBeforeMount(async () => {
    // Check dev mode first
    await authStore.checkDevMode();

    // If already logged in, redirect to home
    if (authStore.loggedIn) {
        router.push('/');
    }
});
</script>

<style scoped>
.login-card {
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-2xl);
}

.login-title {
    color: var(--color-text-primary);
}

.login-subtitle {
    color: var(--color-text-tertiary);
}

.login-dev-badge {
    background-color: var(--color-warning-subtle);
    border: 1px solid var(--color-warning);
}

.login-dev-badge-text {
    color: var(--color-warning-text);
}

.login-input {
    background-color: var(--color-surface-3);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
}

.login-input::placeholder {
    color: var(--color-text-disabled);
}

.login-input:focus {
    border-color: var(--color-border-focus);
}

.login-error {
    color: var(--color-danger-text);
}

.login-divider-text {
    color: var(--color-text-disabled);
}

.login-divider-border {
    border-color: var(--color-border-strong);
}
</style>
