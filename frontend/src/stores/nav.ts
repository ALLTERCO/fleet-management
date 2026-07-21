// Single source of truth for the navigation menu (desktop + mobile).

import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import {canAccessPage, type PageAccessContext} from '@/auth/pageAccess';
import {
    AUTOMATIONS_PATH,
    DASHBOARDS_PATH,
    DEVICES_PATH,
    OPERATIONS_PATH,
    ORGANIZE_PATH,
    SETTINGS_PATH
} from '@/constants';
import {toastRpcError} from '@/helpers/domainErrors';
import {useAuthStore} from '@/stores/auth';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

export type MenuEntry = {
    type: 'item' | 'gap' | 'spacer';
    name?: string;
    link?: string;
    icon?: string;
    iconUrl?: string;
};

type CustomItem = {
    name: string;
    link: string;
    icon?: string;
    iconUrl?: string;
};

type BuiltinItem = {
    name: string;
    link: string;
    icon: string;
};

// Built-in nav, declared once. Sections are joined by gaps; empty sections
// (all items filtered) drop their gap. The `bottom` block is pushed after a
// spacer so it pins to the end of the desktop sidebar.
const BUILTIN_TOP: BuiltinItem[][] = [
    [
        {
            name: 'Dashboards',
            link: DASHBOARDS_PATH,
            icon: 'fa-regular fa-objects-column'
        }
    ],
    [
        {
            name: 'Devices',
            link: DEVICES_PATH,
            // Resolved to ShellyDeviceGlyph.vue by icon renderers.
            icon: 'glyph:shelly-device'
        }
    ],
    [
        {
            name: 'Organize',
            link: ORGANIZE_PATH,
            icon: 'fa-regular fa-folder-tree'
        }
    ],
    [
        {
            name: 'Automations',
            link: AUTOMATIONS_PATH,
            icon: 'fa-regular fa-bolt'
        }
    ],
    [
        {
            name: 'Operations',
            link: OPERATIONS_PATH,
            icon: 'fa-regular fa-list-check'
        }
    ]
    // Grafana is a tab under Automations (/automations/grafana), not top-level.
];

// Pinned to the bottom of the sidebar. Monitoring lives inside Settings now.
const BUILTIN_BOTTOM: BuiltinItem[] = [
    {
        name: 'Settings',
        link: SETTINGS_PATH,
        icon: 'fa-regular fa-gear'
    }
];

// Derived dedup sets — never declared by hand, always in sync with the data above.
const ALL_BUILTINS: BuiltinItem[] = [...BUILTIN_TOP.flat(), ...BUILTIN_BOTTOM];
const BUILTIN_NAMES = new Set(ALL_BUILTINS.map((i) => i.name));
const BUILTIN_LINKS = new Set(ALL_BUILTINS.map((i) => i.link));

// Treat as URL: leading slash, http(s)://, data:, blob:, ./ or ../ relative.
function isIconUrl(icon: string): boolean {
    return /^(\/|\.\.?\/|https?:\/\/|data:|blob:)/.test(icon);
}

// Drops malformed / duplicate / built-in-colliding entries. Replaces, never appends.
function normaliseCustomItems(raw: unknown): CustomItem[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: CustomItem[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null) continue;
        const e = entry as Record<string, unknown>;
        if (
            typeof e.link !== 'string' ||
            typeof e.name !== 'string' ||
            typeof e.icon !== 'string'
        )
            continue;
        if (
            BUILTIN_NAMES.has(e.name) ||
            BUILTIN_LINKS.has(e.link) ||
            seen.has(e.link)
        )
            continue;
        seen.add(e.link);
        const item: CustomItem = {name: e.name, link: e.link};
        if (isIconUrl(e.icon)) item.iconUrl = e.icon;
        else item.icon = e.icon;
        out.push(item);
    }
    return out;
}

function isItemVisible(item: BuiltinItem, access: PageAccessContext): boolean {
    return canAccessPage(item.link, access);
}

function builtinToEntry(item: BuiltinItem): MenuEntry {
    return {type: 'item', name: item.name, link: item.link, icon: item.icon};
}

function buildTopEntries(access: PageAccessContext): MenuEntry[] {
    const sections = BUILTIN_TOP.map((section) =>
        section.filter((it) => isItemVisible(it, access))
    ).filter((s) => s.length > 0);
    const out: MenuEntry[] = [];
    sections.forEach((section, idx) => {
        if (idx > 0) out.push({type: 'gap'});
        for (const item of section) out.push(builtinToEntry(item));
    });
    return out;
}

function buildBottomEntries(access: PageAccessContext): MenuEntry[] {
    const visible = BUILTIN_BOTTOM.filter((it) => isItemVisible(it, access));
    if (visible.length === 0) return [];
    return [{type: 'spacer'}, ...visible.map(builtinToEntry)];
}

export const useNavStore = defineStore('nav', () => {
    const authStore = useAuthStore();
    const toast = useToastStore();
    const customItems = ref<CustomItem[]>([]);
    let initPromise: Promise<void> | undefined;

    async function loadCustomItems(): Promise<void> {
        try {
            const raw = await ws.getRegistry('ui').getItem('menuItems');
            customItems.value = normaliseCustomItems(raw);
        } catch (e) {
            // init() is memoised, so this toasts once per load attempt.
            toastRpcError(toast, e, 'Failed to load custom menu items');
            customItems.value = [];
            // Allow retry on next init() call (e.g. WS reconnect, re-login).
            initPromise = undefined;
        }
    }

    // Idempotent: subsequent calls return the same in-flight or resolved promise.
    function init(): Promise<void> {
        if (!initPromise) initPromise = loadCustomItems();
        return initPromise;
    }

    // Drop cached state so the next init() refetches — call on logout / user switch.
    function reset(): void {
        customItems.value = [];
        initPromise = undefined;
    }

    const menuItems = computed<MenuEntry[]>(() => {
        const top = buildTopEntries(authStore);
        const custom: MenuEntry[] = customItems.value.map((c) => ({
            type: 'item',
            ...c
        }));
        const bottom = buildBottomEntries(authStore);
        return [...top, ...custom, ...bottom];
    });

    // Mobile bar shows only navigable items (no gaps / spacer).
    const mobileMenuItems = computed<MenuEntry[]>(() =>
        menuItems.value.filter((e) => e.type === 'item')
    );

    return {init, reset, menuItems, mobileMenuItems};
});
