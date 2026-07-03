<template>
    <div class="et-media">
        <!-- Now playing -->
        <div class="et-media__now-playing">
            <img
                v-if="mediaMeta?.thumb"
                :src="safeUrl(mediaMeta.thumb)"
                class="et-media__thumb"
                alt=""
            />
            <i v-else class="fas et-media__icon" :class="isPlaying ? 'fa-circle-play' : 'fa-circle-stop'" />
            <div class="et-media__track">
                <span class="et-media__title">{{ trackTitle }}</span>
                <span v-if="mediaType" class="et-media__type-badge">{{ mediaType }}</span>
            </div>
        </div>

        <!-- Playback controls -->
        <div v-if="canExecute" class="et-media__controls">
            <button class="et-media__btn" :disabled="busy" @click="doAction('prev')">
                <i class="fas fa-backward-step" />
            </button>
            <button
                class="et-media__btn et-media__btn--main"
                :class="busy && 'et-media__btn--loading'"
                :disabled="busy"
                @click="doAction('play-pause')"
            >
                <i v-if="busy" class="fas fa-spinner fa-spin" />
                <i v-else class="fas" :class="isPlaying ? 'fa-pause' : 'fa-play'" />
            </button>
            <button class="et-media__btn" :disabled="busy" @click="doAction('next')">
                <i class="fas fa-forward-step" />
            </button>
        </div>

        <!-- Volume slider (0-10) -->
        <div v-if="canExecute && hasVolume" class="et-media__volume">
            <HorizontalSlider
                :value="volume"
                :min="0" :max="10"
                :saved="{'0': 0, '3': 3, '5': 5, '7': 7, '10': 10}"
                :disabled="!canExecute"
                @change="(v: number) => doAction('set-volume', v)"
            >
                <template #title>
                    <i class="fas fa-volume-high" /> {{ volume }} / 10
                </template>
            </HorizontalSlider>
        </div>

        <!-- Radio section -->
        <div v-if="canExecute" class="et-media__section">
            <div class="et-media__section-header">
                <i class="fas fa-radio" /> Radio
            </div>
            <div class="et-media__radio-controls" :class="isRadio && isPlaying && 'et-media__radio-controls--playing'">
                <button class="et-media__radio-btn" :disabled="busy" @click="doAction('radio-prev')">
                    <i class="fas fa-backward" />
                    <span>Prev</span>
                </button>
                <template v-if="isRadio && isPlaying">
                    <button
                        class="et-media__radio-btn et-media__radio-btn--pause"
                        :disabled="busy"
                        @click="doAction('play-pause')"
                    >
                        <i class="fas fa-pause" />
                        <span>Pause</span>
                    </button>
                    <button
                        class="et-media__radio-btn et-media__radio-btn--stop"
                        :disabled="busy"
                        @click="doAction('radio-stop')"
                    >
                        <i class="fas fa-stop" />
                        <span>Stop</span>
                    </button>
                </template>
                <button
                    v-else
                    class="et-media__radio-btn"
                    :disabled="busy"
                    @click="playRadio"
                >
                    <i class="fas fa-play" />
                    <span>Play</span>
                </button>
                <button class="et-media__radio-btn" :disabled="busy" @click="doAction('radio-next')">
                    <i class="fas fa-forward" />
                    <span>Next</span>
                </button>
            </div>

            <!-- Favourites list -->
            <div v-if="favourites.length" class="et-media__favourites">
                <span class="et-media__list-label">Favourites</span>
                <button
                    v-for="(fav, i) in favourites"
                    :key="'fav-' + i"
                    class="et-media__fav-item"
                    :class="isPlayingFav(fav) && 'et-media__fav-item--active'"
                    @click="playFavourite(i)"
                >
                    <img v-if="fav.thumb" :src="safeUrl(fav.thumb)" class="et-media__fav-thumb" :alt="fav.title || fav.name || `Station ${i + 1}`" />
                    <i v-else class="fas fa-star et-media__fav-icon" />
                    <span class="et-media__fav-name">{{ fav.title || fav.name || `Station ${i + 1}` }}</span>
                    <i v-if="isPlayingFav(fav)" class="fas fa-volume-high et-media__fav-playing" />
                </button>
            </div>
            <div v-else class="et-media__no-favs">
                <i class="fas fa-info-circle" />
                <span>No favourites yet — save stations from the device screen. Use Next/Prev to browse stations.</span>
            </div>

            <!-- Media library (ringtones, audio clips) -->
            <div v-if="stations.length" class="et-media__stations">
                <span class="et-media__list-label">Media Library ({{ stations.length }})</span>
                <div class="et-media__station-list" :class="showAllStations && 'et-media__station-list--expanded'">
                    <button
                        v-for="item in visibleStations"
                        :key="item.id ?? item.filename"
                        class="et-media__fav-item"
                        :class="isPlayingStation(item) && 'et-media__fav-item--active'"
                        @click="playMediaItem(item)"
                        @contextmenu.prevent="selectedItem = selectedItem?.id === item.id ? null : item"
                    >
                        <i class="fas et-media__fav-icon" :class="item.type === 'RINGTONE' ? 'fa-bell' : 'fa-music'" />
                        <span class="et-media__fav-name">{{ item.title || item.filename }}</span>
                        <span v-if="item.type" class="et-media__item-type">{{ item.type }}</span>
                        <i v-if="selectedItem?.id === item.id" class="fas fa-check et-media__selected-icon" />
                    </button>
                </div>
                <button
                    v-if="stations.length > 5"
                    class="et-media__show-more"
                    @click="showAllStations = !showAllStations"
                >
                    {{ showAllStations ? 'Show less' : `Show all ${stations.length} items` }}
                </button>
            </div>
        </div>

        <!-- Media management -->
        <div v-if="canExecute && stations.length" class="et-media__section">
            <div class="et-media__section-header">
                <i class="fas fa-gear" /> Manage
            </div>
            <div class="et-media__manage-row">
                <button class="et-media__manage-btn" :disabled="busy" @click="reloadLibrary">
                    <i :class="reloading ? 'fas fa-spinner fa-spin' : 'fas fa-rotate'" />
                    <span>Reload</span>
                </button>
                <button
                    v-if="selectedItem"
                    class="et-media__manage-btn et-media__manage-btn--danger"
                    :disabled="busy"
                    @click="deleteMedia(selectedItem)"
                >
                    <span>Delete {{ selectedItem.title || selectedItem.filename }}</span>
                </button>
            </div>
        </div>

        <!-- Error message -->
        <div v-if="error" class="et-media__error">
            <i class="fas fa-triangle-exclamation" /> {{ error }}
        </div>

        <!-- Extra status fields -->
        <div v-if="extras.length" class="et-media__grid">
            <div v-for="m in extras" :key="m.label" class="et-media__card">
                <span class="et-media__card-value">{{ m.value }}</span>
                <span class="et-media__card-label">{{ m.label }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
}>();

const emit = defineEmits<{
    'play-pause': [];
    prev: [];
    next: [];
    'set-volume': [value: number];
    'play-favourite': [index: number];
    'radio-next': [];
    'radio-prev': [];
    'radio-stop': [];
}>();

type MediaAction =
    | 'play-pause'
    | 'prev'
    | 'next'
    | 'set-volume'
    | 'play-favourite'
    | 'radio-next'
    | 'radio-prev'
    | 'radio-stop';

const busy = ref(false);
const error = ref<string | null>(null);
const favourites = ref<Array<Record<string, any>>>([]);
const stations = ref<Array<Record<string, any>>>([]);
const showAllStations = ref(false);

const playback = computed(() => props.status?.playback);
const isPlaying = computed(() => !!playback.value?.enable);
const isBuffering = computed(() => !!playback.value?.buffering);
const mediaType = computed(
    () => playback.value?.media_type as string | undefined
);
const mediaMeta = computed(
    () =>
        playback.value?.media_meta as
            | {title?: string; thumb?: string}
            | undefined
);
const isRadio = computed(() => mediaType.value === 'RADIO');

const trackTitle = computed(() => {
    if (!props.status) return 'No media';
    if (busy.value) return 'Sending...';
    if (isBuffering.value) return 'Buffering...';
    if (mediaMeta.value?.title) return mediaMeta.value.title;
    if (isPlaying.value) return 'Playing';
    return 'Stopped';
});

const volume = computed(() => {
    const v = playback.value?.volume;
    return typeof v === 'number' ? v : 0;
});

const hasVolume = computed(() => playback.value?.volume !== undefined);

const extras = computed(() => {
    const s = props.status;
    if (!s) return [];
    const out: {label: string; value: string}[] = [];
    const counts = s.item_counts;
    if (counts) {
        if (typeof counts.audio === 'number' && counts.audio > 0)
            out.push({label: 'Audio', value: String(counts.audio)});
        if (typeof counts.photo === 'number' && counts.photo > 0)
            out.push({label: 'Photos', value: String(counts.photo)});
        if (typeof counts.video === 'number' && counts.video > 0)
            out.push({label: 'Videos', value: String(counts.video)});
    }
    if (typeof s.total_size === 'number' && s.total_size > 0) {
        out.push({label: 'Storage', value: formatBytes(s.total_size)});
    }
    return out;
});

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Tracked debounce-release timer — shared across doAction / playFavourite /
// playMediaItem so unmount mid-action clears it instead of writing to a dead ref.
let busyReleaseTimer: ReturnType<typeof setTimeout> | undefined;
function releaseBusyAfter(ms: number) {
    if (busyReleaseTimer !== undefined) clearTimeout(busyReleaseTimer);
    busyReleaseTimer = setTimeout(() => {
        busy.value = false;
        busyReleaseTimer = undefined;
    }, ms);
}

function emitMediaAction(event: MediaAction, value?: number) {
    switch (event) {
        case 'play-pause':
            emit('play-pause');
            return;
        case 'prev':
            emit('prev');
            return;
        case 'next':
            emit('next');
            return;
        case 'set-volume':
            emit('set-volume', value ?? 0);
            return;
        case 'play-favourite':
            emit('play-favourite', value ?? 0);
            return;
        case 'radio-next':
            emit('radio-next');
            return;
        case 'radio-prev':
            emit('radio-prev');
            return;
        case 'radio-stop':
            emit('radio-stop');
    }
}

/** Emit action with brief busy guard to prevent double-clicks */
function doAction(event: MediaAction, value?: number) {
    error.value = null;
    if (event === 'set-volume') {
        emitMediaAction(event, value);
        return;
    }
    if (busy.value) return;
    busy.value = true;
    emitMediaAction(event, value);
    releaseBusyAfter(1500);
}

/** Play radio — first favourite if available, otherwise PlayNextFavourite */
function playRadio() {
    if (favourites.value.length) {
        playFavourite(0);
    } else {
        doAction('radio-next');
    }
}

/** Play a specific radio favourite by index */
function playFavourite(index: number) {
    if (busy.value) return;
    error.value = null;
    busy.value = true;
    emit('play-favourite', index);
    releaseBusyAfter(1500);
}

function isPlayingFav(fav: Record<string, any>): boolean {
    if (!isPlaying.value || !isRadio.value) return false;
    return mediaMeta.value?.title === (fav.title || fav.name);
}

function isPlayingStation(station: Record<string, any>): boolean {
    if (!isPlaying.value || !isRadio.value) return false;
    return mediaMeta.value?.title === (station.title || station.name);
}

/** Show first 5 stations, expand to show all */
const visibleStations = computed(() =>
    showAllStations.value ? stations.value : stations.value.slice(0, 5)
);

/** Play a media item (ringtone, audio clip) */
async function playMediaItem(item: Record<string, any>) {
    if (!props.shellyID || busy.value) return;
    error.value = null;
    busy.value = true;
    try {
        const method =
            item.type === 'RINGTONE'
                ? 'Media.Player.PlayRingtone'
                : 'Media.Player.PlayAudioClip';
        await sendRPC('FLEET_MANAGER', method, {
            shellyID: props.shellyID,
            id: item.id
        });
    } catch (e: any) {
        error.value = e.message || 'Failed to play media';
    }
    releaseBusyAfter(1500);
}

const reloading = ref(false);
const selectedItem = ref<Record<string, any> | null>(null);

async function deleteMedia(item: Record<string, any>) {
    if (!props.shellyID || !confirm(`Delete "${item.title || item.filename}"?`))
        return;
    error.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Media.Delete', {
            shellyID: props.shellyID,
            id: item.id
        });
        stations.value = stations.value.filter((s) => s.id !== item.id);
        if (selectedItem.value?.id === item.id) selectedItem.value = null;
    } catch (e: any) {
        error.value = e.message || 'Failed to delete';
    }
}

async function reloadLibrary() {
    if (!props.shellyID) return;
    reloading.value = true;
    error.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Media.Reload', {
            shellyID: props.shellyID
        });
        // Refresh list after reload
        const result = await sendRPC<Record<string, any>>(
            'FLEET_MANAGER',
            'Media.List',
            {shellyID: props.shellyID}
        );
        const list =
            result?.list ??
            result?.items ??
            (Array.isArray(result) ? result : []);
        if (Array.isArray(list)) {
            stations.value = list.filter((item: any) => item.valid !== false);
        }
    } catch (e: any) {
        error.value = e.message || 'Failed to reload';
    }
    reloading.value = false;
}

/** Upgrade http:// URLs to https:// and reject non-http(s) schemes */
function safeUrl(url: string): string {
    if (url.startsWith('http://')) return url.replace('http://', 'https://');
    if (url.startsWith('https://')) return url;
    // Block javascript:, data:, and other potentially dangerous schemes
    return '';
}

/** Fetch radio favourites + all stations on mount */
onBeforeUnmount(() => {
    if (busyReleaseTimer !== undefined) clearTimeout(busyReleaseTimer);
});

onMounted(async () => {
    if (!props.shellyID) return;

    // Fetch favourites
    try {
        const result = await sendRPC<{list?: Array<Record<string, any>>}>(
            'FLEET_MANAGER',
            'Media.Radio.ListFavourites',
            {shellyID: props.shellyID}
        );
        if (Array.isArray(result?.list)) {
            favourites.value = result.list;
        }
    } catch {
        // Non-critical
    }

    // Fetch all media on device (ringtones, audio clips, etc.)
    try {
        const result = await sendRPC<Record<string, any>>(
            'FLEET_MANAGER',
            'Media.List',
            {shellyID: props.shellyID}
        );
        const list =
            result?.list ??
            result?.items ??
            (Array.isArray(result) ? result : []);
        if (Array.isArray(list)) {
            stations.value = list.filter((item: any) => item.valid !== false);
        }
    } catch {
        // Non-critical — device may not support Media.List
    }
});
</script>

<style scoped>
.et-media {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

/* Now playing */
.et-media__now-playing {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.et-media__thumb {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    flex-shrink: 0;
}
.et-media__icon {
    font-size: var(--type-subheading);
    color: var(--color-primary);
    flex-shrink: 0;
}
.et-media__track {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: var(--space-0-5);
}
.et-media__title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.et-media__type-badge {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-primary);
    letter-spacing: var(--tracking-wide);
    text-transform: none;
}

/* Playback controls */
.et-media__controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
}
.et-media__btn {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--type-body);
    cursor: pointer;
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-tertiary);
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default),
                opacity var(--duration-fast) var(--ease-default);
}
.et-media__btn:hover:not(:disabled) {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-media__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.et-media__btn--main {
    width: 48px;
    height: 48px;
    font-size: var(--type-subheading);
    background-color: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-primary);
}
.et-media__btn--main:hover:not(:disabled) {
    background-color: var(--color-primary-hover);
    color: var(--color-text-primary);
}
.et-media__btn--loading {
    background-color: var(--color-primary);
    opacity: 0.7;
}

/* Volume */
.et-media__volume {
    padding-top: var(--space-1);
}

/* Section (radio) */
.et-media__section {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}
.et-media__section-header {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}

/* Radio controls */
.et-media__radio-controls {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-1-5);
}
.et-media__radio-controls--playing {
    grid-template-columns: 1fr 1fr 1fr 1fr;
}
.et-media__radio-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
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
.et-media__radio-btn:hover:not(:disabled) {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-media__radio-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.et-media__radio-btn--pause {
    border-color: var(--color-primary);
    color: var(--color-primary);
}
.et-media__radio-btn--pause:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-primary) 15%, transparent);
}
.et-media__radio-btn--stop {
    border-color: var(--color-danger);
    color: var(--color-danger-text);
}
.et-media__radio-btn--stop:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-danger) 15%, transparent);
}

/* Favourites list */
.et-media__favourites {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.et-media__fav-item {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-2);
    border: 1px solid transparent;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}
.et-media__fav-item:hover {
    background-color: var(--color-surface-3);
}
.et-media__fav-item--active {
    border-color: var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
}
.et-media__fav-thumb {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    flex-shrink: 0;
}
.et-media__fav-icon {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    width: 24px;
    text-align: center;
}
.et-media__fav-name {
    flex: 1;
    font-size: var(--type-body);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.et-media__fav-playing {
    font-size: var(--type-body);
    color: var(--color-primary);
    animation: pulse-fav 1.5s ease-in-out infinite;
}
@keyframes pulse-fav {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}
.et-media__no-favs {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    padding: var(--space-1) 0;
}
.et-media__list-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-disabled);
    letter-spacing: var(--tracking-wide);
    text-transform: none;
    padding: var(--space-1) 0 var(--space-0-5);
}

/* Stations list */
.et-media__stations {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    border-top: 1px solid var(--color-border-default);
    padding-top: var(--space-1-5);
}
.et-media__station-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 240px;
    overflow: hidden;
    transition: max-height var(--duration-normal) var(--ease-default);
}
.et-media__station-list--expanded {
    max-height: none;
}
.et-media__show-more {
    font-size: var(--type-body);
    color: var(--color-primary);
    cursor: pointer;
    padding: var(--space-1) 0;
    text-align: center;
    font-weight: var(--font-medium);
}
.et-media__show-more:hover {
    text-decoration: underline;
}
.et-media__item-type {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-disabled);
    letter-spacing: var(--tracking-wide);
    text-transform: none;
    flex-shrink: 0;
}

/* Error */
.et-media__error {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    color: var(--color-danger-text);
    padding: var(--space-1) 0;
}

/* Extra metrics grid */
.et-media__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: var(--space-1-5);
}
.et-media__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-1-5);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.et-media__card-value {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.et-media__card-label {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    text-align: center;
}

/* Manage section */
.et-media__manage-row {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.et-media__manage-btn {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
}
.et-media__manage-btn:hover:not(:disabled) {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-media__manage-btn--danger {
    border-color: var(--color-danger);
    color: var(--color-danger-text);
}
.et-media__selected-icon {
    color: var(--color-primary);
    font-size: var(--type-body);
    margin-left: auto;
}
</style>
