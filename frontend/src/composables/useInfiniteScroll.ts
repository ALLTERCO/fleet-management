import {computed, onMounted, type Ref, ref, watch} from 'vue';

export default function useInfiniteScroll<T>(source: Ref<T[]>, pageSize = 75) {
    const items: Ref<T[]> = ref([]);
    const page = ref(1);
    const loading = ref(false);

    const totalPages = computed(() =>
        Math.max(1, Math.ceil(source.value.length / pageSize))
    );

    watch(
        source,
        (newArr) => {
            const keep = Math.max(pageSize, items.value.length);
            const end = Math.min(newArr.length, keep);
            items.value = newArr.slice(0, end);
            page.value = Math.max(1, Math.ceil(items.value.length / pageSize));
        },
        {flush: 'post', immediate: true}
    );

    function loadItems() {
        if (loading.value) return;
        const start = items.value.length;
        const end = Math.min(source.value.length, start + pageSize);
        if (end <= start) return;
        loading.value = true;
        items.value.push(...source.value.slice(start, end));
        page.value = Math.ceil(items.value.length / pageSize);
        loading.value = false;
    }

    onMounted(() => {
        if (items.value.length === 0) loadItems();
    });

    return {items, page, totalPages, loading, loadItems};
}
