/** Shared "toggle in N seconds" quick-action state used by Switch, Light, Bulb.
 *  Caller passes a typed emit closure so each component keeps its own emit signature. */

import {ref} from 'vue';

export function useToggleAfter(emitToggleAfter: (seconds: number) => void) {
    const toggleAfterSec = ref<number | null>(null);

    function doToggleAfter() {
        const sec = toggleAfterSec.value;
        if (sec && sec > 0) {
            emitToggleAfter(sec);
            toggleAfterSec.value = null;
        }
    }

    return {toggleAfterSec, doToggleAfter};
}
