<template>
    <div class="navbar-wrapper">
        <nav class="container navbar" role="navigation" aria-label="main navigation">
            <div class="navbar-brand">
                <a class="navbar-item" @click="router.push('/')">
                    <img src="https://home.shelly.cloud/images/shelly-logo.svg" width="112" height="28">
                </a>

                <a role="button" class="navbar-burger" aria-label="menu" aria-expanded="false"
                    data-target="navbarBasicExample">
                    <span aria-hidden="true"></span>
                    <span aria-hidden="true"></span>
                    <span aria-hidden="true"></span>
                </a>
            </div>

            <div class="navbar-menu has-text-white">
                <div class="navbar-start">
                    <a class="navbar-item has-text-white" @click="router.push('/')">
                        Devices
                    </a>

                    <a class="navbar-item has-text-white" @click="router.push('/mass-rpc')">
                        Mass RPC
                    </a>

                    <a class="navbar-item has-text-white" @click="router.push('/data')">
                        Data
                    </a>

                     <a class="navbar-item has-text-white" @click="router.push('/apply-config')">
                        Apply Config
                    </a>
                </div>

                <!-- <div class="navbar-end">
                    <div class="navbar-item">
                        <input type="text" class="input" placeholder="Search">
                    </div>
                </div> -->
            </div>
        </nav>
    </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useRouter } from 'vue-router';

export default defineComponent({
    setup() {
        const router = useRouter();
        return { router }
    }
})
</script>

<style scoped>
.navbar-wrapper {
    background-color: rgb(31, 33, 36);
    width: 100vw;
    margin-bottom: 1rem;
}

.navbar {
    background-color: transparent;
}

.navbar-item:hover {
    background-color: unset;
    color: rgba(255, 255, 255, 0.9);
}

::placeholder {
    color: white !important;
    opacity: 0.7 !important;
}
</style>