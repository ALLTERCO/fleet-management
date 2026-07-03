// Shortcut registry. Bindings from env (FM_UI_SHORTCUT_*). See docs/env-reference.md.

import {computed, type Ref, ref} from 'vue';
import {UI_CONFIG} from '@/config/ui';

export interface ShortcutSpec {
    id: string;
    description: string;
    section: string;
    handler: (e: KeyboardEvent) => void;
    when?: () => boolean;
    allowInInput?: boolean;
}

interface RegisteredShortcut extends ShortcutSpec {
    binding: string;
    display: string;
    match: (e: KeyboardEvent) => boolean;
}

const registry: Ref<RegisteredShortcut[]> = ref([]);

const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_GLYPH = isMac ? '⌘' : 'Ctrl';
const ALT_GLYPH = isMac ? '⌥' : 'Alt';
const SHIFT_GLYPH = '⇧';

// Shift is implicit for these keys — DSL doesn't need `shift+` for them.
const SYMBOL_KEYS = new Set(['?', '!', '@', '#', '$', '%', '^', '&', '*']);

function parseBinding(binding: string): {
    match: (e: KeyboardEvent) => boolean;
    display: string;
} | null {
    const trimmed = binding.trim();
    if (!trimmed) return null;
    const parts = trimmed
        .toLowerCase()
        .split('+')
        .map((s) => s.trim())
        .filter(Boolean);
    if (parts.length === 0) return null;
    const rawKey = parts[parts.length - 1];
    const mods = new Set(parts.slice(0, -1));
    const key = rawKey === 'esc' ? 'escape' : rawKey;
    const needsMod = mods.has('mod');
    const needsShift = mods.has('shift');
    const needsAlt = mods.has('alt');
    const symbol = SYMBOL_KEYS.has(key);

    const match = (e: KeyboardEvent): boolean => {
        if (e.key.toLowerCase() !== key) return false;
        if ((e.metaKey || e.ctrlKey) !== needsMod) return false;
        if (e.altKey !== needsAlt) return false;
        if (!symbol && e.shiftKey !== needsShift) return false;
        return true;
    };

    const displayParts: string[] = [];
    if (needsMod) displayParts.push(MOD_GLYPH);
    if (needsAlt) displayParts.push(ALT_GLYPH);
    if (needsShift) displayParts.push(SHIFT_GLYPH);
    displayParts.push(
        key === 'escape' ? 'Esc' : key.length === 1 ? key.toUpperCase() : key
    );
    return {match, display: displayParts.join('+')};
}

export function registerShortcut(spec: ShortcutSpec): () => void {
    const binding = UI_CONFIG.shortcuts[spec.id] ?? '';
    const parsed = parseBinding(binding);
    // No binding (empty/invalid env) → skip; modal hides the row too.
    if (!parsed) return () => {};
    const entry: RegisteredShortcut = {
        ...spec,
        binding,
        match: parsed.match,
        display: parsed.display
    };
    // LIFO: page-level beats global; unmount restores the global binding.
    registry.value = [entry, ...registry.value.filter((x) => x.id !== spec.id)];
    return () => {
        registry.value = registry.value.filter((x) => x.id !== spec.id);
    };
}

export function useShortcuts() {
    return computed(() =>
        registry.value.map((s) => ({
            id: s.id,
            description: s.description,
            section: s.section,
            display: s.display
        }))
    );
}

function isInputFocused(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
    );
}

export function dispatchShortcut(e: KeyboardEvent) {
    const inInput = isInputFocused(e);
    for (const s of registry.value) {
        if (s.when && !s.when()) continue;
        if (inInput && !s.allowInInput) continue;
        if (!s.match(e)) continue;
        s.handler(e);
        return;
    }
}
