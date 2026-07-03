<template>
    <nav
        class="route-tabs"
        :style="{'--slider-count': String(options.length)}"
    >
        <div
            class="route-tabs__track"
            :style="{transform: `translateX(${activeIndex * 100}%)`}"
        />
        <button
            v-for="(opt, idx) in options"
            :key="String(opt.value)"
            type="button"
            class="route-tabs__btn"
            :class="{'route-tabs__btn--active': idx === activeIndex}"
            @click="onSelect(opt.value)"
        >
            <i
                v-if="opt.icon"
                :class="opt.icon"
            />
            {{ opt.label }}
        </button>
    </nav>
</template>

<script setup lang="ts" generic="T extends string">
import {computed} from 'vue';

export interface ViewToggleOption<V extends string> {
    value: V;
    label: string;
    icon?: string;
}

const props = defineProps<{
    options: ViewToggleOption<T>[];
}>();

const model = defineModel<T>({required: true});

const activeIndex = computed(() => {
    const idx = props.options.findIndex((o) => o.value === model.value);
    return idx >= 0 ? idx : 0;
});

function onSelect(v: T) {
    model.value = v;
}
</script>
