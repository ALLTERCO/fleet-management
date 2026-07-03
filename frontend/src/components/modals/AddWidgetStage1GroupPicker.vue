<template>
    <template v-if="groupCount > 0">
        <Input
            v-model="searchModel"
            class="wiz-search-input"
            placeholder="Search groups..."
        />
        <div class="cat-grid">
            <template v-for="group of groupStore.groups">
                <CardPreview
                    v-if="matches(group.name)"
                    :key="group.id"
                    :entry="{type: 'group', size: '1x1', data: {id: group.id}}"
                    :interactive="true"
                    :selected="group.id === selected"
                    @select="$emit('update:selected', group.id)"
                />
            </template>
        </div>
    </template>
    <div v-else class="awm-empty-info">
        <i class="fas fa-layer-group" />
        <span class="awm-empty-title">No groups yet</span>
        <span class="awm-empty-desc">
            Create device groups in the Groups page, then add them to your
            dashboard here.
        </span>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Input from '@/components/core/Input.vue';
import CardPreview from '@/components/dashboard/CardPreview.vue';
import {useNameSearch} from '@/composables/useNameSearch';
import {useGroupsStore} from '@/stores/groups';

const groupStore = useGroupsStore();
const groupCount = computed(() => Object.keys(groupStore.groups).length);

defineProps<{selected: number}>();
const searchModel = defineModel<string>('search', {required: true});
defineEmits<{'update:selected': [id: number]}>();

const {matches} = useNameSearch(searchModel);
</script>
