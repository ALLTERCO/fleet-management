<template>
    <div class="et-camera">
        <!-- Status badges -->
        <div class="et-camera__badges">
            <span v-if="isArmed" class="et-camera__badge et-camera__badge--armed">
                <i class="fas fa-shield-halved" /> Armed
            </span>
            <span v-else class="et-camera__badge et-camera__badge--disarmed">
                <i class="fas fa-shield" /> Disarmed
            </span>
            <span v-if="isPrivacy" class="et-camera__badge et-camera__badge--privacy">
                <i class="fas fa-eye-slash" /> Privacy
            </span>
            <span v-if="status?.motion" class="et-camera__badge et-camera__badge--motion">
                <i class="fas fa-person-walking" /> Motion
            </span>
            <span v-if="status?.recording" class="et-camera__badge et-camera__badge--recording">
                <i class="fas fa-circle" /> Recording
            </span>
        </div>

        <!-- Primary controls -->
        <div v-if="canExecute" class="et-camera__controls">
            <button
                class="et-camera__ctrl-btn"
                :class="isArmed && 'et-camera__ctrl-btn--active'"
                @click="emit('toggle-arm', !isArmed)"
            >
                <i :class="isArmed ? 'fas fa-shield-halved' : 'fas fa-shield'" />
                <span>{{ isArmed ? 'Disarm' : 'Arm' }}</span>
            </button>
            <button
                class="et-camera__ctrl-btn"
                :class="isPrivacy && 'et-camera__ctrl-btn--warn'"
                @click="emit('toggle-privacy', !isPrivacy)"
            >
                <i :class="isPrivacy ? 'fas fa-eye' : 'fas fa-eye-slash'" />
                <span>{{ isPrivacy ? 'Show' : 'Privacy' }}</span>
            </button>
            <button class="et-camera__ctrl-btn" :disabled="capturing" @click="captureSnapshot">
                <i :class="capturing ? 'fas fa-spinner fa-spin' : 'fas fa-camera'" />
                <span>Capture</span>
            </button>
            <button
                class="et-camera__ctrl-btn"
                :class="status?.recording && 'et-camera__ctrl-btn--rec'"
                @click="toggleRecording"
            >
                <i :class="status?.recording ? 'fas fa-stop' : 'fas fa-circle'" />
                <span>{{ status?.recording ? 'Stop Rec' : 'Record' }}</span>
            </button>
        </div>

        <!-- Snapshot preview -->
        <div v-if="snapshotUrl" class="et-camera__snapshot">
            <div class="et-camera__section-header">
                <i class="fas fa-image" /> Snapshot
                <button class="et-camera__snapshot-close" @click="snapshotUrl = null">
                    <i class="fas fa-xmark" />
                </button>
            </div>
            <img :src="snapshotUrl" class="et-camera__snapshot-img" alt="Camera snapshot" />
        </div>

        <!-- Live View (WebRTC stream) -->
        <div class="et-camera__live">
            <div class="et-camera__section-header">
                <i class="fas fa-video" /> Live View
                <span v-if="webrtc.streaming.value" class="et-camera__live-badge">LIVE</span>
            </div>
            <!-- Video area — always visible as a viewfinder -->
            <div class="et-camera__viewfinder" :class="webrtc.streaming.value && 'et-camera__viewfinder--active'">
                <video
                    ref="videoEl"
                    class="et-camera__video"
                    :class="!webrtc.streaming.value && 'et-camera__video--idle'"
                    playsinline autoplay muted
                />
                <!-- Idle overlay (camera icon + start buttons) -->
                <div v-if="!webrtc.streaming.value && !webrtc.connecting.value" class="et-camera__idle-overlay">
                    <i class="fas fa-video et-camera__idle-icon" />
                    <span class="et-camera__idle-text">Camera Preview</span>
                    <div class="et-camera__start-btns">
                        <button v-for="s in streams" :key="s.id" class="et-camera__start-btn" @click="startStream(Number(s.id))">
                            <i class="fas fa-play" /> {{ s.resolution }}
                        </button>
                        <button v-if="!streams.length" class="et-camera__start-btn" @click="startStream(0)">
                            <i class="fas fa-play" /> Start Stream
                        </button>
                    </div>
                </div>
                <!-- Connecting overlay -->
                <div v-if="webrtc.connecting.value" class="et-camera__idle-overlay">
                    <i class="fas fa-spinner fa-spin et-camera__idle-icon" />
                    <span class="et-camera__connecting-text">Connecting to stream...</span>
                    <button class="et-camera__start-btn" @click="webrtc.stop()">
                        <i class="fas fa-xmark" /> Cancel
                    </button>
                </div>
                <!-- Stream controls overlay (visible when streaming, shown on hover) -->
                <div v-if="webrtc.streaming.value" class="et-camera__stream-overlay">
                    <div class="et-camera__stream-info">
                        <span class="et-camera__live-dot" /> Stream #{{ activeStreamId }}
                    </div>
                    <div class="et-camera__stream-actions">
                        <div v-if="streams.length > 1" class="et-camera__quality-bar">
                            <button
                                v-for="s in streams" :key="s.id"
                                class="et-camera__quality-btn"
                                :class="activeStreamId === Number(s.id) && 'et-camera__quality-btn--active'"
                                @click="switchStream(Number(s.id))"
                            >
                                {{ s.resolution }}
                            </button>
                        </div>
                        <button class="et-camera__stop-btn" @click="webrtc.stop()">
                            <i class="fas fa-stop" /> Stop
                        </button>
                    </div>
                </div>
            </div>
            <div v-if="webrtc.error.value" class="et-camera__error-msg">
                <i class="fas fa-triangle-exclamation" /> <span>{{ webrtc.error.value }}</span>
            </div>
        </div>

        <!-- Video Settings (editable) -->
        <div v-if="videoConfig && canExecute" class="et-camera__section">
            <div class="et-camera__section-header">
                <i class="fas fa-sliders" /> Video Settings
            </div>
            <HorizontalSlider :value="videoConfig.brightness ?? 50" :min="0" :max="100" @change="(v: number) => setVideoSetting('brightness', v)">
                <template #title>Brightness ({{ videoConfig.brightness ?? 50 }})</template>
            </HorizontalSlider>
            <HorizontalSlider :value="videoConfig.contrast ?? 50" :min="0" :max="100" @change="(v: number) => setVideoSetting('contrast', v)">
                <template #title>Contrast ({{ videoConfig.contrast ?? 50 }})</template>
            </HorizontalSlider>
            <HorizontalSlider :value="videoConfig.saturation ?? 50" :min="0" :max="100" @change="(v: number) => setVideoSetting('saturation', v)">
                <template #title>Saturation ({{ videoConfig.saturation ?? 50 }})</template>
            </HorizontalSlider>
            <HorizontalSlider :value="videoConfig.sharpness ?? 50" :min="0" :max="100" @change="(v: number) => setVideoSetting('sharpness', v)">
                <template #title>Sharpness ({{ videoConfig.sharpness ?? 50 }})</template>
            </HorizontalSlider>
            <div class="et-camera__toggle-row">
                <span class="et-camera__toggle-label">Flip</span>
                <button class="et-camera__toggle-btn" :class="videoConfig.flip && 'et-camera__toggle-btn--on'" @click="setVideoSetting('flip', !videoConfig.flip)">
                    {{ videoConfig.flip ? 'ON' : 'OFF' }}
                </button>
                <span class="et-camera__toggle-label">Mirror</span>
                <button class="et-camera__toggle-btn" :class="videoConfig.mirror && 'et-camera__toggle-btn--on'" @click="setVideoSetting('mirror', !videoConfig.mirror)">
                    {{ videoConfig.mirror ? 'ON' : 'OFF' }}
                </button>
            </div>
        </div>
        <!-- Video Settings (read-only when no execute permission) -->
        <div v-else-if="videoConfig" class="et-camera__section">
            <div class="et-camera__section-header"><i class="fas fa-sliders" /> Video</div>
            <div class="et-camera__kv-grid">
                <div class="et-camera__kv"><span>Brightness</span><span>{{ videoConfig.brightness }}</span></div>
                <div class="et-camera__kv"><span>Contrast</span><span>{{ videoConfig.contrast }}</span></div>
                <div class="et-camera__kv"><span>Saturation</span><span>{{ videoConfig.saturation }}</span></div>
                <div class="et-camera__kv"><span>Sharpness</span><span>{{ videoConfig.sharpness }}</span></div>
                <div class="et-camera__kv"><span>Flip / Mirror</span><span>{{ videoConfig.flip ? 'Yes' : 'No' }} / {{ videoConfig.mirror ? 'Yes' : 'No' }}</span></div>
            </div>
        </div>

        <!-- Audio Settings (editable) -->
        <div v-if="audioConfig && canExecute" class="et-camera__section">
            <div class="et-camera__section-header">
                <i class="fas fa-volume-high" /> Audio
                <button class="et-camera__toggle-btn" :class="audioConfig.enable && 'et-camera__toggle-btn--on'" style="margin-left:auto" @click="setCameraConfig({audio: {enable: !audioConfig.enable}})">
                    {{ audioConfig.enable ? 'ON' : 'OFF' }}
                </button>
            </div>
            <HorizontalSlider
                v-if="audioConfig.output?.volume != null"
                :value="audioConfig.output.volume"
                :min="0" :max="100"
                @change="(v: number) => setCameraConfig({audio: {output: {volume: v}}})"
            >
                <template #title>Volume ({{ audioConfig.output.volume }}%)</template>
            </HorizontalSlider>
        </div>
        <div v-else-if="audioConfig" class="et-camera__section">
            <div class="et-camera__section-header"><i class="fas fa-volume-high" /> Audio</div>
            <div class="et-camera__kv-grid">
                <div class="et-camera__kv"><span>Enabled</span><span>{{ audioConfig.enable ? 'Yes' : 'No' }}</span></div>
                <div v-if="audioConfig.output?.volume != null" class="et-camera__kv"><span>Volume</span><span>{{ audioConfig.output.volume }}%</span></div>
            </div>
        </div>

        <!-- Stream Configuration (editable) -->
        <div v-if="streams.length" class="et-camera__section">
            <div class="et-camera__section-header">
                <i class="fas fa-gear" /> Stream Config
                <span v-if="capabilities" class="et-camera__cap-badge">{{ capabilities.resolutions?.length ?? 0 }} resolutions</span>
            </div>
            <div v-for="s in streams" :key="s.id" class="et-camera__stream-config">
                <div class="et-camera__stream-config-header">
                    <span class="et-camera__stream-label">Stream #{{ s.id }}</span>
                    <span class="et-camera__stream-res">{{ s.resolution }} · {{ formatBitrate(s.bitrate) }}</span>
                </div>
                <select
                    v-if="canExecute && capabilities?.resolutions?.length"
                    class="et-camera__select"
                    :value="s.resolution"
                    @change="(e: Event) => saveStreamConfig(s.id, {resolution: (e.target as HTMLSelectElement).value})"
                >
                    <option v-for="r in capabilities.resolutions" :key="r" :value="r">{{ r }}</option>
                </select>
                <HorizontalSlider
                    v-if="canExecute && capabilities"
                    :value="s.bitrate"
                    :min="capabilities.bitrate_range?.[0] ?? 512"
                    :max="capabilities.bitrate_range?.[1] ?? 4096"
                    @change="(v: number) => saveStreamConfig(s.id, {bitrate: v})"
                >
                    <template #title>Bitrate ({{ s.bitrate }} Kbps)</template>
                </HorizontalSlider>
            </div>
            <div v-if="streamConfigSaved" class="et-camera__saved-msg">
                <i class="fas fa-check" /> Saved — <template v-if="webrtc.streaming.value">
                    <button class="et-camera__restart-link" @click="restartStream">restart stream to apply</button>
                </template>
                <template v-else>takes effect on next stream start</template>
            </div>
        </div>

        <!-- Storage -->
        <div class="et-camera__section">
            <div class="et-camera__section-header">
                <i class="fas fa-sd-card" /> Storage
            </div>
            <div v-if="storageStatus && !storageStatus.present" class="et-camera__storage-empty">
                <i class="fas fa-sd-card" /> <span>No card inserted</span>
            </div>
            <template v-if="storageStatus?.present">
                <div class="et-camera__kv-grid">
                    <div class="et-camera__kv"><span>Active</span><span>{{ storageStatus.active ? 'Yes' : 'No' }}</span></div>
                    <div v-if="storageStatus.fs_size > 0" class="et-camera__kv">
                        <span>Free Space</span><span>{{ formatBytes(storageStatus.fs_free) }} / {{ formatBytes(storageStatus.fs_size) }}</span>
                    </div>
                </div>
                <div v-if="canExecute" class="et-camera__storage-actions">
                    <button class="et-camera__ctrl-btn" :disabled="storageLoading" @click="storageAction('Storage.Eject')">
                        <i class="fas fa-eject" /> Eject
                    </button>
                    <button class="et-camera__ctrl-btn et-camera__ctrl-btn--danger" :disabled="storageLoading" @click="confirmFormat">
                        <i class="fas fa-eraser" /> Format
                    </button>
                </div>
            </template>
            <!-- NFS config -->
            <div v-if="canExecute" class="et-camera__nfs">
                <div class="et-camera__nfs-header">
                    <i class="fas fa-network-wired" /> NFS Storage
                </div>
                <div class="et-camera__nfs-fields">
                    <input v-model="nfsHost" class="et-camera__input" placeholder="NFS Host (e.g. 192.168.1.100)" aria-label="NFS Host" />
                    <input v-model="nfsPath" class="et-camera__input" placeholder="NFS Path (e.g. /recordings)" aria-label="NFS Path" />
                    <button class="et-camera__ctrl-btn" :disabled="!nfsHost" @click="saveNfsConfig">
                        <i class="fas fa-save" /> Save NFS
                    </button>
                </div>
            </div>
            <!-- File listing -->
            <template v-if="storageStatus?.present && storageStatus?.active">
                <div class="et-camera__section-header" style="margin-top: 0.5rem;">
                    <i class="fas fa-folder-open" /> Recordings
                    <button class="et-camera__cap-badge" style="cursor:pointer" @click="loadFiles">
                        <i :class="filesLoading ? 'fas fa-spinner fa-spin' : 'fas fa-rotate'" />
                    </button>
                </div>
                <div v-if="storageFiles.length" class="et-camera__file-list">
                    <div v-for="file in storageFiles" :key="file.name" class="et-camera__file-row">
                        <span class="et-camera__file-name">{{ file.name }}</span>
                        <span class="et-camera__file-size">{{ formatBytes(file.size ?? 0) }}</span>
                        <button v-if="canExecute" class="et-camera__zone-del" @click="deleteFile(file.name)">
                            <i class="fas fa-trash" />
                        </button>
                    </div>
                </div>
                <div v-else-if="!filesLoading && filesLoaded" class="et-camera__storage-empty">
                    <span>No recordings</span>
                </div>
            </template>
            <div v-if="storageError" class="et-camera__error-msg">
                <i class="fas fa-triangle-exclamation" /> {{ storageError }}
            </div>
        </div>

        <!-- Camera Zones (editable) -->
        <div v-if="cameraZones.length || canExecute" class="et-camera__section">
            <div class="et-camera__section-header">
                <i class="fas fa-vector-square" /> Zones
                <span v-if="capabilities" class="et-camera__cap-badge">max {{ capabilities.max_zones ?? '?' }}</span>
            </div>
            <div v-for="zone in cameraZones" :key="zone.id" class="et-camera__zone">
                <span class="et-camera__zone-dot" :style="{backgroundColor: zoneColor(zone.config?.color)}" />
                <input
                    v-if="canExecute"
                    class="et-camera__zone-input"
                    :value="zone.config?.name || ''"
                    placeholder="Zone name"
                    @change="(e: Event) => setZoneConfig(zone.id, {name: (e.target as HTMLInputElement).value})"
                />
                <span v-else class="et-camera__zone-name">{{ zone.config?.name || `Zone ${zone.id}` }}</span>
                <span v-if="zone.motion" class="et-camera__zone-motion"><i class="fas fa-person-walking" /></span>
                <button
                    v-if="canExecute"
                    class="et-camera__toggle-btn"
                    :class="zone.config?.enable !== false && 'et-camera__toggle-btn--on'"
                    @click="setZoneConfig(zone.id, {enable: zone.config?.enable === false})"
                >
                    {{ zone.config?.enable !== false ? 'On' : 'Off' }}
                </button>
                <button v-if="canExecute" class="et-camera__zone-del" @click="deleteZone(zone.id)">
                    <i class="fas fa-trash" />
                </button>
            </div>
            <div v-if="canExecute" class="et-camera__zone-add">
                <input v-model="newZoneName" class="et-camera__zone-input" placeholder="New zone name" />
                <button class="et-camera__ctrl-btn" :disabled="!newZoneName" @click="addZone">
                    <i class="fas fa-plus" /> Add Zone
                </button>
            </div>
            <div v-if="zoneError" class="et-camera__error-msg">
                <i class="fas fa-triangle-exclamation" /> {{ zoneError }}
            </div>
        </div>

        <!-- Night Vision / IR -->
        <div v-if="nightVisionConfig && canExecute" class="et-camera__section">
            <div class="et-camera__section-header">
                <i class="fas fa-moon" /> Night Vision
            </div>
            <div class="et-camera__nv-modes">
                <button
                    v-for="mode in ['auto', 'on', 'off']" :key="mode"
                    class="et-camera__nv-btn"
                    :class="nightVisionConfig.mode === mode && 'et-camera__nv-btn--active'"
                    @click="setNightVision(mode)"
                >
                    <i :class="mode === 'auto' ? 'fas fa-wand-magic-sparkles' : mode === 'on' ? 'fas fa-moon' : 'fas fa-sun'" />
                    {{ mode.charAt(0).toUpperCase() + mode.slice(1) }}
                </button>
            </div>
        </div>
        <div v-else-if="nightVisionConfig" class="et-camera__section">
            <div class="et-camera__section-header"><i class="fas fa-moon" /> Night Vision</div>
            <div class="et-camera__kv-grid">
                <div class="et-camera__kv"><span>Mode</span><span>{{ nightVisionConfig.mode ?? '—' }}</span></div>
            </div>
        </div>

        <!-- Motion Detection -->
        <div v-if="motionConfig && canExecute" class="et-camera__section">
            <div class="et-camera__section-header">
                <i class="fas fa-person-walking" /> Motion Detection
                <button
                    class="et-camera__toggle-btn"
                    :class="motionConfig.enable !== false && 'et-camera__toggle-btn--on'"
                    style="margin-left:auto"
                    @click="toggleMotionDetection(motionConfig.enable === false)"
                >
                    {{ motionConfig.enable !== false ? 'ON' : 'OFF' }}
                </button>
            </div>
            <HorizontalSlider
                v-if="motionConfig.enable !== false && motionConfig.sensitivity != null"
                :value="motionConfig.sensitivity"
                :min="0" :max="100"
                @change="(v: number) => setMotionSensitivity(v)"
            >
                <template #title>Sensitivity ({{ motionConfig.sensitivity }})</template>
            </HorizontalSlider>
        </div>
        <div v-else-if="motionConfig" class="et-camera__section">
            <div class="et-camera__section-header"><i class="fas fa-person-walking" /> Motion Detection</div>
            <div class="et-camera__kv-grid">
                <div class="et-camera__kv"><span>Enabled</span><span>{{ motionConfig.enable !== false ? 'Yes' : 'No' }}</span></div>
                <div v-if="motionConfig.sensitivity != null" class="et-camera__kv"><span>Sensitivity</span><span>{{ motionConfig.sensitivity }}</span></div>
            </div>
        </div>

        <!-- Config error (global) -->
        <div v-if="configError" class="et-camera__error-msg">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, toRef} from 'vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';
import {useWebRtcStream} from '@/composables/useWebRtcStream';
import {useDevicesStore} from '@/stores/devices';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    storageStatus?: Record<string, any>;
    cameraZones?: Array<{
        id: number;
        motion?: boolean;
        config?: Record<string, any>;
    }>;
}>();

const emit = defineEmits<{
    'toggle-arm': [boolean];
    'toggle-privacy': [boolean];
    capture: [];
    'start-recording': [];
    'stop-recording': [];
}>();

const deviceStore = useDevicesStore();

// -- WebRTC stream --
const shellyIDRef = toRef(props, 'shellyID');
const webrtc = useWebRtcStream(shellyIDRef as any);
const videoEl = webrtc.videoEl;

// -- State --
const configError = ref<string | null>(null);
const storageError = ref<string | null>(null);
const zoneError = ref<string | null>(null);
const storageLoading = ref(false);
const newZoneName = ref('');
const storageFiles = ref<{name: string; size?: number}[]>([]);
const filesLoading = ref(false);
const filesLoaded = ref(false);
const capabilities = ref<Record<string, any> | null>(null);
const activeStreamId = ref(0);
const streamConfigSaved = ref(false);
const snapshotUrl = ref<string | null>(null);
const capturing = ref(false);

const nfsHost = ref('');
const nfsPath = ref('');

// -- Computed --
const isArmed = computed(() => props.settings?.arm ?? false);
const isPrivacy = computed(() => props.settings?.privacy ?? false);
const videoConfig = computed(() => props.settings?.video ?? null);
const audioConfig = computed(() => props.settings?.audio ?? null);
const storageStatus = computed(() => props.storageStatus ?? null);
const cameraZones = computed(() => props.cameraZones ?? []);

const nightVisionConfig = computed(() => props.settings?.night_vision ?? null);
const motionConfig = computed(() => props.settings?.motion_detection ?? null);

const streams = computed(() => {
    const s = props.settings?.streams;
    if (!s || typeof s !== 'object') return [];
    return Object.entries(s).map(([id, cfg]: [string, any]) => ({
        id,
        resolution: cfg.resolution ?? '—',
        bitrate: cfg.bitrate ?? 0
    }));
});

async function setCameraConfig(config: Record<string, any>) {
    if (!props.shellyID) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Camera.SetConfig', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 0,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to update config';
    }
}

function setVideoSetting(key: string, value: any) {
    setCameraConfig({video: {[key]: value}});
}

// Tracked timers so unmount mid-action doesn't write to dead refs or kick off
// a webrtc.start against a torn-down peer connection.
let savedFlashTimer: ReturnType<typeof setTimeout> | undefined;
let restartTimer: ReturnType<typeof setTimeout> | undefined;

/** Save stream config with visual feedback */
async function saveStreamConfig(streamId: string, config: Record<string, any>) {
    await setCameraConfig({streams: {[streamId]: config}});
    if (!configError.value) {
        streamConfigSaved.value = true;
        if (savedFlashTimer !== undefined) clearTimeout(savedFlashTimer);
        savedFlashTimer = setTimeout(() => {
            streamConfigSaved.value = false;
            savedFlashTimer = undefined;
        }, 2000);
    }
}

/** Start a stream and track which one is active */
function startStream(streamId: number) {
    activeStreamId.value = streamId;
    webrtc.start(streamId);
}

/** Switch to a different stream quality while viewing */
function switchStream(streamId: number) {
    activeStreamId.value = streamId;
    webrtc.changeStream(streamId);
}

/** Restart stream to apply config changes */
function restartStream() {
    const id = activeStreamId.value;
    webrtc.stop();
    if (restartTimer !== undefined) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        restartTimer = undefined;
        startStream(id);
    }, 500);
}

// -- Snapshot & Recording --

async function captureSnapshot() {
    if (!props.shellyID || capturing.value) return;
    capturing.value = true;
    try {
        const result = await sendRPC<{url?: string}>(
            'FLEET_MANAGER',
            'Camera.CaptureImage',
            {shellyID: props.shellyID, id: props.status?.id ?? 0}
        );
        if (result?.url) {
            snapshotUrl.value = result.url;
        }
    } catch (e: any) {
        configError.value = e.message || 'Failed to capture snapshot';
    }
    capturing.value = false;
}

function toggleRecording() {
    if (props.status?.recording) {
        emit('stop-recording');
    } else {
        emit('start-recording');
    }
}

function setNightVision(mode: string) {
    setCameraConfig({night_vision: {mode}});
}

function setMotionSensitivity(sensitivity: number) {
    setCameraConfig({motion_detection: {sensitivity}});
}

function toggleMotionDetection(enable: boolean) {
    setCameraConfig({motion_detection: {enable}});
}

async function setZoneConfig(zoneId: number, config: Record<string, any>) {
    if (!props.shellyID) return;
    zoneError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Camera.Zone.SetConfig', {
            shellyID: props.shellyID,
            id: zoneId,
            config
        });
    } catch (e: any) {
        zoneError.value = e.message || 'Failed to update zone';
    }
}

async function deleteZone(zoneId: number) {
    if (!props.shellyID) return;
    zoneError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Camera.DeleteZone', {
            shellyID: props.shellyID,
            id: zoneId
        });
    } catch (e: any) {
        zoneError.value = e.message || 'Failed to delete zone';
    }
}

async function addZone() {
    if (!props.shellyID || !newZoneName.value) return;
    zoneError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Camera.AddZone', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 0,
            config: {
                name: newZoneName.value,
                enable: true,
                coordinates: [0, 0, 0, 10000, 10000, 10000, 10000, 0]
            }
        });
        newZoneName.value = '';
    } catch (e: any) {
        zoneError.value = e.message || 'Failed to add zone';
    }
}

async function loadFiles() {
    if (!props.shellyID) return;
    filesLoading.value = true;
    storageError.value = null;
    try {
        const result = await sendRPC<{items?: Array<{name: string}>}>(
            'FLEET_MANAGER',
            'Camera.Storage.List',
            {shellyID: props.shellyID}
        );
        storageFiles.value = result?.items ?? [];
        filesLoaded.value = true;
    } catch (e: any) {
        storageError.value = e.message || 'Failed to list files';
    } finally {
        filesLoading.value = false;
    }
}

async function deleteFile(name: string) {
    if (!props.shellyID) return;
    if (!window.confirm(`Delete recording "${name}"?`)) return;
    storageError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Camera.Storage.Delete', {
            shellyID: props.shellyID,
            name
        });
        storageFiles.value = storageFiles.value.filter((f) => f.name !== name);
    } catch (e: any) {
        storageError.value = e.message || 'Failed to delete file';
    }
}

async function storageAction(method: 'Storage.Format' | 'Storage.Eject') {
    if (!props.shellyID) return;
    storageError.value = null;
    storageLoading.value = true;
    try {
        const rpcMethod =
            method === 'Storage.Format'
                ? 'Camera.Storage.Format'
                : 'Camera.Storage.Eject';
        await sendRPC('FLEET_MANAGER', rpcMethod, {shellyID: props.shellyID});
    } catch (e: any) {
        storageError.value = e.message || `${method} failed`;
    }
    storageLoading.value = false;
}

function confirmFormat() {
    if (confirm('Format storage? All recordings will be deleted.')) {
        storageAction('Storage.Format');
    }
}

async function saveNfsConfig() {
    if (!props.shellyID) return;
    storageError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Camera.Storage.SetConfig', {
            shellyID: props.shellyID,
            config: {
                nfs: {host: nfsHost.value || null, path: nfsPath.value || null}
            }
        });
    } catch (e: any) {
        storageError.value = e.message || 'Failed to save NFS config';
    }
}

onBeforeUnmount(() => {
    if (savedFlashTimer !== undefined) clearTimeout(savedFlashTimer);
    if (restartTimer !== undefined) clearTimeout(restartTimer);
});

onMounted(async () => {
    if (!props.shellyID) return;
    try {
        const caps = await sendRPC<Record<string, any>>(
            'FLEET_MANAGER',
            'Camera.GetCapabilities',
            {shellyID: props.shellyID, id: props.status?.id ?? 0}
        );
        capabilities.value = caps;
    } catch {
        // Non-critical — just won't have validation
    }

    try {
        const storageCfg = await sendRPC<{nfs?: {host?: string; path?: string}}>(
            'FLEET_MANAGER',
            'Camera.Storage.GetConfig',
            {shellyID: props.shellyID}
        );
        if (storageCfg?.nfs) {
            nfsHost.value = storageCfg.nfs.host || '';
            nfsPath.value = storageCfg.nfs.path || '';
        }
    } catch {
        // Non-critical — NFS fields stay empty
    }
});

// -- Helpers --
function formatBitrate(kbps: number): string {
    if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} Mbps`;
    return `${kbps} Kbps`;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(0)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
}

function zoneColor(rgb?: number[]): string {
    if (!rgb || rgb.length < 3) return 'var(--color-text-disabled)';
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
</script>

<style scoped>
.et-camera {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

/* Badges */
.et-camera__badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
}
.et-camera__badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
    letter-spacing: var(--tracking-wide);
}
.et-camera__badge--armed {
    background-color: color-mix(in srgb, var(--color-success) 15%, transparent);
    color: var(--color-success-text);
}
.et-camera__badge--disarmed {
    background-color: var(--color-surface-2);
    color: var(--color-text-disabled);
}
.et-camera__badge--privacy {
    background-color: color-mix(in srgb, var(--color-status-warn) 15%, transparent);
    color: var(--color-warning-text);
}
.et-camera__badge--motion {
    background-color: color-mix(in srgb, var(--color-danger) 15%, transparent);
    color: var(--color-danger-text);
    animation: pulse-badge 1.5s ease-in-out infinite;
}
.et-camera__badge--recording {
    background-color: color-mix(in srgb, var(--color-status-off) 15%, transparent);
    color: var(--color-danger-text);
    animation: pulse-badge 1.5s ease-in-out infinite;
}
@keyframes pulse-badge {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

/* Controls */
.et-camera__controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1-5);
}
.et-camera__ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.et-camera__ctrl-btn:hover:not(:disabled) {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-camera__ctrl-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.et-camera__ctrl-btn--active {
    background-color: color-mix(in srgb, var(--color-success) 15%, transparent);
    border-color: var(--color-success);
    color: var(--color-success-text);
}
.et-camera__ctrl-btn--warn {
    background-color: color-mix(in srgb, var(--color-status-warn) 15%, transparent);
    border-color: var(--color-status-warn);
    color: var(--color-warning-text);
}
.et-camera__ctrl-btn--rec {
    background-color: color-mix(in srgb, var(--color-status-off) 15%, transparent);
    border-color: var(--color-status-off);
    color: var(--color-danger-text);
}
.et-camera__ctrl-btn--danger {
    color: var(--color-danger-text);
}
.et-camera__ctrl-btn--danger:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-danger) 15%, transparent);
}

/* Sections */
.et-camera__section {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}
.et-camera__section-header {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}

/* Live View */
.et-camera__live {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}
.et-camera__live-badge {
    margin-left: auto;
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-status-off);
    letter-spacing: var(--tracking-wide);
    animation: pulse-badge 1.5s ease-in-out infinite;
}
.et-camera__viewfinder {
    position: relative;
    width: 100%;
    border-radius: var(--radius-md);
    overflow: hidden;
    background-color: var(--color-surface-0);
    aspect-ratio: 16 / 9;
    border: 1px solid var(--color-border-default);
    transition: border-color 0.2s ease;
}
.et-camera__viewfinder--active {
    border-color: var(--color-primary);
}
.et-camera__video {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
}
.et-camera__video--idle {
    opacity: 0;
}
/* Idle overlay — centered camera icon + stream buttons */
.et-camera__idle-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    /* Dark feed backdrop — intentionally darker than --color-surface-bg to simulate "no signal". */
    background: radial-gradient(
        ellipse at center,
        rgba(var(--color-surface-bg-rgb), 0.95) 0%,
        rgba(0, 0, 0, 0.98) 100%
    );
}
.et-camera__idle-icon {
    font-size: var(--type-subheading);
    color: var(--color-text-disabled);
    opacity: 0.5;
}
.et-camera__idle-text {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    letter-spacing: var(--tracking-wide);
    text-transform: none;
}
.et-camera__connecting-text {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.et-camera__start-btns {
    display: flex;
    gap: var(--space-1-5);
    flex-wrap: wrap;
    justify-content: center;
    padding: var(--space-1) var(--space-2) 0;
}
.et-camera__start-btn {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-strong);
    background-color: var(--state-hover-bg-strong);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;
}
.et-camera__start-btn:hover {
    background-color: var(--color-text-disabled);
    border-color: var(--color-text-quaternary);
}
/* Stream controls overlay — bottom bar when streaming */
.et-camera__stream-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2);
    background: linear-gradient(transparent, var(--color-overlay-heavy));
    opacity: 0;
    transition: opacity 0.2s ease;
}
.et-camera__viewfinder:hover .et-camera__stream-overlay {
    opacity: 1;
}
.et-camera__stream-info {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    color: var(--color-text-primary);
    font-weight: var(--font-medium);
}
.et-camera__live-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background-color: var(--color-status-off);
    animation: pulse-badge 1.5s ease-in-out infinite;
}
.et-camera__stream-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
}
.et-camera__quality-bar {
    display: flex;
    gap: var(--space-1);
}
.et-camera__quality-btn {
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-strong);
    background-color: var(--color-overlay-light);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: all 0.15s ease;
}
.et-camera__quality-btn:hover {
    background-color: var(--color-text-disabled);
    color: var(--color-text-inverse);
}
.et-camera__quality-btn--active {
    background-color: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-inverse);
}
.et-camera__stop-btn {
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-strong);
    background-color: rgba(var(--color-danger-rgb), 0.4);
    color: var(--color-danger-text);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
}
.et-camera__stop-btn:hover {
    background-color: rgba(var(--color-danger-rgb), 0.6);
}
.et-camera__restart-link {
    color: var(--color-primary);
    cursor: pointer;
    text-decoration: underline;
    font-size: var(--type-body);
}
.et-camera__restart-link:hover {
    color: var(--color-primary-hover);
}

/* Key-value grid (read-only rows) */
.et-camera__kv-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.et-camera__kv {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--type-body);
}
.et-camera__kv > span:first-child {
    color: var(--color-text-disabled);
}
.et-camera__kv > span:last-child {
    color: var(--color-text-tertiary);
    font-weight: var(--font-medium);
}

/* Toggle buttons */
.et-camera__toggle-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
}
.et-camera__toggle-label {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}
.et-camera__toggle-btn {
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
    color: var(--color-text-disabled);
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    cursor: pointer;
    letter-spacing: var(--tracking-wide);
    transition: all var(--duration-fast) var(--ease-default);
}
.et-camera__toggle-btn--on {
    background-color: color-mix(in srgb, var(--color-success) 15%, transparent);
    border-color: var(--color-success);
    color: var(--color-success-text);
}

/* Stream config */
.et-camera__config-notice {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    padding: var(--space-0-5) 0;
}
.et-camera__stream-config {
    padding: var(--space-1-5);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.et-camera__stream-config-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.et-camera__stream-label {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-disabled);
}
.et-camera__stream-res {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    font-weight: var(--font-medium);
}
.et-camera__saved-msg {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-success-text);
    font-weight: var(--font-medium);
    animation: fade-saved 2s ease forwards;
}
@keyframes fade-saved {
    0%, 70% { opacity: 1; }
    100% { opacity: 0; }
}
.et-camera__select {
    padding: var(--space-1) var(--space-1-5);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    cursor: pointer;
}
.et-camera__cap-badge {
    margin-left: auto;
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-disabled);
}

/* Storage */
.et-camera__storage-empty {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    padding: var(--space-1) 0;
}
.et-camera__storage-actions {
    display: flex;
    gap: var(--space-1-5);
}
.et-camera__storage-actions .et-camera__ctrl-btn {
    flex: 1;
    font-size: var(--type-body);
    padding: var(--space-1-5);
}

/* NFS */
.et-camera__nfs {
    border-top: 1px solid var(--color-border-default);
    padding-top: var(--space-1-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}
.et-camera__nfs-header {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-disabled);
}
.et-camera__nfs-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.et-camera__input {
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}
.et-camera__input::placeholder {
    color: var(--color-text-disabled);
}

/* Zones */
.et-camera__zone {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1) var(--space-1-5);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-2);
    font-size: var(--type-body);
}
.et-camera__zone-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
}
.et-camera__zone-name {
    color: var(--color-text-tertiary);
    font-weight: var(--font-medium);
    flex: 1;
}
.et-camera__zone-input {
    flex: 1;
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
}
.et-camera__zone-input:focus {
    border-color: var(--color-border-strong);
    background-color: var(--color-surface-3);
    outline: none;
}
.et-camera__zone-motion {
    color: var(--color-danger-text);
    animation: pulse-badge 1.5s ease-in-out infinite;
}
.et-camera__zone-del {
    color: var(--color-text-disabled);
    cursor: pointer;
    padding: var(--space-0-5);
    font-size: var(--type-body);
}
.et-camera__zone-del:hover {
    color: var(--color-danger-text);
}
.et-camera__zone-add {
    display: flex;
    gap: var(--space-1-5);
    align-items: center;
}
.et-camera__file-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    max-height: 10rem;
    overflow-y: auto;
}
.et-camera__file-row {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-sm);
}
.et-camera__file-row:nth-child(even) {
    background-color: var(--color-surface-2);
}
.et-camera__file-name {
    flex: 1;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.et-camera__file-size {
    color: var(--color-text-disabled);
    flex-shrink: 0;
}

/* Snapshot preview */
.et-camera__snapshot {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}
.et-camera__snapshot-close {
    margin-left: auto;
    color: var(--color-text-disabled);
    cursor: pointer;
    padding: var(--space-0-5);
    font-size: var(--type-body);
}
.et-camera__snapshot-close:hover {
    color: var(--color-text-primary);
}
.et-camera__snapshot-img {
    width: 100%;
    border-radius: var(--radius-sm);
    object-fit: contain;
}

/* Night vision mode buttons */
.et-camera__nv-modes {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-1-5);
}
.et-camera__nv-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-1-5);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
    color: var(--color-text-disabled);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-default);
}
.et-camera__nv-btn:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-camera__nv-btn--active {
    background-color: color-mix(in srgb, var(--color-primary) 15%, transparent);
    border-color: var(--color-primary);
    color: var(--color-primary);
}

/* Error */
.et-camera__error-msg {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    color: var(--color-danger-text);
    padding: var(--space-1) 0;
}
</style>
