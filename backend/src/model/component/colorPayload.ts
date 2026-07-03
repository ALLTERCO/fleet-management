// Strip the FM-side `shellyID` field before forwarding the validated params
// to the device — Shelly RPCs don't recognise it. Shared by RGB / RgbCct /
// Rgbw / CCT components so the elision logic has a single home.
export function stripShellyIdFromPayload<T extends {shellyID?: string}>(
    v: T & Record<string, unknown>
): Omit<T, 'shellyID'> {
    const {shellyID: _shellyID, ...rest} = v;
    return rest as Omit<T, 'shellyID'>;
}
