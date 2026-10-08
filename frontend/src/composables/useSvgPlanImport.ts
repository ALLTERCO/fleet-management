// Everything read out of an uploaded SVG floor plan, from one fetch.
//
// Device markers and room geometry are two readings of the SAME file. Two
// composables would mean two downloads of a 21 MiB CAD export and two chances
// to disagree about whether the file is readable at all, so there is one.
//
// Every failure is reported as a failure. Collapsing a 404 or a corrupt file
// into an empty list would tell the user "your drawing has nothing in it",
// which is a different — and wrong — statement about their file.

import {type Ref, ref, watch} from 'vue';
import {
    type FloorPlanGeometryResolution,
    resolveFloorPlanGeometry
} from '@/helpers/floor-plan-geometry-resolver';
import {
    isSvgPlanUrl,
    readDevicesFromSvg,
    type SvgDevice
} from '@/helpers/svg-floorplan';

export type SvgPlanReadState =
    | 'idle' // nothing to read: no plan, or a raster plan with no layers
    | 'loading'
    | 'ready'
    | 'error';

/** Geometry is resolved on demand rather than with the fetch: Shelly's own
 *  Building 3 Floor 2 costs ~1 s of main thread to resolve and most visits to
 *  a floor never open the import panel. `reading` covers both "not started"
 *  and "in progress" for the caller — it is one uninterruptible step. */
export type SvgPlanGeometryState = 'reading' | 'ready';

export interface SvgPlanImport {
    readonly markers: Ref<SvgDevice[]>;
    readonly state: Ref<SvgPlanReadState>;
    readonly error: Ref<string | null>;
    /** Walls and room candidates. Null until readGeometry() has run. */
    readonly geometry: Ref<FloorPlanGeometryResolution | null>;
    readonly geometryState: Ref<SvgPlanGeometryState>;
    /** Resolve geometry from the drawing already fetched. Idempotent per
     *  drawing, and a no-op until one has loaded. */
    readGeometry(): void;
    reload(): void;
}

const FAILURE_MESSAGES = {
    unreadable: 'This file could not be read as SVG.',
    'no-dimensions':
        'This SVG has no viewBox or size, so marker positions cannot be' +
        ' placed on the plan.'
} as const;

/**
 * @param planUrl  URL of the current plan, or null when there is none.
 * @param enabled  Gate. While false nothing is fetched — the caller uses it
 *                 to keep the plan off the wire for users who could not act
 *                 on the result anyway.
 */
export function useSvgPlanImport(
    planUrl: Ref<string | null>,
    enabled: Ref<boolean>
): SvgPlanImport {
    const markers = ref<SvgDevice[]>([]);
    const state = ref<SvgPlanReadState>('idle');
    const error = ref<string | null>(null);
    const geometry = ref<FloorPlanGeometryResolution | null>(null);
    const geometryState = ref<SvgPlanGeometryState>('reading');

    // Held outside a ref: reading it must not make a component depend on
    // 21 MiB of source text it never renders.
    let planText: string | null = null;

    // Bumped per load; a response from a superseded plan URL is discarded.
    let loadSeq = 0;

    function reset(): void {
        loadSeq++;
        planText = null;
        markers.value = [];
        state.value = 'idle';
        error.value = null;
        geometry.value = null;
        geometryState.value = 'reading';
    }

    function fail(token: number, message: string): void {
        if (token !== loadSeq) return;
        markers.value = [];
        state.value = 'error';
        error.value = message;
    }

    async function load(url: string): Promise<void> {
        const token = ++loadSeq;
        planText = null;
        markers.value = [];
        state.value = 'loading';
        error.value = null;
        geometry.value = null;
        geometryState.value = 'reading';

        let text: string;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                fail(
                    token,
                    `Could not load the plan (HTTP ${response.status}).`
                );
                return;
            }
            text = await response.text();
        } catch (cause: unknown) {
            fail(token, `Could not load the plan: ${describe(cause)}`);
            return;
        }

        const extraction = readDevicesFromSvg(text);
        if (!extraction.ok) {
            fail(token, FAILURE_MESSAGES[extraction.reason]);
            return;
        }
        if (token !== loadSeq) return;
        planText = text;
        markers.value = extraction.devices;
        state.value = 'ready';
    }

    function readGeometry(): void {
        const source = planText;
        if (source === null || geometry.value !== null) return;
        const token = loadSeq;
        geometryState.value = 'reading';
        // One macrotask of head start so the panel paints "Reading the
        // drawing…" before the resolve blocks the thread.
        setTimeout(() => {
            if (token !== loadSeq) return;
            geometry.value = resolveFloorPlanGeometry(source);
            geometryState.value = 'ready';
        }, 0);
    }

    function refresh(): void {
        const url = planUrl.value;
        if (!enabled.value || !url || !isSvgPlanUrl(url)) {
            reset();
            return;
        }
        void load(url);
    }

    watch([planUrl, enabled], refresh, {immediate: true});

    return {
        markers,
        state,
        error,
        geometry,
        geometryState,
        readGeometry,
        reload: refresh
    };
}

function describe(cause: unknown): string {
    if (cause instanceof Error) return cause.message;
    return String(cause);
}
