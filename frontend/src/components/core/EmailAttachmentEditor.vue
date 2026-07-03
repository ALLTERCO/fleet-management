<template>
    <div class="eae">
        <header class="eae__hdr">
            <div class="eae__count">
                <i class="fas fa-paperclip eae__count-icon" />
                <span class="eae__count-num">{{ modelValue.length }}</span>
                <span class="eae__count-label">
                    attachment{{ modelValue.length === 1 ? '' : 's' }}
                </span>
            </div>
            <Button type="green" size="sm" @click="addRow">
                Add attachment
            </Button>
        </header>

        <EmptyBlock v-if="modelValue.length === 0">
            <p>No attachments yet.</p>
            <p class="eae__empty-sub">
                Upload an image or reference a public URL. Inline images use
                <code>cid</code> &amp; HTML <code>&lt;img src="cid:id"&gt;</code>.
            </p>
        </EmptyBlock>

        <ol v-else class="eae__list">
            <li
                v-for="(att, i) in modelValue"
                :key="i"
                class="eae__row"
            >
                <div class="eae__row-hdr">
                    <div class="eae__row-title">
                        <span class="eae__row-index">{{ i + 1 }}</span>
                        <span class="eae__row-name">
                            {{ att.filename || 'Untitled attachment' }}
                        </span>
                    </div>
                    <div class="eae__row-mode" role="radiogroup">
                        <label
                            class="eae__mode-opt"
                            :class="{
                                'eae__mode-opt--active': rowMode(att) === 'asset'
                            }"
                        >
                            <input
                                type="radio"
                                :checked="rowMode(att) === 'asset'"
                                class="eae__mode-input"
                                @change="setMode(i, 'asset')"
                            />
                            <i class="fas fa-image" /> Uploaded
                        </label>
                        <label
                            class="eae__mode-opt"
                            :class="{
                                'eae__mode-opt--active': rowMode(att) === 'url'
                            }"
                        >
                            <input
                                type="radio"
                                :checked="rowMode(att) === 'url'"
                                class="eae__mode-input"
                                @change="setMode(i, 'url')"
                            />
                            <i class="fas fa-link" /> URL
                        </label>
                    </div>
                    <Button
                        type="red"
                        size="sm"
                        narrow
                        title="Remove attachment"
                        aria-label="Remove attachment"
                        @click="removeRow(i)"
                    >
                        <i class="fas fa-trash" aria-hidden="true" />
                    </Button>
                </div>

                <div class="eae__grid">
                    <!-- Asset mode: picker + upload -->
                    <template v-if="rowMode(att) === 'asset'">
                        <div class="eae__field eae__field--wide">
                            <label class="eae__label">Library asset</label>
                            <div class="eae__asset-row">
                                <select
                                    class="core-input eae__select"
                                    :value="att.assetId ?? ''"
                                    :disabled="assetsLoading"
                                    @change="onPickAsset(i, ($event.target as HTMLSelectElement).value)"
                                >
                                    <option value="">
                                        {{ assetsLoading
                                            ? 'Loading…'
                                            : assets.length === 0
                                              ? 'No assets yet — upload one'
                                              : '— select —' }}
                                    </option>
                                    <option
                                        v-for="a in assets"
                                        :key="a.id"
                                        :value="a.id"
                                    >
                                        {{ a.filename }} ({{ formatBytes(a.sizeBytes) }})
                                    </option>
                                </select>
                                <Button
                                    type="blue-hollow"
                                    size="sm"
                                    narrow
                                    :loading="uploadingRow === i"
                                    :disabled="uploadingRow === i"
                                    @click="triggerUpload(i)"
                                >
                                    Upload
                                </Button>
                                <input
                                    :ref="(el) => setFileRef(i, el)"
                                    type="file"
                                    class="eae__file"
                                    accept="image/*"
                                    @change="onFilePicked(i, $event)"
                                />
                            </div>
                            <div
                                v-if="att.assetId && isImage(assetFor(att.assetId)?.contentType)"
                                class="eae__asset-preview"
                            >
                                <img
                                    :src="notificationsStore.emailAssetUrl(att.assetId)"
                                    alt=""
                                    class="eae__asset-thumb"
                                />
                                <a
                                    :href="notificationsStore.emailAssetUrl(att.assetId)"
                                    target="_blank"
                                    rel="noopener"
                                    class="eae__asset-link"
                                >
                                    <i class="fas fa-arrow-up-right-from-square" />
                                    Open full size
                                </a>
                            </div>
                        </div>
                    </template>

                    <!-- URL mode -->
                    <div v-else class="eae__field eae__field--wide">
                        <Input
                            :model-value="att.url ?? ''"
                            label="URL"
                            placeholder="https://…"
                            @update:model-value="(v: string | number) => patch(i, {url: String(v) || undefined})"
                        />
                    </div>

                    <div class="eae__field">
                        <Input
                            :model-value="att.filename"
                            label="Filename"
                            placeholder="logo.png"
                            @update:model-value="(v: string | number) => patch(i, {filename: String(v)})"
                        />
                    </div>
                    <div class="eae__field">
                        <Input
                            :model-value="att.cid ?? ''"
                            label="Content-ID (optional)"
                            placeholder="logo"
                            @update:model-value="(v: string | number) => patch(i, {cid: String(v) || undefined})"
                        />
                    </div>
                    <div class="eae__field">
                        <Input
                            :model-value="att.contentType ?? ''"
                            label="Content type (optional)"
                            placeholder="image/png"
                            @update:model-value="(v: string | number) => patch(i, {contentType: String(v) || undefined})"
                        />
                    </div>
                </div>
            </li>
        </ol>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Input from '@/components/core/Input.vue';
import {
    type EmailAsset,
    type EmailAttachment,
    useNotificationsStore
} from '@/stores/notifications';

type RowMode = 'asset' | 'url';

const props = defineProps<{
    modelValue: EmailAttachment[];
}>();

const emit = defineEmits<{
    'update:modelValue': [value: EmailAttachment[]];
}>();

const notificationsStore = useNotificationsStore();

const assetsLoading = ref(false);
const uploadingRow = ref<number | null>(null);
const fileRefs = ref<Record<number, HTMLInputElement | null>>({});

const assets = computed<EmailAsset[]>(() =>
    Object.values(notificationsStore.emailAssets).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
    )
);

onMounted(async () => {
    if (assets.value.length === 0) {
        assetsLoading.value = true;
        try {
            await notificationsStore.fetchEmailAssets();
        } finally {
            assetsLoading.value = false;
        }
    }
});

function rowMode(att: EmailAttachment): RowMode {
    return att.assetId ? 'asset' : 'url';
}

function setMode(index: number, mode: RowMode) {
    if (mode === 'asset') {
        patch(index, {url: undefined});
    } else {
        patch(index, {assetId: undefined});
    }
}

function addRow() {
    emit('update:modelValue', [
        ...props.modelValue,
        {filename: '', url: ''}
    ]);
}

function removeRow(index: number) {
    emit(
        'update:modelValue',
        props.modelValue.filter((_, i) => i !== index)
    );
    fileRefs.value[index] = null;
}

function patch(index: number, p: Partial<EmailAttachment>) {
    emit(
        'update:modelValue',
        props.modelValue.map((a, i) => (i === index ? {...a, ...p} : a))
    );
}

function onPickAsset(index: number, raw: string) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) {
        patch(index, {assetId: undefined});
        return;
    }
    const asset = notificationsStore.emailAssets[id];
    patch(index, {
        assetId: id,
        filename: props.modelValue[index].filename || asset?.filename || '',
        contentType: props.modelValue[index].contentType || asset?.contentType,
        url: undefined
    });
}

function setFileRef(index: number, el: unknown) {
    fileRefs.value[index] = el as HTMLInputElement | null;
}

function triggerUpload(index: number) {
    fileRefs.value[index]?.click();
}

async function onFilePicked(index: number, ev: Event) {
    const target = ev.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file) return;
    uploadingRow.value = index;
    try {
        const uploaded = await notificationsStore.uploadEmailAsset(file);
        if (uploaded) {
            patch(index, {
                assetId: uploaded.id,
                filename:
                    props.modelValue[index].filename || uploaded.filename,
                contentType:
                    props.modelValue[index].contentType ||
                    uploaded.contentType,
                url: undefined
            });
        }
    } finally {
        uploadingRow.value = null;
    }
}

function assetFor(id: number | undefined): EmailAsset | undefined {
    return id ? notificationsStore.emailAssets[id] : undefined;
}

function isImage(contentType: string | undefined): boolean {
    return !!contentType && contentType.startsWith('image/');
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<style scoped>
.eae {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.eae__hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}

.eae__count {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}

.eae__count-icon {
    color: var(--color-text-tertiary);
}

.eae__count-num {
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.eae__count-label {
    color: var(--color-text-tertiary);
}

.eae__empty-sub {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.45;
    max-width: 60ch;
    margin: 0;
}

.eae__empty-sub code {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--color-surface-3);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
}

.eae__list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.eae__row {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
}

.eae__row-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
}

.eae__row-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    margin-right: auto;
}

.eae__row-index {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
    border-radius: var(--radius-full);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.eae__row-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.eae__row-mode {
    display: inline-flex;
    gap: var(--space-1);
    padding: var(--space-0-5);
    background: var(--color-surface-3);
    border-radius: var(--radius-md);
}

.eae__mode-opt {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    transition:
        background var(--motion-hover),
        color var(--motion-hover);
}

.eae__mode-opt--active {
    background: var(--color-surface-0);
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
    box-shadow: var(--shadow-brand-ring);
}

.eae__mode-input {
    display: none;
}

.eae__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-3);
}

.eae__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.eae__field--wide {
    grid-column: 1 / -1;
}

.eae__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.eae__asset-row {
    display: flex;
    gap: var(--space-2);
    align-items: stretch;
}

/* Inherits border + focus ring from .core-input (global). */
.eae__select {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
}

.eae__file {
    display: none;
}

.eae__asset-preview {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
    padding: var(--space-2);
    background: var(--color-surface-0);
    border-radius: var(--radius-sm);
}

.eae__asset-thumb {
    max-width: 4rem;
    max-height: 3rem;
    object-fit: contain;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: #fff;
}

.eae__asset-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-primary-text);
    text-decoration: none;
}

.eae__asset-link:hover {
    text-decoration: underline;
}
</style>
