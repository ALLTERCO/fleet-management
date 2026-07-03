// CI gate: applies every committed migration against a real Postgres, so
// parser bugs, FK/CHECK violations and signature collisions fail in the test
// stage instead of the deploy boot loop. FM_PG_TEST_URL overrides the target.
import {
    applyMigrations,
    pgConfigFromUrl,
    resetSchemas
} from './migrationTestDb';

const DB_URL =
    process.env.FM_PG_TEST_URL ?? 'postgres://postgres@localhost:5432/postgres';

async function main(): Promise<void> {
    const config = pgConfigFromUrl(DB_URL);
    console.log(
        `[test-migrations] target: ${config.host}:${config.port}/${config.database}`
    );

    await resetSchemas(config);
    const before = Date.now();
    await applyMigrations(config);
    const elapsed = ((Date.now() - before) / 1000).toFixed(1);
    console.log(`[test-migrations] all migrations applied in ${elapsed}s`);
}

main().catch((err) => {
    console.error('[test-migrations] FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
