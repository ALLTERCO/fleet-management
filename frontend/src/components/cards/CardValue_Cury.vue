<template>
    <!-- ═══ 1×1: two halves — vial name + level ═══ -->
    <CardShell
        v-if="size === '1x1'"
        type="cury"
        :name="entity.name"
        icon="fas fa-spray-can"
        size="1x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="cy-vials">
                <!-- Left vial column -->
                <div class="cy-vial-col" :class="{'cy-vial-col--off': !leftSlot?.on && !leftVialFault}" :style="leftVialColor ? {'--ar': leftVialColor} : undefined">
                    <svg v-if="!leftVialFault" class="cy-vial-svg" width="38" height="82" viewBox="0 0 38 82" fill="none">
                        <!-- Mist particles (only when on) -->
                        <template v-if="leftSlot?.on">
                            <circle cx="14" cy="4" r="1.5" class="cy-svg-accent" opacity=".35" />
                            <circle cx="24" cy="6" r="1" class="cy-svg-accent" opacity=".25" />
                            <circle cx="19" cy="3" r="1.2" class="cy-svg-accent" opacity=".3" />
                        </template>
                        <!-- Cap -->
                        <rect x="13" y="9" width="12" height="4" rx="1.5" :class="leftSlot?.on ? 'cy-svg-accent-15' : 'cy-svg-muted-10'" />
                        <!-- Body -->
                        <rect x="7" y="13" width="24" height="58" rx="5" stroke-width="1" :class="leftSlot?.on ? 'cy-svg-body-on' : 'cy-svg-body-off'" />
                        <!-- Fill level -->
                        <rect x="8" :y="leftVialFillY" width="22" :height="leftVialFillH" rx="4" :class="leftSlot?.on ? 'cy-svg-fill-on' : 'cy-svg-fill-off'" />
                    </svg>
                    <!-- Fault state: X mark -->
                    <svg v-else class="cy-vial-svg" width="38" height="82" viewBox="0 0 38 82" fill="none">
                        <rect x="13" y="9" width="12" height="4" rx="1.5" fill="rgba(192,41,61,.15)" />
                        <rect x="7" y="13" width="24" height="58" rx="5" stroke="rgba(192,41,61,.15)" stroke-width="1" fill="rgba(192,41,61,.03)" />
                        <line x1="14" y1="32" x2="24" y2="52" stroke="rgba(192,41,61,.3)" stroke-width="1.5" stroke-linecap="round" />
                        <line x1="24" y1="32" x2="14" y2="52" stroke="rgba(192,41,61,.3)" stroke-width="1.5" stroke-linecap="round" />
                    </svg>
                    <div v-if="leftVialFault" class="cy-vial-info cy-vial-info--fault">
                        <div class="cy-vial-pct-v cy-fault-v">{{ faultLabel(leftVialFault) }}</div>
                        <div class="cy-vial-name cy-fault-v">&mdash;</div>
                    </div>
                    <div v-else class="cy-vial-info">
                        <div class="cy-vial-pct-v">{{ leftSlot?.on ? `${leftSlot.intensity ?? 0}%` : 'Off' }}</div>
                        <div class="cy-vial-name">{{ leftVialName }}</div>
                        <div v-if="leftVialLevel != null" class="cy-vial-remain" :class="{'cy-vial-remain--low': leftVialLevel < 30}">{{ leftVialLevel }}% left</div>
                    </div>
                </div>

                <div class="cy-vial-sep" />

                <!-- Right vial column -->
                <div class="cy-vial-col" :class="{'cy-vial-col--off': !rightSlot?.on && !rightVialFault}" :style="rightVialColor ? {'--ar': rightVialColor} : undefined">
                    <svg v-if="!rightVialFault" class="cy-vial-svg" width="38" height="82" viewBox="0 0 38 82" fill="none">
                        <template v-if="rightSlot?.on">
                            <circle cx="14" cy="5" r="1.2" class="cy-svg-accent" opacity=".3" />
                            <circle cx="22" cy="3" r="1" class="cy-svg-accent" opacity=".2" />
                        </template>
                        <rect x="13" y="9" width="12" height="4" rx="1.5" :class="rightSlot?.on ? 'cy-svg-accent-15' : 'cy-svg-muted-10'" />
                        <rect x="7" y="13" width="24" height="58" rx="5" stroke-width="1" :class="rightSlot?.on ? 'cy-svg-body-on' : 'cy-svg-body-off'" />
                        <rect x="8" :y="rightVialFillY" width="22" :height="rightVialFillH" rx="4" :class="rightSlot?.on ? 'cy-svg-fill-on' : 'cy-svg-fill-off'" />
                    </svg>
                    <svg v-else class="cy-vial-svg" width="38" height="82" viewBox="0 0 38 82" fill="none">
                        <rect x="13" y="9" width="12" height="4" rx="1.5" fill="rgba(192,41,61,.15)" />
                        <rect x="7" y="13" width="24" height="58" rx="5" stroke="rgba(192,41,61,.15)" stroke-width="1" fill="rgba(192,41,61,.03)" />
                        <line x1="14" y1="32" x2="24" y2="52" stroke="rgba(192,41,61,.3)" stroke-width="1.5" stroke-linecap="round" />
                        <line x1="24" y1="32" x2="14" y2="52" stroke="rgba(192,41,61,.3)" stroke-width="1.5" stroke-linecap="round" />
                    </svg>
                    <div v-if="rightVialFault" class="cy-vial-info cy-vial-info--fault">
                        <div class="cy-vial-pct-v cy-fault-v">{{ faultLabel(rightVialFault) }}</div>
                        <div class="cy-vial-name cy-fault-v">&mdash;</div>
                    </div>
                    <div v-else class="cy-vial-info">
                        <div class="cy-vial-pct-v">{{ rightSlot?.on ? `${rightSlot.intensity ?? 0}%` : 'Off' }}</div>
                        <div class="cy-vial-name">{{ rightVialName }}</div>
                        <div v-if="rightVialLevel != null" class="cy-vial-remain" :class="{'cy-vial-remain--low': rightVialLevel < 30}">{{ rightVialLevel }}% left</div>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ 2×1: dual slots side-by-side with presets + Stop/Boost ═══ -->
    <CardShell
        v-else-if="size === '2x1'"
        type="cury"
        :name="entity.name"
        icon="fas fa-spray-can"
        size="2x1"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        val-class="ec-val--flush"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="cy-wide-dual">
                <!-- Left slot -->
                <div class="cy-wide-slot" :class="{'cy-wide-slot--fault': !!leftVialFault}" :style="leftVialColor ? {'--ar': leftVialColor} : undefined">
                    <!-- Vial + name row -->
                    <div class="cy-wide-slot-top">
                        <svg v-if="!leftVialFault" class="cy-wide-vial-svg" width="40" height="82" viewBox="0 0 22 46" fill="none">
                            <template v-if="leftSlot?.on">
                                <circle cx="8" cy="3" r="1" class="cy-svg-accent" opacity=".3" />
                                <circle cx="14" cy="2" r=".7" class="cy-svg-accent" opacity=".2" />
                            </template>
                            <rect x="6" y="5" width="10" height="3" rx="1.5" :class="leftSlot?.on ? 'cy-svg-accent-15' : 'cy-svg-muted-10'" />
                            <rect x="2" y="8" width="18" height="34" rx="3.5" stroke-width="1" :class="leftSlot?.on ? 'cy-svg-body-on' : 'cy-svg-body-off'" />
                            <rect x="3" :y="13 + (1 - (leftVialLevel ?? 0) / 100) * 28" width="16" :height="Math.max(0, (leftVialLevel ?? 0) / 100 * 28)" rx="2.5" :class="leftSlot?.on ? 'cy-svg-fill-on' : 'cy-svg-fill-off'" />
                            <text x="11" :y="13 + (1 - (leftVialLevel ?? 0) / 100) * 28 + Math.max(0, (leftVialLevel ?? 0) / 100 * 28) - 2" text-anchor="middle" class="cy-svg-accent" font-size="5.5" font-weight="700" :opacity="leftVialLevel != null ? 0.6 : 0">{{ leftVialLevel ?? '' }}%</text>
                        </svg>
                        <div class="cy-wide-slot-info">
                            <div class="cy-wide-slot-name" :class="{'cy-fault-v': !!leftVialFault}">{{ leftVialFault ? faultLabel(leftVialFault) : leftVialName }}</div>
                            <div v-if="leftSlot?.on" class="cy-wide-slot-intensity">{{ presetLabel(leftSlot.intensity ?? 0) }} · {{ leftSlot.intensity ?? 0 }}%</div>
                        </div>
                    </div>
                    <div v-if="!leftVialFault" class="cy-wide-presets">
                        <button v-for="p in PRESETS" :key="p.value" class="cy-preset" :class="{'cy-preset--active': (leftSlot?.intensity ?? 0) === p.value}" :disabled="!canExecute" @click.stop="setIntensityDirect('left', p.value)">{{ p.label }}</button>
                    </div>
                    <div class="cy-wide-btns">
                        <button class="cy-wide-stop" :class="leftSlot?.on ? 'cy-wide-stop--red' : 'cy-wide-stop--green'" :disabled="!canExecute" @click.stop="toggleSlot('left')">{{ leftSlot?.on ? 'Stop' : 'Start' }}</button>
                        <button class="cy-wide-boost" :disabled="!canExecute || !!leftVialFault" @click.stop="leftSlot?.boost ? stopBoostSlot('left') : boostSlot('left')">
                            <i class="fas fa-bolt" /> {{ leftSlot?.boost ? leftBoostRemaining : 'Boost' }}
                        </button>
                    </div>
                </div>
                <div class="cy-wide-sep" />
                <!-- Right slot -->
                <div class="cy-wide-slot" :class="{'cy-wide-slot--fault': !!rightVialFault}" :style="rightVialColor ? {'--ar': rightVialColor} : undefined">
                    <div class="cy-wide-slot-top">
                        <svg v-if="!rightVialFault" class="cy-wide-vial-svg" width="40" height="82" viewBox="0 0 22 46" fill="none">
                            <template v-if="rightSlot?.on">
                                <circle cx="9" cy="3" r=".8" class="cy-svg-accent" opacity=".25" />
                            </template>
                            <rect x="6" y="5" width="10" height="3" rx="1.5" :class="rightSlot?.on ? 'cy-svg-accent-15' : 'cy-svg-muted-10'" />
                            <rect x="2" y="8" width="18" height="34" rx="3.5" stroke-width="1" :class="rightSlot?.on ? 'cy-svg-body-on' : 'cy-svg-body-off'" />
                            <rect x="3" :y="13 + (1 - (rightVialLevel ?? 0) / 100) * 28" width="16" :height="Math.max(0, (rightVialLevel ?? 0) / 100 * 28)" rx="2.5" :class="rightSlot?.on ? 'cy-svg-fill-on' : 'cy-svg-fill-off'" />
                            <text x="11" :y="13 + (1 - (rightVialLevel ?? 0) / 100) * 28 + Math.max(0, (rightVialLevel ?? 0) / 100 * 28) - 2" text-anchor="middle" class="cy-svg-accent" font-size="5.5" font-weight="700" :opacity="rightVialLevel != null ? 0.6 : 0">{{ rightVialLevel ?? '' }}%</text>
                        </svg>
                        <div class="cy-wide-slot-info">
                            <div class="cy-wide-slot-name" :class="{'cy-fault-v': !!rightVialFault}">{{ rightVialFault ? faultLabel(rightVialFault) : rightVialName }}</div>
                            <div v-if="rightSlot?.on" class="cy-wide-slot-intensity">{{ presetLabel(rightSlot.intensity ?? 0) }} · {{ rightSlot.intensity ?? 0 }}%</div>
                        </div>
                    </div>
                    <div v-if="!rightVialFault" class="cy-wide-presets">
                        <button v-for="p in PRESETS" :key="p.value" class="cy-preset" :class="{'cy-preset--active': (rightSlot?.intensity ?? 0) === p.value}" :disabled="!canExecute" @click.stop="setIntensityDirect('right', p.value)">{{ p.label }}</button>
                    </div>
                    <div class="cy-wide-btns">
                        <button class="cy-wide-stop" :class="rightSlot?.on ? 'cy-wide-stop--red' : 'cy-wide-stop--green'" :disabled="!canExecute" @click.stop="toggleSlot('right')">{{ rightSlot?.on ? 'Stop' : 'Start' }}</button>
                        <button class="cy-wide-boost" :disabled="!canExecute || !!rightVialFault" @click.stop="rightSlot?.boost ? stopBoostSlot('right') : boostSlot('right')">
                            <i class="fas fa-bolt" /> {{ rightSlot?.boost ? rightBoostRemaining : 'Boost' }}
                        </button>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- ═══ 2×2: side-by-side slot columns ═══ -->
    <CardShell
        v-else
        type="cury"
        :name="entity.name"
        icon="fas fa-spray-can"
        size="2x2"
        :is-on="isOn"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <!-- Top bar: Mode dropdown + Home/Away -->
            <div class="cy-hero-topbar">
                <!-- Mode dropdown -->
                <div class="cy-mode-dropdown" @click.stop>
                    <button class="cy-mode-trigger" @click.stop="modeOpen = !modeOpen">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                        <span>{{ currentModeName }}</span>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-quaternary)" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                    <div v-if="modeOpen" class="cy-mode-dd">
                        <div class="cy-mode-dd-label">Modes</div>
                        <button v-for="m in availableModes" :key="m" class="cy-mode-dd-opt" :class="{'cy-mode-dd-opt--active': currentModeName === m}" @click.stop="selectMode(m)">{{ m }}</button>
                    </div>
                </div>
                <!-- Home/Away toggle -->
                <div class="cy-mode-toggle">
                    <button class="cy-mode-btn" :class="{'cy-mode-btn--active': !status?.away_mode}" :disabled="!canExecute" @click.stop="status?.away_mode && toggleAwayMode()">Home</button>
                    <button class="cy-mode-btn" :class="{'cy-mode-btn--active': !!status?.away_mode}" :disabled="!canExecute" @click.stop="!status?.away_mode && toggleAwayMode()">Away</button>
                </div>
            </div>

            <!-- Dual columns -->
            <div class="cy-hero-cols">
                <!-- LEFT SLOT -->
                <div class="cy-hero-slot" :style="leftVialColor ? {'--ar': leftVialColor} : undefined">
                    <div class="cy-hero-slot-name">{{ leftVialName }}</div>
                    <div class="cy-hero-slot-body">
                        <svg v-if="!leftVialFault" class="cy-hero-vial" width="72" height="155" viewBox="0 0 22 46" fill="none">
                            <template v-if="leftSlot?.on">
                                <circle cx="8" cy="3" r="1" class="cy-svg-accent" opacity=".3" />
                                <circle cx="14" cy="2" r=".7" class="cy-svg-accent" opacity=".2" />
                                <circle cx="11" cy="1" r=".8" class="cy-svg-accent" opacity=".25" />
                            </template>
                            <rect x="6" y="5" width="10" height="3" rx="1.5" :class="leftSlot?.on ? 'cy-svg-accent-15' : 'cy-svg-muted-10'" />
                            <rect x="2" y="8" width="18" height="34" rx="3.5" stroke-width="1" :class="leftSlot?.on ? 'cy-svg-body-on' : 'cy-svg-body-off'" />
                            <rect x="3" :y="8 + (1 - (leftVialLevel ?? 0) / 100) * 34" width="16" :height="Math.max(0, (leftVialLevel ?? 0) / 100 * 34)" rx="2.5" :class="leftSlot?.on ? 'cy-svg-fill-on' : 'cy-svg-fill-off'" />
                            <text v-if="leftVialLevel != null" x="11" y="39" text-anchor="middle" class="cy-svg-accent" font-size="5.5" font-weight="700" opacity=".6">{{ leftVialLevel }}%</text>
                        </svg>
                        <div class="cy-hero-slot-vals">
                            <div class="cy-hero-preset-label">{{ presetLabel(leftSlot?.intensity ?? 0) }}</div>
                            <div class="cy-hero-pct">{{ leftSlot?.intensity ?? 0 }}<span>%</span></div>
                        </div>
                    </div>
                    <!-- Slider + presets -->
                    <div v-if="!leftVialFault" class="cy-hero-slider">
                        <div class="ec-clr-track" style="height:32px">
                            <input type="range" class="sld-r cy-sld" min="25" max="100" step="25" :value="leftSlot?.intensity ?? 50" :disabled="!canExecute" :style="{background: `linear-gradient(90deg,rgba(var(--ar),.1),rgba(var(--ar),.6))`}" @change="(e) => setIntensity('left', e)" @click.stop />
                        </div>
                        <div class="cy-col-presets">
                            <button v-for="p in PRESETS" :key="p.value" class="cy-col-preset" :class="{'cy-col-preset--active': (leftSlot?.intensity ?? 0) === p.value}" @click.stop="setIntensityDirect('left', p.value)">{{ p.label }}</button>
                        </div>
                    </div>
                    <!-- Stop + Boost -->
                    <div class="cy-hero-btns">
                        <button class="cy-wide-stop" :class="leftSlot?.on ? 'cy-wide-stop--red' : 'cy-wide-stop--green'" :disabled="!canExecute" @click.stop="toggleSlot('left')">{{ leftSlot?.on ? 'Stop' : 'Start' }}</button>
                        <button class="cy-wide-boost" :disabled="!canExecute || !!leftVialFault" @click.stop="leftSlot?.boost ? stopBoostSlot('left') : boostSlot('left')">
                            <i class="fas fa-bolt" /> {{ leftSlot?.boost ? leftBoostRemaining : 'Boost' }}
                        </button>
                    </div>
                </div>

                <div class="cy-hero-sep" />

                <!-- RIGHT SLOT -->
                <div class="cy-hero-slot" :style="rightVialColor ? {'--ar': rightVialColor} : undefined">
                    <div class="cy-hero-slot-name">{{ rightVialName }}</div>
                    <div class="cy-hero-slot-body">
                        <svg v-if="!rightVialFault" class="cy-hero-vial" width="72" height="155" viewBox="0 0 22 46" fill="none">
                            <template v-if="rightSlot?.on">
                                <circle cx="9" cy="3" r=".8" class="cy-svg-accent" opacity=".25" />
                                <circle cx="13" cy="2" r=".6" class="cy-svg-accent" opacity=".2" />
                            </template>
                            <rect x="6" y="5" width="10" height="3" rx="1.5" :class="rightSlot?.on ? 'cy-svg-accent-15' : 'cy-svg-muted-10'" />
                            <rect x="2" y="8" width="18" height="34" rx="3.5" stroke-width="1" :class="rightSlot?.on ? 'cy-svg-body-on' : 'cy-svg-body-off'" />
                            <rect x="3" :y="8 + (1 - (rightVialLevel ?? 0) / 100) * 34" width="16" :height="Math.max(0, (rightVialLevel ?? 0) / 100 * 34)" rx="2.5" :class="rightSlot?.on ? 'cy-svg-fill-on' : 'cy-svg-fill-off'" />
                            <text v-if="rightVialLevel != null" x="11" y="39" text-anchor="middle" class="cy-svg-accent" font-size="5.5" font-weight="700" opacity=".6">{{ rightVialLevel }}%</text>
                        </svg>
                        <div class="cy-hero-slot-vals">
                            <div class="cy-hero-preset-label">{{ presetLabel(rightSlot?.intensity ?? 0) }}</div>
                            <div class="cy-hero-pct">{{ rightSlot?.intensity ?? 0 }}<span>%</span></div>
                        </div>
                    </div>
                    <div v-if="!rightVialFault" class="cy-hero-slider">
                        <div class="ec-clr-track" style="height:32px">
                            <input type="range" class="sld-r cy-sld" min="25" max="100" step="25" :value="rightSlot?.intensity ?? 50" :disabled="!canExecute" :style="{background: `linear-gradient(90deg,rgba(var(--ar),.1),rgba(var(--ar),.6))`}" @change="(e) => setIntensity('right', e)" @click.stop />
                        </div>
                        <div class="cy-col-presets">
                            <button v-for="p in PRESETS" :key="p.value" class="cy-col-preset" :class="{'cy-col-preset--active': (rightSlot?.intensity ?? 0) === p.value}" @click.stop="setIntensityDirect('right', p.value)">{{ p.label }}</button>
                        </div>
                    </div>
                    <div class="cy-hero-btns">
                        <button class="cy-wide-stop" :class="rightSlot?.on ? 'cy-wide-stop--red' : 'cy-wide-stop--green'" :disabled="!canExecute" @click.stop="toggleSlot('right')">{{ rightSlot?.on ? 'Stop' : 'Start' }}</button>
                        <button class="cy-wide-boost" :disabled="!canExecute || !!rightVialFault" @click.stop="rightSlot?.boost ? stopBoostSlot('right') : boostSlot('right')">
                            <i class="fas fa-bolt" /> {{ rightSlot?.boost ? rightBoostRemaining : 'Boost' }}
                        </button>
                    </div>
                </div>
            </div>
        </template>

        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>

    </CardShell>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {sendRPC} from '@/tools/websocket';
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

interface CuryBoost {
    started_at: number;
    duration: number;
}

interface CurySlot {
    on?: boolean;
    intensity?: number;
    boost?: CuryBoost | null;
    vial?: {
        serial: string;
        level: number;
        name?: string;
        vial_fault?: string;
        color?: [number, number, number];
    };
}

interface CuryStatus {
    slots?: {left?: CurySlot; right?: CurySlot};
    away_mode?: boolean;
    mode?: string | null;
    errors?: string[];
}

const status = computed((): CuryStatus | null => {
    if (!device.value?.status) return null;
    return (deviceStore.statusOf(
        props.entity.source,
        `cury:${props.entity.properties.id}`
    ) ?? null) as CuryStatus | null;
});

const leftSlot = computed(() => status.value?.slots?.left);
const rightSlot = computed(() => status.value?.slots?.right);

const leftVialName = computed(() => leftSlot.value?.vial?.name ?? 'Left');
const rightVialName = computed(() => rightSlot.value?.vial?.name ?? 'Right');

const leftVialFault = computed(() => leftSlot.value?.vial?.vial_fault ?? null);
const rightVialFault = computed(
    () => rightSlot.value?.vial?.vial_fault ?? null
);

// Vial info — fetched once from device RPC
const vialInfo = ref<any>(null);

async function loadVialInfo() {
    if (!device.value?.online) return;
    try {
        vialInfo.value = await sendRPC(
            'FLEET_MANAGER',
            'Cury.GetVialInfo',
            {
                shellyID: props.entity.source,
                id: props.entity.properties.id ?? 0
            }
        );
    } catch {
        // Supplementary — ignore failures
    }
}

onMounted(loadVialInfo);

// Vial scent color — RGB from GetVialInfo
const leftVialColor = computed(() => {
    const c = vialInfo.value?.left?.color_intensity?.rgb;
    return c ? `${c[0]},${c[1]},${c[2]}` : null;
});
const rightVialColor = computed(() => {
    const c = vialInfo.value?.right?.color_intensity?.rgb;
    return c ? `${c[0]},${c[1]},${c[2]}` : null;
});

const FAULT_LABELS: Record<string, string> = {
    non_genuine: 'Not genuine',
    tag_error: 'Tag error',
    expired: 'Expired',
    empty: 'Empty'
};
function faultLabel(f: string | null): string {
    return f ? (FAULT_LABELS[f] ?? f) : '';
}

const isOn = computed(() => !!(leftSlot.value?.on || rightSlot.value?.on));

const activeCount = computed(() => {
    let c = 0;
    if (leftSlot.value?.on) c++;
    if (rightSlot.value?.on) c++;
    return c;
});

const leftVialLevel = computed(() => {
    const v = leftSlot.value?.vial?.level ?? null;
    return v === -1 ? null : v;
});
const rightVialLevel = computed(() => {
    const v = rightSlot.value?.vial?.level ?? null;
    return v === -1 ? null : v;
});

function vialClass(level: number | null): string {
    if (level == null) return '';
    if (level < 20) return 'cy-vial-fill--crit';
    if (level < 40) return 'cy-vial-fill--warn';
    return '';
}
const leftVialClass = computed(() => vialClass(leftVialLevel.value));
const rightVialClass = computed(() => vialClass(rightVialLevel.value));

// SVG vial fill geometry — vial body runs from y=13 to y=71 (58px height)
// Fill rect starts at bottom (y=71) and grows upward based on level percentage
function vialFillY(level: number | null): number {
    if (level == null || level <= 0) return 71;
    const pct = Math.min(100, level);
    return 71 - (pct / 100) * 58;
}
function vialFillH(level: number | null): number {
    if (level == null || level <= 0) return 0;
    const pct = Math.min(100, level);
    return (pct / 100) * 58;
}
const leftVialFillY = computed(() => vialFillY(leftVialLevel.value));
const leftVialFillH = computed(() => vialFillH(leftVialLevel.value));
const rightVialFillY = computed(() => vialFillY(rightVialLevel.value));
const rightVialFillH = computed(() => vialFillH(rightVialLevel.value));

const boostActive = computed(
    () => !!(leftSlot.value?.boost || rightSlot.value?.boost)
);

// Live countdown clock — ticks every second while any boost is active.
// Using Date.now() instead of sys.unixtime avoids a frozen counter between
// device status pushes (which arrive every ~60 s).
const nowSec = ref(Math.floor(Date.now() / 1000));
let _boostTimer: ReturnType<typeof setInterval> | null = null;
watch(
    boostActive,
    (active) => {
        if (active && !_boostTimer) {
            _boostTimer = setInterval(() => {
                nowSec.value = Math.floor(Date.now() / 1000);
            }, 1000);
        } else if (!active && _boostTimer) {
            clearInterval(_boostTimer);
            _boostTimer = null;
        }
    },
    {immediate: true}
);
onUnmounted(() => {
    if (_boostTimer) clearInterval(_boostTimer);
});

const boostDisplay = computed(() => {
    const b = leftSlot.value?.boost ?? rightSlot.value?.boost ?? null;
    if (!b) return '—';
    const rem = b.started_at + b.duration - nowSec.value;
    if (rem <= 0) return 'Done';
    const m = Math.floor(rem / 60);
    const s = rem % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
});

function boostRemaining(slot: CurySlot | null | undefined): string {
    const b = slot?.boost;
    if (!b) return '';
    const rem = b.started_at + b.duration - nowSec.value;
    if (rem <= 0) return 'Done';
    const m = Math.floor(rem / 60);
    const s = rem % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
const leftBoostRemaining = computed(() => boostRemaining(leftSlot.value));
const rightBoostRemaining = computed(() => boostRemaining(rightSlot.value));

const rssiDisplay = computed(() => {
    const wifi = device.value?.status?.wifi;
    return wifi?.rssi != null ? `${wifi.rssi} dBm` : '—';
});

// 2×1 active slot tab
const activeSlot = ref<'left' | 'right'>('left');
const activeSlotData = computed(() =>
    activeSlot.value === 'left' ? leftSlot.value : rightSlot.value
);
const activeVialName = computed(() =>
    activeSlot.value === 'left' ? leftVialName.value : rightVialName.value
);
const activeVialFault = computed(() =>
    activeSlot.value === 'left' ? leftVialFault.value : rightVialFault.value
);
const activeVialLevel = computed(() =>
    activeSlot.value === 'left' ? leftVialLevel.value : rightVialLevel.value
);
const activeBoostRemaining = computed(() =>
    boostRemaining(activeSlotData.value)
);

function toggleSlot(side: 'left' | 'right') {
    const slot = side === 'left' ? leftSlot.value : rightSlot.value;
    rpc.invokeAction(props.entity.id, 'setSlot', {
        slot: side,
        on: !(slot?.on ?? false)
    });
}

const PRESETS = [
    {label: 'Low', value: 25},
    {label: 'Med', value: 50},
    {label: 'High', value: 75},
    {label: 'Max', value: 100}
] as const;

function setIntensity(side: 'left' | 'right', ev: Event) {
    rpc.invokeAction(props.entity.id, 'setSlot', {
        slot: side,
        on: true,
        intensity: Number((ev.target as HTMLInputElement).value)
    });
}

function setIntensityDirect(side: 'left' | 'right', value: number) {
    rpc.invokeAction(props.entity.id, 'setSlot', {
        slot: side,
        on: true,
        intensity: value
    });
}

function presetLabel(intensity: number): string {
    if (intensity <= 25) return 'Low';
    if (intensity <= 50) return 'Medium';
    if (intensity <= 75) return 'High';
    return 'Max';
}

function toggleAwayMode() {
    rpc.invokeAction(props.entity.id, 'setAwayMode', {
        on: !status.value?.away_mode
    });
}

// Mode dropdown
const modeOpen = ref(false);

const MODE_LABELS: Record<string, string> = {
    hall: 'Hall',
    bedroom: 'Bedroom',
    living_room: 'Living Room',
    lavatory_room: 'Lavatory',
    reception: 'Reception',
    workplace: 'Workplace'
};

const currentModeName = computed(() => {
    const m = status.value?.mode;
    if (!m) return 'Manual';
    return MODE_LABELS[m] ?? m;
});

const availableModes = computed(() => [
    'Manual',
    ...Object.values(MODE_LABELS)
]);

function selectMode(label: string) {
    modeOpen.value = false;
    if (label === 'Manual') {
        rpc.invokeAction(props.entity.id, 'setCuryMode', {mode: null});
        return;
    }
    const key = Object.entries(MODE_LABELS).find(([, v]) => v === label)?.[0];
    if (key) rpc.invokeAction(props.entity.id, 'setCuryMode', {mode: key});
}

function boostSlot(side: 'left' | 'right') {
    const slot = side === 'left' ? leftSlot.value : rightSlot.value;
    if (!slot?.on) {
        rpc.invokeAction(props.entity.id, 'setSlot', {slot: side, on: true});
    }
    rpc.invokeAction(props.entity.id, 'setBoost', {slot: side, on: true});
}

function stopBoostSlot(side: 'left' | 'right') {
    rpc.invokeAction(props.entity.id, 'setBoost', {slot: side, on: false});
}
</script>

<style scoped>
/* ══════════════════════════════════════════
   1×1 — SVG vial visuals (side-by-side)
══════════════════════════════════════════ */
.cy-vials {
    display: flex;
    height: 100%;
}

.cy-vial-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-0-5) var(--space-1);
    gap: var(--space-px);
    transition: opacity 0.2s ease;
}

.cy-vial-col--off {
    opacity: 0.4;
}

.cy-vial-sep {
    width: 1px;
    background: linear-gradient(180deg, transparent, var(--color-border-default), transparent);
    margin: var(--space-3) 0;
    flex-shrink: 0;
}

.cy-vial-svg {
    flex-shrink: 0;
}

.cy-vial-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
}

.cy-vial-pct-v {
    font-size: var(--type-body);
    font-weight: 800;
    color: var(--color-text-primary);
    line-height: 1;
}

.cy-vial-name {
    font-size: var(--type-body);
    font-weight: 600;
    color: rgb(var(--ar));
    max-width: 72px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
}

.cy-vial-remain {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-tertiary);
}

.cy-vial-remain--low {
    color: var(--color-warning-text);
}

/* SVG accent classes — use CSS var(--ar) for fill/stroke */
.cy-svg-accent {
    fill: rgb(var(--ar));
}

.cy-svg-accent-15 {
    fill: rgba(var(--ar), 0.15);
}

.cy-svg-muted-10 {
    fill: rgba(var(--color-chart-axis-rgb), 0.1);
}

.cy-svg-body-on {
    fill: rgba(var(--ar), 0.03);
    stroke: rgba(var(--ar), 0.15);
}

.cy-svg-body-off {
    fill: rgba(var(--color-chart-axis-rgb), 0.02);
    stroke: rgba(var(--color-chart-axis-rgb), 0.08);
}

.cy-svg-fill-on {
    fill: rgba(var(--ar), 0.25);
}

.cy-svg-fill-off {
    fill: rgba(var(--color-chart-axis-rgb), 0.06);
}

/* ══════════════════════════════════════════
   2×1 — L/R tab + single slot view
══════════════════════════════════════════ */
.cy-wide {
    display: flex;
    align-items: stretch;
    height: 100%;
}

.cy-tabs {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
    flex-shrink: 0;
    border-right: 1px solid rgba(var(--color-frost-rgb), 0.06);
}

.cy-tab {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(var(--color-frost-rgb), 0.12);
    background: transparent;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    flex-shrink: 0;
}

.cy-tab--on {
    border-color: rgba(var(--ar), 0.25);
    color: rgb(var(--ar));
}

.cy-tab--active {
    background: rgba(var(--ar), 0.15);
    border-color: rgba(var(--ar), 0.4);
    color: rgb(var(--ar));
}

.cy-wide-body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-4);
    gap: var(--space-1);
}

.cy-wide-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.cy-wide-name {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.cy-wide-acts {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
}

.cy-wide-ctrl {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.cy-wide-track {
    flex: 1;
    height: 18px;
    padding: var(--space-0-5) 0;
}

.cy-wide-sub {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.cy-wide-off {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}

.cy-wide-vial {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
}

/* ══════════════════════════════════════════
   2×2 — side-by-side slot columns
══════════════════════════════════════════ */
.cy-cols {
    display: flex;
    flex-direction: row;
    flex: 1;
    min-height: 0;
}

.cy-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    flex: 1;
    min-width: 0;
    opacity: 0.4;
    transition: opacity 0.2s ease;
}

.cy-col--on,
.cy-col--fault {
    opacity: 1;
}

.cy-col-sep {
    width: 1px;
    background: linear-gradient(180deg, transparent, rgba(var(--color-frost-rgb), 0.1), transparent);
    flex-shrink: 0;
    align-self: stretch;
    margin: var(--space-3) 0;
}

.cy-col-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.cy-col-dir {
    font-size: var(--type-body);
    font-weight: 700;
    color: rgb(var(--ar));
    opacity: 0.8;
    flex-shrink: 0;
}

.cy-col-name {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.cy-col-vial {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.cy-col-ctrl {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.cy-col-ctrl .ec-clr-track {
    flex: 1;
    height: 18px;
    padding: var(--space-0-5) 0;
}

.cy-col-boost {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: auto;
}

/* ══════════════════════════════════════════
   Shared — vial bar
══════════════════════════════════════════ */
.cy-vial-bar {
    flex: 1;
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--state-hover-bg-strong);
    overflow: hidden;
}

.cy-vial-fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-text-tertiary);
    opacity: 0.5;
    transition: width 0.4s ease;
}

.cy-vial-fill--warn {
    background: var(--color-warning-text);
    opacity: 1;
}

.cy-vial-fill--crit {
    background: var(--color-status-off);
    opacity: 1;
}

.cy-vial-pct {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    min-width: 24px;
    text-align: right;
    flex-shrink: 0;
}

/* ══════════════════════════════════════════
   Shared — intensity % label
══════════════════════════════════════════ */
.cy-ctrl-pct {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    min-width: 28px;
    text-align: right;
    flex-shrink: 0;
}

/* ══════════════════════════════════════════
   Shared — action buttons
══════════════════════════════════════════ */
.cy-act-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(var(--ar), 0.3);
    background: rgba(var(--ar), 0.1);
    color: rgb(var(--ar));
    font-size: var(--type-body);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, opacity 0.15s;
}

.cy-act-btn:hover:not(:disabled) {
    background: rgba(var(--ar), 0.22);
}

.cy-act-btn:disabled {
    opacity: 0.4;
    cursor: default;
}

.cy-act-btn--stop {
    border-color: rgba(var(--color-danger-rgb), 0.3);
    background: rgba(var(--color-danger-rgb), 0.1);
    color: var(--color-status-off);
}

.cy-act-btn--stop:hover:not(:disabled) {
    background: rgba(var(--color-danger-rgb), 0.22);
}

/* ══════════════════════════════════════════
   Shared — pills
══════════════════════════════════════════ */
.cy-boost-pill {
    font-size: var(--type-body);
    font-weight: 700;
    padding: var(--space-px) var(--space-1-5);
    border-radius: var(--radius-2xl);
    background: rgba(var(--ar), 0.15);
    color: rgb(var(--ar));
    border: 1px solid rgba(var(--ar), 0.3);
    flex-shrink: 0;
}

.cy-fault-pill {
    font-size: var(--type-body);
    font-weight: 700;
    padding: var(--space-px) var(--space-1-5);
    border-radius: var(--radius-2xl);
    background: rgba(var(--color-danger-rgb), 0.15);
    color: var(--color-status-off);
    border: 1px solid rgba(var(--color-danger-rgb), 0.3);
    flex-shrink: 0;
}

/* ══════════════════════════════════════════
   Shared — state colors
══════════════════════════════════════════ */
.cy-fault-v {
    color: var(--color-status-off);
}

.cy-boost-v {
    color: rgb(var(--ar));
}

/* ══════════════════════════════════════════
   2×1 — exact match to prototype
══════════════════════════════════════════ */
.cy-wide-dual {
    display: flex;
    height: 100%;
    overflow: visible;
}
.cy-wide-slot {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: var(--space-2) var(--space-3);
    gap: var(--space-1-5);
}
.cy-wide-sep {
    width: 1px;
    background: linear-gradient(180deg, transparent, var(--color-border-default), transparent);
    margin: var(--space-2) 0;
    flex-shrink: 0;
}
.cy-wide-slot-top {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1;
}
.cy-wide-vial-svg {
    flex-shrink: 0;
    /* prototype: width="40" height="82" */
}
.cy-wide-slot-info {
    flex: 1;
    text-align: center;
    min-width: 0;
}
.cy-wide-slot-name {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.cy-wide-slot-intensity {
    font-size: var(--type-body);
    font-weight: 600;
    color: rgb(var(--ar));
    opacity: 0.7;
    margin-top: var(--space-1);
}
.cy-wide-presets {
    display: flex;
    gap: var(--space-1);
}
.cy-preset {
    flex: 1;
    text-align: center;
    font-size: var(--type-body);
    font-weight: 600;
    padding: var(--space-1-5) 0;
    border-radius: var(--radius-sm-plus);
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-quaternary);
    cursor: pointer;
    transition: background var(--duration-fast), border-color var(--duration-fast), color var(--duration-fast);
}
.cy-preset:hover:not(:disabled) {
    border-color: var(--color-border-medium);
    color: var(--color-text-secondary);
}
.cy-preset--active {
    background: rgba(var(--ar), 0.15);
    border-color: rgba(var(--ar), 0.3);
    color: rgb(var(--ar));
}
.cy-preset:disabled {
    opacity: 0.4;
    cursor: default;
}
.cy-wide-btns {
    display: flex;
    gap: var(--space-1);
    margin-top: auto;
}
.cy-wide-stop {
    flex: 1;
    padding: var(--space-1-5) 0;
    border-radius: var(--radius-sm-plus);
    font-size: var(--type-body);
    font-weight: 700;
    cursor: pointer;
    text-align: center;
    transition: background var(--duration-fast), border-color var(--duration-fast);
}
/* Stop = red */
.cy-wide-stop--red {
    background: rgba(var(--color-danger-rgb), 0.08);
    border: 1px solid rgba(var(--color-danger-rgb), 0.18);
    color: var(--color-status-off);
}
/* Start = green */
.cy-wide-stop--green {
    background: rgba(var(--color-status-on-rgb), 0.08);
    border: 1px solid rgba(var(--color-status-on-rgb), 0.18);
    color: var(--color-status-on);
}
.cy-wide-stop:disabled {
    opacity: 0.3;
    cursor: default;
}
.cy-wide-boost {
    flex: 1;
    padding: var(--space-1-5) 0;
    border-radius: var(--radius-sm-plus);
    background: rgba(var(--ar), 0.08);
    border: 1px solid rgba(var(--ar), 0.18);
    color: rgb(var(--ar));
    font-size: var(--type-body);
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
}
.cy-wide-boost:disabled {
    opacity: 0.3;
    cursor: default;
}

/* ══════════════════════════════════════════
   2×2 — Home/Away toggle bar
══════════════════════════════════════════ */
/* ── 2×2 preset snap labels under slider ── */
.cy-col-presets {
    display: flex;
    justify-content: space-between;
    padding: var(--space-1) 0 0;
}
.cy-col-preset {
    font-size: var(--type-body);
    font-weight: 600;
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm-plus);
    background: none;
    border: none;
    color: var(--color-text-quaternary);
    cursor: pointer;
    transition: color var(--duration-fast), background var(--duration-fast);
}
.cy-col-preset:hover {
    color: var(--color-text-secondary);
}
.cy-col-preset--active {
    color: rgb(var(--ar));
    background: rgba(var(--ar), 0.08);
}

/* ══════════════════════════════════════════
   2×2 hero — matching prototype layout
══════════════════════════════════════════ */
.cy-hero-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4) 0;
}
.cy-hero-cols {
    display: flex;
    flex: 1;
    gap: 0;
    padding: var(--space-2) var(--space-4);
}
.cy-hero-sep {
    width: 1px;
    background: linear-gradient(180deg, transparent, var(--color-border-default), transparent);
    flex-shrink: 0;
}
.cy-hero-slot {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.cy-hero-slot:first-child {
    padding: 0 var(--space-3) 0 0;
}
.cy-hero-slot:last-child {
    padding: 0 0 0 10px;
}
.cy-hero-slot-name {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.cy-hero-slot-body {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1;
}
.cy-hero-vial {
    flex-shrink: 0;
}
.cy-hero-slot-vals {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
}
.cy-hero-preset-label {
    font-size: var(--type-body);
    font-weight: 700;
    color: rgb(var(--ar));
}
.cy-hero-pct {
    font-size: var(--type-subheading);
    font-weight: 800;
    letter-spacing: -1.5px;
    color: var(--color-text-primary);
    line-height: 1;
}
.cy-hero-pct span {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-frost);
    opacity: 0.5;
}
.cy-hero-slider {
    display: flex;
    flex-direction: column;
    gap: 0;
}
.cy-hero-slider .ec-clr-track {
    height: 32px;
    flex: none;
}
.cy-hero-slider .cy-col-presets {
    padding: var(--space-1) 0 0;
}
.cy-hero-btns {
    display: flex;
    gap: var(--space-1);
}
.cy-hero-btns .cy-wide-stop,
.cy-hero-btns .cy-wide-boost {
    padding: var(--space-2) 0;
    font-size: var(--type-body);
    border-radius: var(--radius-md);
}

/* ── Mode dropdown ── */
.cy-mode-dropdown {
    position: relative;
}
.cy-mode-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: 5px var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    cursor: pointer;
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
}
.cy-mode-trigger:hover {
    border-color: var(--color-border-medium);
}
.cy-mode-dd {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 160px;
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    padding: var(--space-1);
    z-index: 10;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}
.cy-mode-dd-label {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-quaternary);
    padding: var(--space-1-5) 10px var(--space-0-5);
    letter-spacing: 0.04em;
}
.cy-mode-dd-opt {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--space-1-5) 10px;
    border-radius: var(--radius-sm-plus);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
    background: none;
    border: none;
    cursor: pointer;
}
.cy-mode-dd-opt:hover {
    background: rgba(249, 250, 250, 0.04);
    color: var(--color-text-primary);
}
.cy-mode-dd-opt--active {
    background: rgba(var(--color-primary-rgb), 0.08);
    color: var(--color-primary);
}

.cy-mode-toggle {
    display: flex;
    gap: var(--space-px);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    padding: var(--space-0-5);
    overflow: hidden;
}
.cy-mode-btn {
    padding: 5px var(--space-3);
    font-size: var(--type-body);
    font-weight: 700;
    letter-spacing: 0.04em;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-frost);
    opacity: 0.55;
    cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast), opacity var(--duration-fast);
}
.cy-mode-btn--active {
    background: var(--color-surface-4);
    color: var(--color-text-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    opacity: 1;
}
.cy-mode-btn:disabled {
    cursor: default;
}
</style>
