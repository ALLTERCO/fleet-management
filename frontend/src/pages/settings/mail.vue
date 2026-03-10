<template>
    <div v-if="!config" class="space-y-3 p-4">
        <Skeleton variant="row" />
        <Skeleton variant="row" />
        <Skeleton variant="rect" height="4rem" />
    </div>
    <div v-else-if="config">
        <EmptyBlock v-if="!config.enable">
            <div class="space-y-2">
                <p class="text-xl font-semibold pb-2">Mail is disabled</p>
                <p class="text-sm pb-2">Enable mail to start sending mails.</p>
                <Button type="blue" @click="enableMail">Enable mail</Button>
            </div>
        </EmptyBlock>
        <BasicBlock v-else darker>
            <div class="space-y-2 relative">
                <div>
                    <div><h2 class="heading-section">Mail Configuration</h2></div>
                    <div v-if="status" class="mt-2">
                        <span>Mail status: </span>
                        <span v-if="mailVerified" class="text-[var(--color-success-text)]">Working</span>
                        <span v-else class="text-[var(--color-danger-text)]">Not Working</span>
                        <br />
                        <span v-if="status.verifyTs > 0">
                            Last checked on
                            {{ new Date(status.verifyTs).toLocaleString() }}
                        </span>
                        <br />
                        <Notification v-if="status.verifyError" type="error" class="my-1">
                            <span class="text-lg font-semibold">Configuration failed. Error message:</span>
                            <pre class="text-left text-sm">{{ status.verifyError }}</pre>
                        </Notification>
                        <div class="absolute top-2 right-2">
                            <Button :loading="statusLoading" @click="refreshStatus">Check</Button>
                        </div>
                    </div>
                </div>
                <Collapse title="Configure">
                    <form class="max-w-sm space-y-3" @submit.prevent="saveConfig">
                        <Input v-model="config.transport.host" label="SMTP Host" placeholder="SMTP Host" />
                        <Input
                            v-model="config.transport.port"
                            label="SMTP Port"
                            type="number"
                            placeholder="SMTP port"
                        />
                        <Input v-model="config.transport.auth.user" label="User" placeholder="user" />
                        <Input
                            v-model="config.transport.auth.pass"
                            label="Password"
                            type="password"
                            placeholder="*****"
                        />
                        <Button type="blue" :loading="configLoading" @click="saveConfig"> Apply </Button>
                    </form>
                </Collapse>
                <Collapse title="Test Mail">
                    <Notification> This will use your saved configuration to send a test email. </Notification>
                    <Input v-model="testMail" label="Email address" />
                    <Button class="mt-2" :loading="sendMailLoading" @click="sendTestMail">Send</Button>
                </Collapse>
            </div>
        </BasicBlock>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Collapse from '@/components/core/Collapse.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Input from '@/components/core/Input.vue';
import Notification from '@/components/core/Notification.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import {getTestEmail} from '@/helpers/texts';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

const config = ref<{
    enable: boolean;
    transport: {
        host: string;
        port: number;
        auth: {
            user: string;
            pass: string;
        };
    };
}>();
const configLoading = ref(false);

const status = ref();
const statusLoading = ref(false);

const testMail = ref('');
const sendMailLoading = ref(false);

const mailVerified = computed(() => {
    return typeof status.value?.verify === 'boolean' && status.value?.verify;
});

const toast = useToastStore();

async function enableMail() {
    try {
        await ws.sendRPC('FLEET_MANAGER', 'Mail.SetConfig', {
            config: {
                enable: true
            }
        });
        await refreshConfig();
        toast.success('Enabled mail');
    } catch (error) {
        toast.error('Failed to enable mail. ' + String(error));
        console.error(error);
    }
}

async function sendTestMail() {
    sendMailLoading.value = true;
    try {
        const user = config.value?.transport.auth.user;
        if (!user) {
            toast.error('Not configgured');
            return;
        }
        const info = await ws.sendRPC(
            'FLEET_MANAGER',
            'Mail.Send',
            getTestEmail(user, testMail.value)
        );
        toast.success(`Test mail send with id '${info.messageId}'`);
        testMail.value = '';
    } catch (error) {
        toast.error('Failed to send mail. ' + String(error));
        console.error(error);
    } finally {
        sendMailLoading.value = false;
    }
}

async function refreshConfig() {
    configLoading.value = true;
    try {
        config.value = await ws.sendRPC('FLEET_MANAGER', 'Mail.GetConfig');
        if (config.value && !config.value.transport) {
            config.value.transport = {
                host: '',
                port: 587,
                auth: {
                    user: '',
                    pass: ''
                }
            };
        }
    } catch (error) {
        toast.error('Failed to update config');
    } finally {
        configLoading.value = false;
    }

    await refreshStatus();
}

async function refreshStatus() {
    statusLoading.value = true;
    try {
        status.value = await ws.sendRPC('FLEET_MANAGER', 'Mail.GetStatus');
    } catch (error) {
        toast.error('Failed to update status');
    } finally {
        statusLoading.value = false;
    }
}

async function saveConfig() {
    configLoading.value = true;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'Mail.SetConfig', {
            config: {
                transport: config.value?.transport
            }
        });
        setTimeout(async () => {
            await refreshConfig();
            toast.success('Config updated');
        }, 1000);
    } catch (error) {
        toast.error('Failed to update config');
    } finally {
        configLoading.value = false;
    }
}

onMounted(async () => {
    await refreshConfig();
});
</script>
