<template>
    <div class="esf">
        <EmailSmtp_Basics
            v-if="tab === 'basics'"
            v-model="config"
            :descriptor="descriptor"
        />
        <EmailSmtp_Recipients
            v-else-if="tab === 'recipients'"
            v-model="config"
        />
        <EmailSmtp_Auth
            v-else-if="tab === 'auth'"
            v-model="config"
            :channel="channel ?? null"
            :oauth-status="oauthStatus"
            :oauth-error="oauthError"
            @run-consent="runOAuthConsent"
        />
        <EmailSmtp_Delivery
            v-else-if="tab === 'delivery'"
            v-model="config"
            :descriptor="descriptor"
            :channel="channel ?? null"
        />
        <EmailSmtp_Test
            v-else-if="tab === 'test'"
            :channel-id="channel?.id ?? null"
            :testing="testing"
            :result="testResult"
            @run-test="runTest"
        />
    </div>
</template>

<script setup lang="ts">
import type {
    Channel,
    ChannelTestResult,
    ChannelProviderDescriptor
} from '@api/channel';
import {onBeforeUnmount, ref, watch} from 'vue';
import EmailSmtp_Auth from '@/components/core/EmailSmtp_Auth.vue';
import EmailSmtp_Basics from '@/components/core/EmailSmtp_Basics.vue';
import EmailSmtp_Delivery from '@/components/core/EmailSmtp_Delivery.vue';
import EmailSmtp_Recipients from '@/components/core/EmailSmtp_Recipients.vue';
import EmailSmtp_Test from '@/components/core/EmailSmtp_Test.vue';
import {useChannelsStore} from '@/stores/channels';
import {useNotificationsStore} from '@/stores/notifications';

export type EmailSmtpTab =
    | 'basics'
    | 'recipients'
    | 'auth'
    | 'delivery'
    | 'test';

type AuthType = 'oauth2_google' | 'oauth2_microsoft';
type OAuthStatus = 'idle' | 'connecting' | 'success' | 'failed';

// Tab router for the SMTP form. Each tab is a leaf component with a single
// responsibility; this file owns the cross-tab concerns (OAuth consent popup,
// test-channel network call) so the modal doesn't need to know about SMTP
// internals.
const config = defineModel<Record<string, unknown>>({required: true});

const props = defineProps<{
    descriptor: ChannelProviderDescriptor;
    channel?: Channel | null;
    tab: EmailSmtpTab;
}>();

const channelsStore = useChannelsStore();
const notificationsStore = useNotificationsStore();

// ── OAuth consent ──────────────────────────────────────────────────────
const oauthStatus = ref<OAuthStatus>('idle');
const oauthError = ref<string | null>(null);
let oauthPopup: Window | null = null;
let oauthMessageHandler: ((ev: MessageEvent) => void) | null = null;

function authString(key: string): string {
    const auth = config.value.auth;
    if (!auth || typeof auth !== 'object') return '';
    const v = (auth as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : '';
}

function currentAuthType(): AuthType | 'password' {
    const auth = config.value.auth;
    if (!auth || typeof auth !== 'object') return 'password';
    const t = (auth as Record<string, unknown>).type;
    return t === 'oauth2_google' || t === 'oauth2_microsoft'
        ? t
        : 'password';
}

async function runOAuthConsent() {
    const id = props.channel?.id;
    const authType = currentAuthType();
    if (!id || authType === 'password') return;

    oauthStatus.value = 'connecting';
    oauthError.value = null;

    const result = await notificationsStore.oauthStart({
        channelId: id,
        provider: authType,
        ...(authType === 'oauth2_microsoft' && authString('tenant')
            ? {tenant: authString('tenant')}
            : {})
    });

    if (!result) {
        oauthStatus.value = 'failed';
        oauthError.value = 'Failed to start consent flow.';
        return;
    }

    const w = 520;
    const h = 680;
    const left = Math.max(0, Math.round((window.screen.width - w) / 2));
    const top = Math.max(0, Math.round((window.screen.height - h) / 2));
    oauthPopup = window.open(
        result.authUrl,
        'fm-oauth-email',
        `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no`
    );
    if (!oauthPopup) {
        oauthStatus.value = 'failed';
        oauthError.value = 'Popup blocked — allow popups for this site.';
        return;
    }

    teardownOAuthListener();
    oauthMessageHandler = (ev) => {
        // Reject cross-origin messages so a lured admin can't be tricked
        // into a forged consent success/failure from another tab.
        if (ev.origin !== window.location.origin) return;
        const d = ev.data;
        if (!d || typeof d !== 'object' || d.type !== 'fleet-oauth-email')
            return;
        teardownOAuthListener();
        try {
            oauthPopup?.close();
        } catch {
            /* popup may have closed itself already */
        }
        oauthPopup = null;
        if (d.status === 'ok') {
            oauthStatus.value = 'success';
            void channelsStore.fetchChannel(id);
        } else {
            oauthStatus.value = 'failed';
            oauthError.value = String(d.detail ?? 'Consent failed.');
        }
    };
    window.addEventListener('message', oauthMessageHandler);
}

function teardownOAuthListener() {
    if (oauthMessageHandler) {
        window.removeEventListener('message', oauthMessageHandler);
        oauthMessageHandler = null;
    }
}

onBeforeUnmount(() => {
    teardownOAuthListener();
    try {
        oauthPopup?.close();
    } catch {
        /* ignore */
    }
});

// Reset OAuth state when the channel identity changes (new/different channel).
watch(
    () => props.channel?.id,
    () => {
        oauthStatus.value = 'idle';
        oauthError.value = null;
    }
);

// ── Test channel ──────────────────────────────────────────────────────
const testing = ref(false);
const testResult = ref<ChannelTestResult | null>(null);

async function runTest(liveSend: boolean) {
    const id = props.channel?.id;
    if (!id) return;
    testing.value = true;
    try {
        const res = await channelsStore.testChannel(id, !liveSend);
        if (res) testResult.value = res;
    } finally {
        testing.value = false;
    }
}
</script>

<style scoped>
.esf {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}
</style>
