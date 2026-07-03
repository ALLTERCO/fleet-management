import {onBeforeUnmount, onMounted, type Ref, ref} from 'vue';

// SSR-safe — returns false until mounted, then mirrors the matchMedia state.
export function useMediaQuery(query: string): Ref<boolean> {
    const matches = ref(false);
    let mql: MediaQueryList | null = null;
    const handler = (event: MediaQueryListEvent): void => {
        matches.value = event.matches;
    };

    onMounted(() => {
        mql = window.matchMedia(query);
        matches.value = mql.matches;
        mql.addEventListener('change', handler);
    });
    onBeforeUnmount(() => {
        mql?.removeEventListener('change', handler);
    });

    return matches;
}
