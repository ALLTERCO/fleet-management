<template>
    <div class="fpse">
        <div v-if="!url" class="fpse__upload">
            <div
                class="fpse__dropzone"
                :class="{'fpse__dropzone--dragging': dragging, 'fpse__dropzone--uploading': uploading}"
                @dragover.prevent="onDragOver"
                @dragleave.prevent="dragging = false"
                @drop.prevent="onDrop"
            >
                <input
                    ref="fileInputRef"
                    type="file"
                    :accept="acceptMime"
                    class="fpse__file"
                    @change="onFileSelected"
                />
                <i
                    class="fas fpse__icon"
                    :class="uploading ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'"
                    aria-hidden="true"
                />
                <p class="fpse__hint">
                    <template v-if="uploading">Uploading…</template>
                    <template v-else-if="!canUpload">
                        Save the location first, then upload the floor plan here.
                    </template>
                    <template v-else>
                        Drop an image, or
                        <button type="button" class="fpse__browse" @click="fileInputRef?.click()">browse</button>
                    </template>
                </p>
                <p class="fpse__sub">PNG / JPG / SVG / WebP · ≤ {{ maxBytesLabel }}</p>
                <p v-if="uploadError" class="fpse__error">{{ uploadError }}</p>
            </div>
        </div>

        <div v-else class="fpse__editor">
            <div
                ref="stageRef"
                class="fpse__stage"
                :class="{'fpse__stage--scaling': scaling}"
                @mousedown="onStageDown"
                @mousemove="onStageMove"
                @mouseup="onStageUp"
                @mouseleave="onStageUp"
            >
                <img :src="url" alt="Floor plan" class="fpse__img" @load="onImgLoad" />
                <svg
                    v-if="line"
                    class="fpse__overlay"
                    :viewBox="`0 0 ${widthPx ?? 1} ${heightPx ?? 1}`"
                    preserveAspectRatio="none"
                    role="presentation"
                    aria-hidden="true"
                >
                    <line
                        :x1="line.x1"
                        :y1="line.y1"
                        :x2="line.x2"
                        :y2="line.y2"
                        stroke="#4495d1"
                        stroke-width="3"
                        stroke-linecap="round"
                        vector-effect="non-scaling-stroke"
                    />
                    <circle :cx="line.x1" :cy="line.y1" r="6" fill="#ffffff" stroke="#4495d1" stroke-width="2" vector-effect="non-scaling-stroke" />
                    <circle :cx="line.x2" :cy="line.y2" r="6" fill="#ffffff" stroke="#4495d1" stroke-width="2" vector-effect="non-scaling-stroke" />
                </svg>
            </div>

            <div class="fpse__bar">
                <button
                    type="button"
                    class="fpse__btn"
                    :class="{'fpse__btn--on': scaling}"
                    @click="toggleScaling"
                >
                    <i class="fas fa-ruler" aria-hidden="true" />
                    {{ scaling ? 'Cancel scale' : 'Set scale' }}
                </button>
                <div v-if="line && !scaling" class="fpse__scale-prompt">
                    <span>This line is</span>
                    <input
                        v-model.number="distanceMeters"
                        type="number"
                        min="0.1"
                        step="0.1"
                        class="fpse__num"
                        placeholder="10"
                    />
                    <select v-model="unit" class="fpse__unit">
                        <option value="m">meters</option>
                        <option value="ft">feet</option>
                    </select>
                    <button
                        type="button"
                        class="fpse__btn fpse__btn--primary"
                        :disabled="!canCommitScale"
                        @click="commitScale"
                    >Apply</button>
                </div>
                <span v-if="scalePxPerMeter && !line" class="fpse__scale-info">
                    <i class="fas fa-check" aria-hidden="true" />
                    Scale: {{ scalePxPerMeter.toFixed(2) }} px / m
                </span>
                <span class="fpse__spacer" />
                <button type="button" class="fpse__btn fpse__btn--ghost" @click="reset">
                    <i class="fas fa-rotate-left" aria-hidden="true" /> Reset
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import apiClient from '@/helpers/axios';
import {
    ACCEPTED_FLOOR_PLAN_MIME,
    type DistanceUnit,
    type FloorPlanValue,
    isAcceptedFloorPlanFile,
    isReasonablePxPerMeter,
    MAX_FLOOR_PLAN_BYTES,
    pxPerMeterFromLine,
    type ScaleLine
} from '@/helpers/floor-plan-scale';
import {createUploadTicket} from '@/tools/uploadTickets';

export type {FloorPlanValue} from '@/helpers/floor-plan-scale';

const props = defineProps<{
    modelValue: FloorPlanValue | null | undefined;
    locationId?: number | null;
}>();
const emit = defineEmits<{
    'update:modelValue': [FloorPlanValue | null];
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);

const dragging = ref(false);
const uploading = ref(false);
const uploadError = ref<string | null>(null);
const scaling = ref(false);

const line = ref<ScaleLine | null>(null);
const dragStart = ref<{x: number; y: number} | null>(null);

const distanceMeters = ref<number>(10);
const unit = ref<DistanceUnit>('m');

const url = computed(() => props.modelValue?.url ?? '');
const widthPx = computed(() => props.modelValue?.widthPx ?? 0);
const heightPx = computed(() => props.modelValue?.heightPx ?? 0);
const scalePxPerMeter = computed(() => props.modelValue?.scalePxPerMeter);
const canUpload = computed(() => props.locationId != null);
const acceptMime = ACCEPTED_FLOOR_PLAN_MIME.join(',');
const maxBytesLabel = `${Math.round(MAX_FLOOR_PLAN_BYTES / (1024 * 1024))} MB`;

const canCommitScale = computed(() => {
    if (!line.value) return false;
    return Number.isFinite(distanceMeters.value) && distanceMeters.value > 0;
});

function onDragOver(): void {
    if (uploading.value) return;
    dragging.value = true;
}

function onDrop(e: DragEvent): void {
    dragging.value = false;
    if (uploading.value) return;
    const f = e.dataTransfer?.files?.[0];
    if (f) void upload(f);
}

function onFileSelected(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void upload(f);
}

function rejectFile(reason: 'mime' | 'size'): void {
    uploadError.value =
        reason === 'mime'
            ? 'Only image files (PNG / JPG / SVG / WebP).'
            : 'File is larger than the allowed upload size.';
}

async function upload(file: File): Promise<void> {
    if (!canUpload.value || props.locationId == null) {
        uploadError.value = 'Save the location first, then upload.';
        return;
    }
    const verdict = isAcceptedFloorPlanFile(file);
    if (!verdict.ok) {
        rejectFile(verdict.reason);
        return;
    }
    uploadError.value = null;
    uploading.value = true;
    try {
        const uploaded = await postFloorPlan(file, props.locationId);
        emit('update:modelValue', uploaded);
    } catch (err: unknown) {
        uploadError.value = readUploadErrorMessage(err);
    } finally {
        uploading.value = false;
    }
}

// Side-effect step extracted from `upload` so error handling stays separate
// from the network call.
async function postFloorPlan(
    file: File,
    locationId: number
): Promise<FloorPlanValue> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('locationId', String(locationId));
    const ticket = await createUploadTicket(
        'Location.FloorPlan.CreateUploadTicket',
        {locationId}
    );
    fd.append('ticket', ticket);
    const res = await apiClient.post<{
        url: string;
        widthPx: number;
        heightPx: number;
    }>('/api/uploads/floor-plan', fd, {
        headers: {'Content-Type': 'multipart/form-data'}
    });
    return {
        url: res.data.url,
        widthPx: res.data.widthPx,
        heightPx: res.data.heightPx
    };
}

// Answer — best human-readable message we can pull from an axios/network err.
function readUploadErrorMessage(err: unknown): string {
    const shaped = err as {
        response?: {data?: {error?: string}};
        message?: string;
    };
    return (
        shaped.response?.data?.error || shaped.message || 'Upload failed'
    );
}

function onImgLoad(e: Event): void {
    const img = e.target as HTMLImageElement;
    if (widthPx.value && heightPx.value) return;
    emit('update:modelValue', {
        ...(props.modelValue ?? {}),
        widthPx: img.naturalWidth,
        heightPx: img.naturalHeight
    });
}

function toggleScaling(): void {
    scaling.value = !scaling.value;
    if (scaling.value) return;
    line.value = null;
    dragStart.value = null;
}

function stageToImagePoint(e: MouseEvent): {x: number; y: number} | null {
    if (!stageRef.value || !widthPx.value || !heightPx.value) return null;
    const rect = stageRef.value.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;
    return {x: xPct * widthPx.value, y: yPct * heightPx.value};
}

function onStageDown(e: MouseEvent): void {
    if (!scaling.value) return;
    const p = stageToImagePoint(e);
    if (!p) return;
    dragStart.value = p;
    line.value = {x1: p.x, y1: p.y, x2: p.x, y2: p.y};
}

function onStageMove(e: MouseEvent): void {
    if (!scaling.value || !dragStart.value || !line.value) return;
    const p = stageToImagePoint(e);
    if (!p) return;
    line.value = {...line.value, x2: p.x, y2: p.y};
}

function onStageUp(): void {
    if (!scaling.value) return;
    if (!dragStart.value || !line.value) return;
    dragStart.value = null;
    scaling.value = false;
}

function commitScale(): void {
    if (!line.value || !canCommitScale.value) return;
    const pxPerMeter = pxPerMeterFromLine({
        line: line.value,
        realDistance: distanceMeters.value,
        unit: unit.value
    });
    if (!isReasonablePxPerMeter(pxPerMeter)) {
        uploadError.value =
            'Computed scale is outside the believable range. Re-draw a longer line on a clearly measurable wall.';
        return;
    }
    emit('update:modelValue', {
        ...(props.modelValue ?? {}),
        scalePxPerMeter: pxPerMeter
    });
    line.value = null;
}

function reset(): void {
    emit('update:modelValue', null);
    line.value = null;
    scaling.value = false;
    distanceMeters.value = 10;
    unit.value = 'm';
}

watch(
    () => props.modelValue?.url,
    () => {
        line.value = null;
        scaling.value = false;
    }
);
</script>

<style scoped>
.fpse {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

/* Upload zone */
.fpse__upload {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.fpse__dropzone {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-5);
    border: 1.5px dashed rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.02);
    color: rgba(235, 235, 245, 0.72);
    text-align: center;
    transition: background var(--motion-state), border-color var(--motion-state);
}
.fpse__dropzone--dragging {
    border-color: rgba(68, 149, 209, 0.6);
    background: rgba(68, 149, 209, 0.08);
}
.fpse__dropzone--uploading {
    opacity: 0.7;
}
.fpse__file {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
}
.fpse__icon {
    font-size: var(--type-subheading);
    color: rgba(255, 255, 255, 0.45);
}
.fpse__hint {
    margin: 0;
    font-size: var(--type-caption);
}
.fpse__sub {
    margin: 0;
    font-size: var(--type-caption);
    color: rgba(235, 235, 245, 0.45);
}
.fpse__browse {
    appearance: none;
    background: transparent;
    border: none;
    color: rgba(170, 225, 250, 0.96);
    cursor: pointer;
    text-decoration: underline;
    font: inherit;
    padding: 0;
}
.fpse__error {
    margin: 0;
    font-size: var(--type-caption);
    color: rgba(255, 88, 88, 0.92);
}

/* Editor + stage */
.fpse__editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.fpse__stage {
    position: relative;
    width: 100%;
    border-radius: 12px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.32);
    cursor: default;
    user-select: none;
}
.fpse__stage--scaling {
    cursor: crosshair;
}
.fpse__img {
    display: block;
    width: 100%;
    height: auto;
    max-height: 360px;
    object-fit: contain;
}
.fpse__overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

/* Toolbar */
.fpse__bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.fpse__btn {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-3);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(235, 235, 245, 0.92);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background var(--motion-state);
}
.fpse__btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
}
.fpse__btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
.fpse__btn--on {
    background: rgba(68, 149, 209, 0.22);
    border-color: rgba(68, 149, 209, 0.45);
}
.fpse__btn--primary {
    background: rgba(77, 157, 138, 0.32);
    border-color: rgba(77, 157, 138, 0.55);
    color: var(--color-text-primary);
}
.fpse__btn--primary:hover:not(:disabled) {
    background: rgba(77, 157, 138, 0.5);
}
.fpse__btn--ghost {
    background: transparent;
    border-color: rgba(255, 255, 255, 0.06);
    color: rgba(235, 235, 245, 0.7);
}

.fpse__scale-prompt {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-2);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(235, 235, 245, 0.86);
    font-size: var(--type-caption);
}
.fpse__num {
    appearance: none;
    width: 64px;
    padding: 4px 8px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--color-text-primary);
    font: inherit;
}
.fpse__unit {
    appearance: none;
    padding: 4px 8px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--color-text-primary);
    font: inherit;
}
.fpse__scale-info {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    color: rgba(140, 220, 196, 0.96);
    font-size: var(--type-caption);
}
.fpse__spacer {
    flex: 1;
}
</style>
