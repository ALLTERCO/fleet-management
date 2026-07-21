<template>
    <div class="h-full flex flex-col settings-page">
        <h2 class="sr-only">Settings</h2>
        <header class="settings-shell__topbar">
            <h1 class="dp-header__title">{{ activeTitle }}</h1>
            <AlertBell />
            <PageTopMenu />
        </header>
        <div class="settings-shell">
            <nav class="settings-shell__nav" aria-label="Settings sections">
                <div class="search-pill">
                    <i class="fas fa-search search-pill__icon" aria-hidden="true" />
                    <input
                        v-model="navQuery"
                        type="search"
                        class="search-pill__input"
                        placeholder="Search settings"
                        aria-label="Search settings sections"
                    />
                </div>
                <p
                    v-if="navQuery && !filteredNavGroups.length"
                    class="settings-shell__no-match"
                >
                    No settings match "{{ navQuery }}".
                </p>
                <div
                    v-for="group in filteredNavGroups"
                    :key="group.label"
                    class="settings-shell__group"
                >
                    <button
                        type="button"
                        class="settings-shell__label"
                        :aria-expanded="!isGroupCollapsed(group.label)"
                        @click="toggleGroup(group.label)"
                    >
                        <span>{{ group.label }}</span>
                        <i
                            class="fas fa-chevron-down settings-shell__chevron"
                            :class="{
                                'settings-shell__chevron--collapsed':
                                    isGroupCollapsed(group.label)
                            }"
                            aria-hidden="true"
                        />
                    </button>
                    <template
                        v-for="item in isGroupCollapsed(group.label)
                            ? []
                            : group.items"
                        :key="item.path"
                    >
                        <a
                            v-if="item.external"
                            :href="item.path"
                            target="_blank"
                            rel="noopener"
                            class="settings-shell__item"
                        >
                            <i :class="item.icon" aria-hidden="true" />
                            <span>{{ item.label }}</span>
                            <i
                                class="fas fa-arrow-up-right-from-square settings-shell__external"
                                aria-hidden="true"
                            />
                        </a>
                        <RouterLink
                            v-else
                            :to="item.path"
                            class="settings-shell__item"
                            :class="{
                                'settings-shell__item--active': isActive(item.path)
                            }"
                            :aria-current="isActive(item.path) ? 'page' : undefined"
                        >
                            <i :class="item.icon" aria-hidden="true" />
                            <span>{{ item.label }}</span>
                        </RouterLink>
                    </template>
                </div>
            </nav>
            <div class="settings-shell__content">
                <RouterView v-slot="{Component}">
                    <Transition name="tab-fade">
                        <component :is="Component" :key="$route.path" />
                    </Transition>
                </RouterView>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, provide, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import {canAccessPage} from '@/auth/pageAccess';
import AlertBell from '@/components/core/AlertBell.vue';
import PageTopMenu from '@/components/core/PageTopMenu.vue';
import {ALERTS_PATH, PROFILE_PATH, SETTINGS_PATH} from '@/constants';
import {
    MONITORING_CLUSTERS,
    monitoringClusterForPath
} from '@/helpers/monitoringNavigation';
import {useAuthStore} from '@/stores/auth';
import type {RouteTab} from '@/types/page-template';

// One sidebar for the whole settings area — the device-settings language
// (grouped items, circular icon chips) instead of horizontal tab rows.

interface SettingsNavItem {
    label: string;
    path: string;
    icon: string;
    external?: boolean;
}

interface SettingsNavGroup {
    label: string;
    items: SettingsNavItem[];
}

const NAV_GROUPS: SettingsNavGroup[] = [
    {
        label: 'Application',
        items: [
            {label: 'General', path: SETTINGS_PATH, icon: 'fas fa-cog'},
            {
                label: 'User settings',
                path: PROFILE_PATH,
                icon: 'fas fa-user-cog'
            }
        ]
    },
    {
        label: 'Alerts',
        items: [
            {label: 'Alerts', path: ALERTS_PATH, icon: 'fas fa-bolt'},
            {
                label: 'Rules',
                path: '/settings/alerts/rules',
                icon: 'fas fa-sliders'
            },
            {
                label: 'Channels',
                path: '/settings/alerts/channels',
                icon: 'fas fa-bullhorn'
            },
            {
                label: 'Templates',
                path: '/settings/alerts/templates',
                icon: 'fas fa-envelope-open-text'
            }
        ]
    },
    {
        label: 'Users & access',
        items: [
            {label: 'Users', path: '/settings/users', icon: 'fas fa-users'},
            {
                label: 'Groups',
                path: '/settings/user-groups',
                icon: 'fas fa-user-friends'
            },
            {
                label: 'Personas',
                path: '/settings/personas',
                icon: 'fas fa-id-badge'
            },
            {
                label: 'Access simulator',
                path: '/settings/authz-simulator',
                icon: 'fas fa-bolt'
            },
            {
                label: 'Identity policies',
                path: '/settings/identity-policies',
                icon: 'fas fa-id-card-clip'
            },
            {
                label: 'Identity SMTP',
                path: '/settings/identity-smtp',
                icon: 'fas fa-envelope'
            }
        ]
    },
    // Five clusters, one per operator question — detail pages are tabs
    // inside each cluster, defined next to the pages they navigate.
    {
        label: 'Monitoring',
        items: MONITORING_CLUSTERS.map((cluster) => ({
            label: cluster.label,
            path: cluster.path,
            icon: cluster.icon
        }))
    },
    {
        label: 'System',
        items: [
            {
                label: 'Security',
                path: '/settings/security',
                icon: 'fas fa-shield-halved'
            },
            {
                label: 'Plugins',
                path: '/settings/plugins',
                icon: 'fas fa-puzzle-piece'
            },
            {
                label: 'Configurations',
                path: '/settings/configurations',
                icon: 'fas fa-wrench'
            },
            {
                label: 'API reference',
                path: '/api/docs',
                icon: 'fas fa-code',
                external: true
            }
        ]
    }
];

const route = useRoute();
const authStore = useAuthStore();

// Same page-access registry as router/nav — hidden items stay hidden.
const navGroups = computed(() =>
    NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(
            (item) => item.external || canAccessPage(item.path, authStore)
        )
    })).filter((group) => group.items.length > 0)
);

const allNavPaths = computed(() =>
    navGroups.value.flatMap((group) =>
        group.items.filter((item) => !item.external).map((item) => item.path)
    )
);

// Sidebar search — same behavior as the device-settings nav: a query
// shows every match and overrides folding while it is set.
const navQuery = ref('');

const filteredNavGroups = computed(() => {
    const query = navQuery.value.trim().toLowerCase();
    if (!query) return navGroups.value;
    return navGroups.value
        .map((group) => ({
            ...group,
            items: group.items.filter((item) =>
                item.label.toLowerCase().includes(query)
            )
        }))
        .filter((group) => group.items.length > 0);
});

// Fold state persists like the device-settings sidebar does.
const GROUPS_COLLAPSED_KEY = 'fm.settings.collapsed-groups';
function loadCollapsedGroups(): Set<string> {
    try {
        const raw = localStorage.getItem(GROUPS_COLLAPSED_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return new Set(
            Array.isArray(parsed)
                ? parsed.filter((v): v is string => typeof v === 'string')
                : []
        );
    } catch {
        return new Set();
    }
}
const collapsedGroups = ref<Set<string>>(loadCollapsedGroups());

function isGroupCollapsed(label: string): boolean {
    // A search shows every match — folding only applies while browsing.
    if (navQuery.value.trim()) return false;
    return collapsedGroups.value.has(label);
}

function toggleGroup(label: string): void {
    const next = new Set(collapsedGroups.value);
    if (next.has(label)) {
        next.delete(label);
    } else {
        next.add(label);
    }
    collapsedGroups.value = next;
    try {
        localStorage.setItem(GROUPS_COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
        // Storage refused (private mode) — only the fold preference is lost.
    }
}

// Navigating to a page (deep link, redirect) unfolds its group so the
// active item is never hidden.
watch(
    () => route.path,
    () => {
        const group = navGroups.value.find((g) =>
            g.items.some((item) => !item.external && isActive(item.path))
        );
        if (group && collapsedGroups.value.has(group.label)) {
            toggleGroup(group.label);
        }
    },
    {immediate: true}
);

function isActive(path: string): boolean {
    // Monitoring routes belong to a cluster; only its sidebar item lights.
    const owner = monitoringClusterForPath(route.path);
    if (owner) return path === owner.path;
    if (route.path === path) return true;
    if (!route.path.startsWith(`${path}/`)) return false;
    // Longest matching item wins, so "Alerts" does not light up on /rules.
    return !allNavPaths.value.some(
        (other) =>
            other !== path &&
            other.length > path.length &&
            (route.path === other || route.path.startsWith(`${other}/`))
    );
}

// Topbar title follows the active sidebar item, like every page header.
const activeTitle = computed(() => {
    for (const group of navGroups.value) {
        const hit = group.items.find(
            (item) => !item.external && isActive(item.path)
        );
        if (hit) return hit.label;
    }
    return 'Settings';
});

// Sub-pages still inject this for their PageTemplate — empty means no tab
// row renders; the shell sidebar is the only navigation now.
provide('settingsTabs', computed<RouteTab[]>(() => []));
// The shell owns the topbar (title, bell, user menu) — sub-pages skip theirs.
provide('settingsShellChrome', true);
</script>

<style scoped>
.settings-page {
    padding: 0 var(--gap-md) var(--gap-md);
}

/* Same bar as PageTemplate's pt-topbar — title left, bell + user right. */
.settings-shell__topbar {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    padding: var(--gap-xs) var(--gap-xs) 0;
}

.settings-shell__topbar .dp-header__title {
    flex: 1 1 auto;
}

/* One frosted surface for the whole settings area — same glass recipe as
   GlassShell tier 1, with the nav and content as columns inside it. */
.settings-shell {
    display: grid;
    min-height: 0;
    flex: 1;
    margin-top: var(--gap-xs);
    grid-template-columns: minmax(15rem, 20%) minmax(0, 1fr);
    overflow: hidden;
    border: var(--space-px) solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: var(--glass-1-bg);
    backdrop-filter: var(--glass-1-filter);
    -webkit-backdrop-filter: var(--glass-1-filter);
    box-shadow: inset 0 1px 0 var(--glass-highlight);
}

.settings-shell__nav {
    display: flex;
    min-height: 0;
    flex-direction: column;
    gap: var(--gap-md);
    padding: var(--gap-sm);
    border-right: var(--space-px) solid var(--color-border-subtle);
    overflow-y: auto;
}

.settings-shell__group {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}

/* Hairline between groups — the eyebrow below marks the section start. */
.settings-shell__group + .settings-shell__group {
    padding-top: var(--gap-sm);
    border-top: 1px solid var(--divider-hairline);
}

.settings-shell__no-match {
    margin: 0;
    padding: var(--space-2) var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

/* Group header — a caps eyebrow, and a real button: click folds the
   group away. */
.settings-shell__label {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    min-height: var(--space-8);
    padding: var(--space-1) var(--gap-xs);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    text-align: left;
    cursor: pointer;
    transition:
        background-color var(--motion-hover),
        color var(--motion-hover);
}

.settings-shell__label:hover {
    background: var(--state-hover-bg);
    color: var(--color-text-secondary);
}

.settings-shell__chevron {
    margin-left: auto;
    color: var(--color-text-quaternary);
    font-size: var(--icon-size-xs);
    transition: transform var(--duration-fast) var(--ease-default);
}

.settings-shell__chevron--collapsed {
    transform: rotate(-90deg);
}

.settings-shell__item {
    display: grid;
    min-height: var(--touch-target-min);
    grid-template-columns: var(--icon-size-xl) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-xs) var(--gap-sm);
    border-radius: var(--radius-lg);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    text-decoration: none;
    transition:
        background-color var(--duration-fast) var(--ease-default),
        color var(--duration-fast) var(--ease-default);
}

.settings-shell__item:hover {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
}

.settings-shell__item--active {
    background: var(--color-primary-subtle);
    color: var(--color-text-primary);
}

.settings-shell__item > i:first-child {
    display: grid;
    width: var(--icon-size-xl);
    height: var(--icon-size-xl);
    place-items: center;
    border: var(--space-px) solid var(--color-border-medium);
    border-radius: var(--radius-full);
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-xs);
}

.settings-shell__item--active > i:first-child {
    border-color: rgba(var(--color-primary-rgb), 0.5);
    color: var(--color-primary-text);
}

.settings-shell__external {
    color: var(--color-text-quaternary);
    font-size: var(--icon-size-xs);
}

.settings-shell__content {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
}

/* Sub-pages wrap themselves in their own GlassShell (via PageTemplate).
   Inside the one big glass container that inner panel goes flat — no
   glass-in-glass, no double border. */
.settings-shell__content :deep(.pt-content.gs) {
    margin: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}

@media (max-width: 767px) {
    .settings-page {
        padding: var(--gap-sm);
    }

    .settings-shell {
        grid-template-columns: minmax(0, 1fr);
    }

    .settings-shell__nav {
        border-right: none;
        border-bottom: var(--space-px) solid var(--color-border-subtle);
    }
}
</style>
