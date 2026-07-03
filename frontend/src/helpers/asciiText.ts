// Returns true when `s` contains any character outside the printable
// ASCII range. GeoNames `asciiname` is romanized, so non-ASCII queries
// never match the local trigram index.
export function hasNonLatin(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) > 127) return true;
    }
    return false;
}
