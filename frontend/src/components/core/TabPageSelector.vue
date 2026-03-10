<template>
    <div class="tab-page-selector overflow-hidden relative flex flex-col h-full">
        <div
            class="min-h-[2.75rem] w-full flex flex-nowrap gap-0 text-sm font-medium text-center whitespace-nowrap overflow-x-scroll no-scrollbar"
        >
            <template v-for="[name, path, icon] in tabs">
                <RouterLink
                    v-if="isActive(path)"
                    :key="'active' + name"
                    :to="path"
                    class="tab-page-tab tab-page-tab--active inline-block p-3 rounded-t-lg font-semibold select-none border-t border-x max-w-xs"
                    ><i v-if="icon" :class="icon" class="mr-1.5 text-2xs" aria-hidden="true" />{{ name }}
                </RouterLink>
                <RouterLink
                    v-else
                    :key="name"
                    :to="path"
                    class="tab-page-tab tab-page-tab--inactive inline-block p-3 rounded-t-lg select-none border-b hover:cursor-pointer"
                    ><i v-if="icon" :class="icon" class="mr-1.5 text-2xs" aria-hidden="true" />{{ name }}
                </RouterLink>
            </template>
            <div class="tab-page-border w-full border-b" />
        </div>
        <div class="mt-2 flex-grow overflow-auto">
            <RouterView v-slot="{ Component }">
                <Transition name="tab-fade">
                    <component :is="Component" :key="$route.path" />
                </Transition>
            </RouterView>
        </div>
    </div>
</template>

<script setup lang="ts">
import {RouterLink} from 'vue-router';
import {useRoute} from 'vue-router/auto';

const route = useRoute();

const props = defineProps<{
    tabs: [string, string, string?][]; // [name, path, icon?]
}>();

function isActive(tabPath: string): boolean {
    const current = route.path;
    if (current === tabPath) return true;
    if (!current.startsWith(tabPath + '/')) return false;
    // Only active if no other tab is a longer (more specific) match
    return !props.tabs.some(
        ([, p]) =>
            p !== tabPath &&
            p.length > tabPath.length &&
            (current === p || current.startsWith(p + '/'))
    );
}
</script>

<style scoped>
.tab-page-tab--active {
    border-color: var(--tab-active-border);
    color: var(--tab-active-text);
}
.tab-page-tab--inactive {
    border-color: var(--tab-active-border);
    color: var(--tab-inactive-text);
}
.tab-page-tab--inactive:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-secondary);
}
.tab-page-border {
    border-color: var(--tab-active-border);
}
</style>

<!-- Unscoped: transition classes target child component root elements which
     lack TabPageSelector's scoped data attribute. -->
<style>
.tab-fade-enter-active,
.tab-fade-leave-active {
    transition: opacity var(--duration-fast, 100ms) var(--ease-out, ease-out);
}
.tab-fade-enter-from,
.tab-fade-leave-to {
    opacity: 0;
}
/* Default mode (crossfade): both components exist simultaneously.
   Position the leaving one absolutely so it doesn't push layout. */
.tab-fade-leave-active {
    position: absolute;
    inset: 0;
}
</style>
