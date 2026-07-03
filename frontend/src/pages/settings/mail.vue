<template>
    <PageTemplate
        title="Mail"
        :stats="headerStats"
        :loading="store.channelsLoading"
        bare
    >
        <div class="mail-layout">
            <form
                v-if="canWrite"
                class="mail-panel mail-form"
                @submit.prevent="saveChannel"
            >
                <header class="mail-panel__header">
                    <div>
                        <h2>{{ editingChannelId ? 'Edit email channel' : 'Create email channel' }}</h2>
                        <p>Routes use these channels for alerts and notifications.</p>
                    </div>
                    <Button
                        v-if="editingChannelId"
                        type="blue-hollow"
                        size="sm"
                        @click="clearForm"
                    >
                        Cancel
                    </Button>
                </header>

                <div class="mail-form__grid">
                    <Input
                        v-model.trim="channelName"
                        label="Channel name"
                        placeholder="Operations email"
                    />
                    <Input
                        v-model.trim="emailConfig.from"
                        label="From"
                        type="email"
                        placeholder="fleet@example.com"
                    />
                    <Input
                        v-model.trim="emailConfig.toAddresses"
                        label="Recipients"
                        placeholder="ops@example.com, support@example.com"
                    />
                    <label class="mail-select">
                        <span>SMTP source</span>
                        <select v-model="emailConfig.mode">
                            <option value="use_system_smtp">System SMTP</option>
                            <option value="custom_smtp">Custom SMTP</option>
                        </select>
                    </label>
                    <Input
                        v-if="emailConfig.mode === 'custom_smtp'"
                        v-model.trim="emailConfig.host"
                        label="SMTP host"
                        placeholder="smtp.example.com"
                    />
                    <Input
                        v-if="emailConfig.mode === 'custom_smtp'"
                        v-model.number="emailConfig.port"
                        label="SMTP port"
                        type="number"
                        placeholder="587"
                    />
                    <Input
                        v-if="emailConfig.mode === 'custom_smtp'"
                        v-model.trim="emailConfig.authUser"
                        label="Username"
                        placeholder="smtp-user"
                    />
                    <Input
                        v-if="emailConfig.mode === 'custom_smtp'"
                        v-model="emailConfig.authPass"
                        label="Password"
                        type="password"
                        placeholder="••••••••"
                    />
                    <label
                        v-if="emailConfig.mode === 'custom_smtp'"
                        class="mail-check"
                    >
                        <input v-model="emailConfig.secure" type="checkbox" />
                        <span>Use TLS from connection start</span>
                    </label>
                </div>

                <Button
                    type="green"
                    :loading="saving"
                    :disabled="!canSave"
                    submit
                >
                    Save channel
                </Button>
            </form>

            <section class="mail-panel">
                <header class="mail-panel__header">
                    <div>
                        <h2>Email channels</h2>
                        <p>Backend notification channels are the source of truth.</p>
                    </div>
                    <Button type="blue-hollow" size="sm" @click="refreshChannels">
                        Refresh
                    </Button>
                </header>

                <div v-if="emailChannels.length > 0" class="mail-list">
                    <article
                        v-for="channel in emailChannels"
                        :key="channel.id"
                        class="mail-card"
                    >
                        <header>
                            <h3>{{ channel.name }}</h3>
                            <Pill
                                :variant="channel.health.disableReason ? 'danger' : 'success'"
                                size="xs"
                            >
                                {{ channel.health.disableReason ? 'disabled' : (channel.lastTestStatus ?? 'untested') }}
                            </Pill>
                        </header>
                        <dl>
                            <dt>From</dt>
                            <dd>{{ channelFrom(channel) }}</dd>
                            <dt>Recipients</dt>
                            <dd>{{ channelRecipients(channel) }}</dd>
                            <dt>Last delivery</dt>
                            <dd>{{ channel.lastDeliveryStatus ?? 'none' }}</dd>
                            <template v-if="channel.health.lastFailureAt">
                                <dt>Last failure</dt>
                                <dd>{{ channel.health.lastFailureAt }}</dd>
                            </template>
                        </dl>
                        <div v-if="canWrite" class="mail-card__actions">
                            <Button
                                type="blue-hollow"
                                size="sm"
                                :loading="testingChannelId === channel.id"
                                @click="testChannel(channel.id)"
                            >
                                Test
                            </Button>
                            <Button type="blue-hollow" size="sm" @click="editChannel(channel)">
                                Edit
                            </Button>
                            <Button type="red" size="sm" @click="deleteChannel(channel.id)">
                                Delete
                            </Button>
                        </div>
                    </article>
                </div>
                <div v-else class="mail-empty">
                    <h3>No email channels</h3>
                    <p>Create one channel, then attach it to notification routing.</p>
                </div>
            </section>
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import type {Channel} from '@api/channel';
import {computed, onMounted, reactive, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import Pill from '@/components/core/Pill.vue';
import {usePermissions} from '@/composables/usePermissions';
import {
    buildEmailChannelConfig,
    createEmailChannelConfigForm,
    fillEmailChannelConfigForm,
    resetEmailChannelConfigForm
} from '@/helpers/notificationEmailConfig';
import {useNotificationsStore} from '@/stores/notifications';
import {useToastStore} from '@/stores/toast';
import type {StatItem} from '@/types/page-template';

const store = useNotificationsStore();
const toast = useToastStore();
const {canWrite} = usePermissions();

const channelName = ref('');
const editingChannelId = ref<number | null>(null);
const saving = ref(false);
const testingChannelId = ref<number | null>(null);
const emailConfig = reactive(createEmailChannelConfigForm());

const emailChannels = computed(() =>
    Object.values(store.channels)
        .filter((channel) => channel.provider === 'email_smtp')
        .sort((a, b) => a.name.localeCompare(b.name))
);

const headerStats = computed<StatItem[]>(() => [
    {value: emailChannels.value.length, label: 'email channels', status: 'on'}
]);

const canSave = computed(
    () =>
        canWrite.value &&
        channelName.value.trim().length > 0 &&
        emailConfig.toAddresses.trim().length > 0 &&
        (emailConfig.mode === 'use_system_smtp' ||
            emailConfig.from.trim().length > 0)
);

onMounted(() => {
    void refreshChannels();
});

async function refreshChannels(): Promise<void> {
    await store.fetchChannels('email_smtp');
}

async function saveChannel(): Promise<void> {
    if (!canSave.value) {
        toast.error('Fill the required email channel fields');
        return;
    }
    saving.value = true;
    try {
        const saved = await store.saveChannel({
            channelId: editingChannelId.value ?? undefined,
            name: channelName.value.trim(),
            type: 'email_smtp',
            config: buildEmailChannelConfig(emailConfig)
        });
        if (!saved) return;
        clearForm();
        toast.success('Email channel saved');
    } finally {
        saving.value = false;
    }
}

function editChannel(channel: Channel): void {
    editingChannelId.value = channel.id;
    channelName.value = channel.name;
    resetEmailChannelConfigForm(emailConfig);
    fillEmailChannelConfigForm(emailConfig, channel.config);
}

async function deleteChannel(channelId: number): Promise<void> {
    const deleted = await store.deleteChannel(channelId);
    if (!deleted) return;
    if (editingChannelId.value === channelId) clearForm();
    toast.success('Email channel deleted');
}

async function testChannel(channelId: number): Promise<void> {
    testingChannelId.value = channelId;
    try {
        const result = await store.testChannel(channelId);
        if (!result) return;
        if (result.state === 'success') toast.success('Email channel tested');
        else toast.error(result.errorMessage ?? 'Email channel test failed');
    } finally {
        testingChannelId.value = null;
    }
}

function clearForm(): void {
    editingChannelId.value = null;
    channelName.value = '';
    resetEmailChannelConfigForm(emailConfig);
}

function channelFrom(channel: Channel): string {
    if (channel.config.mode === 'use_system_smtp') return 'System SMTP';
    return typeof channel.config.from === 'string' ? channel.config.from : '-';
}

function channelRecipients(channel: Channel): string {
    const recipients = channel.config.toAddresses;
    if (!Array.isArray(recipients)) return '-';
    return recipients.filter((item) => typeof item === 'string').join(', ');
}
</script>

<style scoped>
.mail-layout {
    display: grid;
    grid-template-columns: minmax(20rem, 0.9fr) minmax(24rem, 1.1fr);
    gap: var(--gap-md);
    align-items: start;
}

.mail-panel {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    padding: var(--gap-md);
}

.mail-panel__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap-sm);
    margin-bottom: var(--gap-md);
}

.mail-panel__header h2,
.mail-card h3,
.mail-empty h3 {
    margin: 0;
    font-size: var(--type-title);
    font-weight: var(--font-semibold);
}

.mail-panel__header p,
.mail-empty p {
    margin: var(--gap-2xs) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.mail-form {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}

.mail-form__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-sm);
}

.mail-form__grid > :nth-child(3),
.mail-form__grid > :nth-child(4) {
    grid-column: 1 / -1;
}

.mail-check {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    min-height: var(--touch-target-min);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.mail-select {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.mail-select select {
    min-height: var(--touch-target-min);
    border: 1px solid var(--color-border-default);
    border-radius: var(--input-radius);
    background: var(--color-surface-2);
    padding: var(--gap-xs);
}

.mail-list {
    display: grid;
    gap: var(--gap-sm);
}

.mail-card {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: var(--gap-sm);
}

.mail-card header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
}

.mail-card dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--gap-2xs) var(--gap-sm);
    margin: var(--gap-sm) 0 0;
}

.mail-card dt {
    color: var(--color-text-tertiary);
}

.mail-card dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
}

.mail-card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-xs);
    margin-top: var(--gap-sm);
}

.mail-empty {
    border: 1px dashed var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: var(--gap-md);
}

@media (max-width: 900px) {
    .mail-layout,
    .mail-form__grid {
        grid-template-columns: 1fr;
    }

    .mail-form__grid > :nth-child(3),
    .mail-form__grid > :nth-child(4) {
        grid-column: auto;
    }
}
</style>
