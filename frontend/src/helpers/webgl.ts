// Probe whether a WebGL (or WebGL2) context can be created. Returns
// false on CI runners with disabled GPU, privacy-hardened browsers,
// and old devices. Callers that mount cobe / maplibre / pixi should
// skip init when this returns false rather than letting the library
// throw and bubble through Vue's error boundary.
export function hasWebGL(): boolean {
    if (typeof document === 'undefined') return false;
    try {
        const canvas = document.createElement('canvas');
        return Boolean(
            canvas.getContext('webgl2') || canvas.getContext('webgl')
        );
    } catch {
        return false;
    }
}
