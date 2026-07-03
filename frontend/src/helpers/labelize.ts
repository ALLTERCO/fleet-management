// Convert a snake_case or kebab-case identifier into a human-readable label.
// "num_leds" → "Num Leds", "rgb" → "Rgb".
export function labelizeKey(key: string): string {
    return key.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
