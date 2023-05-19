<template>
    <section class="hero is-fullheight">
        <div class="hero-body is-flex is-justify-content-center ">
            <div class="is-flex is-flex-direction-column" style="gap: 0.75rem">
                <img src="https://home.shelly.cloud/images/shelly-logo.svg" width="112" height="28" class="m-auto">

                <div class="control has-icons-left">
                    <input class="input" type="text" placeholder="username" v-model="username">
                    <span class="icon is-small is-left">
                        <i class="fas fa-user"></i>
                    </span>
                </div>
                <div class="control has-icons-left">
                    <input class="input" type="password" placeholder="password" v-model="password">
                    <span class="icon is-small is-left">
                        <i class="fas fa-lock"></i>
                    </span>
                </div>
                <button class="button is-primary" @click="login">Sign In</button>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import * as http from "@/tools/http";
import { useToastStore } from "@/stores/toast";
import { useSystemStore } from "@/stores/system";

const username = ref("");
const password = ref("");
const toast = useToastStore();

const login = async () => {
    try {
        const resp = await http.login(username.value, password.value);
        if (resp.isok && resp.token) {
            toast.addToast("Logged in", 'success');
            useSystemStore().setToken(resp.token);
        } else {
            toast.addToast("Incorrect username or password", 'danger');
        }
    } catch (error) {
        toast.addToast("Incorrect username or password", 'danger');
    }
}
</script>

<style>
::placeholder {
    color: white !important;
    opacity: 0.8;
}

input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus {
    box-shadow: 0 0 0 30px black inset !important;
    -webkit-box-shadow: 0 0 0 30px black inset !important;
}
</style>