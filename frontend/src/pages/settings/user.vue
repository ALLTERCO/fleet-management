<template>
    <div class="space-y-2">
        <h2 class="sr-only">User Profile</h2>
        <BasicBlock darker title="User Info">
            <div class="flex flex-row mt-2 gap-10 mt-5">
                <figure class="relative w-20 h-20 rounded-full overflow-hidden group cursor-pointer"
                    @click="triggerUpload">
                    <img :src="userImg" alt="User Image" class="w-full h-full object-cover" @error="imageLoadError" />
                    <div
                        class="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center text-white text-sm opacity-0 font-bold group-hover:opacity-100 transition-opacity duration-300">
                        Change
                    </div>
                    <input ref="fileInput" type="file" class="hidden" aria-label="Upload profile picture" @change="handleFileUpload" />
                </figure>
                <div v-if="USE_LOGIN_ZITADEL && zitadelUser" class="flex flex-col gap-1">
                    <p>
                        <span>{{ zitadelUser.name }}</span>
                        <span class="text-[var(--color-text-disabled)]"> ({{ zitadelUser.nickname }})</span>
                    </p>
                    <span class="text-[var(--color-text-disabled)] text-xs"> {{ zitadelUser.email }}</span>
                    <Button size="sm" type="blue" class="w-20" @click="logout">Sign out</Button>
                </div>
                <div v-else class="flex flex-col justify-around">
                    <span>{{ authStore.username }}</span> <br />
                    <Button size="sm" type="blue" class="w-20" @click="logout">Log out</Button>
                </div>
            </div>
        </BasicBlock>
        <BasicBlock darker title="Edit user info">
            <Collapse title="Change password">
                <Notification v-if="USE_LOGIN_ZITADEL" type="warning">
                    Your account is externally managed.
                </Notification>

                <div v-else class="flex flex-row gap-2 items-end">
                    <FormField label="New password" :error="passwordError">
                        <Input v-model="changePasswordData.newPassword" type="password" placeholder="New password"
                            @blur="validatePasswords" />
                    </FormField>
                    <FormField label="Confirm password" :error="confirmError">
                        <Input v-model="changePasswordData.confirmPassword" type="password" placeholder="Confirm password"
                            @blur="validatePasswords" />
                    </FormField>
                    <Button narrow size="sm" :disabled="disabledSaveButton" @click="changePassword"> Save </Button>
                </div>
            </Collapse>
        </BasicBlock>
    </div>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed, reactive, ref} from 'vue';
import {useRouter} from 'vue-router/auto';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Collapse from '@/components/core/Collapse.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import Notification from '@/components/core/Notification.vue';
import {FLEET_MANAGER_HTTP, USE_LOGIN_ZITADEL} from '@/constants';
import apiClient from '@/helpers/axios';
import zitadelAuth from '@/helpers/zitadelAuth';
import {useAuthStore} from '@/stores/auth';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

const authStore = useAuthStore();
const toastStore = useToastStore();
const router = useRouter();

const fileInput = ref<HTMLInputElement | null>(null);

const {zitadelUser} = storeToRefs(authStore);

const changePasswordData = reactive({
    newPassword: '',
    confirmPassword: ''
});

const userImg = ref<string>(
    `${FLEET_MANAGER_HTTP}/uploads/profilePics/${authStore.username}.png`
);

const fileProfile = ref<File | null>(null);

const passwordError = ref('');
const confirmError = ref('');

function validatePasswords() {
    passwordError.value = changePasswordData.newPassword.length === 0 ? 'Password is required' : '';
    if (changePasswordData.confirmPassword.length > 0 && changePasswordData.newPassword !== changePasswordData.confirmPassword) {
        confirmError.value = 'Passwords do not match';
    } else {
        confirmError.value = '';
    }
}

const disabledSaveButton = computed(() => {
    return (
        changePasswordData.newPassword.length === 0 ||
        changePasswordData.confirmPassword.length === 0 ||
        changePasswordData.newPassword !== changePasswordData.confirmPassword
    );
});

function imageLoadError() {
    userImg.value = FLEET_MANAGER_HTTP + '/uploads/profilePics/default.png';
}

async function logout() {
    if (USE_LOGIN_ZITADEL && zitadelAuth) {
        await zitadelAuth.oidcAuth.signOut({
            post_logout_redirect_uri: window.location.origin
        });
    }
    authStore.logout();
    router.push('/login');
}

async function changePassword() {
    try {
        let getId = await ws
            .sendRPC('FLEET_MANAGER', 'User.Find', {
                name: authStore.username
            })
            .then((res) => res.rows[0].id);
        await ws.sendRPC('FLEET_MANAGER', 'User.Update', {
            id: getId,
            password: changePasswordData.confirmPassword
        });
        toastStore.success('Password changed');
    } catch (error) {
        toastStore.error('Failed to change password');
    }
}

const triggerUpload = () => {
    if (fileInput.value) {
        fileInput.value.click();
    }
};

const handleFileUpload = async ($event: Event) => {
    const input = $event.target as HTMLInputElement;
    if (input && input.files) {
        const username = authStore.username;
        if (!username) {
            toastStore.error('Username not available');
            return;
        }
        fileProfile.value = input.files[0];
        const formData = new FormData();
        formData.append('image', fileProfile.value as File);
        formData.append('username', username);
        try {
            await apiClient.post('/media/uploadProfilePic', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            toastStore.info('Image uploading...');

            setTimeout(() => {
                userImg.value = `${FLEET_MANAGER_HTTP}/uploads/profilePics/${authStore.username}.png?${new Date().getTime()}`;
                toastStore.success('Image uploaded successfully');
            }, 3000);
        } catch (err) {
            console.error('Failed to upload image', err);
        }
    } else {
        toastStore.error('No file selected');
    }
};
</script>

<style scoped>
@reference "tailwindcss";
td,
th {
    @apply whitespace-nowrap px-4 py-2 font-medium text-[var(--color-text-primary)] text-center;
}

th {
    @apply font-semibold;
}
</style>
