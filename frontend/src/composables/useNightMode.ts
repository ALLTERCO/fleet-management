/** Shared night-mode helper used by Light + Bulb. Both wrap the same
 *  `settings.night_mode` shape ({ enable, brightness, ct?, white?, mode?,
 *  active_between: [start, end] }). The active-between time picker delegates
 *  to setNightTime(), which preserves the other index when updating one. */

import {computed} from 'vue';

const DEFAULT_RANGE: readonly [string, string] = ['22:00', '06:00'];

export function useNightMode(
    settings: () => Record<string, any> | undefined,
    setConfig: (config: Record<string, any>) => Promise<void> | void
) {
    const nightMode = computed(() => settings()?.night_mode ?? null);

    function setNightTime(index: number, value: string): void {
        const current = nightMode.value?.active_between ?? DEFAULT_RANGE;
        const updated = [...current];
        updated[index] = value;
        void setConfig({night_mode: {active_between: updated}});
    }

    return {nightMode, setNightTime};
}
