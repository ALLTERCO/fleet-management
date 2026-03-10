<template>
    <div class="collapse-box dropdown-box p-0 rounded-xl hover:cursor-pointer shadow-md" @click="expandedClicked">
        <div class="cursor-pointer:hover py-2 px-3 flex iflex-row align">
            <span :key="String(expanded)" class="icon pr-3">
                <i
                    class="fas"
                    :class="{
                        'fa-chevron-right': !expanded,
                        'fa-chevron-down': expanded,
                    }"
                ></i>
            </span>
            <span>{{ title }}</span>
        </div>
        <transition mode="out-in">
            <div v-if="expanded" class="box-body px-3 pb-3" @click.stop>
                <hr class="collapse-divider mb-4 mt-1 h-[1px]" />
                <slot />
            </div>
        </transition>
    </div>
</template>

<script lang="ts" setup>
import {ref} from 'vue';

defineProps<{
    title: string;
}>();

const emit = defineEmits<{
    open: [];
    close: [];
}>();

const expanded = ref(false);

function expandedClicked() {
    expanded.value = !expanded.value;
    if (expanded.value) {
        emit('open');
    } else {
        emit('close');
    }
}
</script>

<style scoped>
.collapse-box {
    background-color: var(--color-surface-2);
}
.collapse-divider {
    background-color: var(--color-border-default);
    border: none;
}
.v-enter-active {
    transition: opacity var(--duration-slower) var(--ease-default);
}
.v-enter-from,
.v-leave-to {
    opacity: 0;
}
</style>
