<script lang="ts" setup>
import { ref } from 'vue';

defineProps<{
    title: string,
}>()

const expanded = ref(false);

function expandedClicked() {
    expanded.value = !expanded.value;
}
</script>

<template>
    <div class="dropdown-box box p-0" @click="expandedClicked">
        <div class="box-hedaer is-clickable p-3 is-flex is-flex-align-row is-justify-content-space-between is-align-items-center">
            <span><b>{{ title }}</b></span>
            <span class="icon">
                <i class="is-pulled-right m-a fas" :class='{ "fa-chevron-up": expanded, "fa-chevron-down": !expanded }'></i>
            </span>
        </div>
        <transition mode="out-in">
            <div class="box-body px-3 pb-3" v-if="expanded" @click.stop>
                <hr class="mb-4 mt-1 has-background-white" style="height: 1px">
                <slot />
            </div>
        </transition>
    </div>
</template>

<style>
.box-hedaer:hover {
    cursor: pointer;
}

.v-enter-active {
    transition: opacity 600ms ease;
}

.v-enter-from,
.v-leave-to {
    opacity: 0;
}
</style>
