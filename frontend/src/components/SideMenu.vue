<template>
    <div v-if="smaller">
        <div
            class="sidemenu fixed bottom-0 left-1/2 w-11/12 z-10 -translate-x-1/2 flex flex-row h-[4rem] md:h-[5rem] border rounded-t-xl backdrop-blur-sm justify-around">
            <div v-for="item in items" :key="item.name"
                role="button"
                tabindex="0"
                class="w-auto h-16 flex flex-col justify-evenly hover:cursor-pointer my-auto"
                :data-track="'nav_' + item.name.toLowerCase()"
                @click="linkClicked(item.link)"
                @keydown.enter="linkClicked(item.link)"
                @keydown.space.prevent="linkClicked(item.link)">
                <div class="flex flex-col items-center text-center" :class="{ 'sidemenu__active': isActive(item.link) }">
                    <span class="text-xl md:text-2xl">
                        <img v-if="item.iconUrl" :src="item.iconUrl" class="w-6 h-6 object-contain" :alt="item.name" />
                        <i v-else :class="item.icon"></i>
                    </span>
                    <span class="text-xs line-clamp-1 hidden md:block">{{ item.name }}</span>
                </div>
            </div>
        </div>
    </div>
    <aside v-else class="min-w-[5.5rem] w-[5.5rem] h-[calc(100vh-0.5rem)] mt-2 overflow-y-auto ">
        <div
            class="sidemenu h-full z-10 flex flex-col border rounded-tr-xl backdrop-blur">
            <div v-for="item in items" :key="item.name"
                role="button"
                tabindex="0"
                class="sidemenu__item flex flex-col items-center justify-center border-b w-full h-[68px] hover:cursor-pointer"
                :data-track="'nav_' + item.name.toLowerCase()"
                @click="linkClicked(item.link)"
                @keydown.enter="linkClicked(item.link)"
                @keydown.space.prevent="linkClicked(item.link)">
                <div class="flex flex-col items-center" :class="{ 'sidemenu__active': isActive(item.link) }">
                    <span class="text-xl">
                        <img v-if="item.iconUrl" :src="item.iconUrl" class="w-5 h-5 object-contain" :alt="item.name" />
                        <i v-else :class="item.icon"></i>
                    </span>
                    <span class="text-xs mt-1">{{ item.name }}</span>
                </div>
            </div>
            <!-- <div class="h-[40px]">
                <figure>
                    <img src="https://control.shelly.cloud/images/shelly-logo.svg" width="112" height="28" />
                </figure>
            </div> -->
            <div class="mt-auto flex flex-col items-center w-full">
                <div @click="linkClicked('/settings/user')" data-track="nav_user_profile" class="sidemenu__item cursor-pointer flex flex-col items-center border-t py-3 w-full px-1">
                    <img :src="userImg" @error="imageLoadError"
                        class="sidemenu__avatar w-10 h-10 rounded-full mb-1 border-2" alt="User avatar" />
                    <div class="text-center w-full px-1 overflow-hidden">
                        <span class="sidemenu__username text-xs hover:underline truncate block">{{ authStore.displayName }}</span>
                    </div>
                </div>
            </div>
        </div>
    </aside>
</template>

<script setup lang="ts">
import {breakpointsTailwind, useBreakpoints} from '@vueuse/core';
import {storeToRefs} from 'pinia';
import {computed, onMounted, reactive, ref} from 'vue';
import {useRoute, useRouter} from 'vue-router/auto';
import {FLEET_MANAGER_HTTP} from '@/constants';
import {useAuthStore} from '@/stores/auth';
import * as ws from '@/tools/websocket';

const authStore = useAuthStore();
const {isAdmin} = storeToRefs(authStore);

// Permission check helper
function canAccessComponent(component: string): boolean {
    return authStore.canReadComponent(component as any);
}
const defaultImg = FLEET_MANAGER_HTTP + '/uploads/profilePics/default.png';
const imgOverride = ref<string | null>(null);
const userImg = computed(() => {
    if (imgOverride.value) return imgOverride.value;
    const name = authStore.username;
    return name
        ? `${FLEET_MANAGER_HTTP}/uploads/profilePics/${name}.png`
        : defaultImg;
});

const breakpoints = useBreakpoints(breakpointsTailwind);

const smaller = breakpoints.smaller('lg');

type link_t = {
    link: string;
    name: string;
    icon?: string;
    iconUrl?: string;
};

const router = useRouter();
const route = useRoute();

function linkClicked(link: string) {
    if (link.startsWith('http://') || link.startsWith('https://')) {
        window.open(link, '_blank');
        return;
    }

    router.push(link);
}

function imageLoadError() {
    imgOverride.value = defaultImg;
}

type link_with_perms_t = link_t & {
    adminOnly?: boolean;
    requiresComponent?: string; // Component name that must be readable
    requiresAllScope?: string; // Component name that must have ALL scope
};

const baseItems = reactive<link_with_perms_t[]>([
    {
        link: '/dash/1',
        name: 'Dashboard',
        icon: 'fa-solid fa-gauge-high',
        requiresComponent: 'dashboards'
    },
    {
        link: '/devices',
        name: 'Devices',
        icon: 'fa-solid fa-microchip'
    },
    // {
    //     link: '/graphs/main',
    //     name: 'Graphs',
    //     icon: 'fa-solid fa-draw-polygon',
    // },
    {
        link: '/automations/actions',
        name: 'Actions',
        icon: 'fa-solid fa-wand-sparkles',
        requiresComponent: 'actions'
    },
    {
        link: '/monitoring',
        name: 'Monitoring',
        icon: 'fa-solid fa-heart-pulse',
        adminOnly: true
    },
    {
        link: '/settings/app',
        name: 'Settings',
        icon: 'fa-solid fa-gear'
    }
]);

// Filter items based on user permissions
const items = computed(() =>
    baseItems.filter((item) => {
        // Admin-only check
        if (item.adminOnly && !isAdmin.value) return false;
        // Component read access check
        if (
            item.requiresComponent &&
            !canAccessComponent(item.requiresComponent)
        )
            return false;
        // ALL scope check
        if (
            item.requiresAllScope &&
            !authStore.hasAllScope(item.requiresAllScope as any)
        )
            return false;
        return true;
    })
);

// Detect if a string is a URL/path (for iconUrl) or FA class
function isIconUrl(icon: string): boolean {
    return /^(\/|https?:\/\/)/.test(icon);
}

onMounted(() => {
    ws.getRegistry('ui')
        .getItem('menuItems')
        .then((menuItems: unknown) => {
            try {
                if (Array.isArray(menuItems))
                    for (const entry of menuItems)
                        if (
                            typeof entry === 'object' &&
                            typeof entry.link === 'string' &&
                            typeof entry.name === 'string' &&
                            typeof entry.icon === 'string'
                        ) {
                            // Detect if icon is actually a URL and assign appropriately
                            const item: link_with_perms_t = {
                                link: entry.link,
                                name: entry.name
                            };
                            if (isIconUrl(entry.icon)) {
                                item.iconUrl = entry.icon;
                            } else {
                                item.icon = entry.icon;
                            }
                            baseItems.push(item);
                        }
            } catch (error) {
                console.error(
                    'cannot add menu entries from ' + JSON.stringify(menuItems),
                    error
                );
            }
        });
});

function isActive(link: string) {
    if (!link.startsWith('/')) return;

    if (link == '/') {
        return route.path == '/';
    }

    const prefix = link.split('/')[1];
    return route.path.startsWith('/' + prefix);
}
</script>

<style scoped>
.sidemenu {
    background-color: color-mix(in srgb, var(--sidebar-bg) 50%, transparent);
    border-color: var(--color-border-strong);
}
.sidemenu__item {
    border-color: var(--color-border-strong);
}
.sidemenu__item:hover {
    background-color: var(--color-surface-3);
}
.sidemenu__active {
    color: var(--color-primary-text);
}
.sidemenu__avatar {
    border-color: var(--color-border-strong);
}
.sidemenu__username {
    color: var(--color-text-secondary);
}
</style>
