<template>
    <Input
        v-model="searchModel"
        class="wiz-search-input"
        placeholder="Search locations..."
    />
    <div class="cat-grid">
        <template v-for="loc of locationsStore.locations">
            <CardValue_Location
                v-if="matches(loc.name)"
                :key="loc.id"
                :location="loc"
                :selected="loc.id === selected"
                @open-preview="$emit('update:selected', loc.id)"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
import CardValue_Location from '@/components/cards/CardValue_Location.vue';
import Input from '@/components/core/Input.vue';
import {useNameSearch} from '@/composables/useNameSearch';
import {useLocationsStore} from '@/stores/locations';

const locationsStore = useLocationsStore();

defineProps<{selected: number}>();
const searchModel = defineModel<string>('search', {required: true});
defineEmits<{'update:selected': [id: number]}>();

const {matches} = useNameSearch(searchModel);
</script>
