<template>
    <!-- 1×1: album art + track + artist + source badge + transport controls -->
    <CardShell
        v-if="size === '1x1'"
        type="audio"
        :name="entity.name"
        icon="fas fa-music"
        size="1x1"
        :is-on="isPlaying"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        val-class="ec-val-center"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div v-if="isPlaying" class="ec-aud-art" :class="isRadio && 'ec-aud-art--radio'">
                <svg v-if="isRadio" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="18" r="3"/><path d="M5 10a7 7 0 0 1 14 0"/><path d="M8 13a4 4 0 0 1 8 0"/></svg>
                <svg v-else aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="4"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>
            </div>
            <div v-else class="ec-aud-art ec-aud-art--dim">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
            </div>
            <div class="ec-aud-track">{{ trackDisplay }}</div>
            <div class="ec-aud-artist">{{ sourceLabel ? `${artistDisplay} · ` : '' }}<span v-if="sourceLabel" :style="{ color: sourceColor }">{{ sourceLabel }}</span><template v-else>{{ artistDisplay }}</template></div>
            <div class="ec-aud-controls">
                <button class="ec-aud-btn" :disabled="!canExecute" aria-label="Previous" @click.stop="playPrev">
                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                </button>
                <button class="ec-aud-btn ec-aud-btn--play" :disabled="!canExecute" :aria-label="isPlaying ? 'Pause' : 'Play'" @click.stop="togglePlayback">
                    <svg v-if="isPlaying" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                    <svg v-else aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                </button>
                <button class="ec-aud-btn" :disabled="!canExecute" aria-label="Next" @click.stop="playNext">
                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-3.5 6L4 6v12z"/></svg>
                </button>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×1: two-zone layout — top (art + info), bottom (centered controls) -->
    <CardShell
        v-else-if="size === '2x1'"
        type="audio"
        :name="entity.name"
        icon="fas fa-music"
        size="2x1"
        :is-on="isPlaying"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        val-class=""
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-aud-2x1">
                <!-- Top: art + info -->
                <div class="ec-aud-2x1__top">
                    <div class="ec-aud-art ec-aud-art--md" :class="isRadio && 'ec-aud-art--radio'">
                        <svg v-if="isRadio" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="18" r="3"/><path d="M5 10a7 7 0 0 1 14 0"/><path d="M8 13a4 4 0 0 1 8 0"/></svg>
                        <svg v-else aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="4"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>
                    </div>
                    <div class="ec-aud-2x1__info">
                        <div class="ec-aud-2x1__title-row">
                            <div class="ec-aud-track ec-aud-track--2x1">{{ trackDisplay }}</div>
                            <span v-if="sourceLabel" class="ec-aud-source-badge" :style="{ color: sourceColor, background: sourceBg }">{{ sourceLabel }}</span>
                        </div>
                        <div class="ec-aud-artist ec-aud-artist--2x1">{{ artistDisplay }}</div>
                        <div v-if="!isRadio" class="ec-aud-progress-row">
                            <span class="ec-aud-tick">{{ elapsedDisplay }}</span>
                            <div class="ec-aud-progress ec-aud-progress--flex"><div class="ec-aud-progress-fill" :style="{ width: progressPct + '%' }"></div></div>
                            <span class="ec-aud-tick">{{ durationDisplay }}</span>
                        </div>
                        <div v-else class="ec-aud-progress ec-aud-progress--radio ec-aud-progress--radio-2x1"><div class="ec-aud-progress-fill ec-aud-progress-fill--full"></div></div>
                    </div>
                </div>
                <!-- Bottom: centered controls -->
                <div class="ec-aud-2x1__transport">
                    <button class="ec-aud-btn" :disabled="!canExecute" aria-label="Previous" @click.stop="playPrev">
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                    </button>
                    <button class="ec-aud-btn ec-aud-btn--play" :disabled="!canExecute" :aria-label="isPlaying ? 'Pause' : 'Play'" @click.stop="togglePlayback">
                        <svg v-if="isPlaying" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                        <svg v-else aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                    </button>
                    <button class="ec-aud-btn" :disabled="!canExecute" aria-label="Next" @click.stop="playNext">
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-3.5 6L4 6v12z"/></svg>
                    </button>
                    <div class="ec-aud-vol ec-aud-vol--abs">
                        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>{{ volumeDisplay }}/10
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2: hero — source badge + large art + track + artist + progress + times + transport + volume -->
    <CardShell
        v-else
        type="audio"
        :name="entity.name"
        icon="fas fa-music"
        size="2x2"
        :is-on="isPlaying"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-aud-hero">
                <div v-if="sourceLabel" class="ec-aud-source-wrap">
                    <span class="ec-aud-source-badge" :style="{ color: sourceColor, background: sourceBg }">{{ sourceLabel }}</span>
                </div>
                <div class="ec-aud-art ec-aud-art--hero" :class="isRadio && 'ec-aud-art--radio'">
                    <svg v-if="isRadio" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="ec-aud-icon-svg--lg"><circle cx="12" cy="18" r="3"/><path d="M5 10a7 7 0 0 1 14 0"/><path d="M8 13a4 4 0 0 1 8 0"/></svg>
                    <svg v-else aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="4"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>
                </div>
                <div class="ec-aud-hero-track">{{ trackDisplay }}</div>
                <div class="ec-aud-hero-artist">{{ artistDisplay }}</div>
                <div class="ec-aud-progress ec-aud-progress--hero"><div class="ec-aud-progress-fill" :style="{ width: progressPct + '%' }"></div></div>
                <div class="ec-aud-hero-times"><span>{{ elapsedDisplay }}</span><span>{{ durationDisplay }}</span></div>
                <div class="ec-aud-controls ec-aud-controls--hero">
                    <button class="ec-aud-btn" :disabled="!canExecute" aria-label="Previous" @click.stop="playPrev">
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                    </button>
                    <button class="ec-aud-btn ec-aud-btn--play ec-aud-btn--lg" :disabled="!canExecute" :aria-label="isPlaying ? 'Pause' : 'Play'" @click.stop="togglePlayback">
                        <svg v-if="isPlaying" aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                        <svg v-else aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                    </button>
                    <button class="ec-aud-btn" :disabled="!canExecute" aria-label="Next" @click.stop="playNext">
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-3.5 6L4 6v12z"/></svg>
                    </button>
                </div>
                <div class="ec-aud-vol-row">
                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg>
                    <div class="ec-aud-vol-bar"><div class="ec-aud-vol-fill" :style="{ width: volumePct + '%' }"></div></div>
                    <span class="ec-aud-vol-pct">{{ volumeDisplay }}/10</span>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {useAuthStore} from '@/stores/auth';
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
const rpc = useCardRpc();
const authStore = useAuthStore();

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);

// Media is a singleton component — no :N suffix
const status = computed(() => {
    if (!device.value) return null;
    return deviceStore.statusOf(props.entity.source, 'media') ?? null;
});

const isPlaying = computed(() => !!status.value?.playback?.enable);
const mediaType = computed(
    () => status.value?.playback?.media_type as string | undefined
);
const isRadio = computed(() => mediaType.value === 'RADIO');

const sourceLabel = computed(() => {
    const t = mediaType.value;
    if (!t || !isPlaying.value) return '';
    if (t === 'RADIO') return 'RADIO';
    if (t === 'SONOS') return 'SONOS';
    return t;
});

const sourceColor = computed(() => {
    if (mediaType.value === 'RADIO') return 'var(--a-energy)';
    if (mediaType.value === 'SONOS') return 'var(--a-audio)';
    return 'var(--color-text-tertiary)';
});

const sourceBg = computed(() => {
    if (mediaType.value === 'RADIO') return 'rgba(var(--accent-energy),.12)';
    if (mediaType.value === 'SONOS') return 'rgba(var(--accent-audio),.12)';
    return 'rgba(var(--color-frost-rgb),.06)';
});

const trackDisplay = computed(() => {
    const title = status.value?.playback?.media_meta?.title;
    return title || 'Not playing';
});

const artistDisplay = computed(() => {
    const artist = status.value?.playback?.media_meta?.artist;
    return artist || '—';
});

const volumeDisplay = computed(() => {
    const v = status.value?.playback?.volume;
    return v != null ? String(v) : '—';
});

const volumePct = computed(() => {
    const v = status.value?.playback?.volume;
    if (v == null) return 0;
    return Math.max(0, Math.min(100, (v / 10) * 100));
});

const progressPct = computed(() => {
    const pos = status.value?.playback?.position;
    const dur = status.value?.playback?.duration;
    if (pos != null && dur != null && dur > 0) {
        return Math.max(0, Math.min(100, (pos / dur) * 100));
    }
    return 0;
});

function formatTime(seconds: number | null | undefined): string {
    if (seconds == null || seconds < 0) return '—';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

const elapsedDisplay = computed(() =>
    formatTime(status.value?.playback?.position)
);
const durationDisplay = computed(() =>
    formatTime(status.value?.playback?.duration)
);

function togglePlayback() {
    if (isPlaying.value) {
        rpc.invokeAction(props.entity.id, 'pause');
    } else {
        // Radio resume is station-specific — Media.Play alone does not pick a station
        rpc.invokeAction(props.entity.id, 'playNextFavourite');
    }
}

function playNext() {
    rpc.invokeAction(props.entity.id, 'next');
}

function playPrev() {
    rpc.invokeAction(props.entity.id, 'playFavourite', {favouriteId: 0});
}
</script>
