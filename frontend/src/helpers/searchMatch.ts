/**
 * One matcher for every search box in the app. The algorithm lives in
 * `template-host/core/search-match` — the host SDK's own home for it, since
 * a custom UI's search box deserves the same typo-forgiving match a device
 * name gets one wrong digit wrong on. This file is a plain re-export so
 * every existing `@/helpers/searchMatch` import keeps working unchanged.
 */
export {
    matchSearch,
    rankSearchMatches,
    type SearchCandidate,
    type SearchHit,
    type SearchRange
} from '@/shell/template-host/core/search-match';
