<template>
    <div v-if="loading" class="awm-empty">
        <Spinner size="sm" />
        <span>Loading actions...</span>
    </div>
    <template v-else-if="actions.length > 0">
        <Input
            v-model="searchModel"
            class="wiz-search-input"
            placeholder="Search actions..."
        />
        <div class="cat-grid">
            <template v-for="action of actions">
                <CardPreview
                    v-if="matches(action.name)"
                    :key="action.id"
                    :entry="{type: 'action', size: '1x1', data: {id: action.id}}"
                    :interactive="true"
                    :selected="action.id === selected"
                    @select="$emit('update:selected', action.id)"
                />
            </template>
        </div>
    </template>
    <div v-else class="awm-empty-info">
        <i class="fas fa-bolt" />
        <span class="awm-empty-title">No actions yet</span>
        <span class="awm-empty-desc">
            Create actions in the Actions page to automate device commands,
            then add them here.
        </span>
    </div>
</template>

<script setup lang="ts">
import Input from '@/components/core/Input.vue';
import Spinner from '@/components/core/Spinner.vue';
import CardPreview from '@/components/dashboard/CardPreview.vue';
import {useNameSearch} from '@/composables/useNameSearch';
import type {action_t} from '@/types';

defineProps<{
    actions: action_t[];
    loading: boolean;
    selected: string;
}>();
const searchModel = defineModel<string>('search', {required: true});
defineEmits<{'update:selected': [id: string]}>();

const {matches} = useNameSearch(searchModel);
</script>
