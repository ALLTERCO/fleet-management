<template>
    <div class="esb">
        <!-- ─── Server card ────────────────────────────────────────────
             One card, three zones:
               row 1: preset selector (label + dropdown) on the left,
                      resolved "host:port · TLS" badge on the right
               row 2: a single hint/warning line (only if the preset has one)
               row 3: (only when "Custom") Host / Port / Implicit-TLS inline
             Collapses to stacked on narrow viewports. -->
        <section class="esb__server" aria-labelledby="esb-server-hdr">
            <header class="esb__server-hdr">
                <span class="esb__server-label">
                    <i class="fas fa-server esb__server-icon" />
                    <span id="esb-server-hdr">SMTP server</span>
                </span>
                <div class="esb__server-row">
                    <div class="esb__select-wrap">
                        <Dropdown
                            :groups="dropdownGroups"
                            :default="preset"
                            searchable
                            @selected="onPresetChange"
                        />
                    </div>
                    <span
                        v-if="!isCustomPreset && selectedPreset"
                        class="esb__server-host"
                    >
                        <code>{{ selectedPreset.host }}:{{ selectedPreset.port }}</code>
                        <span class="esb__server-tls">
                            {{ selectedPreset.secure ? 'Implicit TLS' : 'STARTTLS' }}
                        </span>
                    </span>
                </div>
            </header>

            <p
                v-if="serverHint"
                class="esb__server-hint"
                :class="{'esb__server-hint--warn': serverHintIsWarning}"
            >
                <i
                    class="fas"
                    :class="serverHintIsWarning
                        ? 'fa-triangle-exclamation'
                        : 'fa-circle-info'"
                />
                <span>{{ serverHint }}</span>
                <a
                    v-if="selectedPreset?.docsUrl"
                    class="esb__doc-link"
                    :href="selectedPreset.docsUrl"
                    target="_blank"
                    rel="noopener"
                >
                    Docs <i class="fas fa-external-link" />
                </a>
            </p>

            <!-- Custom preset — Host | Port | TLS in one tight row -->
            <div v-if="isCustomPreset" class="esb__custom-row">
                <div class="esb__custom-host">
                    <Input
                        v-model="hostProxy"
                        label="Host *"
                        placeholder="smtp.example.com"
                    />
                </div>
                <div class="esb__custom-port">
                    <Input
                        v-model="portProxy"
                        label="Port *"
                        type="number"
                        :min="1"
                        :max="65535"
                        placeholder="587"
                    />
                </div>
                <div class="esb__custom-tls">
                    <Checkbox
                        v-model="secureProxy"
                        label="Implicit TLS"
                        hint="Port 465 = on. STARTTLS otherwise."
                    />
                </div>
            </div>
        </section>

        <section class="esb__section">
            <header class="esb__section-hdr">
                <h3 class="esb__section-title">Sender identity</h3>
                <p class="esb__section-desc">
                    <b>From</b> is the address that appears in the recipient's
                    inbox. <b>Reply-to</b> is optional and directs replies elsewhere.
                </p>
            </header>
            <div class="esb__grid">
                <div class="esb__field">
                    <Input
                        v-model="fromProxy"
                        label="From address *"
                        type="email"
                        placeholder="alerts@acme.com"
                    />
                </div>
                <div class="esb__field">
                    <Input
                        v-model="fromNameProxy"
                        label="Display name"
                        placeholder="Acme Alerts"
                    />
                </div>
                <div class="esb__field esb__field--wide">
                    <Input
                        v-model="replyToProxy"
                        label="Reply-to (optional)"
                        type="email"
                        placeholder="ops@acme.com"
                    />
                </div>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import type {ChannelProviderDescriptor} from '@api/channel';
import {computed} from 'vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Input from '@/components/core/Input.vue';

type PresetCategory =
    | 'personal'
    | 'workspace'
    | 'transactional'
    | 'regional'
    | 'custom';

interface SmtpPreset {
    key: string;
    label: string;
    category: PresetCategory;
    host: string;
    port: number;
    secure: boolean;
    appPasswordOnly?: boolean;
    oauthRequired?: boolean;
    notes?: string;
    docsUrl?: string;
}

const config = defineModel<Record<string, unknown>>({required: true});

const props = defineProps<{
    descriptor: ChannelProviderDescriptor;
}>();

const presets = computed<SmtpPreset[]>(() => {
    const raw = (props.descriptor as unknown as {smtpPresets?: SmtpPreset[]})
        .smtpPresets;
    return Array.isArray(raw) ? raw : [];
});

const PRESET_CATEGORY_ORDER: PresetCategory[] = [
    'personal',
    'workspace',
    'transactional',
    'regional',
    'custom'
];

const PRESET_CATEGORY_LABELS: Record<PresetCategory, string> = {
    personal: 'Personal mailboxes',
    workspace: 'Workspace / business',
    transactional: 'Transactional relays',
    regional: 'Regional providers',
    custom: 'Custom'
};

const groupedPresets = computed(() =>
    PRESET_CATEGORY_ORDER.flatMap((key) => {
        const items = presets.value.filter((p) => p.category === key);
        if (items.length === 0) return [];
        return [{key, label: PRESET_CATEGORY_LABELS[key], items}];
    })
);

// Adapter for Dropdown's `groups` prop. The dropdown stores the preset key
// as the value and shows the human label.
const dropdownGroups = computed(() =>
    groupedPresets.value.map((g) => ({
        label: g.label,
        items: g.items.map((p) => ({value: p.key, label: p.label}))
    }))
);

const preset = computed(() => (config.value.preset as string) ?? 'custom');
const selectedPreset = computed(() =>
    presets.value.find((p) => p.key === preset.value)
);
const isCustomPreset = computed(() => preset.value === 'custom');

// Single hint line under the server row. Priority:
//   1. App-password warning (Gmail etc)
//   2. OAuth requirement
//   3. Preset notes (informational)
// Keeps the zone to one line instead of stacking 2-3 paragraphs.
const serverHint = computed(() => {
    const p = selectedPreset.value;
    if (!p) return undefined;
    if (p.appPasswordOnly) {
        return "Requires an app password — account password won't work.";
    }
    if (p.oauthRequired) {
        return 'Requires OAuth2 — pick it on the Authentication tab.';
    }
    return p.notes;
});

const serverHintIsWarning = computed(() => {
    const p = selectedPreset.value;
    return !!(p?.appPasswordOnly || p?.oauthRequired);
});

function onPresetChange(next: string) {
    const p = presets.value.find((x) => x.key === next);
    const patch: Record<string, unknown> = {preset: next};
    if (p && next !== 'custom') {
        patch.host = undefined;
        patch.port = undefined;
        patch.secure = undefined;
    } else if (next === 'custom' && p) {
        patch.host = p.host;
        patch.port = p.port;
        patch.secure = p.secure;
    }
    mergeConfig(patch);
}

function mergeConfig(patch: Record<string, unknown>) {
    const next = {...config.value};
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
    }
    config.value = next;
}

function str(path: string): string {
    const v = config.value[path];
    return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function setString(path: string, value: string) {
    mergeConfig({[path]: value || undefined});
}

function num(path: string): string {
    const v = config.value[path];
    return typeof v === 'number' ? String(v) : '';
}

function setNumber(path: string, value: string | number) {
    const n = typeof value === 'number' ? value : Number(value);
    mergeConfig({[path]: Number.isFinite(n) && n > 0 ? n : undefined});
}

function bool(path: string): boolean {
    return config.value[path] === true;
}

function setBool(path: string, value: boolean) {
    mergeConfig({[path]: value});
}

const hostProxy = computed({
    get: () => str('host'),
    set: (v: string | number) => setString('host', String(v))
});
const portProxy = computed({
    get: () => num('port'),
    set: (v: string | number) => setNumber('port', v)
});
const secureProxy = computed({
    get: () => bool('secure'),
    set: (v: boolean) => setBool('secure', v)
});
const fromProxy = computed({
    get: () => str('from'),
    set: (v: string | number) => setString('from', String(v))
});
const fromNameProxy = computed({
    get: () => str('fromName'),
    set: (v: string | number) => setString('fromName', String(v))
});
const replyToProxy = computed({
    get: () => str('replyTo'),
    set: (v: string | number) => setString('replyTo', String(v))
});
</script>

<style scoped>
.esb {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}

.esb__section {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}

.esb__section-hdr {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.esb__section-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.esb__section-desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.45;
    max-width: 60ch;
}

/* ─── Server card ───────────────────────────────────────────────────── */

/* No inner surface — would nest a --radius-md card inside the
   form-panel's --radius-md, producing double corners. Use a top
   divider + padding to keep rhythm. */
.esb__server {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding: var(--gap-xs) 0;
}

.esb__server-hdr {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--gap-sm) var(--gap-md);
    align-items: center;
}

.esb__server-label {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    white-space: nowrap;
}

.esb__server-icon {
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-sm);
}

.esb__server-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    flex-wrap: wrap;
    min-width: 0;
}

.esb__select-wrap {
    flex: 0 1 18rem;
    min-width: 14rem;
}

.esb__server-host {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--space-1) var(--gap-sm);
    background: var(--color-surface-3);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}

.esb__server-host code {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
}

.esb__server-tls {
    padding: 0 var(--gap-xs);
    background: rgba(var(--color-primary-rgb), 0.18);
    color: var(--color-primary-text);
    border-radius: var(--radius-full);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}

.esb__server-hint {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.45;
    flex-wrap: wrap;
}

.esb__server-hint--warn {
    color: var(--color-warning-text);
}

.esb__custom-row {
    display: grid;
    grid-template-columns: minmax(0, 1.618fr) minmax(0, 1fr) auto;
    gap: var(--gap-sm) var(--gap-md);
    align-items: end;
    padding-top: var(--space-1);
    border-top: 1px solid var(--color-border-subtle);
}

.esb__custom-host {
    min-width: 0;
}

.esb__custom-port {
    min-width: 0;
}

.esb__custom-tls {
    align-self: center;
    min-width: 10rem;
}

@media (max-width: 720px) {
    .esb__server-hdr {
        grid-template-columns: 1fr;
    }
    .esb__select-wrap {
        flex: 1 1 100%;
    }
    .esb__custom-row {
        grid-template-columns: 1fr;
        align-items: stretch;
    }
}

.esb__grid {
    display: grid;
    grid-template-columns: minmax(0, 1.618fr) minmax(0, 1fr);
    gap: var(--gap-sm) var(--gap-md);
}

.esb__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.esb__field--wide {
    grid-column: 1 / -1;
}

.esb__field--inline {
    justify-content: center;
}

.esb__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.esb__doc-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
    color: var(--color-primary-text);
    text-decoration: none;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.esb__doc-link:hover {
    text-decoration: underline;
}

@media (max-width: 640px) {
    .esb__grid {
        grid-template-columns: 1fr;
    }
}
</style>
