import {inject, onUnmounted, type Ref, type InjectionKey, watch} from 'vue';

export interface SettingsDirtyTracker {
    setDirty(sectionId: string, sourceId: string, dirty: boolean): void;
}

export const settingsDirtyTrackerKey: InjectionKey<SettingsDirtyTracker> =
    Symbol('settings-dirty-tracker');

export function useSettingsDirtySource(
    sectionId: string,
    sourceId: string,
    dirty: Ref<boolean>
): void {
    const tracker = inject(settingsDirtyTrackerKey, null);
    if (!tracker) return;

    watch(
        dirty,
        (value) => tracker.setDirty(sectionId, sourceId, value),
        {immediate: true}
    );
    onUnmounted(() => tracker.setDirty(sectionId, sourceId, false));
}
