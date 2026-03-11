<template>
    <!-- Fullscreen overlay — no Modal wrapper needed -->
    <Teleport to="body">
        <div v-if="visible" class="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
            <!-- ═══ Top Toolbar ═══ -->
            <div class="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface-1)] border-b border-[var(--color-border-default)] shrink-0">
                <!-- Title & device info -->
                <i class="fas fa-desktop text-[var(--color-text-tertiary)]"></i>
                <span class="font-semibold text-sm text-[var(--color-text-primary)] truncate">{{ shellyID }}</span>

                <!-- Mode badge -->
                <span
                    v-if="proxyMethod"
                    class="text-2xs px-1.5 py-0.5 rounded-full border cursor-help"
                    :class="
                        proxyMethod === 'direct'
                            ? 'text-[var(--color-primary-text)] border-[var(--color-primary)] bg-[var(--color-primary-subtle)]'
                            : proxyMethod === 'shelly_addr'
                                ? 'text-[var(--color-success-text)] border-[var(--color-success)] bg-[var(--color-success-subtle)]'
                                : 'text-[var(--color-warning-text)] border-[var(--color-warning)] bg-[var(--color-warning-subtle)]'
                    "
                    :title="
                        proxyMethod === 'direct'
                            ? 'Direct LAN access — browser connects to device IP'
                            : proxyMethod === 'shelly_addr'
                                ? 'SaaS proxy + native shelly_addr (FW 1.8.0+)'
                                : 'SaaS proxy + compatibility mode (FW < 1.8.0)'
                    "
                >
                    {{ proxyMethod === 'direct' ? 'LAN' : proxyMethod === 'shelly_addr' ? 'SaaS' : 'SaaS (compat)' }}
                </span>

                <span v-if="deviceIp" class="text-xs text-[var(--color-text-disabled)]">{{ deviceIp }}</span>
                <span v-if="fwVersion" class="text-xs text-[var(--color-text-disabled)]">FW {{ fwVersion }}</span>

                <!-- URL bar (expandable) -->
                <div v-if="guiUrl" class="flex-1 min-w-0 mx-2">
                    <div class="flex items-center bg-[var(--color-surface-0)] border border-[var(--color-border-strong)] rounded px-2 py-1">
                        <div class="text-xs text-[var(--color-text-tertiary)] font-mono truncate flex-1 select-all">
                            {{ guiUrl }}
                        </div>
                        <button
                            class="shrink-0 ml-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                            title="Copy URL"
                            @click="copyUrl"
                        >
                            <i :class="copyLabel === 'Copied!' ? 'fas fa-check text-[var(--color-success-text)]' : 'fas fa-copy'" class="text-xs"></i>
                        </button>
                    </div>
                </div>
                <div v-else class="flex-1"></div>

                <!-- Toolbar actions -->
                <button
                    class="text-xs px-2 py-1 rounded border shrink-0"
                    :class="diagResult
                        ? 'border-[var(--color-primary)] text-[var(--color-primary-text)] bg-[var(--color-primary-subtle)]'
                        : 'border-[var(--color-border-strong)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'"
                    :disabled="diagLoading"
                    @click="diagResult && !diagLoading ? closeDiagnostics() : runDiagnostics()"
                >
                    {{ diagLoading ? 'Running...' : diagResult ? 'Hide Diagnostics' : 'Diagnostics' }}
                </button>

                <button
                    v-if="deviceIp"
                    class="text-xs px-2 py-1 rounded border border-[var(--color-primary)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-subtle)] shrink-0"
                    @click="openDirectly"
                >
                    Open Direct
                </button>

                <button
                    class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] rounded p-1.5 shrink-0"
                    title="Close"
                    @click="emit('close')"
                >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 14 14">
                        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6" />
                    </svg>
                </button>
            </div>

            <!-- ═══ Main Content — iframe fills all remaining space ═══ -->
            <div class="flex-1 min-h-0 relative">
                <!-- Loading State -->
                <div
                    v-if="loading"
                    class="absolute inset-0 flex flex-col items-center justify-center gap-4"
                >
                    <Spinner />
                    <span class="text-[var(--color-text-tertiary)]">Loading device GUI...</span>
                </div>

                <!-- Error State -->
                <div
                    v-else-if="error"
                    class="absolute inset-0 flex flex-col items-center justify-center gap-4"
                >
                    <i class="fas fa-exclamation-triangle text-4xl text-[var(--color-warning-text)]"></i>
                    <span class="text-[var(--color-danger-text)]">{{ error }}</span>
                    <Button type="blue" @click="loadGuiInfo">Retry</Button>
                </div>

                <!-- Iframe -->
                <iframe
                    v-else-if="guiUrl"
                    ref="iframeRef"
                    :src="guiUrl"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    class="w-full h-full border-0 bg-white"
                    @load="onIframeLoad"
                    @error="onIframeError"
                />

                <!-- No GUI Available -->
                <div
                    v-else
                    class="absolute inset-0 flex flex-col items-center justify-center gap-4"
                >
                    <i class="fas fa-desktop text-4xl text-[var(--color-text-disabled)]"></i>
                    <span class="text-[var(--color-text-tertiary)]">Device GUI not available</span>
                    <span class="text-sm text-[var(--color-text-disabled)]">
                        The device may be offline or its IP address is not accessible.
                    </span>
                </div>
            </div>

            <!-- ═══ Bottom Drawer (diagnostics / timings) — only when data exists ═══ -->
            <div
                v-if="diagResult || diagError || (obsLevel >= 2 && deviceRpcTimings.length > 0)"
                class="shrink-0 border-t border-[var(--color-border-default)] bg-[var(--color-surface-1)] max-h-[40vh] overflow-y-auto"
            >
                <!-- Diagnostics Results -->
                <div v-if="diagResult" class="p-3">
                    <div class="flex items-center justify-between mb-2">
                        <div class="text-[var(--color-text-secondary)] text-sm font-semibold">Diagnostics Report</div>
                        <div class="flex items-center gap-2">
                            <button
                                class="text-xs px-2 py-1 rounded border border-[var(--color-border-strong)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]"
                                :disabled="diagLoading"
                                @click="runDiagnostics"
                            >
                                <i :class="diagLoading ? 'fas fa-spinner fa-spin' : 'fas fa-redo'" class="mr-1"></i>
                                {{ diagLoading ? 'Running...' : 'Retry' }}
                            </button>
                            <button
                                class="text-xs px-2 py-1 rounded border"
                                :class="
                                    copyLogsLabel === 'Copied!'
                                        ? 'text-[var(--color-success-text)] border-[var(--color-success)] bg-[var(--color-success-subtle)]'
                                        : 'text-[var(--color-text-secondary)] border-[var(--color-border-strong)] hover:bg-[var(--color-surface-3)]'
                                "
                                @click="copyLogs"
                            >
                                <i :class="copyLogsLabel === 'Copied!' ? 'fas fa-check' : 'fas fa-copy'" class="mr-1"></i>
                                {{ copyLogsLabel }}
                            </button>
                            <button
                                class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] rounded p-1"
                                title="Close diagnostics"
                                @click="closeDiagnostics"
                            >
                                <i class="fas fa-xmark text-sm"></i>
                            </button>
                        </div>
                    </div>
                    <div class="text-xs font-mono text-[var(--color-text-tertiary)] mb-2">
                        {{ diagResult.shellyID }} | IP: {{ diagResult.deviceIp }} |
                        FW: {{ diagResult.fw }} | {{ diagResult.model }} ({{ diagResult.app }}) |
                        Online: <span :class="diagResult.online ? 'text-[var(--color-success-text)]' : 'text-[var(--color-danger-text)]'">{{ diagResult.online }}</span>
                    </div>
                    <table class="w-full text-xs font-mono">
                        <thead>
                            <tr class="text-[var(--color-text-disabled)] border-b border-[var(--color-border-default)]">
                                <th class="text-left py-1 pr-2">Test</th>
                                <th class="text-left py-1 pr-2">Status</th>
                                <th class="text-left py-1 pr-2">Time</th>
                                <th class="text-left py-1">Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(result, name) in diagResult.tests" :key="name" class="border-b border-[var(--color-border-default)]/50">
                                <td class="py-1 pr-2 text-[var(--color-text-secondary)]">{{ name }}</td>
                                <td class="py-1 pr-2">
                                    <span :class="result.ok ? 'text-[var(--color-success-text)]' : 'text-[var(--color-danger-text)]'">{{ result.ok ? 'OK' : 'FAIL' }}</span>
                                    <span v-if="result.code" class="text-[var(--color-text-disabled)] ml-1">({{ result.code }})</span>
                                </td>
                                <td class="py-1 pr-2 text-[var(--color-text-disabled)]">{{ result.elapsed ? result.elapsed + 'ms' : '-' }}</td>
                                <td class="py-1 text-[var(--color-text-tertiary)]">
                                    <span v-if="result.error" class="text-[var(--color-danger-text)]">{{ result.error }}</span>
                                    <span v-else-if="result.bodyLength || result.bodyB64Length">
                                        body={{ result.bodyLength }}B b64={{ result.bodyB64Length }}B
                                    </span>
                                    <span v-if="result.headers && Object.keys(result.headers).length > 0" class="block text-[var(--color-text-disabled)] mt-0.5">
                                        {{ Object.entries(result.headers).map(([k, v]) => `${k}: ${v}`).join(' | ') }}
                                    </span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Diagnostics Error -->
                <div v-if="diagError" class="p-3 flex items-center gap-3">
                    <span class="text-sm text-[var(--color-danger-text)]">Diagnostics failed: {{ diagError }}</span>
                    <button
                        class="text-xs px-2 py-1 rounded border border-[var(--color-border-strong)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] shrink-0"
                        :disabled="diagLoading"
                        @click="runDiagnostics"
                    >
                        <i class="fas fa-redo mr-1"></i>
                        Retry
                    </button>
                    <button
                        class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] rounded p-1 shrink-0"
                        title="Close"
                        @click="closeDiagnostics"
                    >
                        <i class="fas fa-xmark text-sm"></i>
                    </button>
                </div>

                <!-- RPC Timings -->
                <div v-if="obsLevel >= 2 && deviceRpcTimings.length > 0" class="p-3 border-t border-[var(--color-border-default)]">
                    <Collapse title="Device RPC Timings">
                        <div class="max-h-48 overflow-auto">
                            <div v-for="(entry, i) in deviceRpcTimings" :key="i"
                                class="flex items-center gap-3 text-xs font-mono">
                                <span class="text-[var(--color-text-disabled)] w-16">{{ formatTime(entry.ts) }}</span>
                                <span class="flex-1 text-[var(--color-text-secondary)]">{{ entry.method }}</span>
                                <span class="w-16 text-right font-semibold"
                                    :class="entry.durationMs > 1000 ? 'text-[var(--color-danger-text)]' : entry.durationMs > 200 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-success-text)]'">
                                    {{ entry.durationMs }}ms
                                </span>
                            </div>
                        </div>
                    </Collapse>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import zitadelAuth from '@/helpers/zitadelAuth';
import {getObsLevel, getRpcTimings, type ObsLevel} from '@/tools/observability';
import Button from '../core/Button.vue';
import Collapse from '../core/Collapse.vue';
import Spinner from '../core/Spinner.vue';

const props = defineProps<{
    visible: boolean;
    shellyID: string;
}>();

const emit = defineEmits<{
    close: [];
}>();

let abortController: AbortController | null = null;

const loading = ref(false);
const error = ref<string | null>(null);
const guiUrl = ref<string | null>(null);
const deviceIp = ref<string | null>(null);
const fwVersion = ref<string | null>(null);
const proxyMethod = ref<'direct' | 'shelly_addr' | 'compatibility' | null>(
    null
);
const iframeRef = ref<HTMLIFrameElement | null>(null);
const copyLabel = ref('Copy');
const diagLoading = ref(false);
const diagResult = ref<Record<string, any> | null>(null);
const diagError = ref<string | null>(null);
const copyLogsLabel = ref('Copy Logs');

const obsLevel = computed<ObsLevel>(() => getObsLevel());

// Filter RPC timings to this device's shellyID
const deviceRpcTimings = computed(() => {
    if (getObsLevel() < 2) return [];
    return [...getRpcTimings()]
        .filter((t) =>
            t.method.toLowerCase().includes(props.shellyID.toLowerCase())
        )
        .reverse();
});

function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function copyUrl() {
    if (!guiUrl.value) return;
    copyToClipboard(guiUrl.value).then((ok) => {
        copyLabel.value = ok ? 'Copied!' : 'Failed';
        setTimeout(() => {
            copyLabel.value = 'Copy';
        }, 1500);
    });
}

function copyLogs() {
    if (!diagResult.value) return;
    copyToClipboard(JSON.stringify(diagResult.value, null, 2)).then((ok) => {
        copyLogsLabel.value = ok ? 'Copied!' : 'Failed';
        setTimeout(() => {
            copyLogsLabel.value = 'Copy Logs';
        }, 1500);
    });
}

async function copyToClipboard(text: string): Promise<boolean> {
    // navigator.clipboard requires secure context (HTTPS or localhost)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // fall through to fallback
        }
    }
    // Fallback for HTTP contexts
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        document.body.removeChild(textarea);
    }
}

async function getAccessToken(): Promise<string | null> {
    if (!zitadelAuth) {
        console.error('Zitadel auth not initialized');
        return null;
    }
    const user = await zitadelAuth.oidcAuth.mgr.getUser();
    return user?.access_token ?? null;
}

async function loadGuiInfo() {
    if (!props.shellyID) return;

    loading.value = true;
    error.value = null;
    guiUrl.value = null;

    try {
        const token = await getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        console.log(
            '[DeviceWebGuiModal] Fetching info for device:',
            props.shellyID
        );

        const response = await fetch(
            `/api/device-proxy/${props.shellyID}/info`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                signal: abortController?.signal
            }
        );

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('[DeviceWebGuiModal] Got info response:', data);

        deviceIp.value = data.deviceIp;
        fwVersion.value = data.fwVersion || null;

        // Detect if the browser is likely on the same LAN as the device.
        // If FM is accessed from a private IP, we can load the device GUI
        // directly — no proxy needed, works for ALL firmware versions.
        const fmHost = window.location.hostname;
        const isLAN =
            fmHost === 'localhost' ||
            fmHost === '127.0.0.1' ||
            fmHost === '::1' ||
            fmHost.startsWith('10.') ||
            fmHost.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(fmHost);
        const isHttps = window.location.protocol === 'https:';

        if (isLAN && data.deviceIp) {
            // LAN mode: load device GUI directly from its IP.
            // Browser can reach the device — no proxy overhead, works
            // with all firmware versions (no shelly_addr needed).
            guiUrl.value = `http://${data.deviceIp}/`;
            proxyMethod.value = 'direct';
            console.log(
                '[DeviceWebGuiModal] Opening device GUI (direct LAN): %s',
                guiUrl.value
            );
        } else if (!isHttps && data.proxyPort && data.supportsNativeShellyAddr) {
            // Content served from path-based proxy, RPC bridged via port proxy (WS transport)
            const rpcOrigin = `${window.location.protocol}//${window.location.hostname}:${data.proxyPort}`;
            const contentUrl = `/api/device-proxy/${props.shellyID}/gui/`;
            guiUrl.value = `${contentUrl}?shelly_addr=${encodeURIComponent(rpcOrigin + '/rpc')}`;
            proxyMethod.value = 'shelly_addr';
            console.log(
                '[DeviceWebGuiModal] Opening device GUI (content via path proxy, RPC via port %d): %s',
                data.proxyPort,
                guiUrl.value
            );
        } else if (data.fullProxyUrl) {
            // No port proxy available — path proxy fallback
            guiUrl.value = `${data.fullProxyUrl}?token=${encodeURIComponent(token)}`;
            proxyMethod.value = 'compatibility';
            console.log(
                '[DeviceWebGuiModal] Opening device GUI (path proxy fallback): %s',
                guiUrl.value
            );
        } else {
            error.value = 'Device IP not available';
        }
    } catch (e: any) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        console.error('[DeviceWebGuiModal] Failed to load device GUI info:', e);
        error.value = e.message || 'Failed to load device GUI';
    } finally {
        loading.value = false;
    }
}

function onIframeLoad() {
    // Iframe loaded successfully
}

function onIframeError() {
    error.value = 'Failed to load device GUI';
}

async function runDiagnostics() {
    diagLoading.value = true;
    diagResult.value = null;
    diagError.value = null;

    try {
        const token = await getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await fetch(
            `/api/device-proxy/${props.shellyID}/gui-debug`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                signal: abortController?.signal
            }
        );

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP ${response.status}: ${text}`);
        }

        diagResult.value = await response.json();
    } catch (e: any) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        diagError.value = e.message || 'Unknown error';
    } finally {
        diagLoading.value = false;
    }
}

function closeDiagnostics() {
    diagResult.value = null;
    diagError.value = null;
}

function openDirectly() {
    if (deviceIp.value) {
        window.open(`http://${deviceIp.value}/`, '_blank');
    }
}

// Load GUI info when modal becomes visible
watch(
    () => props.visible,
    (newVisible) => {
        if (newVisible && props.shellyID) {
            abortController = new AbortController();
            loadGuiInfo();
        } else {
            if (abortController) {
                abortController.abort();
                abortController = null;
            }
        }
    },
    {immediate: true}
);
</script>
