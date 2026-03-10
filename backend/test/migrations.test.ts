import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {describe, it} from 'node:test';

const MIGRATION_ROOT = path.join(__dirname, '../db/migration/postgresql');
const EXPECTED_DIRS = [
    'device',
    'logging',
    'notifications',
    'organization',
    'ui',
    'user'
];

describe('migration files', () => {
    it('migration root directory exists', () => {
        assert.ok(fs.existsSync(MIGRATION_ROOT), 'Migration root not found');
    });

    for (const dir of EXPECTED_DIRS) {
        it(`${dir}/ subdirectory exists`, () => {
            const dirPath = path.join(MIGRATION_ROOT, dir);
            assert.ok(fs.existsSync(dirPath), `Missing migration dir: ${dir}`);
            assert.ok(fs.statSync(dirPath).isDirectory());
        });

        it(`${dir}/ contains .sql files`, () => {
            const dirPath = path.join(MIGRATION_ROOT, dir);
            const files = fs
                .readdirSync(dirPath)
                .filter((f) => f.endsWith('.sql'));
            assert.ok(files.length > 0, `No .sql files in ${dir}/`);
        });

        it(`${dir}/ sql files have numbered prefixes`, () => {
            const dirPath = path.join(MIGRATION_ROOT, dir);
            const files = fs
                .readdirSync(dirPath)
                .filter((f) => f.endsWith('.sql'));
            for (const file of files) {
                assert.match(
                    file,
                    /^\d+/,
                    `${dir}/${file} should start with a number`
                );
            }
        });
    }

    it('no duplicate migration filenames across dirs', () => {
        const allFiles = new Map<string, string>();
        for (const dir of EXPECTED_DIRS) {
            const dirPath = path.join(MIGRATION_ROOT, dir);
            if (!fs.existsSync(dirPath)) continue;
            for (const file of fs
                .readdirSync(dirPath)
                .filter((f) => f.endsWith('.sql'))) {
                const key = `${dir}/${file}`;
                assert.ok(!allFiles.has(key), `Duplicate: ${key}`);
                allFiles.set(key, dir);
            }
        }
    });

    it('sql files are valid UTF-8 and non-empty', () => {
        for (const dir of EXPECTED_DIRS) {
            const dirPath = path.join(MIGRATION_ROOT, dir);
            if (!fs.existsSync(dirPath)) continue;
            for (const file of fs
                .readdirSync(dirPath)
                .filter((f) => f.endsWith('.sql'))) {
                const content = fs.readFileSync(
                    path.join(dirPath, file),
                    'utf8'
                );
                assert.ok(
                    content.trim().length > 0,
                    `Empty migration: ${dir}/${file}`
                );
            }
        }
    });
});
