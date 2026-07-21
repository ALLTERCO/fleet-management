<template>
    <MenuPopover align="right" class="page-top-menu">
        <template #trigger="{toggle}">
            <button
                type="button"
                class="ptm-avatar-btn"
                :title="displayName"
                :aria-label="displayName"
                @click="toggle"
            >
                <img
                    :src="userImg"
                    class="ptm-avatar"
                    alt="User avatar"
                    @error="imageLoadError"
                />
            </button>
        </template>

        <template #default="{close}">
            <div class="ptm-id">
                <img
                    :src="userImg"
                    class="ptm-id__avatar"
                    alt=""
                    @error="imageLoadError"
                />
                <div class="ptm-id__text">
                    <span class="ptm-id__name">{{ displayName }}</span>
                    <span
                        v-if="authStore.username"
                        class="ptm-id__sub"
                        :title="authStore.username"
                    >{{ authStore.username }}</span>
                </div>
            </div>
            <button
                type="button"
                class="ptm-item"
                @click="go(PROFILE_PATH, close)"
            >
                <i class="fas fa-user ptm-item__icon" />Profile
            </button>
            <button
                type="button"
                class="ptm-item"
                @click="go(SETTINGS_PATH, close)"
            >
                <i class="fas fa-gear ptm-item__icon" />Settings
            </button>
            <div class="ptm-sep" />
            <button
                type="button"
                class="ptm-item ptm-item--danger"
                @click="onSignOut(close)"
            >
                <i class="fas fa-arrow-right-from-bracket ptm-item__icon" />Sign out
            </button>
        </template>
    </MenuPopover>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import {useRouter} from 'vue-router';
import MenuPopover from '@/components/core/MenuPopover.vue';
import {PROFILE_PATH, SETTINGS_PATH} from '@/constants';
import {getProfilePictureUrl} from '@/helpers/profilePicture';
import {useAuthStore} from '@/stores/auth';

const authStore = useAuthStore();
const router = useRouter();

const displayName = computed(
    () => authStore.displayName ?? authStore.username ?? 'Account'
);
const userImg = ref<string>('');

async function refreshUserImg() {
    if (!authStore.username) return;
    userImg.value = await getProfilePictureUrl(authStore.username);
}
function imageLoadError() {
    void refreshUserImg();
}
watch(
    () => authStore.username,
    () => void refreshUserImg()
);
onMounted(() => void refreshUserImg());

function go(path: string, close: () => void) {
    close();
    if (router.currentRoute.value.path !== path) void router.push(path);
}
function onSignOut(close: () => void) {
    close();
    void authStore.logout();
}
</script>

<style scoped>
.page-top-menu {
    flex-shrink: 0;
}

/* Avatar trigger — profile picture with a ring that lights up on hover.
   flex, not inline-flex: an inline trigger adds line-box space under it,
   which pushes the avatar off-center next to the bell. */
.ptm-avatar-btn {
    display: flex;
    width: var(--space-10);
    height: var(--space-10);
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
}
.ptm-avatar {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    background: var(--color-surface-3);
    border: 2px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
    transition:
        border-color var(--motion-hover),
        transform var(--motion-hover);
}
.ptm-avatar-btn:hover .ptm-avatar {
    border-color: var(--color-primary);
    transform: translateY(var(--hover-lift));
}
.ptm-avatar-btn:focus-visible {
    outline: none;
}
.ptm-avatar-btn:focus-visible .ptm-avatar {
    border-color: var(--color-primary);
    outline: var(--focus-ring-width) solid var(--color-primary);
    outline-offset: var(--focus-ring-offset);
}

/* Identity header inside the menu. */
.ptm-id {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--space-3);
    border-bottom: 1px solid var(--divider-hairline);
}
.ptm-id__avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    background: var(--color-surface-3);
    flex-shrink: 0;
}
.ptm-id__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.ptm-id__name {
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ptm-id__sub {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* Menu items. */
.ptm-item {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    width: 100%;
    padding: var(--gap-sm) var(--space-3);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    text-align: left;
    cursor: pointer;
    transition:
        background var(--motion-hover),
        color var(--motion-hover);
}
.ptm-item:hover {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}
.ptm-item__icon {
    width: var(--icon-size-sm);
    text-align: center;
    color: var(--color-text-tertiary);
}
.ptm-item:hover .ptm-item__icon {
    color: inherit;
}
.ptm-item--danger {
    color: var(--color-danger);
}
.ptm-item--danger:hover {
    color: var(--color-danger);
}
.ptm-sep {
    height: 1px;
    background: var(--divider-hairline);
    margin: var(--space-1) 0;
}
</style>
