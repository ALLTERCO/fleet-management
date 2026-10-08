<template>
    <div class="fpz">
        <p
            class="fpz__verdict"
            :class="`fpz__verdict--${verdict.code}`"
            :role="verdict.tone === 'warn' ? 'alert' : 'status'"
        >
            <i :class="['fas', verdict.icon, 'fpz__verdict-icon']" aria-hidden="true" />
            <span>
                <strong class="fpz__verdict-title">{{ verdict.title }}</strong>
                {{ verdict.detail }}
            </span>
        </p>

        <p v-if="evidence" class="fpz__evidence">{{ evidence }}</p>

        <p v-if="error" class="fpz__error" role="alert">
            <i class="fas fa-triangle-exclamation" aria-hidden="true" />
            <span>{{ error }}</span>
        </p>

        <template v-if="groups.length > 0">
            <ul class="fpz__list">
                <li
                    v-for="g in groups"
                    :key="g.color"
                    class="fpz__row"
                    :class="{'fpz__row--done': isAdded(g)}"
                >
                    <div class="fpz__row-hdr">
                        <span class="fpz__swatch" :style="{background: g.color}" />
                        <span class="fpz__meta">{{ groupMeta(g) }}</span>
                        <span v-if="isAdded(g)" class="fpz__done-tag">Added</span>
                    </div>

                    <template v-if="!isAdded(g)">
                        <input
                            type="text"
                            class="fpz__name"
                            :value="names[g.color] ?? ''"
                            :aria-label="`Name for the ${g.color} area`"
                            placeholder="Room name"
                            :disabled="busy"
                            @input="setName(g.color, ($event.target as HTMLInputElement).value)"
                        />
                        <div class="fpz__color-row">
                            <label class="fpz__color-label" :for="`fpz-color-${g.color.slice(1)}`">
                                Colour
                            </label>
                            <input
                                :id="`fpz-color-${g.color.slice(1)}`"
                                type="color"
                                class="fpz__color"
                                :value="colors[g.color] ?? g.color"
                                :disabled="busy"
                                @input="setColor(g.color, ($event.target as HTMLInputElement).value)"
                            />
                        </div>
                        <p v-if="preview(g)" class="fpz__preview">
                            Saves as {{ preview(g) }}
                        </p>
                    </template>
                </li>
            </ul>

            <div v-if="hasOpenGroups" class="fpz__actions">
                <Button
                    type="blue"
                    size="sm"
                    :disabled="busy || pending.length === 0"
                    @click="onConfirm"
                >
                    {{ confirmLabel }}
                </Button>
                <Button
                    v-if="pending.length > 0"
                    type="blue-hollow"
                    size="sm"
                    :disabled="busy"
                    @click="clearAll"
                >
                    Clear
                </Button>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import type {
    FloorPlanGeometryResolution,
    GeometryReport
} from '@/helpers/floor-plan-geometry-resolver';
import {
    groupZoneCandidates,
    type ZoneCandidateGroup,
    type ZoneConfirmation,
    zoneConfirmationsForGroup
} from '@/helpers/floor-plan-zone-import';

const props = withDefaults(
    defineProps<{
        /** Null while the drawing is still being read. */
        geometry: FloorPlanGeometryResolution | null;
        reading: boolean;
        /** Candidate keys already turned into zones this session. */
        confirmedKeys?: readonly string[];
        /** A refusal from the save path — shown, never swallowed. */
        error?: string | null;
        busy?: boolean;
    }>(),
    {confirmedKeys: () => [], error: null, busy: false}
);

const emit = defineEmits<{
    confirm: [confirmations: ZoneConfirmation[]];
}>();

// Group colour -> what the user typed. Owned by the user from the first
// keystroke; only a name the drawing itself supplied is ever seeded.
const names = ref<Record<string, string>>({});
const colors = ref<Record<string, string>>({});

// The one grouping call site: one colour is one team on a real test fit.
const groups = computed<ZoneCandidateGroup[]>(() =>
    props.geometry ? groupZoneCandidates(props.geometry.zoneCandidates) : []
);

const groupIdentity = computed(() => groups.value.map((g) => g.color).join(' '));

watch(
    groupIdentity,
    () => {
        const seeded: Record<string, string> = {};
        for (const g of groups.value) {
            if (g.suggestedName) seeded[g.color] = g.suggestedName;
        }
        names.value = seeded;
        colors.value = {};
    },
    {immediate: true}
);

const addedKeys = computed(() => new Set(props.confirmedKeys));

function isAdded(group: ZoneCandidateGroup): boolean {
    return group.candidates.every((c) => addedKeys.value.has(c.key));
}

const hasOpenGroups = computed(() => groups.value.some((g) => !isAdded(g)));

// Nothing here is a decision until this list is non-empty AND the user
// presses the button. A named group is an intent, not a zone.
const pending = computed<ZoneConfirmation[]>(() =>
    groups.value
        .filter((g) => !isAdded(g))
        .flatMap((g) =>
            zoneConfirmationsForGroup({
                group: g,
                name: names.value[g.color] ?? '',
                color: colors.value[g.color]
            })
        )
);

const confirmLabel = computed(() => {
    const n = pending.value.length;
    if (n === 0) return 'Name a room to continue';
    return `Add ${n} room${n === 1 ? '' : 's'}`;
});

function setName(color: string, value: string): void {
    names.value = {...names.value, [color]: value};
}

function setColor(color: string, value: string): void {
    colors.value = {...colors.value, [color]: value};
}

function clearAll(): void {
    names.value = {};
    colors.value = {};
}

function onConfirm(): void {
    if (pending.value.length === 0) return;
    // Kept on screen after handing over: the save can still refuse, and a
    // form that cleared itself would make a refusal look like success.
    emit('confirm', pending.value);
}

function groupMeta(group: ZoneCandidateGroup): string {
    const parts = group.candidates.length;
    return `${parts} part${parts === 1 ? '' : 's'} · ${areaLabel(group.areaShare)} of the plan`;
}

function areaLabel(share: number): string {
    const percent = share * 100;
    return percent < 1 ? '<1%' : `${Math.round(percent)}%`;
}

// The numbering a multi-part group gets, shown before anything is written.
function preview(group: ZoneCandidateGroup): string | null {
    const confirmations = zoneConfirmationsForGroup({
        group,
        name: names.value[group.color] ?? ''
    });
    if (confirmations.length === 0) return null;
    const labels = confirmations.map((c) => c.name);
    if (labels.length <= 3) return labels.join(', ');
    return `${labels[0]}, ${labels[1]} … ${labels[labels.length - 1]}`;
}

interface Verdict {
    /** Also the CSS modifier, so every outcome is distinguishable on screen
     *  and in a test. */
    readonly code: string;
    readonly tone: 'warn' | 'note' | 'info';
    readonly icon: string;
    readonly title: string;
    readonly detail: string;
}

// "We could not read this file" and "this file has no rooms" are different
// facts about the user's drawing, and a user who cannot tell them apart
// cannot fix it. Every branch below says which one happened.
const verdict = computed<Verdict>(() => {
    if (props.reading || !props.geometry) {
        return {
            code: 'reading',
            tone: 'info',
            icon: 'fa-circle-notch fa-spin',
            title: 'Reading the drawing…',
            detail: 'A large plan takes a moment.'
        };
    }
    const {failure, report} = props.geometry;
    if (failure === 'unreadable') {
        return {
            code: 'unreadable',
            tone: 'warn',
            icon: 'fa-triangle-exclamation',
            title: 'We could not read this drawing.',
            detail:
                'The stored file is not valid SVG, so nothing could be taken' +
                ' out of it. Export the plan again and re-upload it.'
        };
    }
    if (failure === 'no-dimensions') {
        return {
            code: 'no-dimensions',
            tone: 'warn',
            icon: 'fa-triangle-exclamation',
            title: 'This drawing has no page size.',
            detail:
                'It declares no viewBox and no width or height, so there is' +
                ' no space to put a room in. Export it again with a page size.'
        };
    }
    if (failure === 'no-geometry') {
        return {
            code: 'no-geometry',
            tone: 'warn',
            icon: 'fa-triangle-exclamation',
            title: 'This drawing is empty.',
            detail: 'We read it end to end and it draws nothing at all.'
        };
    }
    if (report.strategy === 'none') {
        return {
            code: 'no-signal',
            tone: 'note',
            icon: 'fa-circle-info',
            title: 'Nothing in this drawing says wall or room.',
            detail:
                `We read it end to end${layersSuffix(report)}, and it has` +
                ' neither plan layers nor filled areas to go on. Draw the' +
                ' rooms by hand with the Zones tool.'
        };
    }
    if (groups.value.length === 0) {
        return {
            code: 'no-rooms',
            tone: 'note',
            icon: 'fa-circle-info',
            title: 'No area in this drawing is big enough to be a room.',
            detail:
                'Everything filled in it is furniture-sized. Draw the rooms' +
                ' by hand with the Zones tool.'
        };
    }
    if (report.strategy === 'layer') {
        return {
            code: 'layer',
            tone: 'info',
            icon: 'fa-layer-group',
            title: "Rooms read from the drawing's own layer names.",
            detail:
                'The names below come from the drawing. Confirm the ones you' +
                ' want; anything left unnamed is ignored.'
        };
    }
    return {
        code: 'paint',
        tone: 'info',
        icon: 'fa-fill-drip',
        title: 'This drawing has no layer names, so rooms were read from fill colour.',
        detail:
            'A colour is a guess at a room, not a room. Name the ones that' +
            ' are real; anything left unnamed is ignored.'
    };
});

function layersSuffix(report: GeometryReport): string {
    if (report.layersFound.length === 0) return ' — it has no layer names';
    return ` — its layers are called ${report.layersFound.join(', ')}`;
}

// The evidence behind the verdict, so a result that looks wrong can be
// argued with rather than just disbelieved.
const evidence = computed<string | null>(() => {
    const resolution = props.geometry;
    if (props.reading || !resolution || !resolution.ok) return null;
    const r = resolution.report;
    const parts = [
        `${count(r.elementsScanned)} paths read`,
        `${count(r.wallSegments)} wall segments`
    ];
    if (r.elementsBelowMinSize > 0) {
        parts.push(`${count(r.elementsBelowMinSize)} too small to be walls`);
    }
    parts.push(`${Math.round(r.parseMs + r.resolveMs)} ms`);
    return parts.join(' · ');
});

function count(n: number): string {
    return n.toLocaleString('en-US');
}
</script>

<style scoped>
.fpz {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.fpz__verdict {
    margin: 0;
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2);
    font-size: var(--type-caption);
    line-height: 1.5;
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
}

.fpz__verdict-title {
    display: block;
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
}

.fpz__verdict-icon {
    margin-top: 2px;
    color: var(--color-text-tertiary);
}

.fpz__verdict--unreadable,
.fpz__verdict--no-dimensions,
.fpz__verdict--no-geometry {
    border-color: var(--color-status-warn);
}

.fpz__verdict--unreadable .fpz__verdict-icon,
.fpz__verdict--no-dimensions .fpz__verdict-icon,
.fpz__verdict--no-geometry .fpz__verdict-icon {
    color: var(--color-status-warn);
}

.fpz__verdict--layer .fpz__verdict-icon,
.fpz__verdict--paint .fpz__verdict-icon {
    color: var(--color-primary);
}

.fpz__evidence {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    line-height: 1.4;
}

.fpz__error {
    margin: 0;
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2);
    font-size: var(--type-caption);
    line-height: 1.5;
    color: var(--color-status-warn);
    background: var(--color-surface-2);
    border: 1px solid var(--color-status-warn);
    border-radius: var(--radius-md);
}

.fpz__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.fpz__row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
}

.fpz__row--done {
    opacity: 0.6;
}

.fpz__row-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.fpz__swatch {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
}

.fpz__meta {
    flex: 1;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}

.fpz__done-tag {
    flex-shrink: 0;
    padding: 0 var(--space-2);
    background: var(--color-surface-4);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.fpz__name {
    width: 100%;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
}

.fpz__color-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.fpz__color-label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.fpz__color {
    appearance: none;
    width: 32px;
    height: 24px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    cursor: pointer;
    background: transparent;
    padding: 0;
}

.fpz__preview {
    margin: 0;
    font-size: var(--type-caption);
    line-height: 1.4;
    color: var(--color-text-tertiary);
}

.fpz__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
}
</style>
