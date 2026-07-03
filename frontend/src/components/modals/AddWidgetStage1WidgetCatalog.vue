<template>
    <div class="cat-grid">
        <button
            v-for="id in CATALOG_UI_WIDGETS"
            :key="id"
            type="button"
            class="cat-ui"
            :class="{selected: selected === id}"
            :aria-pressed="selected === id"
            @click="$emit('update:selected', id)"
        >
            <WidgetIllustration :widget="id" class="cat-ui-illustration" />
            <span class="cat-ui-name">{{ UI_WIDGET_META[id].name }}</span>
            <span class="cat-ui-desc">{{ UI_WIDGET_META[id].description }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
import WidgetIllustration from '@/components/dashboard/WidgetIllustration.vue';
import {CATALOG_UI_WIDGETS, UI_WIDGET_META} from '@/helpers/widgetSamples';
import type {UiWidgetId} from '@/types/dashboard-entry';

defineProps<{selected: UiWidgetId | ''}>();
defineEmits<{'update:selected': [id: UiWidgetId]}>();
</script>
