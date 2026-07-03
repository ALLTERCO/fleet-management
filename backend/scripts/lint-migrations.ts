// Static checks on migration SQL: signature-change without DROP, and
// cross-schema refs that sort before the referenced table/fn.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {ALERT_INSTANCE_STATE_SET} from '../src/modules/alert/states';

const MIGRATION_ROOT = path.resolve(
    __dirname,
    '..',
    'db',
    'migration',
    'postgresql'
);

interface FunctionSignature {
    qname: string;
    args: string[];
    returns: string;
    file: string;
    line: number;
}

export interface Finding {
    severity: 'error' | 'warn';
    file: string;
    line: number;
    message: string;
    fix: string;
}

interface CreateMatch {
    qname: string;
    args: string[];
    returns: string;
    line: number;
    offset: number;
}

interface DropMatch {
    qname: string;
    args: string[] | null;
    line: number;
    offset: number;
}

// --- SQL parsing ---------------------------------------------------------

function splitUpDown(sql: string): {up: string; down: string} {
    const marker = /^-{2,}\s*DOWN\s*$/im;
    const parts = sql.split(marker);
    if (parts.length === 1) return {up: sql, down: ''};
    const upRaw = parts[0].replace(/^-{2,}\s*UP\s*$/im, '');
    const downRaw = parts.slice(1).join('');
    return {up: upRaw, down: downRaw};
}

// Walk forward from after an opening `(` and return the content up to the
// matching `)` plus the index just past the `)`. Handles nested parens.
function readBalancedArgs(
    src: string,
    startAfterOpen: number
): {args: string; endIndex: number} | null {
    let depth = 1;
    let i = startAfterOpen;
    for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) {
                return {args: src.slice(startAfterOpen, i), endIndex: i + 1};
            }
        }
    }
    return null;
}

function normalizeArgs(raw: string): string[] {
    if (!raw.trim()) return [];
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of raw) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) parts.push(current);
    return parts.map((p) => {
        const sansDefault = p.split(/\bDEFAULT\b/i)[0].trim();
        const tokens = sansDefault.split(/\s+/);
        const typeTokens =
            tokens.length > 1 && /^[a-z_][a-z0-9_]*$/i.test(tokens[0])
                ? tokens.slice(1)
                : tokens;
        // Strip (n) / (p,s) modifiers — PG DROP FUNCTION matches by base
        // type, so `VARCHAR` == `VARCHAR(250)` and `DECIMAL` == `DECIMAL(10,4)`.
        return typeTokens
            .join(' ')
            .replace(/\([^)]*\)/g, '')
            .toUpperCase()
            .replace(/\s+/g, ' ')
            .trim();
    });
}

function normalizeReturns(bodyHead: string | undefined): string {
    if (!bodyHead) return '';
    const m = bodyHead.match(/\bRETURNS\b([\s\S]*)$/i);
    if (!m) return '';
    return m[1].trim().replace(/\s+/g, ' ').toUpperCase();
}

const FN_HEADER_RE =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(/gi;
const FN_TERM_RE = /\bAS\b|\bLANGUAGE\b/i;

function findCreates(block: string): CreateMatch[] {
    const out: CreateMatch[] = [];
    FN_HEADER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FN_HEADER_RE.exec(block))) {
        const argsStart = m.index + m[0].length;
        const args = readBalancedArgs(block, argsStart);
        if (!args) continue;
        const tail = block.slice(args.endIndex);
        const termMatch = tail.match(FN_TERM_RE);
        const bodyHead = termMatch
            ? tail.slice(0, termMatch.index)
            : tail.slice(0, 200);
        out.push({
            qname: m[1].toLowerCase(),
            args: normalizeArgs(args.args),
            returns: normalizeReturns(bodyHead),
            line: block.slice(0, m.index).split('\n').length,
            offset: m.index
        });
        FN_HEADER_RE.lastIndex = args.endIndex;
    }
    return out;
}

const DROP_HEADER_RE =
    /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*(\()?/gi;

function findDrops(block: string): DropMatch[] {
    const out: DropMatch[] = [];
    DROP_HEADER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DROP_HEADER_RE.exec(block))) {
        let args: string[] | null = null;
        if (m[2]) {
            const argsStart = m.index + m[0].length;
            const read = readBalancedArgs(block, argsStart);
            if (read) {
                args = normalizeArgs(read.args);
                DROP_HEADER_RE.lastIndex = read.endIndex;
            }
        }
        out.push({
            qname: m[1].toLowerCase(),
            args,
            line: block.slice(0, m.index).split('\n').length,
            offset: m.index
        });
    }
    return out;
}

// --- Linter --------------------------------------------------------------

function loadFiles(): Array<{relPath: string; content: string}> {
    const out: Array<{relPath: string; content: string}> = [];
    const schemaDirs = fs
        .readdirSync(MIGRATION_ROOT, {withFileTypes: true})
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    for (const schemaDir of schemaDirs) {
        const dirPath = path.join(MIGRATION_ROOT, schemaDir);
        const files = fs
            .readdirSync(dirPath)
            .filter((f) => f.endsWith('.sql'))
            .sort();
        for (const f of files) {
            out.push({
                relPath: `${schemaDir}/${f}`,
                content: fs.readFileSync(path.join(dirPath, f), 'utf8')
            });
        }
    }
    return out;
}

function argsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((x, i) => x === b[i]);
}

function validateBlock(
    relPath: string,
    block: string,
    blockName: 'UP' | 'DOWN',
    priorState: Map<string, FunctionSignature>,
    findings: Finding[]
) {
    if (!block.trim()) return;
    const creates = findCreates(block);
    const drops = findDrops(block);

    for (const c of creates) {
        const prev = priorState.get(c.qname);
        if (prev) {
            const argsChanged = !argsEqual(prev.args, c.args);
            const returnsChanged = prev.returns !== c.returns;
            if (argsChanged || returnsChanged) {
                const precedingDrop = drops.find(
                    (d) =>
                        d.qname === c.qname &&
                        d.offset < c.offset &&
                        (d.args === null || argsEqual(d.args, prev.args))
                );
                if (!precedingDrop) {
                    const changed =
                        argsChanged && returnsChanged
                            ? 'args + return'
                            : argsChanged
                              ? 'args'
                              : 'return';
                    findings.push({
                        severity: 'error',
                        file: relPath,
                        line: c.line,
                        message: `${blockName}: CREATE OR REPLACE of ${c.qname} changed ${changed} since ${prev.file} without preceding DROP.`,
                        fix: `Add \`DROP FUNCTION IF EXISTS ${c.qname}(${prev.args.join(', ')});\` before the CREATE.`
                    });
                }
            }
        }
        priorState.set(c.qname, {
            qname: c.qname,
            args: c.args,
            returns: c.returns,
            file: relPath,
            line: c.line
        });
    }

    for (const d of drops) {
        priorState.delete(d.qname);
    }
}

// --- Cross-schema ordering check ----------------------------------------

// Schemas = migration subdirectories. Derived, not hardcoded.
function knownSchemas(): Set<string> {
    return new Set(
        fs
            .readdirSync(MIGRATION_ROOT, {withFileTypes: true})
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
    );
}

const COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base'
});

function basename(relPath: string): string {
    return path.basename(relPath);
}

/** Strip comments + string literals. */
function stripCommentsAndStrings(sql: string): string {
    return sql
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/'(?:''|[^'])*'/g, "''");
}

/** Strip plpgsql bodies — PG resolves them at call time, not CREATE. */
function stripPlpgsqlBodies(sql: string): string {
    const fnRe =
        /(CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION[\s\S]*?)(\$\$)([\s\S]*?)(\$\$)/gi;
    return sql.replace(fnRe, (_full, head, open, body, close) =>
        /\bLANGUAGE\s+plpgsql\b/i.test(head)
            ? `${head}${open}${close}`
            : `${head}${open}${body}${close}`
    );
}

const CREATE_TABLE_RE =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
const CREATE_FN_RE =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
const QNAME_REF_RE = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi;

function buildCreationIndex(
    files: Array<{relPath: string; content: string}>
): Map<string, string> {
    // qname.toLowerCase() → earliest basename that CREATEs it
    const idx = new Map<string, string>();
    const record = (schema: string, name: string, basename: string) => {
        const qname = `${schema}.${name}`.toLowerCase();
        const existing = idx.get(qname);
        if (!existing || COLLATOR.compare(basename, existing) < 0) {
            idx.set(qname, basename);
        }
    };
    for (const f of files) {
        const stripped = stripCommentsAndStrings(f.content);
        const bn = basename(f.relPath);
        let m: RegExpExecArray | null;
        CREATE_TABLE_RE.lastIndex = 0;
        while ((m = CREATE_TABLE_RE.exec(stripped))) record(m[1], m[2], bn);
        CREATE_FN_RE.lastIndex = 0;
        while ((m = CREATE_FN_RE.exec(stripped))) record(m[1], m[2], bn);
    }
    return idx;
}

function checkCrossSchemaOrdering(
    files: Array<{relPath: string; content: string}>,
    findings: Finding[]
): void {
    const creationIdx = buildCreationIndex(files);
    const schemas = knownSchemas();
    for (const f of files) {
        const mySchema = f.relPath.split('/')[0];
        const myBasename = basename(f.relPath);
        const stripped = stripPlpgsqlBodies(stripCommentsAndStrings(f.content));
        const {up} = splitUpDown(stripped);
        const seen = new Set<string>();
        QNAME_REF_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = QNAME_REF_RE.exec(up))) {
            const schema = m[1].toLowerCase();
            const name = m[2].toLowerCase();
            const qname = `${schema}.${name}`;
            if (!schemas.has(schema)) continue;
            if (schema === mySchema) continue;
            if (seen.has(qname)) continue;
            seen.add(qname);
            const creator = creationIdx.get(qname);
            if (!creator) continue;
            if (COLLATOR.compare(creator, myBasename) > 0) {
                findings.push({
                    severity: 'error',
                    file: f.relPath,
                    line: 1,
                    message: `UP: ${qname} is created in ${creator} which sorts after this file.`,
                    fix: `Rename to basename ≥ ${creator.match(/^\d+/)?.[0] ?? '<creator>'}.`
                });
            }
        }
    }
}

// --- Additive-only check ----------------------------------------------
// UP blocks must not DROP TABLE / DROP COLUMN / RENAME. Escape hatch:
// `-- LINT-IGNORE: additive-only` on same/prior line, or anywhere in
// the first 10 lines of the UP block to exempt the whole block.

const DESTRUCTIVE_UP_RE =
    /\b(DROP\s+TABLE|DROP\s+COLUMN|RENAME\s+COLUMN|RENAME\s+TO)\b/i;
const LINT_IGNORE_ADDITIVE_RE = /LINT-IGNORE:\s*additive-only/i;

export function checkAdditiveOnly(
    files: Array<{relPath: string; content: string}>,
    findings: Finding[]
): void {
    for (const f of files) {
        const {up} = splitUpDown(f.content);
        if (!up.trim()) continue;
        const lines = up.split('\n');
        // File-scope opt-out: LINT-IGNORE in first 10 lines exempts the block.
        const fileScopeIgnore = lines
            .slice(0, 10)
            .some((l) => LINT_IGNORE_ADDITIVE_RE.test(l));
        if (fileScopeIgnore) continue;
        // Offset so Finding.line points into the original file.
        const upStartIdx = f.content.indexOf(up);
        const upLineBase =
            upStartIdx >= 0
                ? f.content.slice(0, upStartIdx).split('\n').length - 1
                : 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim().startsWith('--')) continue;
            const code = line.split('--')[0];
            const match = code.match(DESTRUCTIVE_UP_RE);
            if (!match) continue;
            const prev = i > 0 ? lines[i - 1] : '';
            if (
                LINT_IGNORE_ADDITIVE_RE.test(line) ||
                LINT_IGNORE_ADDITIVE_RE.test(prev)
            ) {
                continue;
            }
            findings.push({
                severity: 'error',
                file: f.relPath,
                line: upLineBase + i + 1,
                message: `UP: destructive statement "${match[1]}" violates additive-only policy.`,
                fix: 'Add a new additive migration, or — for deliberate greenfield rewrites — add `-- LINT-IGNORE: additive-only` on the same or preceding line.'
            });
        }
    }
}

// --- Idempotency check ------------------------------------------------
// New migrations must use IF NOT EXISTS / IF EXISTS / OR REPLACE on bare
// DDL so partial-recovery re-runs don't error. Per-schema thresholds
// grandfather everything currently committed; the rule only applies to
// migrations added after those numbers.

const IDEMPOTENCY_GRANDFATHER: Record<string, number> = {
    device: 6401,
    logging: 6101,
    notifications: 6415,
    organization: 6103,
    ui: 20002,
    user: 20001
};

const BARE_CREATE_INDEX_RE =
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)[a-z_]/i;
const BARE_ADD_COLUMN_RE = /\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)[a-z_]/i;
const LINT_IGNORE_IDEMPOTENCY_RE = /LINT-IGNORE:\s*idempotency/i;

function migrationNumber(basename: string): number | null {
    const m = basename.match(/^(\d+)/);
    return m ? Number(m[1]) : null;
}

export function checkIdempotency(
    files: Array<{relPath: string; content: string}>,
    findings: Finding[]
): void {
    for (const f of files) {
        const [schema, base] = f.relPath.split('/');
        const grandfather = IDEMPOTENCY_GRANDFATHER[schema];
        const num = migrationNumber(base);
        if (grandfather === undefined || num === null) continue;
        if (num <= grandfather) continue;

        const lines = f.content.split('\n');
        const fileScopeIgnore = lines
            .slice(0, 10)
            .some((l) => LINT_IGNORE_IDEMPOTENCY_RE.test(l));
        if (fileScopeIgnore) continue;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim().startsWith('--')) continue;
            const code = line.split('--')[0];
            const idxMatch = code.match(BARE_CREATE_INDEX_RE);
            const colMatch = code.match(BARE_ADD_COLUMN_RE);
            if (!idxMatch && !colMatch) continue;
            const prev = i > 0 ? lines[i - 1] : '';
            if (
                LINT_IGNORE_IDEMPOTENCY_RE.test(line) ||
                LINT_IGNORE_IDEMPOTENCY_RE.test(prev)
            ) {
                continue;
            }
            const stmt = idxMatch ? 'CREATE INDEX' : 'ADD COLUMN';
            const guard = idxMatch ? 'IF NOT EXISTS' : 'IF NOT EXISTS';
            findings.push({
                severity: 'error',
                file: f.relPath,
                line: i + 1,
                message: `${stmt} without ${guard} — partial-recovery re-runs will error.`,
                fix: `Add \`${guard}\` after \`${stmt}\`, or — if the migration is intentionally non-idempotent — add \`-- LINT-IGNORE: idempotency\` on the same or preceding line.`
            });
        }
    }
}

// --- CREATE INDEX CONCURRENTLY check ----------------------------------
// Indexes on high-write tables must be created CONCURRENTLY so the build
// doesn't block writers for the migration's entire duration. CONCURRENTLY
// cannot run inside the implicit transaction wrapper, so the migration
// file must opt out via `-- LINT-IGNORE: tx` (interpreted by the runner)
// AND drop the redundant `BEGIN/COMMIT` if present. The lint here only
// catches the missing CONCURRENTLY; runner-tx opt-out is a separate gate.
//
// Heavy-table list: PostgreSQL relations expected to grow to >>10M rows
// or to receive sustained write traffic. Keep curated — promoting a
// table here changes the index-build cadence for every future migration
// that touches it.
const HEAVY_TABLES: ReadonlySet<string> = new Set([
    'device.status',
    'logging.audit_log',
    'device_em.stats'
]);

const HEAVY_TABLE_INDEX_RE =
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[\s\S]{0,200}?\bON\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi;
const CONCURRENTLY_RE = /\bCONCURRENTLY\b/i;
const LINT_IGNORE_CONCURRENTLY_RE = /LINT-IGNORE:\s*concurrent-index/i;

// Grandfather: only enforce on migrations created after these per-schema
// numbers. Bumped when the existing migrations are reviewed + accepted
// as-is. Increase as new migrations land that follow the rule.
const CONCURRENTLY_GRANDFATHER: Record<string, number> = {
    device: 6402,
    logging: 6105,
    organization: 6135
};

export function checkCreateIndexConcurrently(
    files: Array<{relPath: string; content: string}>,
    findings: Finding[]
): void {
    for (const f of files) {
        const [schema, base] = f.relPath.split('/');
        const grandfather = CONCURRENTLY_GRANDFATHER[schema];
        const num = migrationNumber(base);
        if (grandfather === undefined || num === null) continue;
        if (num <= grandfather) continue;

        const {up} = splitUpDown(f.content);
        if (!up.trim()) continue;

        const lines = up.split('\n');
        const fileScopeIgnore = lines
            .slice(0, 10)
            .some((l) => LINT_IGNORE_CONCURRENTLY_RE.test(l));
        if (fileScopeIgnore) continue;

        const upStartIdx = f.content.indexOf(up);
        const upLineBase =
            upStartIdx >= 0
                ? f.content.slice(0, upStartIdx).split('\n').length - 1
                : 0;

        const stripped = stripCommentsAndStrings(up);
        HEAVY_TABLE_INDEX_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = HEAVY_TABLE_INDEX_RE.exec(stripped))) {
            const table = m[1].toLowerCase();
            if (!HEAVY_TABLES.has(table)) continue;
            const matched = m[0];
            if (CONCURRENTLY_RE.test(matched)) continue;

            // Resolve to original-file line for the report.
            const offsetInUp = m.index;
            const line = up.slice(0, offsetInUp).split('\n').length;
            findings.push({
                severity: 'error',
                file: f.relPath,
                line: upLineBase + line,
                message: `CREATE INDEX on heavy table ${table} without CONCURRENTLY — blocks writes for the build duration.`,
                fix: 'Use `CREATE INDEX CONCURRENTLY IF NOT EXISTS …` and move the statement to a tx-free migration. Or — for tiny tables / first-deploy seeds — add `-- LINT-IGNORE: concurrent-index` in the first 10 lines.'
            });
        }
    }
}

function lint(): Finding[] {
    const findings: Finding[] = [];
    const files = loadFiles();
    const upState: Map<string, FunctionSignature> = new Map();

    for (const {relPath, content} of files) {
        const {up, down} = splitUpDown(content);
        validateBlock(relPath, up, 'UP', upState, findings);
        const preDown = new Map(upState);
        validateBlock(relPath, down, 'DOWN', preDown, findings);
    }

    checkCrossSchemaOrdering(files, findings);
    checkAdditiveOnly(files, findings);
    checkIdempotency(files, findings);
    checkCreateIndexConcurrently(files, findings);
    checkUuidIntDrift(files, findings);
    checkSentinelParseable(files, findings);
    checkAlertInstancesStateRefs(files, findings);
    return findings;
}

// migration-collection/lib/parser.js looks for a line ending in
// `-----up`/`-----down` (case-insensitive). Anything shorter is silently
// ignored, the parser returns undefined, and pg.query() throws inside
// the deploy container. Catch it at lint time instead.
const SENTINEL_UP_RE = /^.*-{5,}up\s*$/im;
const SENTINEL_DOWN_RE = /^.*-{5,}down\s*$/im;
const SHORT_SEPARATOR_RE = /^-{1,4} (UP|DOWN)\s*$/im;

export function checkSentinelParseable(
    files: Array<{relPath: string; content: string}>,
    findings: Finding[]
): void {
    for (const f of files) {
        if (!SENTINEL_UP_RE.test(f.content)) {
            findings.push({
                severity: 'error',
                file: f.relPath,
                line: 1,
                message:
                    'No parseable UP sentinel — runtime needs a line ending in 5+ dashes then UP.',
                fix: "Replace with `--------------UP` on its own line."
            });
        }
        // DOWN sentinel is advisory — missing DOWN = no rollback path
        // but UP still applies. Only missing/short UP crashes boot.
        const shortMatch = f.content.match(SHORT_SEPARATOR_RE);
        if (shortMatch) {
            findings.push({
                severity: 'error',
                file: f.relPath,
                line: f.content.slice(0, shortMatch.index ?? 0).split('\n')
                    .length,
                message: `Short separator "${shortMatch[0]}" — migration-collection only matches 5+ dashes.`,
                fix: `Change to "--------------${shortMatch[1]}".`
            });
        }
    }
}

// Reject any state IN (...) reference against alert_instances whose
// values aren't in the canonical CHECK set (states.ts → 6520 CHECK).
const STMT_SPLIT_RE = /(?:^|;)([^;]+?)(?=;|$)/gms;
const STATE_IN_RE = /\bstate\s+IN\s*\(([^)]*)\)/gi;
const STRING_LITERAL_RE = /'([^']+)'/g;

export function checkAlertInstancesStateRefs(
    files: Array<{relPath: string; content: string}>,
    findings: Finding[]
): void {
    for (const f of files) {
        STMT_SPLIT_RE.lastIndex = 0;
        let stmt: RegExpExecArray | null;
        while ((stmt = STMT_SPLIT_RE.exec(f.content))) {
            const body = stmt[1];
            if (!/alert_instances/i.test(body)) continue;
            if (/CHECK\s*\(\s*state\s+IN/i.test(body)) continue;
            STATE_IN_RE.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = STATE_IN_RE.exec(body))) {
                STRING_LITERAL_RE.lastIndex = 0;
                let lit: RegExpExecArray | null;
                while ((lit = STRING_LITERAL_RE.exec(match[1]))) {
                    if (!ALERT_INSTANCE_STATE_SET.has(lit[1])) {
                        const lineNo = f.content
                            .slice(0, (stmt.index ?? 0) + (match.index ?? 0))
                            .split('\n').length;
                        findings.push({
                            severity: 'error',
                            file: f.relPath,
                            line: lineNo,
                            message: `alert_instances state IN (...) references unknown value '${lit[1]}'.`,
                            fix: `Use one of: ${[...ALERT_INSTANCE_STATE_SET].sort().join(', ')}.`
                        });
                    }
                }
            }
        }
    }
}

// Migration helpers that declare INT-typed params or RETURNS columns
// for IDs the underlying table stores as UUID fail at CREATE FUNCTION
// time (PG 42P13: return type mismatch / operator does not exist:
// uuid = integer). Build (uuid table, uuid column) sets from CREATE
// TABLE definitions, then flag a function only when its body
// references one of those uuid tables AND declares the same column
// name as INT. Keeps the check from false-positiving on co-named
// columns in tables with INT keys (e.g. dashboards.id INT vs
// personas.id UUID).
function checkUuidIntDrift(
    files: Array<{relPath: string; content: string}>,
    findings: Finding[]
): void {
    // uuidTables: tables that have at least one uuid column
    //   key = lowercase table name (schema-stripped) → Set of uuid column names
    const uuidTables = new Map<string, Set<string>>();
    const TABLE_RE =
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(\w+)\.)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi;
    for (const {content} of files) {
        for (const m of content.matchAll(TABLE_RE)) {
            const table = m[2].toLowerCase();
            const body = m[3];
            const cols = body
                .split(/,(?![^()]*\))/)
                .map((l) => l.trim())
                .filter(Boolean);
            for (const raw of cols) {
                const cm = raw.match(/^([a-z_][\w]*)\s+(uuid)\b/i);
                if (!cm) continue;
                const col = cm[1].toLowerCase();
                if (!uuidTables.has(table)) uuidTables.set(table, new Set());
                uuidTables.get(table)!.add(col);
            }
        }
    }
    if (uuidTables.size === 0) return;

    const FN_RE =
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:\w+\.)?(\w+)\s*\(([\s\S]*?)\)\s*RETURNS\s+([\s\S]*?)\$\$([\s\S]*?)\$\$/gi;

    for (const {relPath, content} of files) {
        for (const m of content.matchAll(FN_RE)) {
            const fnName = m[1];
            const paramsBlock = m[2];
            const returnsBlock = m[3];
            const body = m[4].toLowerCase();
            const lineNo = content.slice(0, m.index ?? 0).split('\n').length;

            // Which uuid tables does this function actually touch?
            const refs = new Set<string>();
            for (const t of uuidTables.keys()) {
                if (new RegExp(`\\b${t}\\b`).test(body)) refs.add(t);
            }
            if (refs.size === 0) continue;
            const refUuidCols = new Set<string>();
            for (const t of refs) {
                for (const c of uuidTables.get(t)!) refUuidCols.add(c);
            }

            const paramLines = paramsBlock
                .split(/,(?![^()]*\))/)
                .map((l) => l.trim())
                .filter(Boolean);
            for (const raw of paramLines) {
                const pm = raw.match(
                    /^(p_[a-z0-9_]+)\s+(int|integer|bigint)\b/i
                );
                if (!pm) continue;
                const paramName = pm[1].toLowerCase();
                const stripped = paramName.replace(/^p_/, '');
                if (refUuidCols.has(stripped)) {
                    findings.push({
                        severity: 'error',
                        file: relPath,
                        line: lineNo,
                        message: `Function ${fnName}: param ${paramName} declared ${pm[2]} but body touches uuid column ${stripped}; CREATE FUNCTION will fail (42P13) or compare uuid = integer.`,
                        fix: `Change ${paramName} to UUID, or — for the rare INT-keyed case — add \`-- LINT-IGNORE: uuid-int-drift\` near this function.`
                    });
                }
            }

            const tableMatch = /RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*$/i.exec(
                returnsBlock.trim()
            );
            if (!tableMatch) continue;
            const cols = tableMatch[1]
                .split(/,(?![^()]*\))/)
                .map((l) => l.trim())
                .filter(Boolean);
            for (const raw of cols) {
                const cm = raw.match(
                    /^([a-z_][\w]*)\s+(int|integer|bigint)\b/i
                );
                if (!cm) continue;
                const col = cm[1].toLowerCase();
                if (refUuidCols.has(col)) {
                    findings.push({
                        severity: 'error',
                        file: relPath,
                        line: lineNo,
                        message: `Function ${fnName}: RETURNS column ${col} declared ${cm[2]} but body returns from a table where ${col} is uuid; PG will error with return type mismatch.`,
                        fix: `Change the RETURNS column ${col} to UUID (or TEXT if you cast via ::text in the SELECT).`
                    });
                }
            }
        }
    }
}

function main() {
    const findings = lint();
    if (findings.length === 0) {
        console.log('Migration lint: clean.');
        process.exit(0);
    }
    const errors = findings.filter((f) => f.severity === 'error');
    const warns = findings.filter((f) => f.severity === 'warn');
    for (const f of findings) {
        const tag = f.severity === 'error' ? 'ERROR' : 'WARN';
        console.error(`[${tag}] ${f.file}:${f.line} — ${f.message}`);
        console.error(`        fix: ${f.fix}`);
    }
    console.error(`\n${errors.length} error(s), ${warns.length} warning(s).`);
    process.exit(errors.length > 0 ? 1 : 0);
}

// Run main() only as CLI; bare imports (tests) must not auto-execute.
if (typeof require !== 'undefined' && require.main === module) {
    main();
}
