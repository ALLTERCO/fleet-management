<template>
    <div class="cfg-panel webhooks-panel">
        <div class="cfg-panel__row">
            <span class="cfg-panel__list-count">
                {{ hooks.length }} webhook{{ hooks.length === 1 ? '' : 's' }}
            </span>
            <div class="cfg-panel__list-actions">
                <Button type="green" size="sm" @click="openCreate">
                    New webhook
                </Button>
                <Button
                    type="blue-hollow"
                    size="sm"
                    :loading="loading"
                    @click="loadHooks"
                >
                    Refresh
                </Button>
            </div>
        </div>

        <div
            v-if="error"
            class="cfg-panel__notice cfg-panel__notice--error cfg-panel__notice--split"
            role="alert"
        >
            <span>
                <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                {{ error }}
            </span>
            <Button
                type="blue-hollow"
                size="sm"
                :loading="loading"
                @click="loadHooks"
            >
                Retry
            </Button>
        </div>

        <section
            v-if="formOpen"
            class="cfg-panel__workspace-section webhooks-panel__editor"
            :aria-label="formTitle"
        >
            <strong class="webhooks-panel__editor-title">
                {{ formTitle }}
            </strong>

            <div class="cfg-panel__field-grid">
                <label class="cfg-panel__field" :for="`${uid}-name`">
                    <strong>Name (optional)</strong>
                    <input
                        :id="`${uid}-name`"
                        v-model="form.name"
                        class="cfg-panel__workspace-input webhooks-panel__name"
                        placeholder="Notify gateway"
                        @input="markFormDirty"
                    />
                </label>
                <label class="cfg-panel__field" :for="`${uid}-event`">
                    <strong>Event</strong>
                    <input
                        :id="`${uid}-event`"
                        v-model="form.event"
                        :list="`${uid}-events`"
                        class="cfg-panel__workspace-input webhooks-panel__event"
                        placeholder="switch.on"
                        @input="markFormDirty"
                    />
                </label>
                <label class="cfg-panel__field" :for="`${uid}-cid`">
                    <strong>Channel</strong>
                    <input
                        :id="`${uid}-cid`"
                        v-model.number="form.cid"
                        type="number"
                        min="0"
                        step="1"
                        class="cfg-panel__workspace-input webhooks-panel__cid"
                        @input="markFormDirty"
                    />
                    <span class="cfg-panel__field-help">
                        Component instance the event comes from, usually 0.
                    </span>
                </label>
                <label
                    class="cfg-panel__field cfg-panel__field--wide"
                    :for="`${uid}-urls`"
                >
                    <strong>URLs</strong>
                    <textarea
                        :id="`${uid}-urls`"
                        v-model="form.urls"
                        rows="3"
                        class="cfg-panel__workspace-input webhooks-panel__urls"
                        placeholder="http://192.168.1.5/notify"
                        @input="markFormDirty"
                    />
                    <span class="cfg-panel__field-help">
                        One URL per line, up to 5.
                    </span>
                </label>
            </div>
            <datalist :id="`${uid}-events`">
                <option
                    v-for="event in supportedEvents"
                    :key="event"
                    :value="event"
                />
            </datalist>

            <div class="webhooks-panel__editor-enable">
                <span class="webhooks-panel__editor-enable-label">Enabled</span>
                <CardToggle size="row"
                    v-model="form.enable"
                    aria-label="Enabled"
                    @update:model-value="markFormDirty"
                />
            </div>

            <div
                v-if="formError"
                class="cfg-panel__notice cfg-panel__notice--error"
            >
                <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                {{ formError }}
            </div>

            <div class="webhooks-panel__editor-actions">
                <Button
                    type="blue"
                    size="sm"
                    :loading="saving"
                    @click="saveForm"
                >
                    Save
                </Button>
                <Button type="blue-hollow" size="sm" @click="closeForm">
                    Cancel
                </Button>
            </div>
        </section>

        <div
            v-if="!hooks.length && !loading && !error && !formOpen"
            class="cfg-panel__empty"
        >
            <i class="fas fa-paper-plane" aria-hidden="true" />
            <strong>No webhooks yet</strong>
            <span>HTTP calls the device sends when events happen.</span>
            <Button type="green" size="sm" @click="openCreate">
                New webhook
            </Button>
        </div>

        <div v-if="hooks.length" class="cfg-panel__section">
        <div
            v-for="hook in hooks"
            :key="hook.id"
            class="cfg-panel__row cfg-panel__row--link"
            role="button"
            tabindex="0"
            :aria-label="`Edit webhook ${hookTitle(hook)}`"
            @click="openEdit(hook)"
            @keydown.enter.prevent="openEdit(hook)"
            @keydown.space.prevent="openEdit(hook)"
        >
            <div class="cfg-panel__row-label">
                <strong>{{ hookTitle(hook) }}</strong>
                <span>{{ hookSubtitle(hook) }}</span>
                <span
                    v-for="url in hook.urls ?? []"
                    :key="url"
                    class="cfg-panel__list-mono webhooks-panel__url"
                >
                    {{ url }}
                </span>
            </div>
            <div class="cfg-panel__list-actions" @click.stop>
                <CardToggle size="row"
                    :model-value="hook.enable === true"
                    :aria-label="`Enable webhook ${hookTitle(hook)}`"
                    @update:model-value="(v: boolean) => setEnable(hook, v)"
                />
                <Button
                    type="red"
                    size="xs"
                    :loading="busy.has(hook.id)"
                    @click="confirmDelete(hook)"
                >
                    Delete
                </Button>
            </div>
            <i class="fas fa-chevron-right cfg-panel__row-chevron" aria-hidden="true" />
        </div>

        </div>

        <p class="cfg-panel__field-help webhooks-panel__hint">
            The device sends these HTTP calls itself when the event happens.
        </p>

        <ConfirmationModal ref="deleteConfirm" />
    </div>
</template>

<script setup lang="ts">
import type {WebhookCreateParams} from '@api/webhook';
import {computed, onMounted, reactive, ref, useId, watch} from 'vue';
import {useSettingsDirtySource} from '@/composables/useSettingsDirtyTracker';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import CardToggle from '../cards/CardToggle.vue';
import ConfirmationModal from '../modals/ConfirmationModal.vue';
import Button from './Button.vue';

// Device rule: a webhook calls at most 5 URLs.
const MAX_WEBHOOK_URLS = 5;

// Shape of one entry in the device's Webhook.List response (passthrough).
interface WebhookHook {
    id: number;
    cid?: number;
    enable?: boolean;
    event?: string;
    name?: string | null;
    urls?: string[];
}

const props = defineProps<{shellyID: string}>();
const toast = useToastStore();
const uid = useId();

const hooks = ref<WebhookHook[]>([]);
const busy = reactive(new Set<number>());
const loading = ref(false);
const error = ref<string | null>(null);
const deleteConfirm = ref<InstanceType<typeof ConfirmationModal> | null>(null);
let requestGeneration = 0;

const formOpen = ref(false);
const formDirty = ref(false);
const formError = ref<string | null>(null);
const saving = ref(false);
const editingId = ref<number | null>(null);
const form = reactive<{
    name: string;
    event: string;
    cid: number | '';
    urls: string;
    enable: boolean;
}>({
    name: '',
    event: '',
    cid: 0,
    urls: '',
    enable: true
});

const supportedEvents = ref<string[]>([]);
let supportedLoadedFor: string | null = null;

useSettingsDirtySource(
    'config:webhook',
    'device-config:webhook-editor',
    formDirty
);

const formTitle = computed(() =>
    editingId.value === null ? 'New webhook' : 'Edit webhook'
);

async function loadHooks(): Promise<void> {
    const generation = ++requestGeneration;
    loading.value = true;
    error.value = null;
    try {
        const response = await sendRPC<{hooks?: WebhookHook[]}>(
            'FLEET_MANAGER',
            'webhook.List',
            {shellyID: props.shellyID}
        );
        if (generation !== requestGeneration) return;
        hooks.value = Array.isArray(response?.hooks) ? response.hooks : [];
    } catch (err: unknown) {
        if (generation !== requestGeneration) return;
        error.value = rpcErrorMessage(err);
    } finally {
        if (generation === requestGeneration) loading.value = false;
    }
}

// Older firmwares answer {hook_types: string[]}, newer ones
// {types: {eventName: {...}}} — accept both, ignore anything else.
function extractEventTypes(response: unknown): string[] {
    if (!response || typeof response !== 'object') return [];
    const {hook_types, types} = response as {
        hook_types?: unknown;
        types?: unknown;
    };
    if (Array.isArray(hook_types)) {
        return hook_types.filter(
            (entry): entry is string => typeof entry === 'string'
        );
    }
    if (types && typeof types === 'object' && !Array.isArray(types)) {
        return Object.keys(types);
    }
    return [];
}

async function loadSupportedEvents(): Promise<void> {
    if (supportedLoadedFor === props.shellyID) return;
    supportedLoadedFor = props.shellyID;
    try {
        const response = await sendRPC<unknown>(
            'FLEET_MANAGER',
            'webhook.ListSupported',
            {shellyID: props.shellyID}
        );
        supportedEvents.value = extractEventTypes(response);
    } catch (err: unknown) {
        supportedLoadedFor = null;
        toast.error(rpcErrorMessage(err));
    }
}

function hookTitle(hook: WebhookHook): string {
    return hook.name || hook.event || `Webhook ${hook.id}`;
}

function hookSubtitle(hook: WebhookHook): string {
    const parts: string[] = [];
    if (hook.event) parts.push(hook.event);
    if (hook.cid !== undefined) parts.push(`channel ${hook.cid}`);
    return parts.join(' · ');
}

function markFormDirty(): void {
    formDirty.value = true;
}

function openCreate(): void {
    editingId.value = null;
    form.name = '';
    form.event = '';
    form.cid = 0;
    form.urls = '';
    form.enable = true;
    formError.value = null;
    formDirty.value = false;
    formOpen.value = true;
    void loadSupportedEvents();
}

function openEdit(hook: WebhookHook): void {
    editingId.value = hook.id;
    form.name = hook.name ?? '';
    form.event = hook.event ?? '';
    form.cid = hook.cid ?? 0;
    form.urls = (hook.urls ?? []).join('\n');
    form.enable = hook.enable === true;
    formError.value = null;
    formDirty.value = false;
    formOpen.value = true;
    void loadSupportedEvents();
}

function closeForm(): void {
    formOpen.value = false;
    editingId.value = null;
    formError.value = null;
    formDirty.value = false;
}

function buildFormPayload(): WebhookCreateParams | null {
    const event = form.event.trim();
    if (!event) {
        formError.value = 'Event is required.';
        return null;
    }
    const cid = form.cid;
    if (typeof cid !== 'number' || !Number.isInteger(cid) || cid < 0) {
        formError.value = 'Channel must be a whole number of 0 or more.';
        return null;
    }
    const urls = form.urls
        .split('\n')
        .map((url) => url.trim())
        .filter((url) => url.length > 0);
    if (!urls.length) {
        formError.value = 'Enter at least one URL.';
        return null;
    }
    if (urls.length > MAX_WEBHOOK_URLS) {
        formError.value = `A webhook can call at most ${MAX_WEBHOOK_URLS} URLs.`;
        return null;
    }
    formError.value = null;
    const payload: WebhookCreateParams = {
        shellyID: props.shellyID,
        cid,
        event,
        urls,
        enable: form.enable
    };
    const name = form.name.trim();
    if (name) payload.name = name;
    return payload;
}

async function saveForm(): Promise<void> {
    const payload = buildFormPayload();
    if (!payload) return;
    saving.value = true;
    try {
        if (editingId.value === null) {
            await sendRPC('FLEET_MANAGER', 'webhook.Create', payload);
            toast.success('Webhook created');
        } else {
            await sendRPC('FLEET_MANAGER', 'webhook.Update', {
                ...payload,
                id: editingId.value
            });
            toast.success('Webhook updated');
        }
        closeForm();
        await loadHooks();
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    } finally {
        saving.value = false;
    }
}

async function setEnable(hook: WebhookHook, enable: boolean): Promise<void> {
    // Optimistic flip — the toggle renders from its prop, so
    // waiting for the device reply would visually bounce the click back.
    const previous = hook.enable;
    hook.enable = enable;
    busy.add(hook.id);
    try {
        await sendRPC('FLEET_MANAGER', 'webhook.Update', {
            shellyID: props.shellyID,
            id: hook.id,
            enable
        });
    } catch (err: unknown) {
        hook.enable = previous;
        toast.error(rpcErrorMessage(err));
    } finally {
        busy.delete(hook.id);
    }
}

function confirmDelete(hook: WebhookHook): void {
    deleteConfirm.value?.storeAction(() => performDelete(hook.id), {
        title: `Delete ${hookTitle(hook)}?`,
        message: 'The webhook is removed from the device.',
        confirmLabel: 'Delete'
    });
}

async function performDelete(id: number): Promise<void> {
    busy.add(id);
    try {
        await sendRPC('FLEET_MANAGER', 'webhook.Delete', {
            shellyID: props.shellyID,
            id
        });
        hooks.value = hooks.value.filter((hook) => hook.id !== id);
        toast.success('Webhook deleted');
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    } finally {
        busy.delete(id);
    }
}

onMounted(loadHooks);
watch(
    () => props.shellyID,
    () => {
        hooks.value = [];
        error.value = null;
        supportedEvents.value = [];
        supportedLoadedFor = null;
        closeForm();
        void loadHooks();
    }
);
</script>

<style scoped>
.webhooks-panel__hint {
    padding: var(--space-2) var(--space-3);
}

.webhooks-panel__url {
    display: block;
    overflow-wrap: anywhere;
}

.webhooks-panel__editor {
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: var(--space-px) solid var(--color-border-medium);
}

.webhooks-panel__editor-title {
    padding: var(--space-2) var(--space-3) 0;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.webhooks-panel__editor-enable {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-target-min);
    padding: 0 var(--space-3);
}

.webhooks-panel__editor-enable-label {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
}

.webhooks-panel__urls {
    font-family: var(--font-mono);
    resize: vertical;
}

.webhooks-panel__editor-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: 0 var(--space-3);
}
</style>
