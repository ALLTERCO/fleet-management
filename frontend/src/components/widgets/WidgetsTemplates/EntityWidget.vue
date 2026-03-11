<template>
    <div v-if="vertical"
        class="widget-card flex flex-row items-center gap-3 rounded-lg shadow-lg p-3 relative text-sm min-h-[76px] justify-start hover:cursor-pointer"
        :class="{ 'widget-card--selected': selected }" @click="onClick">
        <div v-if="vc">
            <span class="widget-badge text-xs rounded-br-lg py-[2px] top-0 left-0 px-[6px] absolute h-5 z-[var(--z-raised)]">
            <slot name="upper-corner">
                <i class="mr-1 fas fa-code"></i>
                Widget
            </slot>
        </span>
        </div>
        <figure class="widget-avatar w-11 h-11 aspect-square border rounded-full flex-shrink-0" :class="{ 'mt-3': vc }">
            <slot name="image">
                <img class="rounded-full w-11 h-11" src="/shelly_logo_black.jpg" alt="Shelly" />
            </slot>
        </figure>
        <div class="flex-grow text-left overflow-hidden min-w-0">
            <div class="font-semibold leading-snug">
                <slot name="name">
                    <span>Widget Name</span>
                </slot>
            </div>
            <template v-if="!stripped">
                <slot name="description" />
            </template>
        </div>
        <div v-if="!stripped" class="min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0">
            <input v-if="selectMode" type="checkbox" class="w-4 h-4" :value="selected" :checked="selected" />
            <slot v-else name="action" :vertical="true" />
        </div>
    </div>

    <div v-else
        class="widget-card min-w-[var(--grid-min-width)] min-h-[var(--grid-min-height)] no-scrollbar overflow-hidden text-ellipsis whitespace-pre-line text-center relative rounded-lg text-sm border self-stretch leading-tight"
        :class="[selected ? 'widget-card--selected' : 'widget-card--default']" @click="onClick">
        <span class="widget-badge text-xs rounded-br-lg py-[2px] px-[6px] absolute h-5 self-center top-0 left-0 z-[var(--z-raised)]">
            <slot name="upper-corner">

            </slot>
        </span>
        <div v-if="$slots.status" class="absolute top-1 right-1 z-[var(--z-raised)]">
            <slot name="status" />
        </div>
        <div
            class="widget-image-bg w-full h-[50%] absolute top-0 left-0 border-none [&>img]:mx-auto [&>img]:h-full [&>img]:brightness-75">
            <slot name="image">
                <img class="rounded-full" src="/shelly_logo_black.jpg" alt="Shelly" />
            </slot>
            <div class="absolute text-center bottom-1 w-full drop-shadow-2xl" style="text-shadow: 0 1px 8px rgba(0,0,0,0.7)">
                <slot name="name">
                    <span>Widget Name</span>
                </slot>
            </div>
        </div>

        <div class="absolute h-[50%] bottom-0 w-full p-1 flex flex-col">
            <template v-if="!stripped">
                <slot name="description" />
            </template>

            <div v-if="!stripped"
                class="min-w-[80%] [&>button]:min-w-[80%] [&>*]:mx-auto min-h-[40px] absolute self-center bottom-2.5">
                <input v-if="selectMode" type="checkbox" class="w-4 h-4" :value="selected" :checked="selected" />
                <slot v-else name="action" :vertical="false" />
            </div>
        </div>
    </div>
</template>

<style>
/* Card styles: global .widget-card system (design-tokens.css §16) — not scoped */
</style>

<script setup lang="ts">
import {toRefs} from 'vue';

type props_t = {
    selected?: boolean;
    vertical?: boolean;
    selectMode?: boolean;
    stripped?: boolean;
    board?: boolean;
    vc?: boolean;
};
const props = withDefaults(defineProps<props_t>(), {
    stripped: false,
    board: false
});

const emit = defineEmits<{
    select: [];
}>();

const {vertical, selected} = toRefs(props);

function onClick() {
    emit('select');
}
</script>
