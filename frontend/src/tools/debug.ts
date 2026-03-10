/**
 * Debug logger — off by default, toggle via browser console:
 *   localStorage.setItem('fm_debug', '1')   // enable
 *   localStorage.removeItem('fm_debug')      // disable
 *
 * Also enabled automatically when running in Vite dev mode
 * or when FM_DEBUG_DEFAULT=true is set in the deploy env.
 */

const rtCfg = (window as any).__FM_RUNTIME_CONFIG__;
let enabled =
    localStorage.getItem('fm_debug') === '1' ||
    (import.meta as any).env?.DEV ||
    rtCfg?.debugDefault === true;

export function isDebugEnabled() {
    return enabled;
}

export function setDebug(value: boolean) {
    enabled = value;
    if (value) {
        localStorage.setItem('fm_debug', '1');
    } else {
        localStorage.removeItem('fm_debug');
    }
}

export function debug(...args: any[]) {
    if (enabled) console.log(...args);
}

export function debugWarn(...args: any[]) {
    if (enabled) console.warn(...args);
}

// Expose toggle on window for easy access from browser console
(window as any).fmDebug = setDebug;
