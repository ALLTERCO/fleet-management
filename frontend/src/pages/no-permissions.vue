<template>
    <div class="no-perms-page min-h-screen flex items-center justify-center">
        <div class="text-center max-w-md mx-auto p-8">
            <div class="mb-6">
                <i class="fas fa-lock text-6xl no-perms-icon"></i>
            </div>
            <h1 class="text-2xl font-bold no-perms-title mb-4">No Access</h1>
            <p class="no-perms-body mb-6">
                Your account does not have any permissions configured for this application.
            </p>
            <p class="no-perms-body mb-8">
                Please contact your administrator to request access.
            </p>
            <div class="flex flex-col gap-3">
                <Button type="blue" @click="refresh">
                    <i class="fas fa-refresh mr-2"></i>
                    Check Again
                </Button>
                <Button type="white" @click="logout">
                    <i class="fas fa-sign-out-alt mr-2"></i>
                    Sign Out
                </Button>
            </div>
            <p class="no-perms-meta text-sm mt-8">
                Logged in as: {{ authStore.username }}
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import {useAuthStore} from '@/stores/auth';

const authStore = useAuthStore();

async function refresh() {
    await authStore.fetchUserPermissions();
    // If user now has permissions, redirect to home
    if (!authStore.hasNoPermissions) {
        window.location.href = '/';
    }
}

function logout() {
    authStore.logout();
}
</script>

<style scoped>
.no-perms-page {
    background-color: var(--color-surface-1);
}

.no-perms-icon {
    color: var(--color-text-disabled);
}

.no-perms-title {
    color: var(--color-text-primary);
}

.no-perms-body {
    color: var(--color-text-tertiary);
}

.no-perms-meta {
    color: var(--color-text-disabled);
}
</style>
