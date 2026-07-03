import {
    breakpointsTailwind,
    useBreakpoints,
    useLocalStorage
} from '@vueuse/core';
import {computed, reactive, ref} from 'vue';
import {FLEET_MANAGER_WEBSOCKET} from '@/constants';

export const breakpoints = useBreakpoints(breakpointsTailwind);

export const small = breakpoints.smaller('md');

export const defaultWs = useLocalStorage(
    'propose-ws',
    `${FLEET_MANAGER_WEBSOCKET}/shelly`
);

// ── Sidebar two-state model: icons-only or hidden ──
export type SidebarMode = 'collapsed' | 'hidden';

const OLD_SIDEBAR_KEY = 'fm_sidebar_hidden';
const NEW_SIDEBAR_KEY = 'fm_sidebar_state';

// Legacy values 'auto'/'expanded' from the previous four-mode model collapse
// to 'collapsed' on read — only 'hidden' survives untouched.
function normalizeSidebarMode(raw: string | null): SidebarMode {
    return raw === 'hidden' ? 'hidden' : 'collapsed';
}

function migrateSidebarKey() {
    const old = localStorage.getItem(OLD_SIDEBAR_KEY);
    if (old !== null && localStorage.getItem(NEW_SIDEBAR_KEY) === null) {
        localStorage.setItem(NEW_SIDEBAR_KEY, 'collapsed');
        localStorage.removeItem(OLD_SIDEBAR_KEY);
    }
    const stored = localStorage.getItem(NEW_SIDEBAR_KEY);
    if (stored !== null && stored !== 'collapsed' && stored !== 'hidden') {
        localStorage.setItem(NEW_SIDEBAR_KEY, normalizeSidebarMode(stored));
    }
}
migrateSidebarKey();

const sidebarMode = useLocalStorage<SidebarMode>(NEW_SIDEBAR_KEY, 'collapsed');

// Sidebar is never expanded — collapsed = icons-only (64px), hidden = 0.
const sidebarExpanded = computed(() => false);

const sidebarWidth = computed(() => (sidebarMode.value === 'hidden' ? 0 : 64));

function toggleSidebar() {
    sidebarMode.value = sidebarMode.value === 'hidden' ? 'collapsed' : 'hidden';
}

export function useSidebarState() {
    return {sidebarMode, sidebarExpanded, sidebarWidth, toggleSidebar};
}

export const modals = reactive({
    addWidget: false
});

// Edit-mode flag, toggled from action bar, consumed by /dash/[id].vue.
export const dashboardEditMode = ref(false);
