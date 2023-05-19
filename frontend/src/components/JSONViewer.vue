<template>
    <div class="content">
        <slot></slot>
        <div class="control">
            <input type="text" class="input" v-model="filter" placeholder="Search keys">
        </div>
        <pre class="filtered">{{ filteredText }}</pre>
    </div>
</template>

<script setup lang="ts">
import { ref, toRef, computed } from "vue";

const props = defineProps<{ data: any }>();
const data = toRef(props, 'data');

const filter = ref("");

const filteredText = computed(() => {
    if (filter.value == undefined || filter.value.length == 0) {
        return JSON.stringify(data.value, undefined, 2);
    }
    let filtered: Record<string, any> = {};
    for (const key in data.value) {
        if (key.startsWith(filter.value)) {
            filtered[key] = data.value[key];
        }
    }
    return JSON.stringify(filtered, undefined, 2);
})

</script>

<style scoped>
.filtered {
    max-height: 50vh;
    overflow: scroll;
}

pre {
    text-align: left;
    white-space: pre;
}

.card-content {
    padding: 0px;
}

input,
pre {
    color: white;
    background-color: var(--shelly-comp-bg);
}


</style>