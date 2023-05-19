<template>
    <aside class="side-menu p-4 is-flex is-flex-direction-column is-justify-content-space-between" style="width: 200px">
        <div>
            <img src="https://home.shelly.cloud/images/shelly-logo.svg" width="112" height="28" class="mb-4" />

            <aside class="menu">
                <ul class="menu-list">
                    <li v-for="item in items" :key="item.name" @click="router.push(item.link)">
                        <a class="icon-text" :class="{ 'is-active': isActive(item.link) }">
                            <span class="icon">
                                <i :class=item.icon></i>
                            </span>
                            <span>{{ item.name }}</span>
                        </a>
                    </li>
                </ul>
            </aside>
        </div>

        <aside class="menu">
            <ul class="menu-list">
                <li>
                    <a class="icon-text" @click="logout">
                        <span class="icon">
                            <i class="fas fa-right-from-bracket"></i>
                        </span>
                        <span>Log out</span>
                    </a>
                </li>
            </ul>
        </aside>
    </aside>
</template>

<script setup lang="ts">
import { useSystemStore } from "@/stores/system";
import { useRouter, useRoute } from "vue-router";
import { reactive, watch, onMounted, toRef } from "vue";

const systemStore = useSystemStore();
const config = toRef(systemStore, 'config')

type link_t = {
    link: string;
    name: string;
    icon: string;
};

const router = useRouter();
const route = useRoute();

const items: link_t[] = reactive([
    {
        link: "/",
        name: "Devices",
        icon: "fa-solid fa-home"
    },
    {
        link: "/mass-rpc",
        name: "Mass RPC",
        icon: "fa-solid fa-code"
    },
    {
        link: "/apply-config",
        name: "Apply Config",
        icon: "fa-solid fa-code"
    }
]);

function buildItems(config: any) {
    items.length = 0;
    items.push({
        link: "/",
        name: "Devices",
        icon: "fa-solid fa-home"
    });

    if (config.discover_local) {
        items.push({
            link: "/discovered",
            name: "Discovered",
            icon: "fa-solid fa-wifi"
        })
    }

    items.push({
        link: "/rpc",
        name: "Mass RPC",
        icon: "fa-solid fa-code"
    }, {
        link: "/apply-config",
        name: "Apply Config",
        icon: "fa-solid fa-code"
    })

    if (config.ble) {
        items.push({
            link: "/bluetooth",
            name: "Bluetooth",
            icon: "fa-brands fa-bluetooth"
        })
    }

    items.push({
        link: "/plugins",
        name: "Plugins",
        icon: "fa-solid fa-puzzle-piece"
    },{
        link: "/settings",
        name: "Settings",
        icon: "fa-solid fa-gear"
    })
}

watch(config, config => {
    buildItems(config)
});

onMounted(() => {
    buildItems(systemStore.config)
})

function logout() {
    useSystemStore().setToken("");
}

function isActive(link: string) {
    return route.path == link;
}

</script>

<style scoped>
* {
    color: white !important;
    text-align: left;
}

.menu-list>li>a:hover {
    background-color: hsl(0, 0%, 26%);
}

.side-menu {
    border-right: 1px solid rgb(49, 52, 56) !important;
    position: fixed;
    height: 100vh;
    z-index: 10;
}
</style>