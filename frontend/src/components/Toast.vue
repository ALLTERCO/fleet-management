<template>
    <div class="toasts">
        <article class="toast has-background-shelly message mb-2" v-for="toast in toasts" :key="toast.message"
            :style="calcStyle(toast)" style="border-radius: 6px;" v-show="toast.visible">
            <div class="message-header has-background-shelly">
                <p style="font-weight:400">{{ toast.message }}</p>
                <button class="delete has-background-grey" aria-label="delete" @click="toast.visible = false"></button>
            </div>
        </article>
    </div>
</template>

<script setup lang="ts">
import { toast_t, useToastStore } from "@/stores/toast";
import { storeToRefs } from "pinia";

const toast = useToastStore();
const { toasts } = storeToRefs(toast);

function calcStyle(toast: toast_t){
    if (toast.color == undefined) return "border: none";
    switch (toast.color) {
        case "success":
            return 'border: 2px solid green'
        case "warning":
            return 'border: 2px solid yellow'
        case "danger":
            return 'border: 2px solid red';
        default:
            return 'border: none'
    }
}
</script>

<style>
.toasts {
    position: fixed;
    top: 1rem !important;
    right: 1rem !important;
    left: auto !important;
    bottom: auto !important;
    width: 350px;
    z-index: 999;
}

.toast {
    transition: width 2s, height 4s;
}

.toast .message-body {
    max-height: 75px;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>