<template>
    <div class="flex min-h-0 flex-1 flex-col">
        <RouterView v-slot="{ Component }">
            <Transition name="tab-fade">
                <component :is="Component" :key="$route.path" />
            </Transition>
        </RouterView>
    </div>
</template>

<script setup lang="ts">
// Router shell for /devices/*. Device-adjacent tools live elsewhere as
// their own top-level pages.
</script>
