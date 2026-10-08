<template>
    <PageTemplate title="Connect your AI" :tabs="tabs">
        <div class="cai-layout">
            <h2 class="sr-only">Connect your AI</h2>

            <p v-if="signInLevels.length" class="cai-lead">
                Let an AI assistant read and run this Fleet Manager for you. It
                connects over MCP (Model Context Protocol). You sign it in with
                your browser, or give it a key. It works as you or as the user
                the key belongs to, so it can never do more than that user.
            </p>
            <p v-else class="cai-lead">
                Let an AI assistant read and run this Fleet Manager for you. It
                connects over MCP (Model Context Protocol) with a key. It works
                as the user the key belongs to, so it can never do more than
                that user.
            </p>

            <SectionCard
                title="Your MCP address"
                hint="Every AI client below needs this address."
            >
                <div class="cai-url">
                    <code class="cai-url__value" data-testid="mcp-url">{{
                        mcpUrl
                    }}</code>
                    <CopyButton
                        :text="mcpUrl"
                        label="Copy"
                        title="Copy MCP address"
                    />
                </div>
            </SectionCard>

            <SectionCard
                title="Sign in with your browser"
                hint="Your AI client opens the Fleet sign-in page, and you log in as yourself."
            >
                <template v-if="signInLevels.length">
                    <ul
                        class="cai-ids"
                        aria-label="Client ids"
                        data-testid="oauth-clients"
                    >
                        <li
                            v-for="level in signInLevels"
                            :key="level.key"
                            class="cai-url"
                            :data-testid="`oauth-client-${level.key}`"
                        >
                            <span class="cai-ids__level">{{ level.name }}</span>
                            <code class="cai-url__value">{{ level.clientId }}</code>
                            <CopyButton
                                :text="level.clientId"
                                label="Copy"
                                :title="`Copy ${level.name} client id`"
                            />
                        </li>
                    </ul>
                    <p class="cai-text">
                        A client id is a public name tag, not a password. Paste
                        the one for the level you want into your AI client once.
                        Then you log in with your browser. The AI works as you,
                        with your role.
                    </p>
                    <p class="cai-text" data-testid="oauth-full-note">
                        Full access needs a key. Browser sign-in gives Read or
                        Write only.
                    </p>
                </template>
                <p v-else class="cai-text" data-testid="oauth-off">
                    Browser sign-in is not set up on this instance. Use a key
                    below. An admin can turn it on.
                </p>
            </SectionCard>

            <SectionCard
                title="Pick a level"
                hint="The level only limits the AI. Your role, or the key's role, still decides what it may touch."
            >
                <ul
                    class="cai-levels grid grid-cols-1 md:grid-cols-3"
                    aria-label="Key levels"
                >
                    <li
                        v-for="level in LEVELS"
                        :key="level.key"
                        class="cai-level"
                    >
                        <span class="cai-level__name">
                            <i :class="level.icon" aria-hidden="true" />
                            {{ level.name }}
                        </span>
                        <span class="cai-level__text">{{ level.text }}</span>
                    </li>
                </ul>
            </SectionCard>

            <SectionCard
                title="What asks you first"
                hint="At every level, these changes wait for a person to say yes."
            >
                <ul class="cai-list">
                    <li v-for="item in ASKS_FIRST" :key="item">{{ item }}</li>
                </ul>
                <p class="cai-text">
                    If your AI client can show a question, you answer yes or
                    no there. If not, the AI gets a short-lived code for that
                    exact change and should show you the change before it uses
                    the code.
                </p>
                <p class="cai-text">
                    Other new items, like an alert rule, are made without
                    asking. Every call is written to the audit log. Running raw
                    scripts and raw database calls is never allowed.
                </p>
            </SectionCard>

            <SectionCard
                title="Create an MCP key"
                hint="Use a key for Full access, or for an AI client that cannot sign in."
            >
                <template v-if="canCreateKey">
                    <ol class="cai-steps">
                        <li v-for="step in KEY_STEPS" :key="step">
                            {{ step }}
                        </li>
                    </ol>
                    <p class="cai-text">
                        The key only works at the MCP address, not for the
                        normal API. Keep it secret. If it leaks, revoke it on
                        the Users page.
                    </p>
                    <RouterLink to="/settings/users" class="cai-link">
                        <i class="fas fa-key" aria-hidden="true" />
                        Go to Users to create a key
                    </RouterLink>
                </template>
                <p v-else class="cai-text" data-testid="no-key-permission">
                    You cannot create keys. Ask an admin to create an MCP key
                    for you.
                </p>
            </SectionCard>

            <SectionCard title="Set up your AI client">
                <ConnectAiClientSetup
                    :mcp-url="mcpUrl"
                    :oauth-clients="MCP_OAUTH_CLIENTS"
                />
            </SectionCard>

            <SectionCard
                title="Remembered approvals"
                hint="When you tell an AI to stop asking, it is kept here. Revoke one and the AI asks again."
            >
                <ConnectAiApprovals />
            </SectionCard>
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, computed, inject} from 'vue';
import {RouterLink} from 'vue-router';
import CopyButton from '@/components/core/CopyButton.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import SectionCard from '@/components/core/SectionCard.vue';
import ConnectAiApprovals from '@/components/pages/settings/ConnectAiApprovals.vue';
import ConnectAiClientSetup from '@/components/pages/settings/ConnectAiClientSetup.vue';
import {
    FLEET_MANAGER_HTTP,
    MCP_OAUTH_CLIENTS,
    type McpOAuthLevel
} from '@/constants';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import type {McpKeyLevel} from '@/helpers/scopedPatCreate';
import type {RouteTab} from '@/types/page-template';

// The backend serves MCP at /mcp on the same origin the app already calls.
const mcpUrl = `${FLEET_MANAGER_HTTP}/mcp`;

const LEVELS: {key: McpKeyLevel; name: string; icon: string; text: string}[] = [
    {
        key: 'read',
        name: 'Read',
        icon: 'fas fa-eye',
        text: 'Looks only. It cannot change anything.'
    },
    {
        key: 'write',
        name: 'Write',
        icon: 'fas fa-pen',
        text: 'Read, plus everyday changes. It cannot touch users, keys, firmware, backups, billing or automations, and cannot switch devices.'
    },
    {
        key: 'full',
        name: 'Full',
        icon: 'fas fa-bolt',
        text: 'Everything the role allows, including switching devices, firmware and automations. It cannot create keys. Only with a key.'
    }
];

// Levels a browser sign-in can reach here; empty when it is not set up.
const SIGN_IN_LEVELS: readonly McpOAuthLevel[] = ['read', 'write'];
const signInLevels = SIGN_IN_LEVELS.map((key) => ({
        key,
        name: LEVELS.find((level) => level.key === key)?.name ?? key,
        clientId: MCP_OAUTH_CLIENTS[key]
    }))
    .filter(
        (level): level is typeof level & {clientId: string} => !!level.clientId
    );

const ASKS_FIRST = [
    'Changing or deleting something.',
    'Giving out access, like a new key or user, or letting a new device in.',
    'Starting or changing an automation.'
];

const KEY_STEPS = [
    'Open Users, then the Service tab, and press New service user.',
    'Give it a name and a role. The role is the most the AI can ever do.',
    'On the API key step, pick An AI agent. Choose what it works on and its level: Read, Write or Full.',
    'Copy the key. It is shown only once.'
];

const rpc = useRpcPermissions();
// Same checks the Users page uses before it offers to make a service user key.
const canCreateKey = computed(
    () =>
        rpc.canCall('User.CreateServiceUser') &&
        rpc.canCall('User.CreateScopedPAT')
);

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);
</script>

<style scoped>
.cai-layout {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.cai-lead,
.cai-text {
    margin: 0;
    max-width: var(--prose-max-width);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    line-height: var(--leading-normal);
}

.cai-url {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--space-2) var(--space-3);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}
.cai-url__value {
    flex: 1;
    min-width: 0;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-body);
    word-break: break-all;
    user-select: all;
}

.cai-ids {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    margin: 0;
    padding: 0;
    list-style: none;
}
.cai-ids__level {
    min-width: var(--space-12);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.cai-levels {
    gap: var(--gap-sm);
    margin: 0;
    padding: 0;
    list-style: none;
}
.cai-level {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}
.cai-level__name {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.cai-level__text {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    line-height: var(--leading-normal);
}

.cai-list,
.cai-steps {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding-left: var(--space-6);
    max-width: var(--prose-max-width);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    line-height: var(--leading-normal);
}
.cai-list {
    list-style: disc;
}
.cai-steps {
    list-style: decimal;
}

.cai-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    align-self: flex-start;
    min-height: var(--touch-target-min);
    color: var(--color-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    text-decoration: underline;
}
.cai-link:visited {
    color: var(--color-primary);
}
.cai-link:hover {
    color: var(--color-text-primary);
}
.cai-link:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.cai-link:active {
    color: var(--color-text-secondary);
}
</style>
