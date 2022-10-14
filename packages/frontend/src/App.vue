<template>
    <div v-if="backendConnected">
        <Menu />
        <div class="container">
            <router-view />
        </div>
    </div>
    <div class="no-connection m-auto" v-else>
        <h1 class="title has-text-white">Failed to connect to backend. Please check your configuration.</h1>
        <pre class="m-auto" style="text-align: left">{{JSON.stringify({ backendUri } , undefined, 2)}}</pre>
    </div>
    <Toast />
</template>

<script lang="ts">
import { storeToRefs } from 'pinia';
import { defineComponent,watch } from 'vue';
import Menu from './components/Menu.vue';
import { useSystemStore } from './stores/system';
import { useDevicesStore } from './stores/devices';
import Toast from '@/components/Toast.vue';

export default defineComponent({
    components: {
        Menu,
        Toast
    },
    setup() {
        const systemStore = useSystemStore();
        const deviceStore = useDevicesStore();
        const { backendConnected, backendUri } = storeToRefs(systemStore);

        watch(backendConnected, val => {
            if(val){
                deviceStore.fetch();
            } else {
                deviceStore.devices = {};
            }
        });

        return {
            backendConnected,
            backendUri
        }
    }
})
</script>

<style>
@import "https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css";

:root {
    --shelly-bg: rgba(21, 22, 23, 1);
    --shelly-comp-bg: rgb(49, 52, 56);
}

.has-background-shelly {
    background-color: var(--shelly-comp-bg);
}

.card-header-title-shelly {
    padding: 0;
}

.card-header-title-shelly>* {
    padding: 0.75rem 1rem;
}

select,
input {
    background-color: var(--shelly-bg) !important;
    color: white !important;
    border-color: gray !important;
}

#app {
    font-family: Avenir, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-align: center;
    color: #2c3e50;
}

#nav {
    padding: 30px;
}

#nav a {
    font-weight: bold;
    color: #2c3e50;
}

#nav a.router-link-exact-active {
    color: #42b983;
}

body {
    background-color: var(--shelly-bg);
    min-height: 100vh;
}

.slidedown-enter-active,
.slidedown-leave-active {
    transition: max-height 0.2s linear 0ms;
}

.slidedown-enter-to,
.slidedown-leave-from {
    overflow: hidden;
    max-height: 1000px;
}

.slidedown-enter-from,
.slidedown-leave-to {
    overflow: hidden;
    max-height: 0;
    transition: max-height 0.1s linear 0ms;
}
</style>
