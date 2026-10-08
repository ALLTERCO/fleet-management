// Decides whether a script module was started as the command, shared by every
// script that is both a CLI and an importable module. Node loads the main
// module from its real path while argv[1] keeps the path as typed, so both are
// compared after resolving symlinks (a symlinked folder or script file).
//
// Lives in frontend/scripts/lib because the public export and the frontend
// image stage carry frontend/; the backend image stage copies this one file.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * 'cli': argv[1] is this module. 'import': it is some other entry, or none.
 * 'unresolved': argv[1] names this module's file but cannot be resolved; the
 * caller asked for this command, so it must fail rather than skip its work.
 */
export function cliEntryState(entry, moduleUrl, realpath = fs.realpathSync) {
    if (!entry) return 'import';
    const self = realpath(fileURLToPath(moduleUrl));
    try {
        return realpath(path.resolve(entry)) === self ? 'cli' : 'import';
    } catch {
        return path.basename(entry) === path.basename(self)
            ? 'unresolved'
            : 'import';
    }
}

/** True when the module at moduleUrl was started as the command. */
export function isCliEntry(moduleUrl) {
    const state = cliEntryState(process.argv[1], moduleUrl);
    if (state === 'unresolved') {
        console.error(
            `Cannot resolve the script path ${process.argv[1]}; refusing to skip the command`
        );
        process.exit(1);
    }
    return state === 'cli';
}
