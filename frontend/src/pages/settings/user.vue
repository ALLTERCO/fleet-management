<template>
    <PageTemplate title="User Settings" :tabs="tabs">
    <div class="user-settings">
        <h2 class="sr-only">User Settings</h2>
        <!-- Profile card -->
        <div class="us-panel">
            <div class="us-panel__head">
                <span class="us-panel__title">Profile</span>
            </div>
            <div class="us-panel__body">
                <div class="us-profile">
                    <figure
                        class="us-profile__avatar"
                        :class="{'us-profile__avatar--uploading': uploadingProfilePicture}"
                        @click="triggerUpload"
                    >
                        <img :src="userImg" alt="User" class="us-profile__img" @error="imageLoadError" />
                        <div class="us-profile__avatar-overlay">
                            <i
                                class="fas"
                                :class="uploadingProfilePicture ? 'fa-spinner fa-spin' : 'fa-camera'"
                            />
                        </div>
                        <input
                            ref="fileInput"
                            type="file"
                            class="hidden"
                            accept=".jpg,.jpeg,.png"
                            aria-label="Upload profile picture"
                            @change="handleFileUpload"
                        />
                    </figure>
                    <div class="us-profile__info">
                        <template v-if="!authStore.devMode && zitadelUser">
                            <span class="us-profile__name">{{ zitadelUser.name }}</span>
                            <span class="us-profile__username">{{ zitadelUser.nickname }}</span>
                            <span class="us-profile__email">{{ zitadelUser.email }}</span>
                        </template>
                        <template v-else>
                            <span class="us-profile__name">{{ authStore.username }}</span>
                        </template>
                        <div class="us-profile__actions">
                            <Button
                                size="sm"
                                type="blue-hollow"
                                :disabled="uploadingProfilePicture || removingProfilePicture"
                                @click="triggerUpload"
                            >
                                <i
                                    v-if="uploadingProfilePicture"
                                    class="fas fa-spinner fa-spin"
                                />
                                {{ uploadingProfilePicture ? 'Uploading' : 'Change photo' }}
                            </Button>
                            <Button
                                v-if="hasCustomProfilePicture"
                                size="sm"
                                type="red"
                                :disabled="uploadingProfilePicture || removingProfilePicture"
                                @click="removePhoto"
                            >
                                <i
                                    v-if="removingProfilePicture"
                                    class="fas fa-spinner fa-spin"
                                />
                                {{ removingProfilePicture ? 'Removing' : 'Remove' }}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- My active sessions — self-service revoke -->
        <div v-if="zitadelUserSub" class="us-panel">
            <div class="us-panel__head">
                <span class="us-panel__title">Active sessions</span>
            </div>
            <div class="us-panel__body">
                <UserSessionsPanel :user-id="zitadelUserSub" />
            </div>
        </div>

        <!-- Password change happens through the Zitadel self-service flow.
             FM no longer carries a local-user table to update. -->

        <!-- Sign out — destructive action belongs at the bottom of the page
             per common settings IA (GitHub, Linear, Google, Notion). -->
        <div class="us-panel us-panel--danger">
            <div class="us-panel__head">
                <span class="us-panel__title">Sign out</span>
            </div>
            <div class="us-panel__body us-signout-body">
                <p class="us-signout-text">
                    Ends this browser's session and returns you to the login
                    screen. Other active sessions on this account are
                    unaffected — manage them in <strong>Active sessions</strong>.
                </p>
                <Button size="sm" type="red" @click="logout">
                    Sign out
                </Button>
            </div>
        </div>
    </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {
    type ComputedRef,
    computed,
    inject,
    onMounted,
    onUnmounted,
    ref,
    watch
} from 'vue';
import {useRouter} from 'vue-router';
import Button from '@/components/core/Button.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import UserSessionsPanel from '@/components/panels/UserSessionsPanel.vue';
import {LOGIN_PATH} from '@/constants';
import apiClient from '@/helpers/axios';
import {getProfilePictureUrl} from '@/helpers/profilePicture';
import {
    profilePictureFormData,
    versionedProfilePictureUrl
} from '@/helpers/profilePictureUpload';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {getZitadelAuth} from '@/helpers/zitadelAuth';
import {useAuthStore} from '@/stores/auth';
import {useToastStore} from '@/stores/toast';
import {createUploadTicket} from '@/tools/uploadTickets';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

const authStore = useAuthStore();
const toastStore = useToastStore();
const router = useRouter();

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

const fileInput = ref<HTMLInputElement | null>(null);

const {zitadelUser} = storeToRefs(authStore);
const zitadelUserSub = computed(() => zitadelUser.value?.sub ?? null);

const userImg = ref<string>('');

const uploadingProfilePicture = ref(false);
const removingProfilePicture = ref(false);
const hasCustomProfilePicture = ref(false);
let localPreviewUrl: string | null = null;

async function refreshProfileImage() {
    if (!authStore.username) return;
    const url = await getProfilePictureUrl(authStore.username);
    userImg.value = versionedProfilePictureUrl(url, Date.now());
    hasCustomProfilePicture.value = !!url && !url.includes('default.png');
}

function imageLoadError() {
    void refreshProfileImage();
}

async function removePhoto() {
    if (removingProfilePicture.value || uploadingProfilePicture.value) return;
    const username = authStore.username;
    if (!username) {
        toastStore.error('Username not available');
        return;
    }
    if (!window.confirm('Remove your profile picture? This cannot be undone.'))
        return;
    removingProfilePicture.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'User.ProfilePicture.Remove', {
            username
        });
        await refreshProfileImage();
        toastStore.success('Profile picture removed');
    } catch (err) {
        toastStore.error(
            rpcErrorMessage(err, 'Failed to remove profile picture')
        );
    } finally {
        removingProfilePicture.value = false;
    }
}

async function logout() {
    const zitadelAuth = getZitadelAuth();
    if (!authStore.devMode && zitadelAuth) {
        await zitadelAuth.oidcAuth.mgr.signoutRedirect({
            post_logout_redirect_uri: `${window.location.origin}/`
        });
    }
    authStore.logout();
    router.push(LOGIN_PATH);
}

const triggerUpload = () => {
    if (uploadingProfilePicture.value) return;
    if (fileInput.value) {
        fileInput.value.click();
    }
};

const handleFileUpload = async ($event: Event) => {
    const input = $event.target as HTMLInputElement;
    if (input?.files?.[0]) {
        const username = authStore.username;
        if (!username) {
            toastStore.error('Username not available');
            return;
        }
        const file = input.files[0];
        showLocalPreview(file);
        uploadingProfilePicture.value = true;
        try {
            const ticket = await createUploadTicket(
                'User.ProfilePicture.CreateUploadTicket',
                {username}
            );
            const formData = profilePictureFormData({file, username, ticket});
            const {data} = await apiClient.post<{url: string}>(
                '/media/uploadProfilePic',
                formData,
                {headers: {'Content-Type': 'multipart/form-data'}}
            );
            userImg.value = versionedProfilePictureUrl(data.url, Date.now());
            toastStore.success('Image uploaded');
        } catch {
            await refreshProfileImage();
            toastStore.error('Failed to upload image');
        } finally {
            revokeLocalPreview();
            uploadingProfilePicture.value = false;
            input.value = '';
        }
    } else {
        toastStore.error('No file selected');
    }
};

function showLocalPreview(file: File) {
    revokeLocalPreview();
    localPreviewUrl = URL.createObjectURL(file);
    userImg.value = localPreviewUrl;
}

function revokeLocalPreview() {
    if (!localPreviewUrl) return;
    URL.revokeObjectURL(localPreviewUrl);
    localPreviewUrl = null;
}

onMounted(refreshProfileImage);
onUnmounted(revokeLocalPreview);
watch(() => authStore.username, refreshProfileImage);
</script>

<style scoped>
.user-settings {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding-top: var(--gap-sm);
    max-width: 72rem;
}

.us-panel {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    overflow: hidden;
}
.us-panel__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gap-xs) var(--gap-sm);
    min-height: var(--touch-target-min);
    border-bottom: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.us-panel__title {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.us-panel__body {
    padding: var(--gap-sm);
}

.us-profile {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
}
.us-profile__avatar {
    position: relative;
    width: 5.5rem;
    height: 5.5rem;
    border-radius: var(--radius-full);
    overflow: hidden;
    cursor: pointer;
    flex-shrink: 0;
    border: 1px solid var(--color-border-default);
}
.us-profile__avatar--uploading { cursor: wait; }
.us-profile__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.us-profile__avatar-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-overlay-light);
    color: var(--primitive-neutral-50);
    font-size: var(--type-body);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-default);
}
.us-profile__avatar:hover .us-profile__avatar-overlay {
    opacity: 1;
}
.us-profile__info {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    min-width: 0;
}
.us-profile__name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.us-profile__username {
    font-size: var(--type-body);
    font-family: var(--font-mono);
    color: var(--color-text-tertiary);
}
.us-profile__email {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.us-profile__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-xs);
    margin-top: var(--gap-xs);
}

.us-panel--danger {
    border-color: color-mix(in srgb, var(--color-status-red) 30%, var(--color-border-default));
}
.us-panel--danger .us-panel__title {
    color: var(--color-status-red);
}
.us-signout-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    flex-wrap: wrap;
}
.us-signout-text {
    margin: 0;
    max-width: 48rem;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    line-height: 1.5;
}
.us-signout-text strong {
    color: var(--color-text-secondary);
    font-weight: var(--font-semibold);
}

</style>
