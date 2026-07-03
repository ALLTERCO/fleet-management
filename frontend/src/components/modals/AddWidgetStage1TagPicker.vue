<template>
    <Input
        v-model="searchModel"
        class="wiz-search-input"
        placeholder="Search tags..."
    />
    <div class="cat-grid">
        <template v-for="t of tagsStore.tags">
            <CardValue_Tag
                v-if="matches(t.name)"
                :key="t.id"
                :tag="t"
                :selected="t.id === selected"
                @open-preview="$emit('update:selected', t.id)"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
import CardValue_Tag from '@/components/cards/CardValue_Tag.vue';
import Input from '@/components/core/Input.vue';
import {useNameSearch} from '@/composables/useNameSearch';
import {useTagsStore} from '@/stores/tags';

const tagsStore = useTagsStore();

defineProps<{selected: number}>();
const searchModel = defineModel<string>('search', {required: true});
defineEmits<{'update:selected': [id: number]}>();

const {matches} = useNameSearch(searchModel);
</script>
