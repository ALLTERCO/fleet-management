<template>
    <Widget :loading="false" :selected :vertical :stripped>
        <template #upper-corner>
            <span class="text-sm"> <i class="mr-1 fas fa-clock"></i> Clock </span>
        </template>

        <template #action>
            <Button v-if="editMode" type="red" @click="emit('delete')">Delete</Button>
            <span v-else class="text-lg font-semibold w-max h-10 flex items-center">
                {{ formattedTime }}
            </span>
        </template>

        <template #name>
            <span class="text-sm font-semibold w-max h-10 flex items-center">
                {{ dummy ? 'Clock' : '' }}
            </span>
        </template>
    </Widget>
</template>

<script lang="ts" setup>
import {defineEmits, onMounted, onUnmounted, ref, toRefs} from 'vue';
import Button from '@/components/core/Button.vue';
import Widget from '../WidgetsTemplates/VanilaWidget.vue';

type props_t = {
    dummy?: boolean;
    selected?: boolean;
    vertical?: boolean;
    stripped?: boolean;
    editMode?: boolean;
};

const props = withDefaults(defineProps<props_t>(), {
    dummy: false,
    selected: false,
    vertical: false,
    stripped: false,
    editMode: false
});

const {dummy, selected, vertical, stripped, editMode} = toRefs(props);

const emit = defineEmits<{
    delete: [];
}>();

const formattedTime = ref('');

function updateTime() {
    const now = new Date();
    formattedTime.value = now.toLocaleTimeString();
}

let interval: ReturnType<typeof setInterval>;

onMounted(() => {
    updateTime();
    interval = setInterval(updateTime, 1000);
});

onUnmounted(() => {
    if (interval) {
        clearInterval(interval);
    }
});
</script>
