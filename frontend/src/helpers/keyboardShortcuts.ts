/** Pure keyboard-shortcut dispatchers for the locations workspace.
 *
 *  Each helper translates a raw key + context into the next state the
 *  component should apply. Components stay thin event-routers; the
 *  state transitions live here where they can be tested without a DOM. */

import type {DetailTabKey} from '@/helpers/locationsUrlState';

/** Map the digit keys `1` … `4` to the right-pane tab keys.
 *  Returns null for any other input so the component can decide whether
 *  to ignore the event or surface it. */
export function tabFromDigit(digit: string): DetailTabKey | null {
    return DIGIT_TO_TAB[digit] ?? null;
}

const DIGIT_TO_TAB: Readonly<Record<string, DetailTabKey>> = {
    '1': 'overview',
    '2': 'plan',
    '3': 'devices',
    '4': 'settings'
};

/** Move tree-row selection one step in the given direction.
 *
 *  - `down` with no current selection picks the first row.
 *  - `up`   with no current selection picks the last row.
 *  - Selection wraps at the ends so keyboard users always get a result.
 *  - Returns null when the visible list is empty. */
export interface RowSelectionInput {
    readonly visibleIds: readonly number[];
    readonly currentId: number | null;
    readonly direction: 'up' | 'down';
}

export function nextRowSelection(input: RowSelectionInput): number | null {
    if (input.visibleIds.length === 0) return null;
    if (input.currentId == null) return entryRow(input);
    return adjacentRow(input);
}

function entryRow(input: RowSelectionInput): number {
    if (input.direction === 'down') return input.visibleIds[0];
    return input.visibleIds[input.visibleIds.length - 1];
}

function adjacentRow(input: RowSelectionInput): number {
    const index = input.visibleIds.indexOf(input.currentId as number);
    const step = input.direction === 'down' ? 1 : -1;
    return wrappedAt(input.visibleIds, index + step);
}

function wrappedAt(visibleIds: readonly number[], rawIndex: number): number {
    const length = visibleIds.length;
    const normalised = ((rawIndex % length) + length) % length;
    return visibleIds[normalised];
}

/** True when a keydown event should be ignored because the user is typing
 *  into an editable field. Prevents shortcuts from hijacking text input —
 *  pressing `/` inside the SMTP host field should type "/", not focus
 *  the search bar. */
export function isTypingInEditableElement(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** A single key binding for the central useKeyboardShortcuts composable.
 *  `key` matches `event.key` exactly. Pass an array to bind multiple keys
 *  to the same action (e.g. `['ArrowDown', 'j']`).
 *
 *  Modifiers are explicit — omit them to require "no modifier", set them
 *  to true to require the modifier. This makes ⌘1 distinct from plain 1. */
export interface ShortcutBinding {
    readonly key: string | readonly string[];
    readonly handler: (event: KeyboardEvent) => void;
    readonly ctrlOrMeta?: boolean;
    readonly shift?: boolean;
    readonly alt?: boolean;
    /** Skip the editable-target guard for this binding. Default false —
     *  shortcuts don't fire while the user is typing. */
    readonly allowInEditable?: boolean;
    /** Call `event.preventDefault()` when this binding matches. Default true. */
    readonly preventDefault?: boolean;
}

/** True when the keyboard event matches the binding's key and modifier
 *  shape. Pure — useful in tests; the composable calls it per event. */
export function matchesBinding(
    event: KeyboardEvent,
    binding: ShortcutBinding
): boolean {
    if (!matchesKey(event.key, binding.key)) return false;
    if (!matchesModifier(event.ctrlKey || event.metaKey, binding.ctrlOrMeta)) {
        return false;
    }
    if (!matchesModifier(event.shiftKey, binding.shift)) return false;
    if (!matchesModifier(event.altKey, binding.alt)) return false;
    return true;
}

function matchesKey(
    eventKey: string,
    bindingKey: string | readonly string[]
): boolean {
    if (Array.isArray(bindingKey)) return bindingKey.includes(eventKey);
    return bindingKey === eventKey;
}

function matchesModifier(
    actual: boolean,
    expected: boolean | undefined
): boolean {
    if (expected === undefined) return !actual;
    return actual === expected;
}
