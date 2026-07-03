import type {Location as ApiLocation} from '@api/location';
import {
    type ComputedRef,
    computed,
    nextTick,
    onMounted,
    onUnmounted,
    type Ref,
    ref,
    watch
} from 'vue';
import type {RouteLocationNormalizedLoaded, Router} from 'vue-router';
import {useFocusedLocationLive} from '@/composables/useFocusedLocationLive';
import {
    type RollupDevice,
    rollupLocationKpisMemoised
} from '@/helpers/locationKpiRollup';
import {realtimeSocket} from '@/helpers/realtimeSocket';
import {useDevicesStore} from '@/stores/devices';
import {useLocationsStore} from '@/stores/locations';
import {useToastStore} from '@/stores/toast';
import {trackInteraction} from '@/tools/observability';
import type {
    FocusCardPosition,
    LiveFallback,
    LocationKpiSnapshot
} from '@/types/focusCard';
import type {MapPin} from '@/types/map';
import {
    DEFAULT_FOCUS_CARD_RESERVES,
    FOCUS_CARD_DIMS_DEFAULT,
    useFocusCardPosition
} from './useFocusCardPosition';

/** What WorldMap.vue exposes via defineExpose. */
export interface MapPinProjector {
    project(lngLat: [number, number]): {x: number; y: number} | null;
    onMapMove(cb: () => void): () => void;
    flyTo?(lng: number, lat: number): void;
    fitToPins?(subset: readonly MapPin[]): void;
}

/** Lat/lng + visible-status snapshot the card hero binds to. */
export interface FocusedSiteSummary {
    readonly id: number;
    readonly name: string;
    readonly city: string;
    readonly lat: number;
    readonly lng: number;
    readonly status: 'on' | 'warn' | 'off';
}

/** Host-specific wiring — each page (locations / map dashboard) injects this. */
export interface LocationFocusCardConfig {
    /** Telemetry namespace prefix, e.g. 'locations' or 'map_dash'. */
    readonly telemetryScope: string;
    /** Where "Open site" navigates. */
    onOpenSite(locationId: number): Promise<void> | void;
    /** Where "Floor plan" navigates. */
    onOpenFloorPlan(locationId: number): Promise<void> | void;
    /** RPC to snooze alerts for a location. Optional — when omitted the
     *  composable hides the Snooze button rather than ship a stub that
     *  could lie to users about success. Reject → toast + card stays open. */
    snoozeLocation?: (locationId: number) => Promise<void>;
    /** False = host owns the Esc cascade (e.g. map dashboard with overlays). */
    handleEscape?: boolean;
}

export interface UseLocationFocusCardResult {
    readonly focusedSite: ComputedRef<FocusedSiteSummary | null>;
    readonly focusedKpisDisplay: ComputedRef<LocationKpiSnapshot>;
    readonly liveFallback: Ref<LiveFallback>;
    readonly focusCardPosition: ComputedRef<FocusCardPosition | null>;
    readonly snoozePending: Ref<boolean>;
    /** True when the host wired a `snoozeLocation` callback. The card
     *  template hides the Snooze button when false. */
    readonly snoozeAvailable: boolean;
    onPinClick(p: {id: string | number}): Promise<void>;
    onCardOpenSite(): Promise<void>;
    onCardOpenFloorPlan(): Promise<void>;
    onCardSnooze(): Promise<void>;
    closeFocusCard(): Promise<void>;
}

const SNOOZE_DEBOUNCE_MS = 750;

/** Single source of truth for the pin-anchored focus card behaviour.
 *  Both /organize/locations and /dash/map/[id] mount this — anything
 *  that would diverge between hosts goes in `config`. */
export function useLocationFocusCard(input: {
    readonly worldMapRef: Ref<MapPinProjector | null>;
    readonly route: RouteLocationNormalizedLoaded;
    readonly router: Router;
    readonly config: LocationFocusCardConfig;
}): UseLocationFocusCardResult {
    const store = useLocationsStore();
    const devicesStore = useDevicesStore();
    const toast = useToastStore();

    const focusedSiteId = ref<number | null>(null);
    const viewport = ref({w: window.innerWidth, h: window.innerHeight});
    const pin = ref<{x: number; y: number} | null>(null);
    const snoozePending = ref(false);

    let focusOpenedAt = 0;
    let lastActionTaken: string | null = null;
    let snoozeDebounce: number | null = null;
    /** Element that held focus when the card opened — restored on close. */
    let previousFocus: Element | null = null;

    const devicesIndex = computed(() => devicesStoreForRollup(devicesStore));

    // Shared between focusedSite (status) and focusedKpis (rollup). Hoisting
    // means descendantIdsOf — an O(N²·D) tree walk — runs at most once per
    // (focusedSiteId, locations) change instead of twice per recompute.
    const focusedDescendantIds = computed(() => {
        if (focusedSiteId.value == null) return null;
        return descendantIdsOf(focusedSiteId.value, store);
    });

    const focusedSite = computed<FocusedSiteSummary | null>(() => {
        if (focusedSiteId.value == null) return null;
        const loc = store.locations[focusedSiteId.value];
        if (!loc) return null;
        const geo = locationGeoLatLng(loc);
        if (!geo) return null;
        const descendants = focusedDescendantIds.value;
        if (descendants == null) return null;
        return {
            id: loc.id,
            name: loc.name,
            city: locationCity(loc),
            lat: geo.lat,
            lng: geo.lng,
            status: deriveStatusFromKpis(
                rollupLocationKpisMemoised({
                    location: loc,
                    devicesIndex: devicesIndex.value,
                    descendantLocationIds: descendants,
                    devicesRevision: devicesStore.devicesVersion
                })
            )
        };
    });

    const focusedKpis = computed<LocationKpiSnapshot | null>(() => {
        if (focusedSiteId.value == null) return null;
        const loc = store.locations[focusedSiteId.value];
        if (!loc) return null;
        const descendants = focusedDescendantIds.value;
        if (descendants == null) return null;
        return rollupLocationKpisMemoised({
            location: loc,
            devicesIndex: devicesIndex.value,
            descendantLocationIds: descendants,
            devicesRevision: devicesStore.devicesVersion
        });
    });

    const {live: liveKpis, fallback: liveFallback} = useFocusedLocationLive({
        focusedId: focusedSiteId,
        socket: realtimeSocket
    });

    // Track every live-state transition while a card is open. 'forbidden'
    // (permission revoked mid-session) is the most diagnostic; staleness
    // (live → snapshot) is the most common; 'unwired' surfaces stub usage.
    watch(liveFallback, (next, prev) => {
        if (next === prev || focusedSiteId.value == null) return;
        trackInteraction(
            input.config.telemetryScope,
            'focus_card_live_transition',
            JSON.stringify({
                locationId: focusedSiteId.value,
                from: prev,
                to: next
            })
        );
    });

    const focusedKpisDisplay = computed<LocationKpiSnapshot>(
        () => liveKpis.value ?? focusedKpis.value ?? EMPTY_DISPLAY
    );

    // -- positioning ---------------------------------------------------------
    const focusDims = computed(() => FOCUS_CARD_DIMS_DEFAULT);
    const focusReserves = ref(DEFAULT_FOCUS_CARD_RESERVES);
    const focusCardPosition = useFocusCardPosition({
        pin,
        dims: focusDims,
        reserves: focusReserves,
        viewport
    });

    let reprojectRafId = 0;
    function reprojectPin(): void {
        if (reprojectRafId !== 0) return;
        reprojectRafId = requestAnimationFrame(() => {
            reprojectRafId = 0;
            pin.value = computeNextPinPixel(
                focusedSiteId.value,
                store,
                input.worldMapRef.value
            );
        });
    }

    // -- telemetry helpers (single-purpose) ---------------------------------
    function trackAction(action: string): void {
        if (focusedSiteId.value == null) return;
        trackInteraction(
            input.config.telemetryScope,
            'focus_card_action',
            JSON.stringify({locationId: focusedSiteId.value, action})
        );
    }

    function trackClose(): void {
        if (focusedSiteId.value == null) return;
        trackInteraction(
            input.config.telemetryScope,
            'focus_card_close',
            JSON.stringify({
                locationId: focusedSiteId.value,
                durationMs: Math.round(performance.now() - focusOpenedAt),
                lastAction: lastActionTaken
            })
        );
    }

    // -- URL state ----------------------------------------------------------
    function stripFocused(
        q: typeof input.route.query
    ): typeof input.route.query {
        const next = {...q};
        delete next.focused;
        return next;
    }

    async function recoverFocusedFromUrl(): Promise<void> {
        const raw = input.route.query.focused;
        const id = typeof raw === 'string' ? Number(raw) : Number.NaN;
        if (!Number.isInteger(id) || id <= 0) return;
        // Awaits the locations fetch so the store is populated before we
        // check whether the requested id is a known location.
        await store.fetchLocations();
        if (store.locations[id] == null) return;
        focusedSiteId.value = id;
    }

    // -- handlers -----------------------------------------------------------
    async function onPinClick(p: {id: string | number}): Promise<void> {
        if (!isValidPinId(p.id)) return;
        const id = Number(p.id);
        const loc = store.locations[id];
        if (loc == null) return;
        const geo = locationGeoLatLng(loc);
        if (!geo) {
            trackInteraction(
                input.config.telemetryScope,
                'focus_card_skipped_no_geo',
                String(id)
            );
            return;
        }
        previousFocus = document.activeElement;
        focusedSiteId.value = id;
        focusOpenedAt = performance.now();
        lastActionTaken = null;
        trackInteraction(
            input.config.telemetryScope,
            'focus_card_open',
            String(id)
        );
        input.worldMapRef.value?.flyTo?.(geo.lng, geo.lat);
        reprojectPin();
        await nextTick();
        await input.router.replace({
            path: input.route.path,
            query: {...input.route.query, focused: String(id)}
        });
    }

    async function closeFocusCard(): Promise<void> {
        trackClose();
        focusedSiteId.value = null;
        pin.value = null;
        // Restore focus BEFORE the router replace: a route guard or teardown
        // triggered by the URL change can detach the previous focus target,
        // which would silently fall into the focus_restore_skipped path.
        restoreFocus();
        await nextTick();
        await input.router.replace({
            path: input.route.path,
            query: stripFocused(input.route.query)
        });
    }

    /** `Element.focus()` is a silent no-op on a detached node. If the trigger
     *  pin was removed from the DOM while the card was open (filter change,
     *  store reload, pagination), fall through to a telemetry signal so we
     *  can spot keyboard-user dead-ends in the wild. */
    function restoreFocus(): void {
        const target = previousFocus;
        previousFocus = null;
        if (!(target instanceof HTMLElement)) return;
        if (!document.contains(target)) {
            trackInteraction(
                input.config.telemetryScope,
                'focus_card_focus_restore_skipped',
                'detached'
            );
            return;
        }
        target.focus();
    }

    async function onCardOpenSite(): Promise<void> {
        if (focusedSiteId.value == null) return;
        const targetId = focusedSiteId.value;
        lastActionTaken = 'open_site';
        trackAction('open_site');
        const ok = await runNavigationAction('open_site', () =>
            input.config.onOpenSite(targetId)
        );
        if (ok) await closeFocusCard();
    }

    async function onCardOpenFloorPlan(): Promise<void> {
        if (focusedSiteId.value == null) return;
        const targetId = focusedSiteId.value;
        lastActionTaken = 'floor_plan';
        trackAction('floor_plan');
        const ok = await runNavigationAction('floor_plan', () =>
            input.config.onOpenFloorPlan(targetId)
        );
        if (ok) await closeFocusCard();
    }

    /** Returns true on success, false on rejection. Failure keeps the card
     *  open so the user can retry or close manually instead of being left
     *  with no recovery affordance after a router-guard abort. */
    async function runNavigationAction(
        action: string,
        fn: () => Promise<void> | void
    ): Promise<boolean> {
        try {
            await fn();
            return true;
        } catch (error) {
            console.error(`[focus-card] ${action} host callback failed`, error);
            trackInteraction(
                input.config.telemetryScope,
                'focus_card_navigation_failed',
                action
            );
            toast.error(
                'Navigation failed. The card is still open — try again.'
            );
            return false;
        }
    }

    async function onCardSnooze(): Promise<void> {
        if (focusedSiteId.value == null) return;
        if (snoozePending.value) return;
        if (snoozeDebounce !== null) return;
        const targetId = focusedSiteId.value;

        snoozePending.value = true;
        snoozeDebounce = window.setTimeout(() => {
            snoozeDebounce = null;
        }, SNOOZE_DEBOUNCE_MS);

        lastActionTaken = 'snooze';
        trackAction('snooze');

        const snoozeFn = input.config.snoozeLocation;
        if (!snoozeFn) {
            snoozePending.value = false;
            return;
        }
        try {
            await snoozeFn(targetId);
        } catch (error) {
            console.error('[focus-card] snooze failed', error);
            trackInteraction(
                input.config.telemetryScope,
                'focus_card_snooze_failed',
                String(targetId)
            );
            toast.error(
                'Snooze failed. Alerts for this location are still active.'
            );
            // Clear the debounce so a fast failure (<750 ms) doesn't block
            // the user's retry click — the pending flag is the user-visible
            // lock; the debounce is meant to dedupe accidental double-clicks.
            if (snoozeDebounce !== null) {
                window.clearTimeout(snoozeDebounce);
                snoozeDebounce = null;
            }
            return;
        } finally {
            snoozePending.value = false;
        }
        await closeFocusCard();
    }

    // -- lifecycle: map + viewport + keyboard wiring ------------------------
    let unsubscribeMove: (() => void) | null = null;
    watch(
        () => input.worldMapRef.value,
        (m) => {
            unsubscribeMove?.();
            unsubscribeMove = m?.onMapMove(reprojectPin) ?? null;
        },
        // `immediate` covers the case where the host already populated the ref
        // before the composable's watcher ran (HMR or sync ref binding).
        {immediate: true}
    );

    function onViewportResize(): void {
        viewport.value = {w: window.innerWidth, h: window.innerHeight};
        reprojectPin();
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape' && focusedSiteId.value != null) {
            closeFocusCard();
        }
    }

    const ownsEscape = input.config.handleEscape ?? true;

    onMounted(() => {
        window.addEventListener('resize', onViewportResize);
        if (ownsEscape) document.addEventListener('keydown', onKeydown);
        void recoverFocusedFromUrl();
    });

    onUnmounted(() => {
        window.removeEventListener('resize', onViewportResize);
        if (ownsEscape) document.removeEventListener('keydown', onKeydown);
        unsubscribeMove?.();
        if (reprojectRafId !== 0) cancelAnimationFrame(reprojectRafId);
    });

    // Back/forward browser nav — keep ref in sync with URL.
    watch(
        () => input.route.query.focused,
        (raw) => {
            if (raw == null || raw === '') {
                if (focusedSiteId.value !== null) focusedSiteId.value = null;
                return;
            }
            const id = typeof raw === 'string' ? Number(raw) : Number.NaN;
            if (isValidLocationId(id, store)) {
                if (focusedSiteId.value !== id) focusedSiteId.value = id;
                return;
            }
            // raw can also be string[] — vue-router behaviour when a query key
            // is repeated. Emit a structured payload so dashboard queries can
            // distinguish "garbage id" from "url has multiple ?focused=...".
            trackInteraction(
                input.config.telemetryScope,
                'focus_card_invalid_url_id',
                JSON.stringify({
                    kind: Array.isArray(raw) ? 'array' : 'string',
                    value: raw
                })
            );
            if (focusedSiteId.value !== null) focusedSiteId.value = null;
        }
    );

    return {
        focusedSite,
        focusedKpisDisplay,
        liveFallback,
        focusCardPosition,
        snoozePending,
        snoozeAvailable: typeof input.config.snoozeLocation === 'function',
        onPinClick,
        onCardOpenSite,
        onCardOpenFloorPlan,
        onCardSnooze,
        closeFocusCard
    };
}

// ────────────────────── pure helpers (no side effects) ────────────────────

const EMPTY_DISPLAY: LocationKpiSnapshot = Object.freeze({
    total: 0,
    on: 0,
    off: 0,
    warn: 0,
    powerKW: 0,
    todayKWh: null,
    alerts: null,
    lastSeenTs: 0,
    savingsPotentialPct: 0,
    firmwareHealthPct: 0,
    signalHealthPct: 0
});

function isValidPinId(value: unknown): value is number {
    const n = typeof value === 'string' ? Number(value) : value;
    return (
        typeof n === 'number' &&
        Number.isFinite(n) &&
        Number.isInteger(n) &&
        n > 0
    );
}

function isValidLocationId(
    id: number,
    store: ReturnType<typeof useLocationsStore>
): boolean {
    return Number.isInteger(id) && id > 0 && store.locations[id] != null;
}

function locationGeoLatLng(
    loc: ApiLocation
): {lat: number; lng: number} | null {
    const geo = (loc.kindFields as Record<string, unknown>)?.geo as
        | {lat?: number; lng?: number}
        | null
        | undefined;
    if (!geo) return null;
    const lat = geo.lat ?? Number.NaN;
    const lng = geo.lng ?? Number.NaN;
    if (
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        !Number.isFinite(lng) ||
        lng < -180 ||
        lng > 180
    )
        return null;
    return {lat, lng};
}

function locationCity(loc: ApiLocation): string {
    const fields = loc.kindFields as Record<string, unknown> | null;
    if (!fields?.address) return '';
    const address = fields.address as Record<string, unknown>;
    return typeof address.city === 'string' ? address.city : '';
}

function descendantIdsOf(
    rootId: number,
    store: ReturnType<typeof useLocationsStore>
): Set<number> {
    const out = new Set<number>([rootId]);
    let added = true;
    while (added) {
        added = false;
        for (const loc of Object.values(store.locations)) {
            if (
                loc.parentLocationId != null &&
                out.has(loc.parentLocationId) &&
                !out.has(loc.id)
            ) {
                out.add(loc.id);
                added = true;
            }
        }
    }
    return out;
}

function deriveStatusFromKpis(
    kpis: LocationKpiSnapshot
): 'on' | 'warn' | 'off' {
    if (kpis.alerts != null && kpis.alerts > 0) return 'warn';
    if (kpis.off > 0 && kpis.on === 0) return 'off';
    return 'on';
}

function computeNextPinPixel(
    focusedId: number | null,
    store: ReturnType<typeof useLocationsStore>,
    map: MapPinProjector | null
): {x: number; y: number} | null {
    if (focusedId == null || !map) return null;
    const loc = store.locations[focusedId];
    const geo = loc ? locationGeoLatLng(loc) : null;
    if (!geo) return null;
    return map.project([geo.lng, geo.lat]);
}

/** The devices store value is typed `shelly_device_t` internally; the
 *  rollup only reads `RollupDevice`'s six fields under identical names.
 *  The cast widens from the concrete store type to the rollup's structural
 *  contract — not a reinterpret.
 *
 *  Dev-mode invariant check: walk one sample value the first time we're
 *  called and crash loudly if a required field is missing. Surfaces store
 *  schema drift immediately instead of silently degrading to 0/null. */
let storeContractChecked = false;
const REQUIRED_FIELDS: (keyof RollupDevice)[] = [
    'id',
    'presence',
    'status',
    'info',
    '_statusTs'
];

function devicesStoreForRollup(
    devicesStore: ReturnType<typeof useDevicesStore>
): Readonly<Record<string, RollupDevice>> {
    const widened = devicesStore.devices as unknown as Readonly<
        Record<string, RollupDevice>
    >;
    if (import.meta.env.DEV && !storeContractChecked) {
        const sample = Object.values(widened)[0];
        if (sample) {
            for (const f of REQUIRED_FIELDS) {
                if (!(f in sample)) {
                    throw new Error(
                        `[focus-card] devices store missing required field '${f}' — RollupDevice contract violated`
                    );
                }
            }
            storeContractChecked = true;
        }
    }
    return widened;
}
