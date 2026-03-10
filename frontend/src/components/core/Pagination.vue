<template>
    <div>
        <div v-if="items.length > 50" class="flex items-center justify-between px-4 py-3 sm:px-6">
            <div class="flex flex-1 justify-between sm:hidden">
                <a
                    class="pagination-btn relative inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium"
                    @click="gotoPage(currentPage - 1)"
                    >Previous</a
                >
                <a
                    class="pagination-btn relative ml-3 inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium"
                    @click="gotoPage(currentPage + 1)"
                    >Next</a
                >
            </div>
            <div class="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                <div class="flex flex-row gap-2 items-center">
                    <Dropdown
                        :default="perPage"
                        :options="[50, 100, 200]"
                        @selected="(val) => (perPage = val) && (currentPage = 0)"
                    />

                    <p class="text-sm">
                        Showing
                        <span class="font-medium">{{ perPage * currentPage }}</span>
                        to
                        <span class="font-medium">{{ Math.min(items.length, perPage * (currentPage + 1)) }}</span>
                        of
                        <span class="font-medium">{{ items.length }}</span>
                        results
                    </p>
                </div>
                <div>
                    <nav class="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                        <!-- Prev -->
                        <a
                            class="pagination-nav-btn relative inline-flex items-center rounded-l-md px-2 py-2 focus:z-20 focus:outline-offset-0"
                            @click="gotoPage(currentPage - 1)"
                        >
                            <span class="sr-only">Previous</span>
                            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path
                                    fill-rule="evenodd"
                                    d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                                    clip-rule="evenodd"
                                />
                            </svg>
                        </a>
                        <!-- Numbers -->
                        <a
                            v-for="page of pageNumbers"
                            :key="page"
                            class="pagination-page relative inline-flex items-center px-4 py-2 text-sm font-semibold focus:z-20 focus:outline-offset-0 hover:cursor-pointer"
                            :class="[currentPage == page - 1 && 'pagination-page--active']"
                            :aria-current="currentPage == page - 1 ? 'page' : undefined"
                            @click="gotoPage(page - 1)"
                        >
                            {{ page }}
                        </a>
                        <!-- Next -->
                        <a
                            class="pagination-nav-btn relative inline-flex items-center rounded-r-md px-2 py-2 focus:z-20 focus:outline-offset-0"
                            @click="gotoPage(currentPage + 1)"
                        >
                            <span class="sr-only">Next</span>
                            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path
                                    fill-rule="evenodd"
                                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                                    clip-rule="evenodd"
                                />
                            </svg>
                        </a>
                    </nav>
                </div>
            </div>
        </div>

        <div class="mt-2">
            <slot :items="pageItems" />
        </div>
    </div>
</template>

<script setup lang="ts" generic="T">
import {useLocalStorage} from '@vueuse/core';
import {computed, ref, toRefs, watch} from 'vue';
import Dropdown from './Dropdown.vue';

const props = defineProps<{
    items: T[];
    store: string;
}>();

const {items} = toRefs(props);

// reset to first page if items change
watch(items, () => (currentPage.value = 0));

const perPage = useLocalStorage(`pagination:${props.store}`, 25);
const currentPage = ref(0);
const totalPages = computed(() =>
    Math.ceil(items.value.length / perPage.value)
);
const pageNumbers = computed(() => {
    const allPages = new Array<number>(totalPages.value)
        .fill(0)
        .map((_, index) => index + 1);

    if (totalPages.value < 6) {
        return allPages;
    }

    if (currentPage.value < 3) {
        return allPages.slice(0, 5);
    }

    if (currentPage.value + 4 > totalPages.value) {
        return allPages.slice(allPages.length - 5, allPages.length);
    }

    return [
        currentPage.value - 1,
        currentPage.value,
        currentPage.value + 1,
        currentPage.value + 2,
        currentPage.value + 3
    ];
});
const pageItems = computed(() =>
    items.value.slice(
        perPage.value * currentPage.value,
        perPage.value * (currentPage.value + 1)
    )
);

function gotoPage(page: number) {
    if (page > totalPages.value - 1 || page < 0) return;
    currentPage.value = page;
}
</script>

<style scoped>
.pagination-btn {
    border-color: var(--color-border-strong);
    color: var(--color-text-secondary);
}
.pagination-btn:hover {
    background-color: var(--color-surface-3);
}
.pagination-nav-btn {
    color: var(--color-text-tertiary);
    box-shadow: inset 0 0 0 1px var(--color-border-strong);
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.pagination-nav-btn:hover {
    background-color: var(--color-surface-3);
}
.pagination-page {
    box-shadow: inset 0 0 0 1px var(--color-border-strong);
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.pagination-page:hover {
    background-color: var(--color-surface-3);
}
.pagination-page--active {
    background-color: var(--color-primary);
}
.pagination-page--active:hover {
    background-color: var(--color-primary-hover);
}
</style>
