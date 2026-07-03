<template>
    <div class="et-presence">
        <!-- ═══ 1. Room Settings ═══ -->
        <div class="et-presence__section">
            <div class="et-presence__section-header" @click="showRoom = !showRoom">
                <i class="fas fa-border-all" /> Room Settings
                <i class="fas" :class="showRoom ? 'fa-chevron-down' : 'fa-chevron-right'" style="margin-left: auto; font-size: var(--type-body); color: var(--color-text-disabled);" />
            </div>
            <template v-if="showRoom">
                <!-- Live radar map with tile editor -->
                <div class="et-presence__radar-section">
                    <button class="et-presence__live-btn" :class="isLiveTrack && 'et-presence__live-btn--on'"
                        :disabled="!canExecute || !isEnabled" @click="toggleLiveTrack">
                        <span class="et-presence__live-dot" />
                        {{ isLiveTrack ? 'LIVE' : 'Start Live Radar' }}
                    </button>
                    <PresenceRadarMap
                        v-if="isLiveTrack || radarZones.length"
                        :zones="radarZones" :objects="liveObjects" :blind-spots="blindSpotAreas"
                        :sensor-position="settings?.sensor?.position ?? 'center'"
                        :zmin="settings?.zmin ?? 0" :zmax="settings?.zmax ?? 3"
                        :editable="canExecute"
                        @update-zone="onUpdateZone" @update-blinds="onUpdateBlinds"
                    />
                </div>

                <!-- Mounting position -->
                <div v-if="canExecute && settings?.sensor?.position" class="et-presence__row">
                    <span class="et-presence__label">Device mounting position</span>
                    <select class="et-presence__select" :value="settings.sensor.position"
                        @change="(e: Event) => setConfig({sensor: {position: (e.target as HTMLSelectElement).value}})">
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                    </select>
                </div>

                <!-- Blind spots -->
                <div v-if="canExecute && settings?.blind !== undefined" class="et-presence__subsection">
                    <div class="et-presence__sublabel"><i class="fas fa-eye-slash" /> Blind Spots <span v-if="settings.blind?.length" class="et-presence__badge">{{ settings.blind.length }}</span></div>
                    <div v-for="(spot, i) in settings.blind" :key="i" class="et-presence__blind-row">
                        <span class="et-presence__blind-coords">[{{ spot.join(', ') }}]</span>
                        <button class="et-presence__blind-remove" aria-label="Remove blind spot" @click="removeBlindSpot(i)"><i class="fas fa-xmark" /></button>
                    </div>
                    <div v-if="!settings.blind?.length" class="et-presence__empty">No blind spots — use the map editor above or add coordinates below</div>
                    <div class="et-presence__blind-add">
                        <input v-model="newBlindSpot" type="text" class="et-presence__text" placeholder="x0,y0,x1,y1 (e.g. -2,4,2,0)" />
                        <button class="et-presence__action-btn" :disabled="!newBlindSpot" @click="addBlindSpot"><i class="fas fa-plus" /> Add</button>
                    </div>
                </div>

                <!-- Zone management -->
                <div v-if="canExecute" class="et-presence__subsection">
                    <div class="et-presence__sublabel"><i class="fas fa-vector-square" /> Zones</div>
                    <div class="et-presence__row">
                        <input v-model="newZoneName" type="text" class="et-presence__text" placeholder="New zone name" style="flex:1" />
                        <button class="et-presence__action-btn" :disabled="!newZoneName" @click="addZone"><i class="fas fa-plus" /> Add Zone</button>
                    </div>
                </div>
            </template>
        </div>

        <!-- ═══ 2. Configuration ═══ -->
        <div v-if="canExecute && shellyID && settings" class="et-presence__section">
            <div class="et-presence__section-header" @click="showSettings = !showSettings">
                <i class="fas fa-gear" /> Configuration
                <i class="fas" :class="showSettings ? 'fa-chevron-down' : 'fa-chevron-right'" style="margin-left: auto; font-size: var(--type-body); color: var(--color-text-disabled);" />
            </div>
            <template v-if="showSettings">
                <div class="et-presence__row">
                    <span class="et-presence__label">Enable presence detection</span>
                    <button class="et-presence__toggle" :class="isEnabled && 'et-presence__toggle--on'" @click="setSensor(!isEnabled)">
                        <i class="fas fa-power-off" />
                    </button>
                </div>
                <div v-if="settings.sensor?.flipped != null" class="et-presence__row">
                    <span class="et-presence__label">Flipped mounting (180°)</span>
                    <button class="et-presence__toggle-btn" :class="settings.sensor.flipped && 'et-presence__toggle-btn--on'"
                        @click="setConfig({sensor: {flipped: !settings.sensor.flipped}})">
                        <i class="fas" :class="settings.sensor.flipped ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                </div>
                <div v-if="settings.ui?.imperial != null" class="et-presence__row">
                    <span class="et-presence__label">Enable imperial units</span>
                    <button class="et-presence__toggle-btn" :class="settings.ui.imperial && 'et-presence__toggle-btn--on'"
                        @click="setConfig({ui: {imperial: !settings.ui.imperial}})">
                        <i class="fas" :class="settings.ui.imperial ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                </div>
                <div v-if="settings.zmin != null" class="et-presence__row">
                    <span class="et-presence__label">Min detection height (m)</span>
                    <input type="number" class="et-presence__num" :value="settings.zmin" min="0" max="2.9" step="0.1"
                        @change="(e: Event) => setConfig({zmin: Number((e.target as HTMLInputElement).value)})" />
                </div>
                <div v-if="settings.zmax != null" class="et-presence__row">
                    <span class="et-presence__label">Max detection height (m)</span>
                    <input type="number" class="et-presence__num" :value="settings.zmax" min="0.1" max="5" step="0.1"
                        @change="(e: Event) => setConfig({zmax: Number((e.target as HTMLInputElement).value)})" />
                </div>
                <div v-if="settings.sensor?.height != null" class="et-presence__row">
                    <span class="et-presence__label">Sensor height (m)</span>
                    <input type="number" class="et-presence__num" :value="settings.sensor.height" min="0" max="3" step="0.1"
                        @change="(e: Event) => setConfig({sensor: {height: Number((e.target as HTMLInputElement).value)}})" />
                </div>
                <div v-if="settings.sensor?.tilt != null" class="et-presence__row">
                    <span class="et-presence__label">Sensor tilt</span>
                    <span class="et-presence__value">{{ settings.sensor.tilt }}°</span>
                    <button v-if="canExecute" class="et-presence__action-btn" @click="tiltCalibrate"><i class="fas fa-crosshairs" /> Calibrate</button>
                </div>
                <div v-if="settings.sensor?.power" class="et-presence__row">
                    <span class="et-presence__label">Transmission power</span>
                    <select class="et-presence__select" :value="settings.sensor.power"
                        @change="(e: Event) => setConfig({sensor: {power: (e.target as HTMLSelectElement).value}})">
                        <option value="low">Low (4 dBm)</option>
                        <option value="medium">Medium (8 dBm)</option>
                        <option value="high">High (12 dBm)</option>
                    </select>
                </div>
                <div v-if="settings.sensor?.sensitivity" class="et-presence__row">
                    <span class="et-presence__label">Detection sensitivity</span>
                    <select class="et-presence__select" :value="settings.sensor.sensitivity"
                        @change="(e: Event) => setConfig({sensor: {sensitivity: (e.target as HTMLSelectElement).value}})">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="custom">Custom</option>
                    </select>
                </div>
            </template>
        </div>

        <!-- ═══ 3. Fine-tuning ═══ -->
        <div v-if="canExecute && shellyID && settings?.sensor?.state" class="et-presence__section">
            <div class="et-presence__section-header" @click="showFineTuning = !showFineTuning">
                <i class="fas fa-sliders" /> Fine-tuning
                <i class="fas" :class="showFineTuning ? 'fa-chevron-down' : 'fa-chevron-right'" style="margin-left: auto; font-size: var(--type-body); color: var(--color-text-disabled);" />
            </div>
            <template v-if="showFineTuning">
                <div class="et-presence__hint">1 frame = 100 ms (10 frames per second)</div>
                <div v-if="settings.sensor.snr != null" class="et-presence__row">
                    <span class="et-presence__label">SNR threshold</span>
                    <input type="number" class="et-presence__num" :value="settings.sensor.snr" min="10" max="100"
                        @change="(e: Event) => setConfig({sensor: {snr: Number((e.target as HTMLInputElement).value)}})" />
                </div>
                <div v-if="settings.sensor.points != null" class="et-presence__row">
                    <span class="et-presence__label">Object recognition threshold</span>
                    <input type="number" class="et-presence__num" :value="settings.sensor.points" min="10" max="100"
                        @change="(e: Event) => setConfig({sensor: {points: Number((e.target as HTMLInputElement).value)}})" />
                    <span class="et-presence__unit">pts</span>
                </div>
                <div v-if="settings.sensor.velocity != null" class="et-presence__row">
                    <span class="et-presence__label">Velocity threshold</span>
                    <input type="number" class="et-presence__num" :value="settings.sensor.velocity" min="0.01" max="1" step="0.01"
                        @change="(e: Event) => setConfig({sensor: {velocity: Number((e.target as HTMLInputElement).value)}})" />
                    <span class="et-presence__unit">m/s</span>
                </div>
                <div v-if="settings.sensor.max_velocity != null" class="et-presence__row">
                    <span class="et-presence__label">Max velocity difference</span>
                    <input type="number" class="et-presence__num" :value="settings.sensor.max_velocity" min="1" max="50"
                        @change="(e: Event) => setConfig({sensor: {max_velocity: Number((e.target as HTMLInputElement).value)}})" />
                    <span class="et-presence__unit">m/s</span>
                </div>
                <div v-if="settings.sensor.state.det_act_thr != null" class="et-presence__row">
                    <span class="et-presence__label">Motion activation threshold</span>
                    <input type="number" class="et-presence__num" :value="settings.sensor.state.det_act_thr" min="1" max="100"
                        @change="(e: Event) => setConfig({sensor: {state: {det_act_thr: Number((e.target as HTMLInputElement).value)}}})" />
                    <span class="et-presence__unit">frames</span>
                </div>
                <div v-if="settings.sensor.state.det_free_thr != null" class="et-presence__row">
                    <span class="et-presence__label">Motion release threshold</span>
                    <input type="number" class="et-presence__num" :value="settings.sensor.state.det_free_thr" min="1" max="100"
                        @change="(e: Event) => setConfig({sensor: {state: {det_free_thr: Number((e.target as HTMLInputElement).value)}}})" />
                    <span class="et-presence__unit">frames</span>
                </div>
                <div v-if="settings.sensor.state.act_free_thr != null" class="et-presence__row">
                    <span class="et-presence__label">Tracking loss threshold</span>
                    <input type="number" class="et-presence__num" :value="settings.sensor.state.act_free_thr" min="1" max="1000"
                        @change="(e: Event) => setConfig({sensor: {state: {act_free_thr: Number((e.target as HTMLInputElement).value)}}})" />
                    <span class="et-presence__unit">frames</span>
                </div>
                <div v-if="settings.sensor.state.stat_free_thr != null" class="et-presence__row">
                    <span class="et-presence__label">Stillness tracking threshold</span>
                    <input type="number" class="et-presence__num" :value="settings.sensor.state.stat_free_thr" min="1" max="1000"
                        @change="(e: Event) => setConfig({sensor: {state: {stat_free_thr: Number((e.target as HTMLInputElement).value)}}})" />
                    <span class="et-presence__unit">frames</span>
                </div>
                <div v-if="settings.sensor.state.sleep_free_thr != null" class="et-presence__row">
                    <span class="et-presence__label">Stillness timeout threshold</span>
                    <input type="number" class="et-presence__num" :value="settings.sensor.state.sleep_free_thr" min="1" max="65535"
                        @change="(e: Event) => setConfig({sensor: {state: {sleep_free_thr: Number((e.target as HTMLInputElement).value)}}})" />
                    <span class="et-presence__unit">frames</span>
                </div>
            </template>
        </div>

        <!-- ═══ 4. LED Control ═══ -->
        <div v-if="canExecute && shellyID && settings?.leds" class="et-presence__section">
            <div class="et-presence__section-header" @click="showLeds = !showLeds">
                <i class="fas fa-lightbulb" /> LED Control
                <i class="fas" :class="showLeds ? 'fa-chevron-down' : 'fa-chevron-right'" style="margin-left: auto; font-size: var(--type-body); color: var(--color-text-disabled);" />
            </div>
            <template v-if="showLeds">
                <div class="et-presence__row">
                    <span class="et-presence__label">Brightness ({{ settings.leds.brightness }}%)</span>
                    <input type="range" class="et-presence__slider" :value="settings.leds.brightness" min="0" max="100"
                        @change="(e: Event) => setConfig({leds: {brightness: Number((e.target as HTMLInputElement).value)}})" />
                </div>
            </template>
        </div>

        <!-- ═══ 5. Night Mode ═══ -->
        <div v-if="canExecute && shellyID && settings?.leds?.night_mode" class="et-presence__section">
            <div class="et-presence__section-header" @click="showNightMode = !showNightMode">
                <i class="fas fa-moon" /> Night Mode
                <i class="fas" :class="showNightMode ? 'fa-chevron-down' : 'fa-chevron-right'" style="margin-left: auto; font-size: var(--type-body); color: var(--color-text-disabled);" />
            </div>
            <template v-if="showNightMode">
                <div class="et-presence__row">
                    <span class="et-presence__label">Enable</span>
                    <button class="et-presence__toggle-btn" :class="settings.leds.night_mode.enable && 'et-presence__toggle-btn--on'"
                        @click="setConfig({leds: {night_mode: {enable: !settings.leds.night_mode.enable}}})">
                        <i class="fas" :class="settings.leds.night_mode.enable ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                </div>
                <template v-if="settings.leds.night_mode.enable">
                    <div class="et-presence__row">
                        <span class="et-presence__label">Start time</span>
                        <input type="time" class="et-presence__time"
                            :value="settings.leds.night_mode.active_between?.[0] ?? '22:00'"
                            @change="(e: Event) => setNightTime(0, (e.target as HTMLInputElement).value)" />
                    </div>
                    <div class="et-presence__row">
                        <span class="et-presence__label">End time</span>
                        <input type="time" class="et-presence__time"
                            :value="settings.leds.night_mode.active_between?.[1] ?? '06:00'"
                            @change="(e: Event) => setNightTime(1, (e.target as HTMLInputElement).value)" />
                    </div>
                    <div class="et-presence__row">
                        <span class="et-presence__label">Brightness ({{ settings.leds.night_mode.brightness }}%)</span>
                        <input type="range" class="et-presence__slider" :value="settings.leds.night_mode.brightness" min="0" max="100"
                            @change="(e: Event) => setConfig({leds: {night_mode: {brightness: Number((e.target as HTMLInputElement).value)}}})" />
                    </div>
                </template>
            </template>
        </div>

        <div v-if="configError" class="et-presence__error">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onUnmounted, ref} from 'vue';
import PresenceRadarMap from '@/components/core/PresenceRadarMap.vue';
import {useDevicesStore} from '@/stores/devices';
import {
    addPresenceTrackListener, 
    type PresenceTrackObject, sendRPC } from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
}>();

const deviceStore = useDevicesStore();
const configError = ref<string | null>(null);
const showRoom = ref(true);
const showSettings = ref(false);
const showFineTuning = ref(false);
const showLeds = ref(false);
const showNightMode = ref(false);
const newZoneName = ref('');
const newBlindSpot = ref('');

// Live radar
const isLiveTrack = ref(false);
const liveObjects = ref<PresenceTrackObject[]>([]);
let removeTrackListener: (() => void) | null = null;
let renewTimer: ReturnType<typeof setInterval> | null = null;

const device = computed(() =>
    props.shellyID ? deviceStore.devices[props.shellyID] : null
);

const radarZones = computed(() => {
    const st = device.value?.status;
    const cfg = device.value?.settings;
    if (!st || !cfg) return [];
    const zones: Array<{
        id: number;
        name?: string;
        color?: number[];
        area: number[][];
        occupied?: boolean;
        numObjects?: number;
    }> = [];
    for (const key of Object.keys(cfg)) {
        if (!key.startsWith('presencezone:')) continue;
        const id = Number(key.split(':')[1]);
        const zc = cfg[key];
        const zs = st[key];
        if (!zc?.area?.length) continue;
        zones.push({
            id,
            name: zc.name,
            color: zc.color,
            area: zc.area,
            occupied: zs?.value === true,
            numObjects: zs?.num_objects ?? 0
        });
    }
    return zones;
});

const blindSpotAreas = computed(
    () => (props.settings?.blind as number[][] | undefined) ?? []
);

async function startLiveTrack() {
    if (!props.shellyID) return;
    isLiveTrack.value = true;
    liveObjects.value = [];
    try {
        await sendRPC('FLEET_MANAGER', 'Presence.LiveTrack', {
            shellyID: props.shellyID
        });
    } catch {
        /* ignore */
    }
    renewTimer = setInterval(async () => {
        if (!props.shellyID) return;
        try {
            await sendRPC('FLEET_MANAGER', 'Presence.LiveTrack', {shellyID: props.shellyID});
        } catch {
            /* ignore */
        }
    }, 55_000);
    removeTrackListener = addPresenceTrackListener(
        props.shellyID,
        (objects) => {
            liveObjects.value = objects;
        }
    );
}

function stopLiveTrack() {
    isLiveTrack.value = false;
    liveObjects.value = [];
    if (renewTimer) {
        clearInterval(renewTimer);
        renewTimer = null;
    }
    removeTrackListener?.();
    removeTrackListener = null;
}

function toggleLiveTrack() {
    isLiveTrack.value ? stopLiveTrack() : startLiveTrack();
}

onUnmounted(stopLiveTrack);

async function onUpdateZone(zoneId: number, area: number[][]) {
    if (!props.shellyID) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Presence.Zone.SetConfig', {
            shellyID: props.shellyID,
            id: zoneId,
            config: {area}
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to update zone';
    }
}

async function onUpdateBlinds(blinds: number[][]) {
    if (!props.shellyID) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Presence.SetConfig', {
            shellyID: props.shellyID,
            config: {blind: blinds}
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to update blind spots';
    }
}

function setNightTime(index: number, value: string) {
    const current = props.settings?.leds?.night_mode?.active_between ?? [
        '22:00',
        '06:00'
    ];
    const updated = [...current];
    updated[index] = value;
    setConfig({leds: {night_mode: {active_between: updated}}});
}

const isEnabled = computed(() => props.settings?.enable !== false);

async function setConfig(config: Record<string, any>) {
    if (!props.shellyID) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Presence.SetConfig', {
            shellyID: props.shellyID,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to set config';
    }
}

async function setSensor(enable: boolean) {
    if (!props.shellyID) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Presence.SetSensor', {
            shellyID: props.shellyID,
            enable
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to toggle sensor';
    }
}

function addBlindSpot() {
    if (!newBlindSpot.value) return;
    const coords = newBlindSpot.value.split(',').map(Number);
    if (coords.length !== 4 || coords.some(Number.isNaN)) {
        configError.value = 'Enter 4 numbers: x0,y0,x1,y1';
        return;
    }
    // Ensure correct ordering: x0 < x1 and y0 > y1 (segment convention)
    if (coords[0] >= coords[2] || coords[3] >= coords[1]) {
        configError.value =
            'Coordinates must be: x0 < x1, y0 > y1 (e.g. -2,4,2,0)';
        return;
    }
    const current = props.settings?.blind ?? [];
    setConfig({blind: [...current, coords]});
    newBlindSpot.value = '';
}

function removeBlindSpot(index: number | string) {
    const i = typeof index === 'string' ? Number.parseInt(index, 10) : index;
    if (!Number.isFinite(i)) return;
    const current = [...(props.settings?.blind ?? [])];
    current.splice(i, 1);
    setConfig({blind: current});
}

async function addZone() {
    if (!props.shellyID || !newZoneName.value) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Presence.AddZone', {
            shellyID: props.shellyID,
            config: {name: newZoneName.value, enable: true}
        });
        newZoneName.value = '';
    } catch (e: any) {
        configError.value = e.message || 'Failed to add zone';
    }
}

async function tiltCalibrate() {
    if (!props.shellyID) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Presence.TiltCalibrate', {shellyID: props.shellyID});
    } catch (e: any) {
        configError.value = e.message || 'Tilt calibration failed';
    }
}
</script>

<style scoped>
.et-presence { display: flex; flex-direction: column; gap: var(--space-2); }
.et-presence__header { display: flex; align-items: center; justify-content: space-between; }
.et-presence__state { font-size: var(--type-body); font-weight: var(--font-bold); letter-spacing: var(--tracking-wide); }
.et-presence__state--on { color: var(--color-success-text); }
.et-presence__state--off { color: var(--color-text-disabled); }
.et-presence__toggle {
    width: 40px; height: 40px; border-radius: var(--radius-full); display: flex; align-items: center; justify-content: center;
    cursor: pointer; border: 1px solid var(--color-border-default); background-color: var(--color-surface-3); color: var(--color-text-tertiary);
}
.et-presence__toggle--on { background-color: var(--color-success); border-color: var(--color-success); color: white; }
.et-presence__radar-section {
    display: flex; flex-direction: column; gap: var(--space-2);
}
.et-presence__live-btn {
    display: flex; align-items: center; gap: var(--space-1-5); padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-md); border: 1px solid var(--color-border-default);
    background: var(--color-surface-2); color: var(--color-text-tertiary);
    font-size: var(--type-body); font-weight: var(--font-semibold); cursor: pointer;
    align-self: flex-start;
}
.et-presence__live-btn--on {
    border-color: rgba(var(--color-success-rgb), 0.4); background: rgba(var(--color-success-rgb), 0.08); color: rgba(var(--color-success-rgb), 0.9);
}
.et-presence__live-dot {
    width: 6px; height: 6px; border-radius: 50%; background: currentColor;
}
.et-presence__live-btn--on .et-presence__live-dot {
    animation: et-presence-pulse 1.5s ease-in-out infinite;
}
@keyframes et-presence-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
}
.et-presence__info {
    display: flex; flex-direction: column; gap: var(--space-0-5); padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-md); background-color: var(--color-surface-2);
}
.et-presence__kv { display: flex; justify-content: space-between; font-size: var(--type-body); }
.et-presence__kv > span:first-child { color: var(--color-text-disabled); }
.et-presence__kv > span:last-child { color: var(--color-text-primary); font-weight: var(--font-medium); }
.et-presence__section {
    display: flex; flex-direction: column; gap: var(--space-1-5);
    border: 1px solid var(--color-border-default); border-radius: var(--radius-md); padding: var(--space-2);
}
.et-presence__section-header {
    display: flex; align-items: center; gap: var(--space-1-5); font-size: var(--type-body);
    font-weight: var(--font-semibold); color: var(--color-text-tertiary); cursor: pointer; user-select: none;
}
.et-presence__subsection { padding-top: var(--space-1-5); border-top: 1px solid var(--color-border-default); display: flex; flex-direction: column; gap: var(--space-1); }
.et-presence__sublabel { font-size: var(--type-body); font-weight: var(--font-semibold); color: var(--color-text-tertiary); display: flex; align-items: center; gap: var(--space-1); }
.et-presence__hint { font-size: var(--type-body); color: var(--color-text-disabled); font-style: italic; }
.et-presence__value { font-size: var(--type-body); font-weight: var(--font-bold); color: var(--color-text-primary); }
.et-presence__row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) 0; }
.et-presence__label { font-size: var(--type-body); color: var(--color-text-disabled); flex-shrink: 0; }
.et-presence__num {
    width: 60px; padding: var(--space-1) var(--space-1-5); border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default); background-color: var(--color-surface-3);
    color: var(--color-text-primary); font-size: var(--type-body); text-align: center;
}
.et-presence__unit { font-size: var(--type-body); color: var(--color-text-disabled); }
.et-presence__select {
    font-size: var(--type-body); color: var(--color-text-primary); background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default); border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2); cursor: pointer;
}
.et-presence__toggle-btn { font-size: var(--type-subheading); color: var(--color-text-disabled); cursor: pointer; }
.et-presence__toggle-btn--on { color: var(--color-success-text); }
.et-presence__actions { display: flex; gap: var(--space-1-5); }
.et-presence__action-btn {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-2); border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default); background-color: var(--color-surface-2);
    color: var(--color-text-tertiary); font-size: var(--type-body); font-weight: var(--font-medium); cursor: pointer;
}
.et-presence__action-btn:hover { background-color: var(--color-surface-3); color: var(--color-text-primary); }
.et-presence__action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.et-presence__text {
    flex: 1; min-width: 0; font-size: var(--type-body); color: var(--color-text-primary);
    background-color: var(--color-surface-2); border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2);
}
.et-presence__text:focus { outline: none; border-color: var(--color-primary); }
.et-presence__badge {
    font-size: var(--type-body); font-weight: var(--font-bold);
    background-color: var(--color-surface-3); color: var(--color-text-secondary);
    padding: 0 var(--space-1-5); border-radius: var(--radius-full);
}
.et-presence__blind-row {
    display: flex; align-items: center; justify-content: space-between;
    font-size: var(--type-body); padding: var(--space-0-5) var(--space-1); border-radius: var(--radius-sm);
}
.et-presence__blind-row:nth-child(even) { background-color: var(--color-surface-2); }
.et-presence__blind-coords { font-family: monospace; color: var(--color-text-tertiary); }
.et-presence__blind-remove { color: var(--color-text-disabled); cursor: pointer; font-size: var(--type-body); }
.et-presence__blind-remove:hover { color: var(--color-danger-text); }
.et-presence__blind-add { display: flex; gap: var(--space-1-5); }
.et-presence__empty { font-size: var(--type-body); color: var(--color-text-disabled); text-align: center; padding: var(--space-1); }
.et-presence__slider { flex: 1; accent-color: var(--color-primary); }
.et-presence__time {
    font-size: var(--type-body); color: var(--color-text-primary);
    background-color: var(--color-surface-2); border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2);
}
.et-presence__time:focus { outline: none; border-color: var(--color-primary); }
.et-presence__error { display: flex; align-items: center; gap: var(--space-1-5); font-size: var(--type-body); color: var(--color-danger-text); }
</style>
