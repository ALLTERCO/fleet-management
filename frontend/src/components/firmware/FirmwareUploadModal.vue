<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>Upload Firmware</template>

        <div class="fw-upload">
            <!-- File selection — primary action, first -->
            <div class="fw-upload__file">
                <input
                    ref="fileInputRef"
                    type="file"
                    class="hidden"
                    accept=".zip,.bin,.ota,.sfu,.swu"
                    aria-label="Upload firmware file"
                    @change="handleFileChange"
                />
                <button type="button" class="fw-upload__drop" @click="fileInputRef?.click()">
                    <i class="fas fa-cloud-upload-alt fw-upload__drop-icon" />
                    <span v-if="selectedFile" class="fw-upload__drop-name">{{ selectedFile.name }}</span>
                    <span v-else class="fw-upload__drop-hint">Click to choose .bin, .zip, .ota file</span>
                </button>
            </div>

            <!-- Retention toggle — only show when devices are selected -->
            <div v-if="hasSelectedDevices" class="fw-upload__mode">
                <button
                    class="fw-upload__mode-btn"
                    :class="{ 'fw-upload__mode-btn--active': retention === 'temporary' }"
                    @click="retention = 'temporary'"
                >
                    Flash &amp; Discard
                </button>
                <button
                    class="fw-upload__mode-btn"
                    :class="{ 'fw-upload__mode-btn--active': retention === 'library' }"
                    @click="retention = 'library'"
                >
                    Save to Library
                </button>
            </div>

            <!-- Library metadata — only when saving -->
            <div v-if="retention === 'library'" class="fw-upload__meta">
                <div class="fw-upload__row">
                    <FormField label="Name" optional>
                        <Input v-model="form.name" placeholder="Display name" />
                    </FormField>
                    <FormField label="Tags" optional>
                        <Input v-model="form.tags" placeholder="comma separated" />
                    </FormField>
                </div>
                <div class="fw-upload__row">
                    <FormField label="Model" optional>
                        <Input v-model="form.model" placeholder="e.g. SHSW-25" />
                    </FormField>
                    <FormField label="Version" optional>
                        <Input v-model="form.version" placeholder="e.g. 1.4.3" />
                    </FormField>
                </div>
                <div class="fw-upload__row">
                    <FormField label="Channel" optional>
                        <select v-model="form.channel" class="fw-upload__select" aria-label="Channel">
                            <option value="">—</option>
                            <option value="stable">Stable</option>
                            <option value="beta">Beta</option>
                            <option value="custom">Custom</option>
                        </select>
                    </FormField>
                    <div />
                </div>
            </div>
        </div>

        <template #footer>
            <div class="flex justify-end gap-2">
                <Button type="blue-hollow" size="sm" @click="emit('close')">Cancel</Button>
                <Button type="green" size="sm" :disabled="!selectedFile" @click="handleUpload">
                    {{ retention === 'library' ? 'Upload & Save' : 'Upload & Flash' }}
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import Modal from '@/components/modals/Modal.vue';

const props = defineProps<{
    visible: boolean;
    hasSelectedDevices?: boolean;
}>();

const emit = defineEmits<{
    close: [];
    upload: [formData: FormData];
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const retention = ref<'temporary' | 'library'>('temporary');

const defaultForm = {
    name: '',
    app: '',
    model: '',
    version: '',
    fwId: '',
    channel: '',
    tags: ''
};
const form = reactive({...defaultForm});

/** Read esp_app_desc_t from an ESP32 .bin firmware image.
 *  Layout (at offset 32 in the image):
 *    0x00: uint32 magic (0xABCD5432)
 *    0x04: uint32 secure_version
 *    0x08: uint32[2] reserved
 *    0x10: char[32] version
 *    0x30: char[32] project_name
 *    0x50: char[16] compile_time
 *    0x60: char[16] compile_date
 *    0x70: char[32] idf_ver
 *    0x90: uint8[32] app_elf_sha256
 *  Total: 256 bytes. Magic = 0xABCD5432.
 */
async function readEsp32AppDesc(file: File): Promise<{
    version?: string;
    projectName?: string;
    compileDate?: string;
    compileTime?: string;
    idfVer?: string;
    sha256?: string;
} | null> {
    if (!/\.(bin|ota)$/i.test(file.name)) return null;
    if (file.size < 512) return null;
    try {
        const headerSlice = await file.slice(0, 512).arrayBuffer();
        const view = new DataView(headerSlice);
        const decoder = new TextDecoder();

        // ESP32 image starts with magic byte 0xE9
        if (view.getUint8(0) !== 0xe9) return null;

        // esp_app_desc_t is at offset 32 (24-byte image header + 8-byte segment header)
        const descOffset = 32;
        const magic = view.getUint32(descOffset, true);
        if (magic !== 0xabcd5432) return null;

        function readString(offset: number, maxLen: number): string {
            const bytes = new Uint8Array(headerSlice, offset, maxLen);
            const nullIdx = bytes.indexOf(0);
            return decoder
                .decode(bytes.subarray(0, nullIdx >= 0 ? nullIdx : maxLen))
                .trim();
        }

        const version = readString(descOffset + 0x10, 32);
        const projectName = readString(descOffset + 0x30, 32);
        const compileTime = readString(descOffset + 0x50, 16);
        const compileDate = readString(descOffset + 0x60, 16);
        const idfVer = readString(descOffset + 0x70, 32);

        // SHA256 as hex
        const shaBytes = new Uint8Array(headerSlice, descOffset + 0x90, 32);
        const sha256 = Array.from(shaBytes)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');

        return {
            version: version || undefined,
            projectName: projectName || undefined,
            compileDate: compileDate || undefined,
            compileTime: compileTime || undefined,
            idfVer: idfVer || undefined,
            sha256: sha256 !== '0'.repeat(64) ? sha256 : undefined
        };
    } catch {
        return null;
    }
}

/** Parse Shelly firmware filename for metadata.
 *  Common patterns:
 *    ShellyPlus1-1.4.3.bin
 *    SNSW-001P16EU_1.4.3_g1a2b3c4.zip
 *    ShellyPro4PM_20240315-123456_1.4.3-gbuild123.bin
 */
function parseFilenameMetadata(filename: string): {
    model?: string;
    version?: string;
    fwId?: string;
    name?: string;
} {
    const base = filename.replace(/\.(zip|bin|ota|sfu|swu)$/i, '');

    // Version: X.Y.Z pattern
    const verMatch = base.match(/(\d+\.\d+\.\d+)/);
    const version = verMatch?.[1];

    // Build ID: gXXXXXXX pattern
    const buildMatch = base.match(/\bg([0-9a-f]{7,})\b/i);
    const fwId = buildMatch?.[1] ? `g${buildMatch[1]}` : undefined;

    // Model: text before the first version/underscore/dash-digit boundary
    // e.g. "ShellyPlus1" from "ShellyPlus1-1.4.3" or "SNSW-001P16EU" from "SNSW-001P16EU_1.4.3"
    const modelMatch = base.match(
        /^([A-Za-z][A-Za-z0-9]*(?:[-][A-Za-z0-9]+)*)(?:[_-]\d)/
    );
    const model = modelMatch?.[1];

    return {
        model: model || undefined,
        version: version || undefined,
        fwId: fwId || undefined,
        name: base || undefined
    };
}

interface ZipEntry {
    name: string;
    compressedSize: number;
    uncompressedSize: number;
    lastModified: Date;
    comment: string;
}

/** Parse ZIP central directory to extract entry list, file comment, and optionally manifest.json content. */
async function readZipMetadata(file: File): Promise<{
    entries: ZipEntry[];
    comment: string;
    manifest: Record<string, any> | null;
} | null> {
    if (!file.name.toLowerCase().endsWith('.zip')) return null;
    try {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);
        const decoder = new TextDecoder();

        // Find End of Central Directory (EOCD)
        let eocdOffset = -1;
        for (
            let i = buffer.byteLength - 22;
            i >= Math.max(0, buffer.byteLength - 65557);
            i--
        ) {
            if (view.getUint32(i, true) === 0x06054b50) {
                eocdOffset = i;
                break;
            }
        }
        if (eocdOffset === -1) return null;

        const cdOffset = view.getUint32(eocdOffset + 16, true);
        const cdEntries = view.getUint16(eocdOffset + 10, true);
        const zipCommentLen = view.getUint16(eocdOffset + 20, true);
        const zipComment =
            zipCommentLen > 0
                ? decoder.decode(
                      new Uint8Array(buffer, eocdOffset + 22, zipCommentLen)
                  )
                : '';

        const entries: ZipEntry[] = [];
        let manifest: Record<string, any> | null = null;
        let pos = cdOffset;

        for (let i = 0; i < cdEntries; i++) {
            if (view.getUint32(pos, true) !== 0x02014b50) break;
            const nameLen = view.getUint16(pos + 28, true);
            const extraLen = view.getUint16(pos + 30, true);
            const commentLen = view.getUint16(pos + 32, true);
            const compressedSize = view.getUint32(pos + 20, true);
            const uncompressedSize = view.getUint32(pos + 24, true);
            const localHeaderOffset = view.getUint32(pos + 42, true);

            // DOS date/time → JS Date
            const dosTime = view.getUint16(pos + 12, true);
            const dosDate = view.getUint16(pos + 14, true);
            const lastModified = new Date(
                ((dosDate >> 9) & 0x7f) + 1980,
                ((dosDate >> 5) & 0x0f) - 1,
                dosDate & 0x1f,
                (dosTime >> 11) & 0x1f,
                (dosTime >> 5) & 0x3f,
                (dosTime & 0x1f) * 2
            );

            const name = decoder.decode(
                new Uint8Array(buffer, pos + 46, nameLen)
            );
            const comment =
                commentLen > 0
                    ? decoder.decode(
                          new Uint8Array(
                              buffer,
                              pos + 46 + nameLen + extraLen,
                              commentLen
                          )
                      )
                    : '';

            entries.push({
                name,
                compressedSize,
                uncompressedSize,
                lastModified,
                comment
            });

            // Try to read manifest.json if stored uncompressed
            if (
                !manifest &&
                (name === 'manifest.json' || name.endsWith('/manifest.json'))
            ) {
                const lhPos = localHeaderOffset;
                if (view.getUint32(lhPos, true) === 0x04034b50) {
                    const compressionMethod = view.getUint16(lhPos + 8, true);
                    if (compressionMethod === 0) {
                        const lhNameLen = view.getUint16(lhPos + 26, true);
                        const lhExtraLen = view.getUint16(lhPos + 28, true);
                        const dataStart = lhPos + 30 + lhNameLen + lhExtraLen;
                        const raw = new Uint8Array(
                            buffer,
                            dataStart,
                            compressedSize
                        );
                        try {
                            manifest = JSON.parse(decoder.decode(raw));
                        } catch {
                            /* ignore parse errors */
                        }
                    }
                }
            }

            pos += 46 + nameLen + extraLen + commentLen;
        }

        return {entries, comment: zipComment, manifest};
    } catch {
        return null;
    }
}

/** Extract metadata from ZIP structure: manifest > entry names > zip comment > filename */
function extractZipMetadata(zip: {
    entries: ZipEntry[];
    comment: string;
    manifest: Record<string, any> | null;
}): {
    model?: string;
    version?: string;
    fwId?: string;
    name?: string;
    app?: string;
    channel?: string;
} {
    // Best source: manifest.json
    if (zip.manifest) {
        return {
            name: zip.manifest.name || zip.manifest.app,
            model: zip.manifest.model,
            version: zip.manifest.version || zip.manifest.ver,
            fwId: zip.manifest.fw_id || zip.manifest.build_id,
            app: zip.manifest.app,
            channel: zip.manifest.channel
        };
    }

    // Second: parse .bin entry names inside the ZIP
    const binEntry = zip.entries.find(
        (e) => /\.(bin|ota)$/i.test(e.name) && !e.name.startsWith('__')
    );
    if (binEntry) {
        return parseFilenameMetadata(
            binEntry.name.split('/').pop() || binEntry.name
        );
    }

    // Third: ZIP file comment (some build tools embed version here)
    if (zip.comment) {
        const verMatch = zip.comment.match(/(\d+\.\d+\.\d+)/);
        if (verMatch) return {version: verMatch[1]};
    }

    return {};
}

function applyMetadata(meta: {
    model?: string;
    version?: string;
    fwId?: string;
    name?: string;
    app?: string;
    channel?: string;
}) {
    if (meta.name && !form.name) form.name = meta.name;
    if (meta.model && !form.model) form.model = meta.model;
    if (meta.version && !form.version) form.version = meta.version;
    if (meta.fwId && !form.fwId) form.fwId = meta.fwId;
    if (meta.app && !form.app) form.app = meta.app;
    if (meta.channel && !form.channel) form.channel = meta.channel;
}

async function handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    selectedFile.value = input.files?.[0] ?? null;
    if (!selectedFile.value) return;

    // 1. ZIP: central directory + manifest.json + entry names + file comment
    const zip = await readZipMetadata(selectedFile.value);
    if (zip) {
        applyMetadata(extractZipMetadata(zip));
        return;
    }

    // 2. ESP32 .bin: read esp_app_desc_t from binary header
    const appDesc = await readEsp32AppDesc(selectedFile.value);
    if (appDesc) {
        applyMetadata({
            version: appDesc.version,
            app: appDesc.projectName,
            name: appDesc.projectName
        });
        // Also try filename for model (binary header doesn't contain model)
        const filenameMeta = parseFilenameMetadata(selectedFile.value.name);
        if (filenameMeta.model && !form.model) form.model = filenameMeta.model;
        if (filenameMeta.fwId && !form.fwId) form.fwId = filenameMeta.fwId;
        return;
    }

    // 3. Filename parsing fallback
    applyMetadata(parseFilenameMetadata(selectedFile.value.name));
}

function handleUpload() {
    if (!selectedFile.value) return;

    const formData = new FormData();
    formData.append('firmware', selectedFile.value);
    formData.append('retention', retention.value);
    if (retention.value === 'library') {
        if (form.name) formData.append('name', form.name);
        if (form.app) formData.append('app', form.app);
        if (form.model) formData.append('model', form.model);
        if (form.version) formData.append('ver', form.version);
        if (form.fwId) formData.append('fwId', form.fwId);
        if (form.channel) formData.append('channel', form.channel);
        if (form.tags) formData.append('tags', form.tags);
    }
    emit('upload', formData);
}

function resetState() {
    selectedFile.value = null;
    retention.value = props.hasSelectedDevices ? 'temporary' : 'library';
    Object.assign(form, defaultForm);
    if (fileInputRef.value) fileInputRef.value.value = '';
}

watch(
    () => props.visible,
    (isVisible) => {
        if (!isVisible) resetState();
        // Force library mode when no devices selected
        if (isVisible && !props.hasSelectedDevices) retention.value = 'library';
    }
);
</script>

<style scoped>
:deep(.modal-body) {
    min-height: 40vh;
}

/* Label spacing */
:deep(.form-field__label) {
    margin-bottom: var(--space-2);
}

.fw-upload {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

/* Drop zone */
.fw-upload__drop {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-8);
    border: 2px dashed var(--color-border-medium);
    border-radius: var(--btn-radius);
    background: var(--color-surface-3);
    cursor: pointer;
    transition: border-color var(--duration-fast), background var(--duration-fast);
}
.fw-upload__drop:hover {
    border-color: var(--color-text-tertiary);
    background: color-mix(in srgb, var(--color-surface-3) 80%, var(--color-surface-4));
}
.fw-upload__drop-icon {
    font-size: var(--type-subheading); /* subheading */
    color: var(--color-text-tertiary);
}
.fw-upload__drop-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.fw-upload__drop-hint {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}

/* Retention toggle */
.fw-upload__mode {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
}
.fw-upload__mode-btn {
    min-height: var(--touch-target-min); /* 44px */
    border: 2px solid var(--color-border-medium);
    border-radius: var(--btn-radius);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    font-family: inherit;
    cursor: pointer;
    transition: all var(--duration-fast);
}
.fw-upload__mode-btn:hover {
    border-color: var(--color-text-tertiary);
    color: var(--color-text-primary);
}
.fw-upload__mode-btn--active {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
}

/* Metadata form */
.fw-upload__meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.fw-upload__row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
}
.fw-upload__select {
    width: 100%;
    min-height: var(--touch-target-min);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--btn-radius);
    background: var(--color-surface-3);
    color: var(--color-text-primary);
    padding: 0 13px;
    font-size: var(--type-body);
    font-family: inherit;
}
.fw-upload__select:focus {
    outline: none;
    border-color: var(--color-border-focus);
}
</style>
