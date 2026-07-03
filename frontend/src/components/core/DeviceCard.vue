<template>
    <button
        type="button"
        class="cat-dc"
        :class="{ checked: selected }"
        :style="{'--dev-accent': accentRgb}"
        :aria-pressed="selected"
        :aria-label="name"
        @click="emit('click', shellyID)"
    >
        <!-- Checkmark overlay -->
        <div v-if="selected" class="awm-dev-check">
            <i class="fas fa-check" />
        </div>
        <!-- Accent line -->
        <div class="cat-dc-bar" :style="barStyle" />
        <!-- Head -->
        <div class="cat-dc-head">
            <span class="cat-dc-type">{{ deviceLabel }}</span>
            <div class="cat-dc-dot" :class="sleeping ? 'sleep' : online ? 'on' : 'off'" />
        </div>
        <!-- Image -->
        <div class="cat-dc-img" :class="{ 'cat-dc-img--off': !online }">
            <img :src="pictureUrl" :alt="name" loading="lazy" @error="handleImgError" />
        </div>
        <!-- Name -->
        <div class="cat-dc-name">{{ name }}</div>
    </button>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {getLogoFallback} from '@/helpers/device';
import {useEntityStore} from '@/stores/entities';

const ACCENT_RGB: Record<string, string> = {
    blue: '68,149,209',
    pink: '244,114,182',
    amber: '245,158,11',
    teal: '20,184,166',
    green: '34,197,94',
    purple: '168,85,247',
    orange: '249,115,22',
    red: '239,68,68'
};

const props = defineProps<{
    shellyID: string;
    name: string;
    pictureUrl: string;
    selected?: boolean;
    online?: boolean;
    sleeping?: boolean;
}>();

const emit = defineEmits<{
    click: [shellyID: string];
}>();

const entityStore = useEntityStore();

const deviceMeta = computed(() => {
    const types =
        entityStore.typesBySource.get(props.shellyID) ?? new Set<string>();

    let accent = 'blue';
    if (types.has('camera')) accent = 'blue';
    else if (types.has('cury') || types.has('media')) accent = 'purple';
    else if (
        types.has('rgb') ||
        types.has('rgbw') ||
        types.has('cct') ||
        types.has('rgbcct')
    )
        accent = 'pink';
    else if (types.has('dimmer') || types.has('light')) accent = 'amber';
    else if (types.has('cover') || types.has('roller')) accent = 'teal';
    else if (types.has('thermostat') || types.has('blutrv')) accent = 'green';
    else if (
        types.has('temperature') ||
        types.has('humidity') ||
        types.has('illuminance')
    )
        accent = 'purple';
    else if (
        types.has('em') ||
        types.has('em1') ||
        types.has('pm1') ||
        types.has('em3')
    )
        accent = 'amber';
    else if (types.has('presence') || types.has('motion')) accent = 'orange';
    else if (types.has('flood') || types.has('door')) accent = 'teal';
    else if (types.has('smoke')) accent = 'red';

    let label = 'DEVICE';
    const priority = [
        'cury',
        'cover',
        'thermostat',
        'blutrv',
        'presence',
        'dimmer',
        'light',
        'rgbw',
        'rgb',
        'camera',
        'media',
        'switch',
        'em',
        'em3',
        'temperature',
        'humidity',
        'motion',
        'flood',
        'smoke',
        'door',
        'input',
        'button'
    ];
    for (const t of priority) {
        if (types.has(t)) {
            label = t.toUpperCase();
            break;
        }
    }

    return {accent, accentRgb: ACCENT_RGB[accent] ?? ACCENT_RGB.blue, label};
});

const accentRgb = computed(() => deviceMeta.value.accentRgb);
const deviceLabel = computed(() => deviceMeta.value.label);

const barStyle = computed(() => {
    const rgb = accentRgb.value;
    if (!props.online) {
        return {
            background:
                'linear-gradient(90deg, color-mix(in srgb, var(--color-status-off) 80%, transparent) 0%, color-mix(in srgb, var(--color-status-off) 13%, transparent) 50%, transparent 100%)'
        };
    }
    return {
        background: `linear-gradient(90deg, rgb(${rgb}) 0%, rgba(${rgb}, 0.13) 50%, transparent 100%)`
    };
});

function handleImgError(e: Event) {
    const img = e.target as HTMLImageElement;
    img.src = getLogoFallback();
}
</script>

<style scoped>
.awm-dev-check {
    position: absolute;
    top: var(--space-1-5);
    right: var(--space-1-5);
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full);
    background: var(--color-primary);
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--type-body);
    z-index: 2;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

/* Selected state */
.cat-dc.checked {
    border-color: rgba(var(--dev-accent), 0.6);
    box-shadow:
        0 0 12px rgba(var(--dev-accent), 0.2),
        0 0 4px rgba(var(--dev-accent), 0.1),
        inset 0 0 0 1px rgba(var(--dev-accent), 0.15);
}

.cat-dc.checked:hover {
    border-color: rgba(var(--dev-accent), 0.7);
    box-shadow:
        0 0 18px rgba(var(--dev-accent), 0.25),
        0 0 6px rgba(var(--dev-accent), 0.15),
        inset 0 0 0 1px rgba(var(--dev-accent), 0.2);
}

.cat-dc.checked .cat-dc-bar {
    height: 2.5px;
}

.cat-dc-dot.sleep {
    background: var(--color-accent);
    box-shadow: 0 0 4px color-mix(in srgb, var(--color-accent) 40%, transparent);
}

.cat-dc-dot.off {
    background: var(--color-status-off);
    box-shadow: 0 0 4px color-mix(in srgb, var(--color-status-off) 40%, transparent);
}

.cat-dc-img--off img {
    opacity: 0.25;
    filter: grayscale(1);
}

.cat-dc-img img {
    max-width: 56px;
    max-height: 56px;
    object-fit: contain;
}
</style>
