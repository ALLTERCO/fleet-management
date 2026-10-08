// Builds the bundled IR starter catalog (static/ir-catalog/) from the
// Flipper-IRDB repository. Standalone tool — run on demand, never part of
// `npm run generate`:
//
//   npx tsx scripts/build-ir-catalog.ts [--repo <path>] [--commit <sha>]
//
// Licensing gate (the reason this script exists): Flipper-IRDB is
// CC0-1.0, but its README states "Commits prior to 2319685 are not
// covered." Only files whose ENTIRE git history (rename-following) begins
// at or after that commit are clearly CC0 — everything else is excluded.
// The emitted catalog.json carries per-remote provenance and ships with
// the upstream LICENSE text copied alongside.

import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseFlipperIr} from '../src/modules/irLibrary/flipperIr';
import {IrImportParseError} from '../src/modules/irLibrary/types';
import {IR_LIBRARY_IMPORT_MAX_ENTRIES} from '../src/types/api/irlibrary';

const SOURCE_REPO = 'https://github.com/logickworkshop/Flipper-IRDB';
const SOURCE_LICENSE = 'CC0-1.0';
// The commit that added the CC0-1.0 LICENSE ("feat: add LICENSE and add
// license note to README (#960)"). The README pins coverage to it.
const CUTOFF_COMMIT = '2319685f2cbf0cd3f809609622cade14d24fb819';
const LICENSE_NOTE =
    'Flipper-IRDB README: "By submitting you agree to license your work ' +
    'under the CC0-1.0 license. Commits prior to 2319685 are not ' +
    'covered." Only files whose entire git history begins at or after ' +
    `commit ${CUTOFF_COMMIT} are included.`;

// Curated categories → product-facing device types.
const CATEGORY_DEVICE_TYPES: Record<string, string> = {
    TVs: 'TV',
    ACs: 'AC',
    Projectors: 'Projector',
    Audio_and_Video_Receivers: 'Audio receiver',
    SoundBars: 'Soundbar',
    Speakers: 'Speaker'
};

// Size caps keep the committed pack at a few hundred KB.
const MAX_FILE_BYTES = 16 * 1024;
const MAX_TOTAL_CONTENT_BYTES = 320 * 1024;

const OUT_DIR = path.resolve(__dirname, '../static/ir-catalog');
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

interface CatalogRemote {
    id: string;
    name: string;
    brand: string;
    deviceType: string;
    codeCount: number;
    protocols: string[];
    sourceRepo: string;
    sourcePath: string;
    license: string;
    content: string;
}

function git(repoDir: string, args: string[]): string {
    const result = spawnSync('git', ['-C', repoDir, ...args], {
        encoding: 'utf8',
        maxBuffer: GIT_MAX_BUFFER
    });
    if (result.status !== 0) {
        throw new Error(
            `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`
        );
    }
    return result.stdout;
}

function parseArgs(argv: string[]): {repo?: string; commit?: string} {
    const out: {repo?: string; commit?: string} = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--repo') out.repo = argv[++i];
        else if (argv[i] === '--commit') out.commit = argv[++i];
        else throw new Error(`unknown argument "${argv[i]}"`);
    }
    return out;
}

// Blobless clone: full history metadata, blobs fetched lazily by git show.
function cloneRepo(): {dir: string; cleanup: () => void} {
    const dir = mkdtempSync(path.join(tmpdir(), 'flipper-irdb-'));
    console.log(`Cloning ${SOURCE_REPO} (blobless) into ${dir} ...`);
    const result = spawnSync(
        'git',
        ['clone', '--filter=blob:none', '--no-checkout', SOURCE_REPO, dir],
        {encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER}
    );
    if (result.status !== 0) {
        rmSync(dir, {recursive: true, force: true});
        throw new Error(`clone failed: ${result.stderr}`);
    }
    return {dir, cleanup: () => rmSync(dir, {recursive: true, force: true})};
}

/** Paths touched by any commit prior to the cutoff — never clearly CC0. */
function preCutoffPaths(repoDir: string): Set<string> {
    const out = git(repoDir, [
        'log',
        '--pretty=format:',
        '--name-only',
        `${CUTOFF_COMMIT}^`
    ]);
    return new Set(out.split('\n').filter((line) => line !== ''));
}

/** True when the file's rename-following history starts after the cutoff. */
function historyStartsAfterCutoff(repoDir: string, file: string): boolean {
    const first = git(repoDir, [
        'log',
        '--follow',
        '--reverse',
        '--pretty=%H',
        '--',
        file
    ])
        .split('\n')
        .find((line) => line !== '');
    if (!first) throw new Error(`no history for ${file}`);
    const check = spawnSync(
        'git',
        [
            '-C',
            repoDir,
            'merge-base',
            '--is-ancestor',
            first,
            `${CUTOFF_COMMIT}^`
        ],
        {encoding: 'utf8'}
    );
    // Exit 0 = first commit is prior to the cutoff → not covered.
    return check.status !== 0;
}

function candidateFiles(repoDir: string, commit: string): string[] {
    const all = git(repoDir, ['ls-tree', '-r', '--name-only', commit])
        .split('\n')
        .filter((f) => f.endsWith('.ir'));
    const categories = new Set(Object.keys(CATEGORY_DEVICE_TYPES));
    return all.filter((f) => categories.has(f.split('/')[0])).sort();
}

function slugify(sourcePath: string): string {
    return sourcePath
        .replace(/\.ir$/i, '')
        .toLowerCase()
        .split('/')
        .map((seg) => seg.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
        .join('/');
}

function prettyName(sourcePath: string): string {
    return path
        .basename(sourcePath, '.ir')
        .replace(/[_.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildRemote(
    sourcePath: string,
    content: string
): {remote?: CatalogRemote; skip?: string} {
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
        return {skip: `exceeds per-file cap of ${MAX_FILE_BYTES} bytes`};
    }
    const [category, brandDir] = sourcePath.split('/');
    let parsed: ReturnType<typeof parseFlipperIr>;
    try {
        parsed = parseFlipperIr(content);
    } catch (err: unknown) {
        // Upstream file is not the format its extension claims — exclude.
        if (err instanceof IrImportParseError) return {skip: err.message};
        throw err;
    }
    if (parsed.codes.length === 0) return {skip: 'no parseable codes'};
    if (parsed.codes.length > IR_LIBRARY_IMPORT_MAX_ENTRIES) {
        return {skip: `exceeds import cap of ${IR_LIBRARY_IMPORT_MAX_ENTRIES}`};
    }
    const overlong = parsed.codes.find((c) => c.name.length > 128);
    if (overlong) return {skip: `code name over 128 chars: ${overlong.name}`};
    const protocols = [
        ...new Set(parsed.codes.map((c) => c.protocol ?? 'raw'))
    ].sort();
    return {
        remote: {
            id: slugify(sourcePath),
            name: prettyName(sourcePath),
            brand: brandDir.replace(/_/g, ' '),
            deviceType: CATEGORY_DEVICE_TYPES[category],
            codeCount: parsed.codes.length,
            protocols,
            sourceRepo: SOURCE_REPO,
            sourcePath,
            license: SOURCE_LICENSE,
            content
        }
    };
}

function assertUniqueIds(remotes: CatalogRemote[]): void {
    const seen = new Set<string>();
    for (const remote of remotes) {
        if (seen.has(remote.id)) {
            throw new Error(`duplicate catalog id "${remote.id}"`);
        }
        seen.add(remote.id);
    }
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const cloned = args.repo ? null : cloneRepo();
    const repoDir = args.repo ?? (cloned as {dir: string}).dir;

    try {
        // The cutoff must be a real ancestor of the pinned commit,
        // otherwise the coverage rule cannot be evaluated.
        git(repoDir, ['rev-parse', '--verify', `${CUTOFF_COMMIT}^{commit}`]);
        const commit = git(repoDir, [
            'rev-parse',
            args.commit ?? 'HEAD'
        ]).trim();
        git(repoDir, ['merge-base', '--is-ancestor', CUTOFF_COMMIT, commit]);

        const tainted = preCutoffPaths(repoDir);
        const remotes: CatalogRemote[] = [];
        let totalContentBytes = 0;

        for (const file of candidateFiles(repoDir, commit)) {
            if (tainted.has(file)) continue;
            if (!historyStartsAfterCutoff(repoDir, file)) {
                console.log(`skip (pre-cutoff content): ${file}`);
                continue;
            }
            const content = git(repoDir, ['show', `${commit}:${file}`]);
            const {remote, skip} = buildRemote(file, content);
            if (!remote) {
                console.log(`skip (${skip}): ${file}`);
                continue;
            }
            const bytes = Buffer.byteLength(content, 'utf8');
            if (totalContentBytes + bytes > MAX_TOTAL_CONTENT_BYTES) {
                console.log(`skip (total budget reached): ${file}`);
                continue;
            }
            totalContentBytes += bytes;
            remotes.push(remote);
        }

        if (remotes.length === 0) throw new Error('no eligible remotes found');
        assertUniqueIds(remotes);

        const catalog = {
            $comment:
                'Generated by backend/scripts/build-ir-catalog.ts — do not hand-edit.',
            source: {
                repo: SOURCE_REPO,
                commit,
                license: SOURCE_LICENSE,
                licenseNote: LICENSE_NOTE
            },
            remotes
        };
        const licenseText = git(repoDir, ['show', `${commit}:LICENSE`]);

        mkdirSync(OUT_DIR, {recursive: true});
        writeFileSync(
            path.join(OUT_DIR, 'catalog.json'),
            `${JSON.stringify(catalog, null, 4)}\n`
        );
        writeFileSync(path.join(OUT_DIR, 'LICENSE'), licenseText);
        console.log(
            `Wrote ${remotes.length} remotes (${totalContentBytes} content ` +
                `bytes) from ${commit.slice(0, 9)} to ${OUT_DIR}`
        );
    } finally {
        cloned?.cleanup();
    }
}

main();
