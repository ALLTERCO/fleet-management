import {type ComputedRef, computed, ref} from 'vue';

// Shared optimistic slider for the light cards. Follows the finger while
// dragging, the device when idle. Why: without it the value never moves
// mid-drag and snaps back when a status refresh lands.

export function useOptimisticSlider(
    deviceValue: ComputedRef<number>,
    commit: (value: number) => void
) {
    const dragging = ref<number | null>(null);
    const display = computed(() => dragging.value ?? deviceValue.value);

    function onInput(e: Event) {
        dragging.value = Number((e.target as HTMLInputElement).value);
    }

    function onChange(e: Event) {
        commit(Number((e.target as HTMLInputElement).value));
        dragging.value = null;
    }

    return {display, onInput, onChange};
}
