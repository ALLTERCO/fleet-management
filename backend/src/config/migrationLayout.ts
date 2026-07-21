// SoT for migration directory layout. Imported by runtime config and CI.
//
// The two lists live in migration-layout.json — not inline here — because the
// deploy shell generators (dev.sh / oidc.sh) cannot import TypeScript. They
// read the exact same file via jq, so the list has one home and cannot drift.
// The JSON sits under db/migration/ because that tree ships in every deploy
// (the migration runner reads it at boot), so it resolves from both src/ and
// the compiled dist/.

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

interface MigrationLayout {
    migrationDirs: readonly string[];
    linkedSchemas: readonly string[];
}

// dist/config/migrationLayout.js → ../../ → backend/, then db/migration/.
// __dirname is defined in the compiled CommonJS output and under tsx on older
// Node. Newer Node loads this file as an ES module (via tsx) where __dirname is
// undefined, so fall back to the backend root — every entry point (dev, tests,
// the Docker WORKDIR) runs with cwd there.
const LAYOUT_PATH =
    typeof __dirname !== 'undefined'
        ? resolve(__dirname, '../../db/migration/migration-layout.json')
        : resolve(process.cwd(), 'db/migration/migration-layout.json');

const layout = JSON.parse(readFileSync(LAYOUT_PATH, 'utf8')) as MigrationLayout;

export const MIGRATION_DIRS: readonly string[] = Object.freeze([
    ...layout.migrationDirs
]);

export const LINKED_SCHEMAS: readonly string[] = Object.freeze([
    ...layout.linkedSchemas
]);
