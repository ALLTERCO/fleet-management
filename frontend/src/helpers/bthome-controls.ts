export type BTHomeControlKind = 'button' | 'dimmer';

export interface BTHomeControlButton {
    objId: number;
    idx: number;
    kind: BTHomeControlKind;
    label: string;
}

interface BTHomeEventSourceOptions {
    event?: string | null;
    idx?: number | null;
    controls?: BTHomeControlButton[];
    fallback?: string;
}

export function formatBTHomeEventName(value: string): string {
    return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatBTHomeChannelLabel(channel: number): string {
    if (!Number.isFinite(channel)) {
        return 'Channel';
    }

    return `Channel ${Math.trunc(channel) + 1}`;
}

export function getBTHomeEventSourceLabel({
    event,
    idx,
    controls,
    fallback = 'Last Event'
}: BTHomeEventSourceOptions): string {
    // Backend supplies `label` on every control entry. If we have a match,
    // use it verbatim — otherwise fall back to the raw event name (no
    // client-side invention of button/dimmer labels).
    if (typeof idx === 'number' && idx >= 0 && controls?.length) {
        const control = controls.find((c) => c.idx === idx);
        if (control?.label) return control.label;
    }
    if (typeof event === 'string' && event.trim()) {
        return formatBTHomeEventName(event);
    }
    return fallback;
}

export function formatBTHomeEventSummary(
    event: string,
    idx?: number | null,
    controls?: BTHomeControlButton[],
    channel?: number | null
): string {
    const formatted = formatBTHomeEventName(event);
    const label = getBTHomeEventSourceLabel({
        event,
        idx,
        controls
    });

    const summary =
        label === 'Last Event' ? formatted : `${label}: ${formatted}`;

    return typeof channel === 'number' && channel >= 0
        ? `${summary} · ${formatBTHomeChannelLabel(channel)}`
        : summary;
}

// objName comes from the backend-normalized entity — the authority for
// "is this a button/dimmer control object" lives in the device registry,
// not in the UI's per-device controls list.
export function isBTHomeControlSensor(objName?: string): boolean {
    return objName === 'button' || objName === 'dimmer';
}
