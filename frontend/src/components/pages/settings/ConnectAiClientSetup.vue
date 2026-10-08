<template>
    <div class="cai-setup">
        <fieldset v-if="levels.length > 1" class="cai-pick">
            <legend class="cai-pick__legend">Client id in the steps below</legend>
            <div class="cai-pick__options">
                <label
                    v-for="level in levels"
                    :key="level"
                    :for="`cai-pick-${level}`"
                    class="cai-pick__option"
                >
                    <input
                        :id="`cai-pick-${level}`"
                        v-model="chosen"
                        type="radio"
                        name="cai-pick-level"
                        :value="level"
                        class="core-radio"
                    />
                    {{ LEVEL_NAMES[level] }}
                </label>
            </div>
        </fieldset>

        <DetailTabs
            :tabs="tabs"
            :active="active"
            :scrollable="false"
            @change="active = $event"
        >
            <template v-for="client in clients" :key="client.id" #[client.id]>
                <div class="cai-client">
                    <template v-if="client.browser">
                        <section
                            class="cai-client__way"
                            data-testid="browser-steps"
                            :aria-labelledby="`${client.id}-browser`"
                        >
                            <h4
                                :id="`${client.id}-browser`"
                                class="cai-client__way-title"
                            >
                                <i
                                    class="fas fa-arrow-right-to-bracket"
                                    aria-hidden="true"
                                />
                                Sign in with your browser
                            </h4>
                            <ConnectAiSteps :block="client.browser" />
                        </section>
                        <section
                            class="cai-client__way"
                            data-testid="key-steps"
                            :aria-labelledby="`${client.id}-key`"
                        >
                            <h4
                                :id="`${client.id}-key`"
                                class="cai-client__way-title"
                            >
                                <i class="fas fa-key" aria-hidden="true" />
                                Or use a key
                            </h4>
                            <ConnectAiSteps :block="client.key" />
                        </section>
                    </template>
                    <ConnectAiSteps
                        v-else
                        :block="client.key"
                        data-testid="key-steps"
                    />
                    <a
                        v-for="guide in client.guides"
                        :key="guide.url"
                        :href="guide.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="cai-client__guide"
                    >
                        {{ guide.label }}
                        <i
                            class="fas fa-arrow-up-right-from-square"
                            aria-hidden="true"
                        />
                    </a>
                </div>
            </template>
        </DetailTabs>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import DetailTabs from '@/components/core/DetailTabs.vue';
import ConnectAiSteps, {
    type ConnectAiStepBlock
} from '@/components/pages/settings/ConnectAiSteps.vue';
import type {McpOAuthClients, McpOAuthLevel} from '@/constants';

const props = defineProps<{mcpUrl: string; oauthClients: McpOAuthClients}>();

interface ClientSetup {
    id: string;
    label: string;
    icon: string;
    // Absent when browser sign-in is not set up on this instance.
    browser?: ConnectAiStepBlock;
    key: ConnectAiStepBlock;
    guides: {label: string; url: string}[];
}

// The client id the browser steps use: which Fleet app, so which level.
interface SignIn {
    clientId: string;
    levelName: string;
}

const LEVEL_NAMES: Record<McpOAuthLevel, string> = {
    read: 'Read',
    write: 'Write'
};

// A stand-in the user replaces; the real key is shown once at creation only.
const KEY_PLACEHOLDER = 'YOUR_KEY';
const SERVER_NAME = 'fleet-manager';
const NOT_SET_UP = 'Browser sign-in is not set up on this instance.';

const levels = computed(() =>
    (['read', 'write'] as const).filter((level) => props.oauthClients[level])
);
const chosen = ref<McpOAuthLevel | undefined>(levels.value[0]);

const signIn = computed<SignIn | undefined>(() => {
    const level = chosen.value;
    const clientId = level && props.oauthClients[level];
    return level && clientId
        ? {clientId, levelName: LEVEL_NAMES[level]}
        : undefined;
});

const clients = computed<ClientSetup[]>(() => [
    claudeCode(props.mcpUrl, signIn.value),
    claudeApps(props.mcpUrl, signIn.value),
    chatGpt(props.mcpUrl, signIn.value),
    cursor(props.mcpUrl, signIn.value),
    vsCode(props.mcpUrl, signIn.value)
]);

const tabs = computed(() =>
    clients.value.map(({id, label, icon}) => ({id, label, icon}))
);
const active = ref(clients.value[0].id);

// The client resolves this ${...} reference, so the key stays out of the file.
function clientVariable(name: string): string {
    return `\${${name}}`;
}

function json(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

function claudeCode(url: string, signIn?: SignIn): ClientSetup {
    return {
        id: 'claude-code',
        label: 'Claude Code',
        icon: 'fas fa-terminal',
        browser: signIn && {
            steps: [
                `Run this in a terminal. It uses the ${signIn.levelName} client id. No secret is needed.`,
                'Add --scope user before the name to use it in every project.',
                'In Claude Code, type /mcp, pick fleet-manager and sign in. Your browser opens the Fleet sign-in page.'
            ],
            snippet: {
                label: 'Terminal command',
                text: `claude mcp add --transport http --client-id ${signIn.clientId} ${SERVER_NAME} ${url}`
            }
        },
        key: {
            steps: [
                `Run this in a terminal. Put your key in place of ${KEY_PLACEHOLDER}.`,
                'Add --scope user before the name to use it in every project.'
            ],
            snippet: {
                label: 'Terminal command',
                text: `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: Bearer ${KEY_PLACEHOLDER}"`
            },
            after: 'Then type /mcp in Claude Code to check that it is connected.'
        },
        guides: [
            {
                label: 'Claude Code guide',
                url: 'https://code.claude.com/docs/en/mcp'
            }
        ]
    };
}

function claudeApps(url: string, signIn?: SignIn): ClientSetup {
    const open = [
        'Pro and Max: open Customize, then Connectors. Press + Add, then Add custom connector.',
        'Team and Enterprise: an owner opens Organization settings, then Connectors. Press Add, then Custom, then Web.',
        `Enter a name and this address: ${url}.`
    ];
    const reach =
        'Claude connects from Anthropic servers, not from your computer. This address must be reachable from the internet.';
    return {
        id: 'claude-apps',
        label: 'Claude app and web',
        icon: 'fas fa-comments',
        browser: signIn && {
            steps: [
                ...open,
                `Open Advanced settings and paste the ${signIn.levelName} client id: ${signIn.clientId}. If Claude asks for an OAuth client instead, pick Use your own OAuth client and paste it there.`,
                'Leave the client secret empty. Press Add.',
                'Press Connect and sign in to Fleet in the window that opens. On Team and Enterprise, each member presses Connect under Customize, then Connectors.',
                reach
            ]
        },
        key: {
            steps: [
                ...open,
                'Under Authentication, pick No sign-in.',
                `Under Request headers, add Authorization with the value Bearer ${KEY_PLACEHOLDER}. Press Add.`,
                'Request headers are in beta. If you do not see them, your Claude organization does not have them yet.',
                reach
            ]
        },
        guides: [
            {
                label: 'Claude connector guide',
                url: 'https://claude.com/docs/connectors/custom/add-unlisted'
            }
        ]
    };
}

function chatGpt(url: string, signIn?: SignIn): ClientSetup {
    return {
        id: 'chatgpt',
        label: 'ChatGPT',
        icon: signIn ? 'fas fa-comment-dots' : 'fas fa-comment-slash',
        browser: signIn && {
            steps: [
                'Turn on Developer mode: Settings, then Security and login. It needs Plus, Pro, Business, Enterprise or Education, on the web.',
                `Go to Plugins, press the plus button and make an app. Enter a name and this address: ${url}.`,
                `Pick OAuth sign-in. Enter the ${signIn.levelName} client id as the OAuth client id: ${signIn.clientId}. Leave the secret empty.`,
                'ChatGPT shows a callback URL for this app. Send it to your Fleet admin. They add it to FM_MCP_OAUTH_EXTRA_REDIRECT_URIS and run an update. Sign-in fails until then.',
                'Then connect and sign in to Fleet in the window that opens. ChatGPT connects from OpenAI servers, so this address must be reachable from the internet.'
            ],
            caveat: 'OpenAI says ChatGPT uses a fixed client id when you give one, but its guide does not name the fields. The field names here are not confirmed.'
        },
        key: {
            blocked: signIn
                ? 'ChatGPT cannot send a key. Use browser sign-in.'
                : `ChatGPT cannot connect here. It cannot send a key. ${NOT_SET_UP} Fleet Manager never allows access without sign-in.`,
            steps: []
        },
        guides: [
            {
                label: 'ChatGPT developer mode guide',
                url: 'https://developers.openai.com/api/docs/guides/developer-mode'
            },
            {
                label: 'ChatGPT sign-in options',
                url: 'https://developers.openai.com/plugins/build/auth'
            }
        ]
    };
}

function cursor(url: string, signIn?: SignIn): ClientSetup {
    const where =
        'Open ~/.cursor/mcp.json for all projects, or .cursor/mcp.json in one project.';
    return {
        id: 'cursor',
        label: 'Cursor',
        icon: 'fas fa-i-cursor',
        browser: signIn && {
            steps: [
                where,
                `Add this. CLIENT_ID is the ${signIn.levelName} client id. There is no secret.`,
                'When Cursor connects, sign in to Fleet in the browser window it opens.'
            ],
            snippet: {
                label: 'mcp.json',
                text: json({
                    mcpServers: {
                        [SERVER_NAME]: {url, auth: {CLIENT_ID: signIn.clientId}}
                    }
                })
            }
        },
        key: {
            steps: [
                where,
                'Add this. It reads the key from FLEET_MCP_KEY, so the key stays out of the file.',
                'Set FLEET_MCP_KEY to your key where Cursor starts.'
            ],
            snippet: {
                label: 'mcp.json',
                text: json({
                    mcpServers: {
                        [SERVER_NAME]: {
                            url,
                            headers: {
                                Authorization: `Bearer ${clientVariable('env:FLEET_MCP_KEY')}`
                            }
                        }
                    }
                })
            }
        },
        guides: [{label: 'Cursor guide', url: 'https://cursor.com/docs/context/mcp'}]
    };
}

function vsCode(url: string, signIn?: SignIn): ClientSetup {
    const where =
        'Open .vscode/mcp.json in your project, or run MCP: Open User Configuration for all projects.';
    return {
        id: 'vscode',
        label: 'VS Code',
        icon: 'fas fa-code',
        browser: signIn && {
            steps: [
                where,
                `Add this. clientId is the ${signIn.levelName} client id.`,
                'On first use, VS Code opens a browser window. Sign in to Fleet there.',
                'If VS Code asks for a client id instead, paste the same id and leave the secret empty.'
            ],
            snippet: {
                label: 'mcp.json',
                text: json({
                    servers: {
                        [SERVER_NAME]: {
                            type: 'http',
                            url,
                            oauth: {clientId: signIn.clientId}
                        }
                    }
                })
            }
        },
        key: {
            steps: [
                where,
                'Add this. VS Code asks for the key when the server starts.'
            ],
            snippet: {
                label: 'mcp.json',
                text: json({
                    inputs: [
                        {
                            type: 'promptString',
                            id: 'fleet-mcp-key',
                            description: 'Fleet Manager MCP key',
                            password: true
                        }
                    ],
                    servers: {
                        [SERVER_NAME]: {
                            type: 'http',
                            url,
                            headers: {
                                Authorization: `Bearer ${clientVariable('input:fleet-mcp-key')}`
                            }
                        }
                    }
                })
            }
        },
        guides: [
            {
                label: 'VS Code guide',
                url: 'https://code.visualstudio.com/docs/copilot/customization/mcp-servers'
            },
            {
                label: 'VS Code sign-in settings',
                url: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration'
            }
        ]
    };
}
</script>

<style scoped>
.cai-setup {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.cai-pick {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
}
.cai-pick__legend {
    padding: 0;
    margin-bottom: var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}
.cai-pick__options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}
.cai-pick__option {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target-min);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    cursor: pointer;
}

.cai-client {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: var(--prose-max-width);
}
.cai-client__way {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.cai-client__way-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.cai-client__guide {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    align-self: flex-start;
    min-height: var(--touch-target-min);
    color: var(--color-primary);
    font-size: var(--type-body);
    text-decoration: underline;
}
.cai-client__guide:hover {
    color: var(--color-text-primary);
}
.cai-client__guide:visited {
    color: var(--color-primary);
}
.cai-client__guide:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.cai-client__guide:active {
    color: var(--color-text-secondary);
}
</style>
