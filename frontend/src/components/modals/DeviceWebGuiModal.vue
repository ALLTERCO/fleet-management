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
                    class="text-2xs px-1.5 py-0.5 rounded-full border cursor-help text-[var(--color-primary-text)] border-[var(--color-primary)] bg-[var(--color-primary-subtle)]"
                    title="Direct LAN access — browser connects to device IP"
                >
                    LAN
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
                    @click="diagResult && !diagLoading ? closeDiagnostics() : runDiagnostics(false)"
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
                                @click="runDiagnostics(false)"
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

                    <!-- Device not in collector banner -->
                    <div v-if="diagResult.deviceNotFound" class="mb-3 px-2 py-1.5 rounded bg-[var(--color-warning-subtle)] border border-[var(--color-warning)] text-xs text-[var(--color-warning-text)]">
                        <i class="fas fa-triangle-exclamation mr-1"></i>
                        Device not currently connected to Fleet Manager — diagnostics are limited
                    </div>

                    <!-- ── 1. Reachability ── -->
                    <div class="mb-3">
                        <div class="text-2xs uppercase tracking-wider text-[var(--color-text-disabled)] mb-1">Reachability</div>
                        <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs font-mono">
                            <span class="text-[var(--color-text-disabled)]">Device IP</span>
                            <span class="text-[var(--color-text-secondary)]">{{ diagResult.deviceIp || '—' }}</span>

                            <!-- Browser → Device -->
                            <span class="text-[var(--color-text-disabled)]">Browser → Device</span>
                            <span v-if="browserProbe === null" class="text-[var(--color-text-disabled)]">—</span>
                            <span v-else-if="browserProbe === 'probing'" class="text-[var(--color-text-disabled)]">probing...</span>
                            <span v-else-if="browserProbe.elapsed === 0 && browserProbe.error?.startsWith('skipped')" class="text-[var(--color-warning-text)]">
                                Skipped — mixed content (HTTPS → HTTP)
                            </span>
                            <span v-else :class="browserProbe.reachable ? 'text-[var(--color-success-text)]' : 'text-[var(--color-danger-text)]'">
                                {{ browserProbe.reachable ? 'Reachable' : 'Unreachable' }}
                                ({{ browserProbe.elapsed }}ms)
                                <span v-if="browserProbe.error"> — {{ browserProbe.error }}</span>
                            </span>

                            <!-- FM → Device -->
                            <span class="text-[var(--color-text-disabled)]">FM → Device</span>
                            <template v-if="diagResult.fmReachability?.skipped">
                                <span class="text-[var(--color-text-disabled)]">{{ diagResult.fmReachability.reason }}</span>
                            </template>
                            <template v-else-if="diagResult.fmReachability">
                                <span :class="diagResult.fmReachability.reachable ? 'text-[var(--color-success-text)]' : 'text-[var(--color-danger-text)]'">
                                    {{ diagResult.fmReachability.reachable ? 'Reachable' : 'Unreachable' }}
                                    ({{ diagResult.fmReachability.elapsed }}ms)
                                    <span v-if="diagResult.fmReachability.error"> — {{ diagResult.fmReachability.error }}</span>
                                </span>
                            </template>
                            <span v-else class="text-[var(--color-text-disabled)]">—</span>

                            <!-- HTTPS warning -->
                            <template v-if="diagResult.guiContext?.httpsWarning">
                                <span class="text-[var(--color-text-disabled)]">Warning</span>
                                <span class="text-[var(--color-warning-text)]">{{ diagResult.guiContext.httpsWarning }}</span>
                            </template>
                        </div>
                    </div>

                    <!-- ── 2. Device Health ── -->
                    <div class="mb-3">
                        <div class="text-2xs uppercase tracking-wider text-[var(--color-text-disabled)] mb-1">Device Health</div>
                        <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs font-mono">
                            <span class="text-[var(--color-text-disabled)]">Model</span>
                            <span class="text-[var(--color-text-secondary)]">
                                {{ diagResult.deviceHealth?.model || '—' }}
                                <span v-if="diagResult.deviceHealth?.app" class="text-[var(--color-text-disabled)]">({{ diagResult.deviceHealth.app }})</span>
                                <span v-if="diagResult.deviceHealth?.gen" class="text-[var(--color-text-disabled)]">Gen {{ diagResult.deviceHealth.gen }}</span>
                            </span>

                            <span class="text-[var(--color-text-disabled)]">Firmware</span>
                            <span class="text-[var(--color-text-secondary)]">{{ diagResult.deviceHealth?.fw || '—' }}</span>

                            <span class="text-[var(--color-text-disabled)]">Uptime</span>
                            <span class="text-[var(--color-text-secondary)]">{{ formatUptime(diagResult.deviceHealth?.uptime) }}</span>

                            <span class="text-[var(--color-text-disabled)]">RAM</span>
                            <span class="text-[var(--color-text-secondary)]">
                                {{ diagResult.deviceHealth?.ramFree != null ? Math.round(diagResult.deviceHealth.ramFree / 1024) + 'KB free' : '—' }}
                                {{ diagResult.deviceHealth?.ramSize != null ? '/ ' + Math.round(diagResult.deviceHealth.ramSize / 1024) + 'KB' : '' }}
                            </span>

                            <span class="text-[var(--color-text-disabled)]">FS</span>
                            <span class="text-[var(--color-text-secondary)]">
                                {{ diagResult.deviceHealth?.fsFree != null ? Math.round(diagResult.deviceHealth.fsFree / 1024) + 'KB free' : '—' }}
                                {{ diagResult.deviceHealth?.fsSize != null ? '/ ' + Math.round(diagResult.deviceHealth.fsSize / 1024) + 'KB' : '' }}
                            </span>

                            <template v-if="diagResult.deviceHealth?.temperatures?.length">
                                <span class="text-[var(--color-text-disabled)]">Temperature</span>
                                <span class="text-[var(--color-text-secondary)]">
                                    {{ diagResult.deviceHealth.temperatures.map((t: any) => t.tC + '\u00B0C').join(', ') }}
                                </span>
                            </template>
                        </div>
                    </div>

                    <!-- ── 3. Transport Health ── -->
                    <div class="mb-3">
                        <div class="text-2xs uppercase tracking-wider text-[var(--color-text-disabled)] mb-1">Transport Health</div>
                        <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs font-mono">
                            <span class="text-[var(--color-text-disabled)]">Status</span>
                            <span :class="diagResult.transportHealth?.online ? 'text-[var(--color-success-text)]' : 'text-[var(--color-danger-text)]'">
                                {{ diagResult.transportHealth?.online ? 'Online' : 'Offline' }}
                                <span v-if="diagResult.transportHealth?.presence === 'pending'" class="text-[var(--color-warning-text)]">(pending)</span>
                            </span>

                            <span class="text-[var(--color-text-disabled)]">Transport</span>
                            <span class="text-[var(--color-text-secondary)]">{{ diagResult.transportHealth?.transport || '—' }}</span>

                            <span class="text-[var(--color-text-disabled)]">Pending RPCs</span>
                            <span :class="(diagResult.transportHealth?.pendingRpcs || 0) > 0 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-text-secondary)]'">
                                {{ diagResult.transportHealth?.pendingRpcs ?? 0 }}
                            </span>

                            <span class="text-[var(--color-text-disabled)]">Last Report</span>
                            <span class="text-[var(--color-text-secondary)]">
                                {{ diagResult.transportHealth?.lastReportAge != null ? diagResult.transportHealth.lastReportAge + 's ago' : '—' }}
                            </span>

                            <template v-if="diagResult.transportHealth?.rpcCheck">
                                <span class="text-[var(--color-text-disabled)]">RPC Check</span>
                                <span :class="diagResult.transportHealth.rpcCheck.ok ? 'text-[var(--color-success-text)]' : 'text-[var(--color-danger-text)]'">
                                    {{ diagResult.transportHealth.rpcCheck.ok ? 'OK' : 'FAIL' }}
                                    ({{ diagResult.transportHealth.rpcCheck.elapsed }}ms)
                                    <span v-if="diagResult.transportHealth.rpcCheck.error"> — {{ diagResult.transportHealth.rpcCheck.error }}</span>
                                </span>
                            </template>
                        </div>
                    </div>

                    <!-- ── 4. Network Quality ── -->
                    <div v-if="diagResult.networkQuality" class="mb-3">
                        <div class="text-2xs uppercase tracking-wider text-[var(--color-text-disabled)] mb-1">Network Quality</div>
                        <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs font-mono">
                            <template v-if="diagResult.networkQuality.wifi">
                                <span class="text-[var(--color-text-disabled)]">WiFi</span>
                                <span class="text-[var(--color-text-secondary)]">
                                    {{ diagResult.networkQuality.wifi.ssid || '—' }}
                                    — {{ diagResult.networkQuality.wifi.ip || 'no IP' }}
                                </span>

                                <span class="text-[var(--color-text-disabled)]">RSSI</span>
                                <span v-if="diagResult.networkQuality.wifi.rssi != null"
                                    :class="diagResult.networkQuality.wifi.rssi > -50 ? 'text-[var(--color-success-text)]'
                                        : diagResult.networkQuality.wifi.rssi > -70 ? 'text-[var(--color-warning-text)]'
                                        : 'text-[var(--color-danger-text)]'"
                                >
                                    {{ diagResult.networkQuality.wifi.rssi }} dBm
                                    ({{ diagResult.networkQuality.wifi.rssi > -50 ? 'excellent' : diagResult.networkQuality.wifi.rssi > -60 ? 'good' : diagResult.networkQuality.wifi.rssi > -70 ? 'fair' : 'weak' }})
                                </span>
                                <span v-else class="text-[var(--color-text-disabled)]">—</span>
                            </template>

                            <template v-if="diagResult.networkQuality.eth">
                                <span class="text-[var(--color-text-disabled)]">Ethernet</span>
                                <span class="text-[var(--color-text-secondary)]">{{ diagResult.networkQuality.eth.ip || '—' }}</span>
                            </template>

                            <span class="text-[var(--color-text-disabled)]">Cloud</span>
                            <span class="text-[var(--color-text-secondary)]">
                                {{ diagResult.networkQuality.cloud != null ? (diagResult.networkQuality.cloud ? 'Connected' : 'Disconnected') : '—' }}
                            </span>
                        </div>
                    </div>

                    <!-- ── 5. Advanced (collapsed, loaded on demand) ── -->
                    <div v-if="diagResult.advanced">
                        <Collapse title="Advanced">
                            <div v-if="diagResult.advanced.listMethods" class="text-xs font-mono">
                                <div class="mb-1">
                                    <span :class="diagResult.advanced.listMethods.ok ? 'text-[var(--color-success-text)]' : 'text-[var(--color-danger-text)]'">
                                        ListMethods: {{ diagResult.advanced.listMethods.ok ? 'OK' : 'FAIL' }}
                                    </span>
                                    <span class="text-[var(--color-text-disabled)]"> ({{ diagResult.advanced.listMethods.elapsed }}ms)</span>
                                    <span v-if="diagResult.advanced.listMethods.error" class="text-[var(--color-danger-text)]"> — {{ diagResult.advanced.listMethods.error }}</span>
                                </div>
                                <div v-if="diagResult.advanced.listMethods.methods" class="text-[var(--color-text-disabled)] max-h-32 overflow-auto">
                                    {{ diagResult.advanced.listMethods.count }} methods:
                                    {{ diagResult.advanced.listMethods.methods.join(', ') }}
                                </div>
                            </div>
                        </Collapse>
                    </div>
                    <div v-else>
                        <button
                            class="text-xs text-[var(--color-text-disabled)] hover:text-[var(--color-text-secondary)] underline"
                            :disabled="diagLoading"
                            @click="runDiagnostics(true)"
                        >
                            Load advanced diagnostics...
                        </button>
                    </div>
                </div>

                <!-- Diagnostics Error -->
                <div v-if="diagError" class="p-3 flex items-center gap-3">
                    <span class="text-sm text-[var(--color-danger-text)]">Diagnostics failed: {{ diagError }}</span>
                    <button
                        class="text-xs px-2 py-1 rounded border border-[var(--color-border-strong)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] shrink-0"
                        :disabled="diagLoading"
                        @click="runDiagnostics(false)"
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
const proxyMethod = ref<'direct' | null>(null);
const iframeRef = ref<HTMLIFrameElement | null>(null);
const copyLabel = ref('Copy');
const diagLoading = ref(false);
const diagResult = ref<Record<string, any> | null>(null);
const diagError = ref<string | null>(null);
const copyLogsLabel = ref('Copy Logs');
const browserProbe = ref<null | 'probing' | {reachable: boolean; elapsed: number; error?: string}>(null);

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
            if (response.status === 404) {
                throw new Error(
                    data.error || 'Device no longer connected to Fleet Manager'
                );
            }
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('[DeviceWebGuiModal] Got info response:', data);

        deviceIp.value = data.deviceIp;
        fwVersion.value = data.fwVersion || null;

        if (!data.deviceIp) {
            error.value = 'Device IP not available. The device may be offline.';
            return;
        }

        // Direct LAN access — browser connects to device IP.
        // Works when FM and devices are on the same network (typical deployment).
        // If accessed via domain name, verify the device is reachable first.
        const deviceUrl = `http://${data.deviceIp}/`;
        const fmHost = window.location.hostname;
        const isPrivateIp =
            fmHost === 'localhost' ||
            fmHost === '127.0.0.1' ||
            fmHost === '::1' ||
            fmHost.startsWith('10.') ||
            fmHost.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(fmHost);

        if (!isPrivateIp) {
            // Accessed via domain name — probe device to check LAN reachability.
            // Uses a short fetch with timeout; if unreachable, show helpful error.
            try {
                const probe = new AbortController();
                const timer = setTimeout(() => probe.abort(), 3000);
                await fetch(deviceUrl, {
                    mode: 'no-cors',
                    signal: probe.signal
                });
                clearTimeout(timer);
            } catch {
                error.value =
                    `Cannot reach device at ${data.deviceIp}. ` +
                    'Make sure your browser is on the same network as the device. ' +
                    'The device GUI requires direct LAN access.';
                return;
            }
        }

        guiUrl.value = deviceUrl;
        proxyMethod.value = 'direct';
        console.log(
            '[DeviceWebGuiModal] Opening device GUI (direct LAN): %s',
            guiUrl.value
        );
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

function formatUptime(seconds: number | null): string {
    if (seconds == null) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

const isHttpsPage = window.location.protocol === 'https:';

async function probeBrowserReachability(ip: string) {
    // HTTPS pages block fetch to http:// as mixed content — probe would
    // always fail, giving a misleading "Unreachable" result.
    if (isHttpsPage) {
        browserProbe.value = {
            reachable: false,
            elapsed: 0,
            error: 'skipped — mixed content blocked by browser (HTTPS → HTTP)'
        };
        return;
    }

    browserProbe.value = 'probing';
    const start = Date.now();
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        await fetch(`http://${ip}/`, {mode: 'no-cors', signal: ctrl.signal});
        clearTimeout(timer);
        browserProbe.value = {reachable: true, elapsed: Date.now() - start};
    } catch (e: any) {
        browserProbe.value = {
            reachable: false,
            elapsed: Date.now() - start,
            error: e.name === 'AbortError' ? 'timeout (4s)' : e.message
        };
    }
}

async function runDiagnostics(advanced = false) {
    diagLoading.value = true;
    if (!advanced) {
        diagResult.value = null;
        browserProbe.value = null;
    }
    diagError.value = null;

    try {
        const token = await getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        const query = advanced ? '?advanced=true' : '';
        const response = await fetch(
            `/api/device-proxy/${props.shellyID}/gui-debug${query}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                signal: abortController?.signal
            }
        );

        if (!response.ok) {
            const text = await response.text();
            if (response.status === 404) {
                throw new Error('Device no longer connected to Fleet Manager');
            }
            throw new Error(`HTTP ${response.status}: ${text}`);
        }

        const data = await response.json();
        diagResult.value = data;

        // Run browser → device probe in parallel (non-blocking)
        if (data.deviceIp && !advanced) {
            probeBrowserReachability(data.deviceIp);
        }
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
