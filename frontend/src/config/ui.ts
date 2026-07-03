// UI tunables. Values come from env (see docs/env-reference.md).
// FALLBACK below is dev/test only, when runtime config is absent.

export interface AlertTimerThresholds {
    amberMins: number;
    dangerMins: number;
}

export interface UiConfig {
    nowTickerMs: number;
    listSkeletonCount: number;
    urlSyncDebounceMs: number;
    duplicateCheckDebounceMs: number;
    templatePreviewDebounceMs: number;
    // "✓ Saved" flash shown on edit modals before they dismiss.
    optimisticFlashMs: number;
    // After an optimistic device-status patch is applied, if no real status
    // echo arrives within this window, fire a Shelly.GetStatus to reconcile.
    optimisticReconcileTimeoutMs: number;
    // Upper bound on optimistic overlay lifetime — expires regardless of echo.
    optimisticReaperMs: number;
    firingsPageSize: number;
    groupActivityPageSize: number;
    alertTimer: {
        critical: AlertTimerThresholds;
        warning: AlertTimerThresholds;
        info: AlertTimerThresholds;
    };
    silence: {
        presetMinutes: number[];
        tomorrowHour: number;
    };
    search: {
        threshold: number;
        ignoreLocation: boolean;
    };
    toast: {
        defaultMs: number;
        actionMs: number;
        maxStack: number;
    };
    // id → DSL string. Empty = disabled.
    shortcuts: Record<string, string>;
}

const FALLBACK: UiConfig = {
    nowTickerMs: 30_000,
    listSkeletonCount: 4,
    urlSyncDebounceMs: 300,
    duplicateCheckDebounceMs: 400,
    templatePreviewDebounceMs: 300,
    optimisticFlashMs: 220,
    optimisticReconcileTimeoutMs: 3_000,
    optimisticReaperMs: 60_000,
    firingsPageSize: 100,
    groupActivityPageSize: 200,
    alertTimer: {
        critical: {amberMins: 5, dangerMins: 15},
        warning: {amberMins: 30, dangerMins: 120},
        info: {amberMins: 120, dangerMins: 480}
    },
    silence: {
        presetMinutes: [15, 60, 240, 480, 1440],
        tomorrowHour: 9
    },
    search: {
        threshold: 0.4,
        ignoreLocation: true
    },
    toast: {
        defaultMs: 5_000,
        actionMs: 8_000,
        maxStack: 5
    },
    shortcuts: {
        'shortcuts.help': '?',
        'inspector.close': 'escape',
        'search.focus': 'mod+k',
        'dashboard.undo': 'mod+z',
        'dashboard.redo': 'mod+shift+z',
        'logs.focus': 'mod+k',
        'logs.clear': 'mod+l',
        'logs.clear-search': 'escape'
    }
};

function pickNum(runtime: number | undefined, fallback: number): number {
    return typeof runtime === 'number' && Number.isFinite(runtime)
        ? runtime
        : fallback;
}

function pickArr(runtime: number[] | undefined, fallback: number[]): number[] {
    return Array.isArray(runtime) && runtime.length > 0 ? runtime : fallback;
}

function pickThresholds(
    rt: {amberMins?: number; dangerMins?: number} | undefined,
    fb: AlertTimerThresholds
): AlertTimerThresholds {
    return {
        amberMins: pickNum(rt?.amberMins, fb.amberMins),
        dangerMins: pickNum(rt?.dangerMins, fb.dangerMins)
    };
}

function pickShortcuts(
    rt: Record<string, unknown> | undefined,
    fb: Record<string, string>
): Record<string, string> {
    const out: Record<string, string> = {...fb};
    if (!rt) return out;
    for (const [id, value] of Object.entries(rt)) {
        if (typeof value === 'string') out[id] = value;
    }
    return out;
}

function build(): UiConfig {
    const rt =
        (typeof window !== 'undefined' && window.__FM_RUNTIME_CONFIG__?.ui) ||
        {};
    return {
        nowTickerMs: pickNum(rt.nowTickerMs, FALLBACK.nowTickerMs),
        listSkeletonCount: pickNum(
            rt.listSkeletonCount,
            FALLBACK.listSkeletonCount
        ),
        urlSyncDebounceMs: pickNum(
            rt.urlSyncDebounceMs,
            FALLBACK.urlSyncDebounceMs
        ),
        duplicateCheckDebounceMs: pickNum(
            rt.duplicateCheckDebounceMs,
            FALLBACK.duplicateCheckDebounceMs
        ),
        templatePreviewDebounceMs: pickNum(
            rt.templatePreviewDebounceMs,
            FALLBACK.templatePreviewDebounceMs
        ),
        optimisticFlashMs: pickNum(
            rt.optimisticFlashMs,
            FALLBACK.optimisticFlashMs
        ),
        optimisticReconcileTimeoutMs: pickNum(
            rt.optimisticReconcileTimeoutMs,
            FALLBACK.optimisticReconcileTimeoutMs
        ),
        optimisticReaperMs: pickNum(
            rt.optimisticReaperMs,
            FALLBACK.optimisticReaperMs
        ),
        firingsPageSize: pickNum(rt.firingsPageSize, FALLBACK.firingsPageSize),
        groupActivityPageSize: pickNum(
            rt.groupActivityPageSize,
            FALLBACK.groupActivityPageSize
        ),
        alertTimer: {
            critical: pickThresholds(
                rt.alertTimer?.critical,
                FALLBACK.alertTimer.critical
            ),
            warning: pickThresholds(
                rt.alertTimer?.warning,
                FALLBACK.alertTimer.warning
            ),
            info: pickThresholds(rt.alertTimer?.info, FALLBACK.alertTimer.info)
        },
        silence: {
            presetMinutes: pickArr(
                rt.silence?.presetMinutes,
                FALLBACK.silence.presetMinutes
            ),
            tomorrowHour: pickNum(
                rt.silence?.tomorrowHour,
                FALLBACK.silence.tomorrowHour
            )
        },
        search: {
            threshold: pickNum(rt.search?.threshold, FALLBACK.search.threshold),
            ignoreLocation:
                typeof rt.search?.ignoreLocation === 'boolean'
                    ? rt.search.ignoreLocation
                    : FALLBACK.search.ignoreLocation
        },
        toast: {
            defaultMs: pickNum(rt.toast?.defaultMs, FALLBACK.toast.defaultMs),
            actionMs: pickNum(rt.toast?.actionMs, FALLBACK.toast.actionMs),
            maxStack: pickNum(rt.toast?.maxStack, FALLBACK.toast.maxStack)
        },
        shortcuts: pickShortcuts(rt.shortcuts, FALLBACK.shortcuts)
    };
}

export const UI_CONFIG: UiConfig = build();
