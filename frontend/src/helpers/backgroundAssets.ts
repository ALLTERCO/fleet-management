import {FLEET_MANAGER_HTTP} from '@/constants';
import {debugWarn} from '@/tools/debug';

const PROTECTED_BACKGROUND_PREFIX = '/uploads/backgrounds/';

export type BackgroundStyleState =
    | {kind: 'empty'}
    | {kind: 'color'; color: string}
    | {kind: 'image'; imageUrl: string};

export type BackgroundStyleTarget = {
    state: BackgroundStyleState;
    style: Pick<CSSStyleDeclaration, 'removeProperty' | 'setProperty'>;
};

export function isProtectedBackgroundPath(value: string): boolean {
    return value.includes(PROTECTED_BACKGROUND_PREFIX);
}

export function initialDisplayBackground(stored: string | null): string {
    const value = stored || '';
    return isProtectedBackgroundPath(value) ? '' : value;
}

export function backgroundImageUrl(value: string): string {
    const raw = value.startsWith('/') ? FLEET_MANAGER_HTTP + value : value;
    try {
        const url = new URL(raw, FLEET_MANAGER_HTTP);
        if (!['http:', 'https:'].includes(url.protocol)) return '';
        return url.toString();
    } catch (error) {
        debugWarn('invalid background image URL', {value, error});
        return '';
    }
}

export function backgroundStyleState(value: string): BackgroundStyleState {
    if (!value || value === 'undefined') return {kind: 'empty'};
    if (value.startsWith('#')) return {kind: 'color', color: value};
    const imageUrl = backgroundImageUrl(value);
    return imageUrl ? {kind: 'image', imageUrl} : {kind: 'empty'};
}

export function applyBackgroundStyle(target: BackgroundStyleTarget): void {
    const {state, style} = target;
    if (state.kind === 'empty') {
        clearBackgroundStyle(style);
        return;
    }
    if (state.kind === 'color') {
        applyBackgroundColor({state, style});
        return;
    }
    applyBackgroundImage({state, style});
}

function clearBackgroundStyle(
    style: Pick<CSSStyleDeclaration, 'removeProperty'>
): void {
    style.removeProperty('--background-color');
    style.removeProperty('--background-image');
}

function applyBackgroundColor(target: {
    state: Extract<BackgroundStyleState, {kind: 'color'}>;
    style: Pick<CSSStyleDeclaration, 'setProperty'>;
}): void {
    target.style.setProperty('--background-color', target.state.color);
    target.style.setProperty('--background-image', 'none');
}

function applyBackgroundImage(target: {
    state: Extract<BackgroundStyleState, {kind: 'image'}>;
    style: Pick<CSSStyleDeclaration, 'removeProperty' | 'setProperty'>;
}): void {
    target.style.setProperty(
        '--background-image',
        `url("${target.state.imageUrl}")`
    );
    target.style.removeProperty('--background-color');
}
