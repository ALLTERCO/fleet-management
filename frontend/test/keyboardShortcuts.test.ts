import {describe, expect, it} from 'vitest';
import {
    isTypingInEditableElement,
    matchesBinding,
    nextRowSelection,
    type ShortcutBinding,
    tabFromDigit
} from '@/helpers/keyboardShortcuts';

describe('tabFromDigit', () => {
    it('maps "1" to overview', () => {
        expect(tabFromDigit('1')).toBe('overview');
    });

    it('maps "2" to plan', () => {
        expect(tabFromDigit('2')).toBe('plan');
    });

    it('maps "3" to devices', () => {
        expect(tabFromDigit('3')).toBe('devices');
    });

    it('maps "4" to settings', () => {
        expect(tabFromDigit('4')).toBe('settings');
    });

    it('returns null for any digit outside 1-4', () => {
        expect(tabFromDigit('0')).toBeNull();
        expect(tabFromDigit('5')).toBeNull();
        expect(tabFromDigit('9')).toBeNull();
    });

    it('returns null for letters and other keys', () => {
        expect(tabFromDigit('e')).toBeNull();
        expect(tabFromDigit('ArrowDown')).toBeNull();
        expect(tabFromDigit('')).toBeNull();
    });
});

describe('nextRowSelection', () => {
    it('returns null when the visible list is empty', () => {
        const next = nextRowSelection({
            visibleIds: [],
            currentId: null,
            direction: 'down'
        });
        expect(next).toBeNull();
    });

    it('moves down by one when a row is currently selected', () => {
        const next = nextRowSelection({
            visibleIds: [1, 2, 3, 4],
            currentId: 2,
            direction: 'down'
        });
        expect(next).toBe(3);
    });

    it('moves up by one when a row is currently selected', () => {
        const next = nextRowSelection({
            visibleIds: [1, 2, 3, 4],
            currentId: 2,
            direction: 'up'
        });
        expect(next).toBe(1);
    });

    it('wraps from the last row down to the first', () => {
        const next = nextRowSelection({
            visibleIds: [1, 2, 3],
            currentId: 3,
            direction: 'down'
        });
        expect(next).toBe(1);
    });

    it('wraps from the first row up to the last', () => {
        const next = nextRowSelection({
            visibleIds: [1, 2, 3],
            currentId: 1,
            direction: 'up'
        });
        expect(next).toBe(3);
    });

    it('picks the first row when nothing is selected and direction is down', () => {
        const next = nextRowSelection({
            visibleIds: [10, 20, 30],
            currentId: null,
            direction: 'down'
        });
        expect(next).toBe(10);
    });

    it('picks the last row when nothing is selected and direction is up', () => {
        const next = nextRowSelection({
            visibleIds: [10, 20, 30],
            currentId: null,
            direction: 'up'
        });
        expect(next).toBe(30);
    });

    it('handles a single-row list (no movement possible)', () => {
        expect(
            nextRowSelection({
                visibleIds: [42],
                currentId: 42,
                direction: 'down'
            })
        ).toBe(42);
        expect(
            nextRowSelection({
                visibleIds: [42],
                currentId: 42,
                direction: 'up'
            })
        ).toBe(42);
    });
});

describe('isTypingInEditableElement', () => {
    it('returns false for null', () => {
        expect(isTypingInEditableElement(null)).toBe(false);
    });

    it('returns true for INPUT', () => {
        const input = document.createElement('input');
        expect(isTypingInEditableElement(input)).toBe(true);
    });

    it('returns true for TEXTAREA', () => {
        const textarea = document.createElement('textarea');
        expect(isTypingInEditableElement(textarea)).toBe(true);
    });

    it('returns true for SELECT', () => {
        const select = document.createElement('select');
        expect(isTypingInEditableElement(select)).toBe(true);
    });

    it('returns true for contentEditable elements', () => {
        const div = document.createElement('div');
        div.contentEditable = 'true';
        expect(isTypingInEditableElement(div)).toBe(true);
    });

    it('returns false for non-editable elements (DIV, BUTTON, A)', () => {
        for (const tag of ['div', 'button', 'a']) {
            const el = document.createElement(tag);
            expect(isTypingInEditableElement(el)).toBe(false);
        }
    });
});

function makeEvent(
    key: string,
    modifiers: Partial<{
        ctrl: boolean;
        meta: boolean;
        shift: boolean;
        alt: boolean;
    }> = {}
): KeyboardEvent {
    return new KeyboardEvent('keydown', {
        key,
        ctrlKey: modifiers.ctrl ?? false,
        metaKey: modifiers.meta ?? false,
        shiftKey: modifiers.shift ?? false,
        altKey: modifiers.alt ?? false
    });
}

const noop = (): void => undefined;

describe('matchesBinding', () => {
    it('matches a plain single-key binding', () => {
        const binding: ShortcutBinding = {key: '/', handler: noop};
        expect(matchesBinding(makeEvent('/'), binding)).toBe(true);
        expect(matchesBinding(makeEvent('?'), binding)).toBe(false);
    });

    it('matches any key in an array binding', () => {
        const binding: ShortcutBinding = {
            key: ['ArrowDown', 'j'],
            handler: noop
        };
        expect(matchesBinding(makeEvent('ArrowDown'), binding)).toBe(true);
        expect(matchesBinding(makeEvent('j'), binding)).toBe(true);
        expect(matchesBinding(makeEvent('k'), binding)).toBe(false);
    });

    it('rejects a plain-key binding when a modifier is held', () => {
        const binding: ShortcutBinding = {key: '1', handler: noop};
        expect(matchesBinding(makeEvent('1', {meta: true}), binding)).toBe(
            false
        );
        expect(matchesBinding(makeEvent('1', {ctrl: true}), binding)).toBe(
            false
        );
    });

    it('accepts a binding that requires ctrlOrMeta when meta is held', () => {
        const binding: ShortcutBinding = {
            key: '1',
            handler: noop,
            ctrlOrMeta: true
        };
        expect(matchesBinding(makeEvent('1', {meta: true}), binding)).toBe(
            true
        );
        expect(matchesBinding(makeEvent('1', {ctrl: true}), binding)).toBe(
            true
        );
    });

    it('rejects a ctrlOrMeta binding when no modifier is held', () => {
        const binding: ShortcutBinding = {
            key: '1',
            handler: noop,
            ctrlOrMeta: true
        };
        expect(matchesBinding(makeEvent('1'), binding)).toBe(false);
    });

    it('respects an explicit shift requirement', () => {
        const binding: ShortcutBinding = {
            key: '?',
            handler: noop,
            shift: true
        };
        expect(matchesBinding(makeEvent('?', {shift: true}), binding)).toBe(
            true
        );
        expect(matchesBinding(makeEvent('?'), binding)).toBe(false);
    });
});
