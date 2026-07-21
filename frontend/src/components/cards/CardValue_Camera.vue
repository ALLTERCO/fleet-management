<template>
    <!-- 1×1: snapshot + armed/motion overlay -->
    <CardShell
        v-if="size === '1x1'"
        type="camera"
        :name="entity.name"
        icon="fas fa-video"
        size="1x1"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div ref="feedEl" class="ec-camera-feed">
                <video v-if="isWebRtcActive" :ref="(el: any) => { webrtc.videoEl.value = el as HTMLVideoElement; }" class="ec-cam-img" autoplay muted playsinline />
                <img v-else-if="snapshotUrl" :src="snapshotUrl" class="ec-cam-img" alt="Camera snapshot" :class="{'ec-cam-img--offline': isOffline}" />
                <div v-else class="ec-camera-placeholder">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                </div>
                <div v-if="isWebRtcActive || isRecording" class="ec-camera-badge">LIVE</div>
                <div class="ec-cam-quality ec-cam-quality--fs-only" @click.stop>
                    <button class="ec-cam-res ec-cam-res--click" @click="qualityOpen = !qualityOpen">
                        {{ activeStreamDisplay }} <i class="fas fa-chevron-down" style="font-size:var(--icon-size-2xs);opacity:.5" />
                    </button>
                    <div v-if="qualityOpen" class="ec-cam-quality-dd">
                        <button v-for="(stream, idx) in availableStreams" :key="idx" class="ec-cam-quality-opt" :class="{'ec-cam-quality-opt--active': selectedStreamId === idx}" @click="switchStream(idx); qualityOpen = false">
                            {{ stream.resolution ?? `Stream ${idx}` }}
                            <span v-if="stream.fps" class="ec-cam-quality-fps">{{ stream.fps }}fps</span>
                        </button>
                    </div>
                </div>
                <button class="ec-cam-fullscreen" title="Fullscreen" @click.stop="toggleFullscreen"><i class="fas fa-expand" /></button>
                <div class="ec-cam-overlay">
                    <div class="ec-cam-ostat"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> {{ isArmed ? 'Armed' : 'Off' }}</div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×1: wide feed + overlay stats -->
    <CardShell
        v-else-if="size === '2x1'"
        type="camera"
        :name="entity.name"
        icon="fas fa-video"
        size="2x1"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div ref="feedEl" class="ec-camera-feed" :class="{'ec-camera-feed--dd-open': qualityOpen}">
                <div class="ec-cam-preview" :class="{'ec-cam-preview--offline': isOffline}">
                    <video v-if="isWebRtcActive" :ref="(el: any) => { webrtc.videoEl.value = el as HTMLVideoElement; }" class="ec-cam-img" autoplay muted playsinline />
                    <img v-else-if="snapshotUrl" :src="snapshotUrl" class="ec-cam-img" alt="Camera snapshot" />
                    <div v-else class="ec-cam-placeholder">
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                    </div>
                </div>
                <div class="ec-cam-quality" @click.stop>
                    <button class="ec-cam-res ec-cam-res--click" @click="qualityOpen = !qualityOpen">
                        {{ activeStreamDisplay }} <i class="fas fa-chevron-down" style="font-size:var(--icon-size-2xs);opacity:.5" />
                    </button>
                    <div v-if="qualityOpen" class="ec-cam-quality-dd">
                        <button v-for="(stream, idx) in availableStreams" :key="idx" class="ec-cam-quality-opt" :class="{'ec-cam-quality-opt--active': selectedStreamId === idx}" @click="switchStream(idx); qualityOpen = false">
                            {{ stream.resolution ?? `Stream ${idx}` }}
                            <span v-if="stream.fps" class="ec-cam-quality-fps">{{ stream.fps }}fps</span>
                        </button>
                    </div>
                </div>
                <button class="ec-cam-fullscreen" title="Fullscreen" @click.stop="toggleFullscreen"><i class="fas fa-expand" /></button>
                <div class="ec-cam-overlay">
                    <div class="ec-cam-ostat"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> {{ isArmed ? 'Armed' : 'Off' }}</div>
                    <div v-if="hasMotion" class="ec-cam-ostat" style="color:var(--color-status-off)"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="4"/><path d="M5.8 21a7 7 0 0112.4 0"/></svg> Motion</div>
                    <div class="ec-cam-ostat"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.7"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg> {{ nightModeDisplay }}</div>
                    <div class="ec-cam-ostat"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.7"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="16"/></svg> {{ sdStatusDisplay }}</div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2: hero — auto-streaming, no Live button -->
    <CardShell
        v-else
        type="camera"
        :name="entity.name"
        icon="fas fa-video"
        size="2x2"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div ref="feedEl" class="ec-camera-feed ec-camera-feed--hero" :class="{'ec-camera-feed--dd-open': qualityOpen}">
                <div class="ec-cam-preview" :class="{'ec-cam-preview--offline': isOffline}">
                    <video v-if="isWebRtcActive" :ref="(el: any) => { webrtc.videoEl.value = el as HTMLVideoElement; }" class="ec-cam-img" autoplay muted playsinline />
                    <img v-else-if="snapshotUrl" :src="snapshotUrl" class="ec-cam-img" alt="Camera snapshot" />
                    <div v-else class="ec-cam-placeholder">
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                    </div>
                </div>
                <div v-if="isWebRtcActive || isRecording" class="ec-camera-badge">{{ webrtc.connecting.value ? 'CONNECTING' : 'LIVE' }}</div>
                <button class="ec-cam-fullscreen" title="Fullscreen" @click.stop="toggleFullscreen"><i class="fas fa-expand" /></button>
                <!-- Quality picker -->
                <div class="ec-cam-quality" @click.stop>
                    <button class="ec-cam-res ec-cam-res--click" @click="qualityOpen = !qualityOpen">
                        {{ activeStreamDisplay }} <i class="fas fa-chevron-down" style="font-size:var(--icon-size-2xs);opacity:.5" />
                    </button>
                    <div v-if="qualityOpen" class="ec-cam-quality-dd">
                        <button
                            v-for="(stream, idx) in availableStreams"
                            :key="idx"
                            class="ec-cam-quality-opt"
                            :class="{'ec-cam-quality-opt--active': selectedStreamId === idx}"
                            @click="switchStream(idx); qualityOpen = false"
                        >
                            {{ stream.resolution ?? `Stream ${idx}` }}
                            <span v-if="stream.fps" class="ec-cam-quality-fps">{{ stream.fps }}fps</span>
                        </button>
                    </div>
                </div>
            </div>
            <!-- Info bar: single row matching prototype -->
            <div class="ec-cam-hero-stats">
                <span class="ec-cam-ostat"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" :stroke="isArmed ? 'var(--color-status-on)' : 'currentColor'" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> {{ isArmed ? 'Armed' : 'Off' }}</span>
                <span v-if="hasMotion" class="ec-cam-ostat" style="color:var(--color-status-off)"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="4"/><path d="M5.8 21a7 7 0 0112.4 0"/></svg> Motion</span>
                <span class="ec-cam-ostat"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.7"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg> {{ nightModeDisplay }}</span>
                <span class="ec-cam-ostat"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.7"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="16"/></svg> {{ sdStatusDisplay }}</span>
                <span v-if="isRecording" class="ec-cam-ostat" style="color:var(--color-status-off)"><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg> REC</span>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {useWebRtcStream} from '@/composables/useWebRtcStream';
import apiClient from '@/helpers/axios';
import {useDevicesStore} from '@/stores/devices';
import type {entity_t} from '@/types';
import CardBadges from './CardBadges.vue';
import CardShell from './CardShell.vue';

const props = withDefaults(
    defineProps<{
        entity: entity_t;
        size: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {editMode: false}
);

defineEmits<{
    'open-detail': [];
    delete: [];
    'cycle-size': [];
}>();

const deviceStore = useDevicesStore();
const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);

const status = computed(() => {
    if (!device.value) return null;
    const e = props.entity;
    return device.value.status?.[`${e.type}:${e.properties.id}`] ?? null;
});

// Device status carries `recordings` (an object keyed by rec_id), not a boolean.
const isRecording = computed(() => {
    const r = status.value?.recordings;
    return !!r && typeof r === 'object' && Object.keys(r).length > 0;
});

// ---------------------------------------------------------------------------
// WebRTC live mode refs (declared early — snapshot polling guards on liveMode)
// ---------------------------------------------------------------------------

const LIVE_PREF_KEY = 'cam-live-pref';

function getLivePref(): Record<string, {live: boolean; streamId: number}> {
    try {
        return JSON.parse(localStorage.getItem(LIVE_PREF_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveLivePref(live: boolean, streamId: number) {
    const prefs = getLivePref();
    prefs[props.entity.id] = {live, streamId};
    try {
        localStorage.setItem(LIVE_PREF_KEY, JSON.stringify(prefs));
    } catch {
        /* quota */
    }
}

const shellyIdRef = computed(() => props.entity.source);
const webrtc = useWebRtcStream(shellyIdRef);
const liveMode = ref(false);
const selectedStreamId = ref(0);
const qualityOpen = ref(false);
const feedEl = ref<HTMLElement | null>(null);

// True only when WebRTC is actually connected or connecting (not when offline with liveMode=true)
const isWebRtcActive = computed(
    () => liveMode.value && (webrtc.streaming.value || webrtc.connecting.value)
);

// ---------------------------------------------------------------------------
// Snapshot auto-preview (1x1 / 2x1 only — 2x2 uses WebRTC live)
// ---------------------------------------------------------------------------

const snapshotUrl = ref<string | null>(null);
let snapshotObjectUrl: string | null = null;
let snapshotTimer: ReturnType<typeof setInterval> | undefined;

// Live still, proxied by FM. CaptureImage returns a cloud/SD media_id (not
// bytes), so it can't feed an <img>; the device snapshot endpoint can.
async function fetchSnapshot() {
    if (isOffline.value) return;
    try {
        const res = await apiClient.get(
            `/api/device-proxy/${props.entity.source}/camera/${props.entity.properties.id}/snapshot`,
            {responseType: 'blob'}
        );
        const nextUrl = URL.createObjectURL(res.data);
        if (snapshotObjectUrl) URL.revokeObjectURL(snapshotObjectUrl);
        snapshotObjectUrl = nextUrl;
        snapshotUrl.value = nextUrl;
    } catch {
        // Transient poll failure — keep the last good frame; the offline state
        // handles a real loss of the device.
    }
}

function startPolling() {
    if (liveMode.value) return;
    stopPolling();
    fetchSnapshot();
    snapshotTimer = setInterval(fetchSnapshot, 10_000);
}

function stopPolling() {
    clearInterval(snapshotTimer);
    snapshotTimer = undefined;
}

function onVisibilityChange() {
    if (document.hidden) {
        stopPolling();
    } else if (!liveMode.value) {
        startPolling();
    }
}

// ---------------------------------------------------------------------------
// Display helpers (shared camSettings computed)
// ---------------------------------------------------------------------------

const camSettings = computed(
    () =>
        device.value?.settings?.[
            `${props.entity.type}:${props.entity.properties.id}`
        ] ?? null
);

const activeStreamDisplay = computed(() => {
    const sid = selectedStreamId.value;
    const s =
        camSettings.value?.streams?.[sid] ?? camSettings.value?.streams?.[0];
    if (!s) return '—';
    const parts = [s.resolution, s.bitrate ? `${s.bitrate}Kbps` : null].filter(
        Boolean
    );
    return parts.join(' \u00b7 ');
});

const isArmed = computed(() => camSettings.value?.arm ?? false);
const hasMotion = computed(() => !!status.value?.motion);

const sdStatusDisplay = computed(() => {
    const storage = device.value?.status?.['storage:0'];
    if (!storage?.present) return 'No SD';
    const free = storage.fs_free;
    const size = storage.fs_size;
    if (free != null && size != null && size > 0) {
        const freeGB = (free / (1024 * 1024 * 1024)).toFixed(1);
        return `${freeGB} GB free`;
    }
    return storage.active ? 'SD OK' : 'SD Idle';
});

const nightModeDisplay = computed(() => {
    // Device shape is {auto, ir_leds}; there is no `mode` field.
    const nv = camSettings.value?.night_vision;
    if (!nv) return '—';
    if (nv.auto) return 'IR Auto';
    return nv.ir_leds ? 'IR On' : 'IR Off';
});

// ---------------------------------------------------------------------------
// Live WebRTC mode (2x2 auto-starts; 1x1/2x1 use snapshot polling)
// ---------------------------------------------------------------------------

const availableStreams = computed(
    () =>
        (camSettings.value?.streams as {
            resolution?: string;
            fps?: number;
            codec?: string;
        }[]) ?? []
);

// Lowest-quality stream = highest index (Shelly: 0 = main/high). Small cards
// use it to save bandwidth; larger cards default to the high-quality stream 0.
const lowStreamId = computed(() => {
    const s = camSettings.value?.streams;
    if (!s || typeof s !== 'object') return 0;
    const ids = Object.keys(s)
        .map(Number)
        .filter((n) => !Number.isNaN(n));
    return ids.length ? Math.max(...ids) : 0;
});

function defaultStreamForSize(): number {
    return props.size === '1x1' ? lowStreamId.value : 0;
}

function startLive() {
    liveMode.value = true;
    stopPolling();
    saveLivePref(true, selectedStreamId.value);
    webrtc.start(selectedStreamId.value);
}

function stopLive() {
    liveMode.value = false;
    webrtc.stop();
    saveLivePref(false, selectedStreamId.value);
    if (!isOffline.value) startPolling();
}

function switchStream(id: number) {
    selectedStreamId.value = id;
    saveLivePref(liveMode.value, id);
    if (liveMode.value && webrtc.streaming.value) {
        webrtc.changeStream(id);
    }
}

// ---------------------------------------------------------------------------
// Quality dropdown click-outside
// ---------------------------------------------------------------------------

function toggleFullscreen() {
    const doc = document as any;
    // Exit fullscreen
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
        return;
    }
    // iOS Safari: <video>.webkitEnterFullscreen is the only way to fullscreen video
    const video = webrtc.videoEl.value;
    if (video && isWebRtcActive.value && (video as any).webkitEnterFullscreen) {
        (video as any).webkitEnterFullscreen();
        return;
    }
    // Standard + webkit prefix for container (keeps quality controls visible)
    const target = feedEl.value;
    if (!target) return;
    if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
    else if ((target as any).webkitRequestFullscreen)
        (target as any).webkitRequestFullscreen();
}

function closeQualityDropdown() {
    qualityOpen.value = false;
}

watch(qualityOpen, (open) => {
    if (open) {
        document.addEventListener('click', closeQualityDropdown);
    } else {
        document.removeEventListener('click', closeQualityDropdown);
    }
});

// ---------------------------------------------------------------------------
// Lifecycle — single onMounted, unified offline + size watchers
// ---------------------------------------------------------------------------

onMounted(() => {
    const pref = getLivePref()[props.entity.id];
    // A camera widget is meant to be watched — auto-start live at every size,
    // no manual button. Stream choice follows the card size (small = low).
    selectedStreamId.value = pref ? pref.streamId : defaultStreamForSize();

    document.addEventListener('visibilitychange', onVisibilityChange);

    if (!isOffline.value) startLive();
    else startPolling();
});

onBeforeUnmount(() => {
    stopPolling();
    if (snapshotObjectUrl) URL.revokeObjectURL(snapshotObjectUrl);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('click', closeQualityDropdown);
});

// Unified offline/online handler
watch(isOffline, (offline) => {
    if (offline) {
        stopPolling();
        if (liveMode.value) webrtc.stop();
    } else if (liveMode.value) {
        webrtc.start(selectedStreamId.value);
    } else {
        startPolling();
    }
});

// Stop live when resizing away from 2x2; start live when resizing to 2x2
watch(
    () => props.size,
    (newSize, oldSize) => {
        if (oldSize === '2x2' && newSize !== '2x2' && liveMode.value) {
            stopLive();
        } else if (
            newSize === '2x2' &&
            oldSize !== '2x2' &&
            !liveMode.value &&
            !isOffline.value
        ) {
            startLive();
        }
    }
);
</script>

<style scoped>
.ec-cam-preview {
    position: relative;
    width: 100%;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--color-overlay-light);
}

.ec-cam-preview--offline .ec-cam-img {
    opacity: 0.4;
}

.ec-cam-img {
    width: 100%;
    height: 100%;
    /* Show the whole 16:9 frame — never crop the scene to fill the card. */
    object-fit: contain;
    display: block;
}

.ec-cam-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--color-text-disabled);
    opacity: 0.3;
}

/* Fullscreen button */
.ec-cam-fullscreen {
    position: absolute;
    top: var(--space-1-5);
    right: var(--space-1-5);
    z-index: 3;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    background: rgba(var(--color-surface-bg-rgb), 0.7);
    border: 1px solid rgba(var(--color-frost-rgb), 0.2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--duration-fast), border-color var(--duration-fast);
}

.ec-cam-fullscreen:hover {
    color: var(--color-text-primary);
    border-color: rgba(var(--color-frost-rgb), 0.4);
}

/* Allow dropdown to escape overflow:hidden when open */
.ec-camera-feed--dd-open {
    overflow: visible;
}

/* Quality picker */
.ec-cam-quality {
    position: absolute;
    top: var(--space-1-5);
    left: var(--space-1-5);
    z-index: 3;
}

.ec-cam-res--click {
    cursor: pointer;
    background: rgba(var(--color-surface-bg-rgb), 0.7);
    border: 1px solid rgba(var(--color-frost-rgb), 0.2);
    border-radius: var(--radius-sm);
    padding: var(--space-0-5) var(--space-1-5);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    font-weight: 600;
    font-family: inherit;
    transition: border-color var(--duration-fast);
}

.ec-cam-res--click:hover {
    border-color: rgba(var(--color-frost-rgb), 0.4);
    color: var(--color-text-primary);
}

.ec-cam-quality-dd {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: var(--space-1);
    display: flex;
    flex-direction: column;
    background: rgba(var(--color-surface-bg-rgb), 0.9);
    border: 1px solid rgba(var(--color-frost-rgb), 0.2);
    border-radius: var(--radius-md);
    overflow: hidden;
    min-width: 100px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
}

.ec-cam-quality-opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-tertiary);
    background: none;
    border: none;
    border-bottom: 0.5px solid rgba(var(--color-frost-rgb), 0.1);
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    transition: background var(--duration-fast);
}

.ec-cam-quality-opt:last-child {
    border-bottom: none;
}

.ec-cam-quality-opt:hover {
    background: rgba(var(--color-frost-rgb), 0.06);
    color: var(--color-text-primary);
}

.ec-cam-quality-opt--active {
    color: var(--color-primary);
}

.ec-cam-quality-fps {
    font-size: var(--type-body);
    opacity: 0.6;
}

/* ── 1x1 offline image dim ── */
.ec-cam-img--offline {
    opacity: 0.4;
}

/* ── 2x2 hero stats bar (single row, matching prototype) ── */
.ec-cam-hero-stats {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    flex-wrap: wrap;
}

/* 1x1: hide quality picker, show only in fullscreen */
.ec-cam-quality--fs-only { display: none; }

/* ── Fullscreen: native aspect ratio + controls visible ── */
.ec-camera-feed:fullscreen,
.ec-camera-feed:-webkit-full-screen {
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.ec-camera-feed:fullscreen .ec-cam-quality--fs-only,
.ec-camera-feed:-webkit-full-screen .ec-cam-quality--fs-only {
    display: block;
}
.ec-camera-feed:fullscreen img,
.ec-camera-feed:fullscreen video,
.ec-camera-feed:-webkit-full-screen img,
.ec-camera-feed:-webkit-full-screen video {
    object-fit: contain;
    width: 100%;
    height: 100%;
}
</style>
