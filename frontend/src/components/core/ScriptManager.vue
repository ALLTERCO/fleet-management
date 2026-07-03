<template>
    <div class="cfg-panel">
        <div class="script-mgr__toolbar">
            <span class="script-mgr__count">
                {{ scripts.length }} script{{ scripts.length === 1 ? '' : 's' }}
            </span>
            <Button type="blue-hollow" size="sm" :loading="loading" @click="loadScripts">
                Refresh
            </Button>
            <Button
                type="green"
                size="sm"
                :loading="creating"
                title="New script"
                aria-label="New script"
                @click="createScript"
            >
                <i class="fas fa-plus" aria-hidden="true" />
            </Button>
        </div>

        <div
            v-if="error"
            class="cfg-panel__notice cfg-panel__notice--error"
        >
            <i class="fas fa-triangle-exclamation" /> {{ error }}
        </div>

        <div v-if="!scripts.length && !loading" class="cfg-panel__error">
            <p>No scripts on this device.</p>
        </div>

        <div
            v-for="script in scripts"
            :key="script.id"
            class="script-mgr__item"
        >
            <div
                class="script-mgr__header"
                @click="toggleExpand(script.id)"
            >
                <i
                    class="fas script-mgr__chevron"
                    :class="
                        expanded.has(script.id)
                            ? 'fa-chevron-down'
                            : 'fa-chevron-right'
                    "
                />
                <span class="script-mgr__name">{{ script.name }}</span>
                <span
                    class="script-mgr__badge"
                    :class="{
                        'script-mgr__badge--running': script.running,
                        'script-mgr__badge--enabled':
                            script.enable && !script.running,
                        'script-mgr__badge--off':
                            !script.enable && !script.running
                    }"
                >
                    {{
                        script.running
                            ? 'Running'
                            : script.enable
                              ? 'Enabled'
                              : 'Stopped'
                    }}
                </span>
                <Button
                    v-if="script.running"
                    type="blue-hollow"
                    size="xs"
                    :loading="busy.has(script.id)"
                    @click.stop="stopScript(script.id)"
                >
                    Stop
                </Button>
                <Button
                    v-else
                    type="blue"
                    size="xs"
                    :loading="busy.has(script.id)"
                    @click.stop="startScript(script.id)"
                >
                    Start
                </Button>
            </div>

            <div v-if="expanded.has(script.id)" class="script-mgr__body">
                <div class="cfg-panel__row">
                    <div class="cfg-panel__row-label">
                        <strong>Name</strong>
                    </div>
                    <input
                        :value="script.name"
                        type="text"
                        class="cfg-panel__input"
                        readonly
                    />
                </div>

                <div class="cfg-panel__row">
                    <div class="cfg-panel__row-label">
                        <strong>Auto-start on boot</strong>
                    </div>
                    <Checkbox
                        :model-value="script.enable"
                        @update:model-value="
                            (v: boolean) => saveEnable(script, v)
                        "
                    />
                </div>

                <div
                    v-if="status[script.id] || statusFailed.has(script.id)"
                    class="script-mgr__status"
                >
                    <template v-if="statusFailed.has(script.id)">
                        Status unavailable
                    </template>
                    <template v-else-if="status[script.id]">
                        <span v-if="status[script.id]?.mem_used != null">
                            Memory: {{ status[script.id]?.mem_used }} used,
                            {{ status[script.id]?.mem_peak }} peak,
                            {{ status[script.id]?.mem_free }} free (bytes)
                        </span>
                        <span v-if="status[script.id]?.cpu != null">
                            · CPU: {{ status[script.id]?.cpu }}%
                        </span>
                        <span
                            v-if="status[script.id]?.errors?.length"
                            class="script-mgr__errors"
                        >
                            · Errors:
                            {{
                                (status[script.id]?.errors ?? []).join(', ')
                            }}
                        </span>
                    </template>
                </div>

                <div class="script-mgr__code">
                    <div class="script-mgr__code-header">
                        <strong>Code</strong>
                        <Button
                            type="blue-hollow"
                            size="xs"
                            :loading="codeLoading.has(script.id)"
                            @click="loadCode(script.id)"
                        >
                            Load
                        </Button>
                        <Button
                            type="blue"
                            size="xs"
                            :loading="codeSaving.has(script.id)"
                            @click="saveCode(script.id)"
                        >
                            Save
                        </Button>
                    </div>
                    <textarea
                        v-model="code[script.id]"
                        class="script-mgr__editor"
                        placeholder="JavaScript code…"
                        spellcheck="false"
                    />
                </div>

                <div class="script-mgr__footer">
                    <Button
                        type="red"
                        size="sm"
                        :loading="busy.has(script.id)"
                        @click="deleteScript(script.id)"
                    >
                        Delete
                    </Button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {onMounted, reactive, ref, watch} from 'vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import Button from './Button.vue';
import Checkbox from './Checkbox.vue';

interface ScriptInfo {
    id: number;
    name: string;
    enable: boolean;
    running: boolean;
}

interface ScriptStatus {
    id: number;
    mem_used?: number;
    mem_peak?: number;
    mem_free?: number;
    cpu?: number;
    errors?: string[];
}

interface PutCodeResponse {
    len?: number;
}

const PUT_CODE_CHUNK_BYTES = 1024;
const GET_CODE_MAX_CHUNKS = 1024;
const GET_CODE_MAX_BYTES = 256 * 1024;

const props = defineProps<{shellyID: string}>();
const toast = useToastStore();

const scripts = ref<ScriptInfo[]>([]);
const status = reactive<Record<number, ScriptStatus>>({});
const statusFailed = reactive(new Set<number>());
const code = reactive<Record<number, string>>({});
const expanded = reactive(new Set<number>());
const busy = reactive(new Set<number>());
const codeLoading = reactive(new Set<number>());
const codeSaving = reactive(new Set<number>());
const loading = ref(false);
const creating = ref(false);
const error = ref<string | null>(null);

async function loadScripts(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        const resp = await sendRPC<{scripts?: ScriptInfo[]}>(
            'FLEET_MANAGER',
            'Script.List',
            {shellyID: props.shellyID}
        );
        scripts.value = resp?.scripts ?? [];
        for (const s of scripts.value) {
            void loadStatus(s.id);
        }
    } catch (err: unknown) {
        error.value = rpcErrorMessage(err);
    } finally {
        loading.value = false;
    }
}

async function loadStatus(id: number): Promise<void> {
    try {
        const resp = await sendRPC<ScriptStatus & {running?: boolean}>(
            'FLEET_MANAGER',
            'Script.GetStatus',
            {shellyID: props.shellyID, id}
        );
        const {running: _running, ...telemetry} = resp;
        status[id] = telemetry;
        statusFailed.delete(id);
    } catch (err: unknown) {
        statusFailed.add(id);
        console.warn(
            `[ScriptManager] Script.GetStatus failed for id=${id}:`,
            err
        );
    }
}

async function createScript(): Promise<void> {
    creating.value = true;
    error.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Script.Create', {
            shellyID: props.shellyID
        });
        toast.success('Script created');
        await loadScripts();
    } catch (err: unknown) {
        error.value = rpcErrorMessage(err);
    } finally {
        creating.value = false;
    }
}

async function deleteScript(id: number): Promise<void> {
    if (!window.confirm(`Delete script ${id}?`)) return;
    busy.add(id);
    try {
        await sendRPC('FLEET_MANAGER', 'Script.Delete', {
            shellyID: props.shellyID,
            id
        });
        scripts.value = scripts.value.filter((s) => s.id !== id);
        delete status[id];
        delete code[id];
        statusFailed.delete(id);
        expanded.delete(id);
        toast.success('Script deleted');
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    } finally {
        busy.delete(id);
    }
}

async function startScript(id: number): Promise<void> {
    busy.add(id);
    try {
        await sendRPC('FLEET_MANAGER', 'Script.Start', {
            shellyID: props.shellyID,
            id
        });
        const s = scripts.value.find((s) => s.id === id);
        if (s) s.running = true;
        await loadStatus(id);
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    } finally {
        busy.delete(id);
    }
}

async function stopScript(id: number): Promise<void> {
    busy.add(id);
    try {
        await sendRPC('FLEET_MANAGER', 'Script.Stop', {
            shellyID: props.shellyID,
            id
        });
        const s = scripts.value.find((s) => s.id === id);
        if (s) s.running = false;
        await loadStatus(id);
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    } finally {
        busy.delete(id);
    }
}

async function saveEnable(s: ScriptInfo, enable: boolean): Promise<void> {
    busy.add(s.id);
    try {
        await sendRPC('FLEET_MANAGER', 'Script.SetConfig', {
            shellyID: props.shellyID,
            id: s.id,
            config: {enable}
        });
        s.enable = enable;
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    } finally {
        busy.delete(s.id);
    }
}

function toggleExpand(id: number): void {
    if (expanded.has(id)) {
        expanded.delete(id);
        return;
    }
    expanded.add(id);
    if (code[id] === undefined) void loadCode(id);
}

async function loadCode(id: number): Promise<void> {
    codeLoading.add(id);
    try {
        let offset = 0;
        let result = '';
        for (let i = 0; i < GET_CODE_MAX_CHUNKS; i++) {
            const resp = await sendRPC<{data?: string; left?: number}>(
                'FLEET_MANAGER',
                'Script.GetCode',
                {shellyID: props.shellyID, id, offset}
            );
            const chunk = resp?.data ?? '';
            const left = resp?.left ?? 0;
            result += chunk;
            if (result.length > GET_CODE_MAX_BYTES) {
                throw new Error(
                    `Script exceeds ${GET_CODE_MAX_BYTES} bytes — refusing to load`
                );
            }
            if (left <= 0 || !chunk) break;
            offset += chunk.length;
        }
        code[id] = result;
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    } finally {
        codeLoading.delete(id);
    }
}

async function saveCode(id: number): Promise<void> {
    const source = code[id];
    if (!source) {
        toast.error('Load the script code before saving.');
        return;
    }
    codeSaving.add(id);
    const s = scripts.value.find((s) => s.id === id);
    const wasRunning = !!s?.running;
    let stopped = false;
    try {
        if (wasRunning) {
            await sendRPC('FLEET_MANAGER', 'Script.Stop', {
                shellyID: props.shellyID,
                id
            });
            if (s) s.running = false;
            stopped = true;
        }
        await putCodeChunked(id, source);
        toast.success(
            wasRunning
                ? 'Code saved (script was stopped; restart manually)'
                : 'Code saved'
        );
    } catch (err: unknown) {
        const base = rpcErrorMessage(err);
        toast.error(
            stopped
                ? `${base} — script was stopped before failure; restart manually when ready`
                : base
        );
    } finally {
        codeSaving.delete(id);
    }
}

async function putCodeChunked(id: number, source: string): Promise<void> {
    // Script.PutCode rejects length=0 — treat empty source as no-op.
    if (source.length === 0) return;
    let offset = 0;
    let append = false;
    while (offset < source.length) {
        const chunk = source.slice(offset, offset + PUT_CODE_CHUNK_BYTES);
        await sendRPC<PutCodeResponse>('FLEET_MANAGER', 'Script.PutCode', {
            shellyID: props.shellyID,
            id,
            code: chunk,
            append
        });
        offset += chunk.length;
        append = true;
    }
}

onMounted(loadScripts);
watch(
    () => props.shellyID,
    () => {
        scripts.value = [];
        for (const k of Object.keys(status)) delete status[Number(k)];
        for (const k of Object.keys(code)) delete code[Number(k)];
        statusFailed.clear();
        expanded.clear();
        void loadScripts();
    }
);
</script>

<style scoped>
.script-mgr__toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
}
.script-mgr__count {
    flex: 1;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.script-mgr__item {
    border-top: 1px solid var(--color-border-subtle);
}
.script-mgr__header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
}
.script-mgr__header:hover {
    background: var(--state-hover-bg);
}
.script-mgr__chevron {
    color: var(--color-text-tertiary);
    width: var(--space-3);
}
.script-mgr__name {
    flex: 1;
    font-family: var(--font-mono, monospace);
    font-size: var(--type-caption);
    color: var(--color-text-primary);
}
.script-mgr__badge {
    padding: var(--space-px) var(--space-2);
    border-radius: var(--radius-2xl);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
.script-mgr__badge--running {
    background: rgba(var(--color-success-rgb), 0.15);
    color: var(--color-success-text);
}
.script-mgr__badge--enabled {
    background: rgba(var(--color-primary-rgb), 0.15);
    color: var(--color-primary-text);
}
.script-mgr__badge--off {
    background: var(--color-surface-3);
    color: var(--color-text-tertiary);
}
.script-mgr__body {
    padding-bottom: var(--space-2);
}
.script-mgr__status {
    padding: var(--space-2) var(--space-3);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.script-mgr__errors {
    color: var(--color-danger-text);
}
.script-mgr__code {
    padding: var(--space-2) var(--space-3);
}
.script-mgr__code-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
    font-size: var(--type-caption);
    color: var(--color-text-primary);
}
.script-mgr__code-header strong {
    flex: 1;
}
.script-mgr__editor {
    width: 100%;
    min-height: 12rem;
    padding: var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-caption);
    line-height: 1.4;
    resize: vertical;
}
.script-mgr__footer {
    display: flex;
    justify-content: flex-end;
    padding: var(--space-2) var(--space-3);
}
</style>
