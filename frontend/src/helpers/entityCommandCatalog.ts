// Single source of truth for rollbackable entity command predictions.
// Device store owns overlay timers and backend reconciliation.
//
// Prediction contract: each entry predicts ONLY the status fields the action
// directly sets. Don't predict derived state — output from brightness, rgb
// from color, media_type from favourite. Real firmware ramps emit intermediate
// values that won't echoConfirm against derived predictions, so the overlay
// sticks for the full reconcile window and the UI flicks. echoConfirms only
// needs the directly-set fields to match.

export type CommandFeedbackMode = 'instant' | 'pending';

export type PredictedStatusPatchFn = (
    params: Record<string, any> | undefined,
    currentStatus: any
) => Record<string, any> | null;

interface EntityCommandPlan {
    feedbackMode: CommandFeedbackMode;
    predictedStatusPatch: PredictedStatusPatchFn;
}

function instant(
    predictedStatusPatch: PredictedStatusPatchFn
): EntityCommandPlan {
    return {feedbackMode: 'instant', predictedStatusPatch};
}

function pending(
    predictedStatusPatch: PredictedStatusPatchFn
): EntityCommandPlan {
    return {feedbackMode: 'pending', predictedStatusPatch};
}

function bulbCommands(profile: string): Record<string, EntityCommandPlan> {
    return {
        [`${profile}.toggle`]: instant((_, s) => ({output: !s?.output})),
        [`${profile}.setOutput`]: instant((p) => ({output: !!p?.on})),
        [`${profile}.setBrightness`]: instant((p) => ({
            brightness: p?.brightness
        })),
        [`${profile}.setColor`]: instant((p) => ({rgb: p?.rgb})),
        [`${profile}.setWhite`]: instant((p) => ({white: p?.white})),
        [`${profile}.setColorTemperature`]: instant((p) => ({ct: p?.ct})),
        [`${profile}.setMode`]: instant((p) => ({mode: p?.mode}))
    };
}

const COMMANDS: Record<string, EntityCommandPlan> = {
    'switch.toggle': instant((_, s) => ({output: !s?.output})),
    'switch.toggleAfter': instant((_, s) => ({output: !s?.output})),

    'light.toggle': instant((_, s) => ({output: !s?.output})),
    'light.setOutput': instant((p) => ({output: !!p?.on})),
    'light.setBrightness': instant((p) => ({brightness: p?.brightness})),
    'light.setColorTemperature': instant((p) => ({ct: p?.ct})),
    'light.toggleAfter': instant((_, s) => ({output: !s?.output})),
    'light.setDaliGroup': pending(() => null),

    ...bulbCommands('cct'),
    ...bulbCommands('rgb'),
    ...bulbCommands('rgbw'),
    ...bulbCommands('rgbcct'),

    'cover.open': pending(() => ({state: 'opening'})),
    'cover.close': pending(() => ({state: 'closing'})),
    'cover.stop': pending(() => ({state: 'stopped'})),
    'cover.setPosition': pending((p, s) => coverPositionPatch(p, s)),
    'cover.setTilt': pending((p) => ({slat_pos: p?.slat_pos})),

    'thermostat.setEnabled': instant((p) => ({enable: !!p?.enabled})),
    'thermostat.setTarget': instant((p) => ({target_C: p?.target_C})),
    'blutrv.setEnabled': instant((p) => ({enable: !!p?.enabled})),
    'blutrv.setTarget': instant((p) => ({target_C: p?.target_C})),
    'blutrv.startBoost': pending(() => null),
    'blutrv.clearBoost': pending(() => null),

    'boolean.setValue': instant((p) => ({value: p?.value})),
    'number.setValue': instant((p) => ({value: p?.value})),
    'text.setValue': instant((p) => ({value: p?.value})),
    'enum.setValue': instant((p) => ({value: p?.value})),
    'service.setVariable': instant((p) => ({value: p?.value})),
    'service.trigger': pending(() => null),

    'matter.setEnabled': instant((p) => ({enable: !!p?.enabled})),

    'camera.setArmed': instant((p) => ({armed: !!p?.armed})),
    'camera.setPrivacy': instant((p) => ({privacy: !!p?.privacy})),

    'media.playPause': instant((_, s) => ({
        playback: {enable: !s?.playback?.enable}
    })),
    'media.playFavourite': instant(() => ({playback: {enable: true}})),
    'media.playNextFavourite': instant(() => ({playback: {enable: true}})),
    'media.playPreviousFavourite': instant(() => ({playback: {enable: true}})),
    'media.radioStop': instant(() => ({playback: {enable: false}})),
    'media.pause': instant(() => ({playback: {enable: false}})),
    'media.setVolume': instant((p) => ({playback: {volume: p?.volume}})),

    'cury.setSlot': instant((p) => curySlotPatch(p)),
    'cury.setIntensity': instant((p) => curyIntensityPatch(p)),
    'cury.setBoost': instant((p) => curyBoostPatch(p)),
    'cury.setAwayMode': instant((p) => ({away_mode: !!p?.on})),
    'cury.setCuryMode': instant((p) => ({mode: p?.mode ?? null})),

    'ui.setScreen': pending(() => null),
    'ui.swipe': pending(() => null),
    'ui.tap': pending(() => null),

    'ledstrip.setLedStripField': pending(() => null),
    'ledstrip.nextLedStripEffect': pending(() => null)
};

function coverPositionPatch(
    params: Record<string, any> | undefined,
    currentStatus: any
): Record<string, any> | null {
    const target = params?.pos;
    if (typeof target !== 'number') return null;
    const current = currentStatus?.current_pos;
    if (typeof current === 'number' && target === current) return null;
    return {
        target_pos: target,
        state:
            typeof current === 'number' && target < current
                ? 'closing'
                : 'opening'
    };
}

function curySlotPatch(
    params: Record<string, any> | undefined
): Record<string, any> | null {
    const slot = params?.slot;
    if (typeof slot !== 'string') return null;
    return {slots: {[slot]: {on: !!params?.on}}};
}

function curyIntensityPatch(
    params: Record<string, any> | undefined
): Record<string, any> | null {
    const slot = params?.slot;
    const intensity = params?.intensity;
    if (typeof slot !== 'string' || typeof intensity !== 'number') return null;
    return {slots: {[slot]: {intensity}}};
}

function curyBoostPatch(
    params: Record<string, any> | undefined
): Record<string, any> | null {
    const slot = params?.slot;
    const on = params?.on;
    if (typeof slot !== 'string' || typeof on !== 'boolean') return null;
    return {slots: {[slot]: {boost: on}}};
}

export function predictedStatusPatchFor(
    entityType: string,
    action: string,
    params: Record<string, any> | undefined,
    currentStatus: any
): Record<string, any> | null {
    return (
        entityCommandPlanFor(entityType, action)?.predictedStatusPatch(
            params,
            currentStatus
        ) ?? null
    );
}

export function entityCommandFeedbackMode(
    entityType: string,
    action: string
): CommandFeedbackMode | null {
    return entityCommandPlanFor(entityType, action)?.feedbackMode ?? null;
}

function entityCommandPlanFor(
    entityType: string,
    action: string
): EntityCommandPlan | undefined {
    return COMMANDS[`${entityType}.${action}`];
}
