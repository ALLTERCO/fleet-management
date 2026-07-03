<template>
    <div class="prm" :class="[compact && 'prm--compact', editMode && 'prm--editing']">
        <!-- Edit mode toolbar -->
        <div v-if="editable && !compact" class="prm-toolbar">
            <button class="prm-tb-btn" :class="editMode === null && 'prm-tb-btn--act'" @click="editMode = null">
                <i class="fas fa-eye" /> View
            </button>
            <button class="prm-tb-btn" :class="editMode === 'room' && 'prm-tb-btn--act'" @click="startEditRoom">
                <i class="fas fa-border-all" /> Edit Room
            </button>
            <button class="prm-tb-btn" :class="editMode === 'blind' && 'prm-tb-btn--act'" @click="startEditBlind">
                <i class="fas fa-eye-slash" /> Blind Spots
            </button>
            <button v-for="zone in zones" :key="'eb'+zone.id" class="prm-tb-btn" :class="editMode === 'zone' && editZoneId === zone.id && 'prm-tb-btn--act'" @click="startEditZone(zone.id)">
                <span class="prm-tb-dot" :style="{background: zc(zone.color, 0.8)}" /> {{ zone.name || `Zone ${zone.id}` }}
            </button>
            <button v-if="editMode" class="prm-tb-btn prm-tb-btn--save" @click="saveEdit">
                <i class="fas fa-save" /> Save
            </button>
            <button v-if="editMode" class="prm-tb-btn" @click="cancelEdit">
                <i class="fas fa-xmark" /> Cancel
            </button>
        </div>

        <!-- SVG map -->
        <svg
            ref="svgEl"
            class="prm-svg"
            :viewBox="`${grid.x} ${grid.y} ${grid.w} ${grid.h}`"
            preserveAspectRatio="xMidYMid meet"
            @click="onMapClick"
            @mousemove="onMapHover"
            @mouseleave="hoverTile = null"
        >
            <rect :x="grid.x" :y="grid.y" :width="grid.w" :height="grid.h" class="prm-bg" />

            <!-- Grid lines -->
            <line v-for="gx in gridLinesX" :key="'gx'+gx" :x1="gx" :y1="grid.y" :x2="gx" :y2="grid.y+grid.h" class="prm-grid" />
            <line v-for="gy in gridLinesY" :key="'gy'+gy" :x1="grid.x" :y1="gy" :x2="grid.x+grid.w" :y2="gy" class="prm-grid" />

            <!-- Detection range band (Y=zmin at top, Y=zmax further down) -->
            <rect v-if="zmin != null && zmax != null" :x="grid.x" :y="zmin * T" :width="grid.w" :height="(zmax - zmin) * T" class="prm-det" />

            <!-- Zone segments: seg=[x0,y0,x1,y1] where y0>y1, sensor at top, X mirrored -->
            <template v-for="zone in displayZones" :key="'z'+zone.id">
                <rect v-for="(seg, si) in zone.area" :key="'zs'+zone.id+'_'+si"
                    :x="-seg[2]*T" :y="seg[3]*T" :width="(seg[2]-seg[0])*T" :height="(seg[1]-seg[3])*T"
                    class="prm-zone" :class="highlightZoneId === zone.id && 'prm-zone--hl'"
                    :style="{'--zf':zc(zone.color, highlightZoneId === zone.id ? 0.25 : 0.1),'--zs':zc(zone.color, highlightZoneId === zone.id ? 0.6 : 0.3)}" />
            </template>

            <!-- Zone labels (colored to match zone, matching prototype) -->
            <text v-for="zone in displayZones" :key="'zl'+zone.id"
                :x="zlX(zone)" :y="zlY(zone)" class="prm-zlabel" text-anchor="middle" dominant-baseline="middle"
                :fill="zc(zone.color, highlightZoneId === zone.id ? 0.6 : 0.4)"
            >{{ zone.name || `Zone ${zone.id}` }}</text>

            <!-- Blind spots (X mirrored) -->
            <rect v-for="(bs, i) in displayBlinds" :key="'bs'+i"
                :x="-bs[2]*T" :y="bs[3]*T" :width="(bs[2]-bs[0])*T" :height="(bs[1]-bs[3])*T"
                class="prm-blind" />

            <!-- Edit: dirty tiles highlight (X mirrored) -->
            <rect v-for="(dt, i) in dirtyTiles" :key="'dt'+i"
                :x="-(dt.x+1)*T" :y="dt.y*T" :width="T" :height="T"
                :class="dt.add ? 'prm-tile-add' : 'prm-tile-del'" />

            <!-- Hover tile indicator (X mirrored) -->
            <rect v-if="hoverTile && editMode"
                :x="-(hoverTile.x+1)*T" :y="hoverTile.y*T" :width="T" :height="T"
                class="prm-tile-hover" />

            <!-- Sensor marker (at top center) -->
            <rect :x="sensorX-T*0.6" :y="-T*0.3" :width="T*1.2" :height="T*0.3" rx="1" class="prm-sensor" />
            <text v-if="!compact" :x="sensorX" :y="-T*0.5" class="prm-slabel" text-anchor="middle">SENSOR</text>

            <!-- Tracked objects (X mirrored, rendered after sensor so they appear on top) -->
            <g v-for="(obj, idx) in objects" :key="'o'+obj.id">
                <circle :cx="-obj.x*T" :cy="obj.y*T" :r="4" class="prm-obj" />
                <text :x="-obj.x*T" :y="obj.y*T" class="prm-oid" text-anchor="middle" dominant-baseline="central">{{ idx + 1 }}</text>
            </g>

            <!-- Meter labels -->
            <template v-if="!compact">
                <text v-for="m in mLabelsY" :key="'my'+m" :x="grid.x+T*0.3" :y="m*T+T*0.3" class="prm-ml">{{ m*0.5 }}m</text>
                <text v-for="m in mLabelsX" :key="'mx'+m" :x="m*T" :y="-T*0.3" class="prm-ml" text-anchor="middle">{{ m*0.5 }}m</text>
            </template>
        </svg>

        <!-- Legend -->
        <div v-if="!compact && !hideLegend && displayZones.length" class="prm-legend">
            <div v-for="zone in displayZones" :key="'leg'+zone.id" class="prm-leg">
                <span class="prm-leg-dot" :style="{background:zc(zone.color,0.7)}" />
                <span>{{ zone.name || `Zone ${zone.id}` }}</span>
                <span v-if="zone.occupied" class="prm-leg-occ">{{ zone.numObjects ?? 0 }} <i class="fas fa-person" /></span>
            </div>
            <div v-if="displayBlinds.length" class="prm-leg"><span class="prm-leg-dot" style="background:rgba(var(--color-danger-rgb),0.4)" /><span>Blind spots</span></div>
            <div class="prm-leg prm-leg--dim"><span class="prm-leg-dot" style="background:rgba(var(--color-chart-axis-rgb), 0.15)" /><span>1 tile = 0.5m × 0.5m</span></div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';

export interface RadarZone {
    id: number;
    name?: string;
    color?: number[];
    area: number[][];
    occupied?: boolean;
    numObjects?: number;
}

export interface RadarObject {
    id: number;
    x: number;
    y: number;
    z?: number;
}

const props = withDefaults(
    defineProps<{
        zones?: RadarZone[];
        objects?: RadarObject[];
        blindSpots?: number[][];
        highlightZoneId?: number | null;
        sensorPosition?: string;
        zmin?: number | null;
        zmax?: number | null;
        compact?: boolean;
        hideLegend?: boolean;
        editable?: boolean;
    }>(),
    {
        zones: () => [],
        objects: () => [],
        blindSpots: () => [],
        highlightZoneId: null,
        sensorPosition: 'center',
        zmin: null,
        zmax: null,
        compact: false,
        hideLegend: false,
        editable: false
    }
);

const emit = defineEmits<{
    'update-zone': [zoneId: number, area: number[][]];
    'update-blinds': [blinds: number[][]];
}>();

const T = 10;
const svgEl = ref<SVGSVGElement | null>(null);

// Edit state
const editMode = ref<'room' | 'blind' | 'zone' | null>(null);
const editZoneId = ref<number | null>(null);
const dirtyTiles = ref<Array<{x: number; y: number; add: boolean}>>([]);
const hoverTile = ref<{x: number; y: number} | null>(null);

// What we display — zones and blinds (use dirty overlay when editing)
const displayZones = computed(() => props.zones);
const displayBlinds = computed(() => props.blindSpots);

// Grid bounds — fixed 16×16 tile grid (0.5m per tile = 8m × 8m)
// X: -8 to 8, Y: 0 to 16 (sensor at top, room extends downward)
// Extra space above for sensor marker
const grid = computed(() => {
    return {
        x: -8 * T,
        y: -1 * T,
        w: 16 * T,
        h: 17 * T
    };
});

const gridLinesX = computed(() => {
    const lines: number[] = [];
    for (
        let x = Math.floor(grid.value.x / T) * T;
        x <= grid.value.x + grid.value.w;
        x += T
    )
        lines.push(x);
    return lines;
});
const gridLinesY = computed(() => {
    const lines: number[] = [];
    for (
        let y = Math.floor(grid.value.y / T) * T;
        y <= grid.value.y + grid.value.h;
        y += T
    )
        lines.push(y);
    return lines;
});

const sensorX = computed(() => {
    const g = grid.value;
    if (props.sensorPosition === 'left') return g.x + T * 2;
    if (props.sensorPosition === 'right') return g.x + g.w - T * 2;
    return g.x + g.w / 2;
});

const mLabelsY = computed(() => {
    const r: number[] = [];
    const maxTile = Math.floor((grid.value.y + grid.value.h) / T);
    for (let t = 2; t <= maxTile; t += 2) r.push(t);
    return r;
});
const mLabelsX = computed(() => {
    const r: number[] = [];
    const lo = Math.ceil(grid.value.x / T);
    const hi = Math.floor((grid.value.x + grid.value.w) / T);
    for (let t = lo; t <= hi; t += 4) {
        if (t !== 0) r.push(t);
    }
    return r;
});

function zlX(z: RadarZone): number {
    const s = z.area?.[0];
    return s ? -((s[0] + s[2]) / 2) * T : 0;
}
function zlY(z: RadarZone): number {
    const s = z.area?.[0];
    return s ? ((s[1] + s[3]) / 2) * T : 0;
}
function zc(color?: number[], alpha = 0.3): string {
    if (!color || color.length < 3) return `rgba(var(--color-primary-rgb),${alpha})`;
    return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

// Convert mouse event to tile coordinates
function eventToTile(e: MouseEvent): {x: number; y: number} | null {
    const svg = svgEl.value;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const svgPt = pt.matrixTransform(ctm.inverse());
    // X is mirrored in display — convert back to data coordinates
    return {
        x: -Math.ceil(svgPt.x / T),
        y: Math.floor(svgPt.y / T)
    };
}

function onMapHover(e: MouseEvent) {
    if (!editMode.value) return;
    hoverTile.value = eventToTile(e);
}

function onMapClick(e: MouseEvent) {
    if (!editMode.value) return;
    const tile = eventToTile(e);
    if (!tile) return;

    // Check if tile is already in dirty list
    const idx = dirtyTiles.value.findIndex(
        (dt) => dt.x === tile.x && dt.y === tile.y
    );
    if (idx >= 0) {
        dirtyTiles.value.splice(idx, 1);
    } else {
        // Determine if adding or removing based on whether tile is already in the target area
        const isInTarget = isTileInTarget(tile.x, tile.y);
        dirtyTiles.value.push({x: tile.x, y: tile.y, add: !isInTarget});
    }
}

function isTileInTarget(tx: number, ty: number): boolean {
    const segments = getTargetSegments();
    for (const seg of segments) {
        if (tx >= seg[0] && tx < seg[2] && ty >= seg[3] && ty < seg[1])
            return true;
    }
    return false;
}

function getTargetSegments(): number[][] {
    if (editMode.value === 'room') {
        // Editing the first zone (main room)
        return props.zones[0]?.area ?? [];
    }
    if (editMode.value === 'blind') {
        return props.blindSpots;
    }
    if (editMode.value === 'zone' && editZoneId.value != null) {
        const zone = props.zones.find((z) => z.id === editZoneId.value);
        return zone?.area ?? [];
    }
    return [];
}

function startEditRoom() {
    editMode.value = 'room';
    editZoneId.value = props.zones[0]?.id ?? null;
    dirtyTiles.value = [];
    hoverTile.value = null;
}

function startEditZone(id: number) {
    editMode.value = 'zone';
    editZoneId.value = id;
    dirtyTiles.value = [];
    hoverTile.value = null;
}

function saveEdit() {
    if (!dirtyTiles.value.length) {
        editMode.value = null;
        return;
    }

    if (editMode.value === 'blind') {
        const result = applyDirtyTiles(props.blindSpots, dirtyTiles.value);
        emit('update-blinds', result);
    } else {
        const targetId =
            editMode.value === 'room' ? props.zones[0]?.id : editZoneId.value;
        if (targetId == null) return;
        const zone = props.zones.find((z) => z.id === targetId);
        if (!zone) return;
        const result = applyDirtyTiles(zone.area, dirtyTiles.value);
        emit('update-zone', targetId, result);
    }

    dirtyTiles.value = [];
    editMode.value = null;
}

function startEditBlind() {
    editMode.value = 'blind';
    editZoneId.value = null;
    dirtyTiles.value = [];
    hoverTile.value = null;
}

// Decompose segments into individual tiles, apply adds/removes, return new segments
function applyDirtyTiles(
    segments: number[][],
    dirty: Array<{x: number; y: number; add: boolean}>
): number[][] {
    // Build a tile set from existing segments
    const tiles = new Set<string>();
    for (const seg of segments) {
        for (let x = seg[0]; x < seg[2]; x++) {
            for (let y = seg[3]; y < seg[1]; y++) {
                tiles.add(`${x},${y}`);
            }
        }
    }
    // Apply dirty tiles
    for (const dt of dirty) {
        const key = `${dt.x},${dt.y}`;
        if (dt.add) tiles.add(key);
        else tiles.delete(key);
    }
    // Convert back to 1-tile segments
    const result: number[][] = [];
    for (const key of tiles) {
        const [x, y] = key.split(',').map(Number);
        result.push([x, y + 1, x + 1, y]);
    }
    return result;
}

function cancelEdit() {
    dirtyTiles.value = [];
    hoverTile.value = null;
    editMode.value = null;
    editZoneId.value = null;
}
</script>

<style scoped>
.prm { width: 100%; height: 100%; position: relative; flex: 1; min-height: 0; }
.prm--compact { }
.prm--editing .prm-svg { cursor: crosshair; }
/* Matching prototype 16×16 grid visual exactly */
.prm-svg { width: 100%; height: 100%; overflow: hidden; }
.prm--compact .prm-svg { max-height: 200px; }
.prm-bg { fill: rgba(10,16,28,0.9); }
.prm-grid { stroke: rgba(var(--color-chart-axis-rgb), 0.08); stroke-width: 0.5; }
.prm-det { fill: rgba(var(--color-primary-rgb),0.015); stroke: rgba(var(--color-primary-rgb),0.08); stroke-width: 0.5; stroke-dasharray: 3 2; }
.prm-zone { fill: var(--zf, rgba(var(--color-primary-rgb),0.1)); stroke: var(--zs, rgba(var(--color-primary-rgb),0.3)); stroke-width: 0.5; rx: 1; }
.prm-zone--hl { fill: var(--zf, rgba(var(--color-success-rgb),0.15)); stroke: var(--zs, rgba(var(--color-success-rgb),0.4)); stroke-width: 0.8; }
.prm-zlabel { fill: var(--color-text-primary); font-size: var(--type-body); font-weight: 700; pointer-events: none; }
.prm--compact .prm-zlabel { font-size: var(--type-body); }
.prm-blind { fill: rgba(var(--color-danger-rgb),0.05); stroke: rgba(var(--color-danger-rgb),0.12); stroke-width: 0.4; stroke-dasharray: 2 2; }
.prm-obj { fill: rgba(var(--color-success-rgb),0.85); }
.prm-oid { fill: #fff; font-size: var(--type-body); font-weight: 800; pointer-events: none; }
.prm-sensor { fill: rgba(var(--color-primary-rgb),0.5); }
.prm-slabel { fill: rgba(var(--color-primary-rgb),0.4); font-size: var(--type-body); font-weight: 700; letter-spacing: 0.5px; }
.prm-ml { fill: rgba(148,163,184,0.2); font-size: var(--type-body); font-weight: 600; }

/* Edit mode tiles */
.prm-tile-hover { fill: var(--color-border-default); stroke: var(--color-border-strong); stroke-width: 0.5; pointer-events: none; }
.prm-tile-add { fill: rgba(var(--color-success-rgb),0.25); stroke: rgba(var(--color-success-rgb),0.5); stroke-width: 0.5; pointer-events: none; }
.prm-tile-del { fill: rgba(var(--color-danger-rgb),0.25); stroke: rgba(var(--color-danger-rgb),0.5); stroke-width: 0.5; pointer-events: none; }

/* Toolbar */
.prm-toolbar { display: flex; gap: var(--space-1); flex-wrap: wrap; padding-bottom: var(--space-1-5); }
.prm-tb-btn {
    display: flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2);
    border-radius: var(--radius-sm, 4px); border: 1px solid rgba(148,163,184,0.18);
    background: rgba(10,16,28,0.6); color: rgba(var(--color-chart-axis-rgb), 0.6);
    font-size: var(--type-body); font-weight: 600; cursor: pointer;
}
.prm-tb-btn:hover { color: var(--color-text-primary); border-color: rgba(148,163,184,0.3); }
.prm-tb-btn--act { background: rgba(var(--color-primary-rgb),0.12); border-color: rgba(var(--color-primary-rgb),0.4); color: rgba(var(--color-primary-rgb),0.9); }
.prm-tb-btn--save { background: rgba(var(--color-success-rgb),0.12); border-color: rgba(var(--color-success-rgb),0.4); color: rgba(var(--color-success-rgb),0.9); }
.prm-tb-dot { width: 8px; height: 8px; border-radius: var(--radius-xs); flex-shrink: 0; }

/* Legend */
.prm-legend { display: flex; gap: var(--space-2); flex-wrap: wrap; padding-top: var(--space-1); }
.prm-leg { display: flex; align-items: center; gap: var(--space-1); font-size: var(--type-body); color: var(--color-text-tertiary); }
.prm-leg--dim { opacity: 0.5; }
.prm-leg-dot { width: 8px; height: 8px; border-radius: var(--radius-xs); flex-shrink: 0; }
.prm-leg-occ { font-weight: 700; color: rgba(var(--color-success-rgb),0.9); }
.prm-leg-occ i { font-size: var(--type-body); }
</style>
