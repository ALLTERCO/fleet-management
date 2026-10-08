<template>
    <button
        ref="triggerEl"
        type="button"
        class="gs-trigger"
        aria-haspopup="dialog"
        aria-label="Search"
        :title="TRIGGER_TITLE"
        :aria-expanded="isOpen"
        @click="openPalette"
    >
        <i class="fas fa-search gs-trigger__icon" aria-hidden="true" />
    </button>

    <Teleport to="body">
        <Transition name="gs-fade">
            <div v-if="isOpen" class="gs-overlay">
                <!-- The scrim is its own element so clicking away is a click on
                     something, not a click that missed the panel. -->
                <button
                    type="button"
                    class="gs-scrim"
                    aria-label="Close search"
                    @click="close"
                />
                <div
                    class="gs-panel"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Search"
                >
                    <div class="search-pill">
                        <i
                            class="fas fa-search search-pill__icon"
                            aria-hidden="true"
                        />
                        <input
                            ref="inputEl"
                            v-model="query"
                            type="text"
                            class="search-pill__input gs-input"
                            role="combobox"
                            :aria-controls="ELEMENT_IDS.list"
                            aria-expanded="true"
                            :aria-activedescendant="activeRowId"
                            aria-label="Search the whole app"
                            :placeholder="PLACEHOLDER"
                            autocomplete="off"
                        />
                    </div>

                    <GlobalSearchResults
                        :rows="rows"
                        :active-index="activeIndex"
                        :empty-message="emptyMessage"
                        :ids="ELEMENT_IDS"
                        @choose="openIndex"
                        @highlight="activeIndex = $event"
                    />
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, watch} from 'vue';
import {useRouter} from 'vue-router';
import type {PendingDevice} from '@/api/waitingRoomRpc';
import {useKeyboardShortcuts} from '@/composables/useKeyboardShortcuts';
import {useLazySearchSources} from '@/composables/useLazySearchSources';
import {nextRowSelection} from '@/helpers/keyboardShortcuts';
import {lockBodyScroll, unlockBodyScroll} from '@/helpers/modalStack';
import {
    rankSearchMatches,
    type SearchHit,
    type SearchRange
} from '@/helpers/searchMatch';
import {
    buildSearchCandidates,
    type SearchableAlertInstance,
    type SearchTarget
} from '@/helpers/searchSources';
import {canOpenSettingsPage} from '@/helpers/settingsNavigation';
import {useAlertsStore} from '@/stores/alerts';
import {useAuthStore} from '@/stores/auth';
import {useChannelsStore} from '@/stores/channels';
import {useDashboardsStore} from '@/stores/dashboards';
import {useDestinationsStore} from '@/stores/destinations';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {usePersonasStore} from '@/stores/personas';
import {
    type RecentSearchItem,
    useSearchRecentsStore
} from '@/stores/searchRecents';
import {useTagsStore} from '@/stores/tags';
import {useUsersStore} from '@/stores/users';
import {getPreloadedRpc} from '@/tools/websocket';
import GlobalSearchResults from './GlobalSearchResults.vue';

/**
 * The one search that reaches the whole app. The header shows a box, not a
 * shortcut, because a hidden key is no way in for most people. Per-page
 * filter boxes are a separate thing and stay.
 */

/** A palette people read at a glance, not a list they scroll. */
const MAX_RESULT_ROWS = 10;
const RECENT_HEADING = 'Recent';
const PLACEHOLDER = 'Search devices, sites, groups and settings';

// The input has to point at the list and at the highlighted row, so the ids
// both elements share are named here and handed to the list.
const ELEMENT_IDS = {list: 'gs-results', activeRow: 'gs-active-row'};

// The key a Mac keyboard actually has; every other keyboard says Ctrl. The
// chord itself is bound once for the whole app, never here: a second owner
// would open two overlays on one keypress.
const SHORTCUT_HINT = /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? 'Cmd K'
    : 'Ctrl K';

// The icon says nothing on its own, so the tooltip carries the name and the
// shortcut. The header is a row of icons; a wide box would break that rhythm.
const TRIGGER_TITLE = `Search (${SHORTCUT_HINT})`;

interface PaletteRow {
    key: string;
    /** One running number across the headings, so up and down cross them. */
    index: number;
    heading: string;
    /** True on the first row under its heading, which renders the heading. */
    startsSection: boolean;
    label: string;
    /** Where the query matched the label, so those letters can be bold. */
    ranges: readonly SearchRange[];
    /** Where the row goes, and what recents remembers about it. */
    target: RecentSearchItem;
}

type DraftRow = Omit<PaletteRow, 'index' | 'startsSection'>;

const router = useRouter();
const authStore = useAuthStore();
const devicesStore = useDevicesStore();
const locationsStore = useLocationsStore();
const groupsStore = useGroupsStore();
const tagsStore = useTagsStore();
const entityStore = useEntityStore();
const alertsStore = useAlertsStore();
const dashboardsStore = useDashboardsStore();
const personasStore = usePersonasStore();
const usersStore = useUsersStore();
const channelsStore = useChannelsStore();
const destinationsStore = useDestinationsStore();
const recentsStore = useSearchRecentsStore();
const lazySources = useLazySearchSources();

const isOpen = ref(false);
const query = ref('');
const activeIndex = ref(0);
const triggerEl = ref<HTMLButtonElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
// A plain peek at connect-time cache, not a live store: waiting-room
// admission has no reactive Pinia store of its own today, so this is
// refreshed each time the palette opens rather than kept always current.
const pendingDevices = ref<Record<string, PendingDevice>>({});

// The whole keyboard model: up and down move, Enter opens, Escape closes.
const KEY_ACTIONS: Record<string, () => void> = {
    ArrowDown: () => moveHighlight('down'),
    ArrowUp: () => moveHighlight('up'),
    Enter: () => openIndex(activeIndex.value),
    Escape: close
};

// On the window, not the panel: one click on a heading or on the padding puts
// the caret back on the page, and the keys have to keep working after that.
useKeyboardShortcuts({
    bindings: [
        {
            key: Object.keys(KEY_ACTIONS),
            // The caret sits in the palette's own box while it is open.
            allowInEditable: true,
            // Shut, the palette leaves these keys to the page behind it.
            preventDefault: false,
            handler: onPaletteKey
        }
    ]
});

// Alerts everywhere else on the page (a bell badge, a KPI count) merge every
// state into this same store, so the palette filters down to firing ones
// itself instead of trusting whichever page last populated it.
const activeAlerts = computed<Record<number, SearchableAlertInstance>>(() => {
    const active: Record<number, SearchableAlertInstance> = {};
    for (const instance of Object.values(alertsStore.instances)) {
        if (instance.state === 'active') active[instance.id] = instance;
    }
    return active;
});

// Read-only: the websocket bootstrap already loads devices, locations,
// groups, tags, entities and active alerts for the whole app, so the
// palette must not open a second path to that data. Alert rules, dashboards,
// tariffs, personas, users, notification channels, destination groups and
// message templates are not preloaded — `lazySources` fetches each once
// search activity starts, and this stays empty for a kind until it does.
const candidates = computed(() =>
    buildSearchCandidates({
        devices: devicesStore.devices,
        locations: locationsStore.locations,
        groups: groupsStore.groups,
        tags: tagsStore.tags,
        entities: entityStore.entities,
        activeAlerts: activeAlerts.value,
        pendingDevices: pendingDevices.value,
        alertRules: alertsStore.rules,
        dashboards: dashboardsStore.dashboards,
        tariffs: lazySources.tariffs,
        personas: personasStore.personas,
        users: usersStore.users,
        notificationChannels: channelsStore.channels,
        destinationGroups: destinationsStore.destinations,
        messageTemplates: alertsStore.templates,
        canOpenPage: canOpenSettingsPage(authStore)
    })
);

const rows = computed(() => {
    const typed = query.value.trim();
    if (!typed) return numbered(recentsStore.recentItems.map(recentRow));
    const hits = rankSearchMatches(typed, candidates.value);
    return numbered(grouped(hits.slice(0, MAX_RESULT_ROWS)).map(resultRow));
});

const emptyMessage = computed(() => {
    const typed = query.value.trim();
    if (typed) return `Nothing matches "${typed}".`;
    return 'Nothing yet. Type to find a device, site, group or settings page.';
});

const activeRowId = computed(() =>
    rows.value.length ? ELEMENT_IDS.activeRow : undefined
);

// A new query is a new list, so the best answer is highlighted again. Typing
// anything also starts the backend-sourced kinds loading, debounced inside
// `lazySources` itself so this can fire on every keystroke without cost.
watch(query, (typed) => {
    activeIndex.value = 0;
    if (typed.trim()) lazySources.triggerLoad();
});

// Torn off screen while open, the page still has to get its scroll back.
onBeforeUnmount(() => {
    if (isOpen.value) unlockBodyScroll();
});

/** Every kind label is a plain noun, so one rule spells all the headings. */
function headingFor(kindLabel: string): string {
    return `${kindLabel}s`;
}

/** Ranked hits gathered under one heading per kind. A kind sits where its
 *  best answer ranked, so the very first row is the best answer overall. */
function grouped(
    hits: readonly SearchHit<SearchTarget>[]
): SearchHit<SearchTarget>[] {
    const byHeading = new Map<string, SearchHit<SearchTarget>[]>();
    for (const hit of hits) {
        const heading = headingFor(hit.item.value.kindLabel);
        const bucket = byHeading.get(heading);
        if (bucket) bucket.push(hit);
        else byHeading.set(heading, [hit]);
    }
    return [...byHeading.values()].flat();
}

/** What recents keeps of a result: where it goes, and how it opens. The live
 *  results are free to stop offering a page, so the item carries both. Keyed
 *  by the target's own id, never its route — several kinds share one route
 *  (every active alert opens the same inbox), and a shared route would
 *  collapse distinct records into a single recent entry. */
function recentTarget(hit: SearchHit<SearchTarget>): RecentSearchItem {
    const target = hit.item.value;
    const item: RecentSearchItem = {
        kind: target.kind,
        id: target.id,
        label: hit.item.label,
        route: target.route
    };
    if (target.external === true) item.external = true;
    return item;
}

function resultRow(hit: SearchHit<SearchTarget>): DraftRow {
    const target = hit.item.value;
    return {
        key: `${target.kind}:${target.id}`,
        heading: headingFor(target.kindLabel),
        label: hit.item.label,
        ranges: hit.labelRanges,
        target: recentTarget(hit)
    };
}

function recentRow(item: RecentSearchItem): DraftRow {
    return {
        key: `${item.kind}:${item.id}`,
        heading: RECENT_HEADING,
        label: item.label,
        ranges: [],
        target: item
    };
}

function numbered(draft: readonly DraftRow[]): PaletteRow[] {
    return draft.map((row, index) => ({
        ...row,
        index,
        startsSection: row.heading !== draft[index - 1]?.heading
    }));
}

function openPalette(): void {
    if (isOpen.value) return;
    isOpen.value = true;
    query.value = '';
    activeIndex.value = 0;
    pendingDevices.value =
        getPreloadedRpc<Record<string, PendingDevice>>(
            'WaitingRoom.GetPending'
        ) ?? {};
    lockBodyScroll();
    void nextTick(() => inputEl.value?.focus());
}

function close(): void {
    if (!isOpen.value) return;
    isOpen.value = false;
    unlockBodyScroll();
    triggerEl.value?.focus();
}

function moveHighlight(direction: 'up' | 'down'): void {
    const next = nextRowSelection({
        visibleIds: rows.value.map((row) => row.index),
        currentId: activeIndex.value,
        direction
    });
    if (next !== null) activeIndex.value = next;
}

function openIndex(index: number): void {
    const row = rows.value[index];
    if (!row) return;
    recentsStore.rememberOpened(row.target);
    close();
    navigate(row.target);
}

/** A route that leaves the app gets its own tab, so this page survives. */
function navigate(target: RecentSearchItem): void {
    if (target.external === true) {
        window.open(target.route, '_blank', 'noopener');
        return;
    }
    void router.push(target.route);
}

function onPaletteKey(event: KeyboardEvent): void {
    if (!isOpen.value) return;
    const action = KEY_ACTIONS[event.key];
    if (!action) return;
    event.preventDefault();
    action();
}
</script>

<style scoped>
/* A box shaped like a search field, so it reads as one from across the room,
   but a button: the typing happens in the overlay. */
.gs-trigger {
    display: flex;
    min-height: var(--touch-target-min);
    flex-shrink: 0;
    align-items: center;
    width: var(--touch-target-min);
    justify-content: center;
    padding: 0;
    border: 1px solid var(--glass-border);
    border-radius: var(--btn-radius);
    background: var(--glass-1-bg);
    backdrop-filter: var(--glass-1-filter);
    color: var(--color-text-tertiary);
    font-family: inherit;
    font-size: var(--type-body);
    cursor: pointer;
    transition:
        border-color var(--motion-hover),
        color var(--motion-hover),
        transform var(--motion-press);
}

.gs-trigger:hover {
    border-color: var(--color-primary);
    color: var(--color-text-primary);
}

/* Escape hands the caret back here, so this has to say where it went. */
.gs-trigger:focus-visible {
    border-color: var(--color-primary);
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
    color: var(--color-text-primary);
}

.gs-trigger:active {
    background: var(--state-active-bg);
    transform: scale(0.99);
}



.gs-overlay {
    position: fixed;
    z-index: var(--z-modal);
    display: flex;
    inset: 0;
    justify-content: center;
    padding: var(--space-16) var(--space-4) var(--space-4);
}

.gs-scrim {
    position: absolute;
    inset: 0;
    padding: 0;
    border: none;
    background: var(--color-overlay);
    backdrop-filter: blur(var(--scrim-blur));
    cursor: default;
}

.gs-panel {
    /* The scrim is absolutely placed behind it; the panel keeps the clicks. */
    position: relative;
    display: flex;
    width: 100%;
    max-width: 40rem;
    max-height: 60vh;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-xl);
    background: var(--glass-5-bg);
    backdrop-filter: var(--glass-5-filter);
    box-shadow: var(--shadow-xl);
}

/* The shared pill grows to fill spare width; this is a column, so pin it. */
.gs-panel .search-pill {
    flex: 0 0 auto;
}

/* The pill reserves its right edge for a clear and a funnel button. Neither
   belongs here, so the query gets that room back. */
.gs-panel .search-pill__input {
    padding-right: var(--gap-lg);
}

/* A fade a person meets a hundred times a day is felt, not watched. */
.gs-fade-enter-active,
.gs-fade-leave-active {
    transition: opacity var(--duration-fast) var(--ease-out);
}

.gs-fade-enter-from,
.gs-fade-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .gs-fade-enter-active,
    .gs-fade-leave-active {
        transition: none;
    }
}
</style>
