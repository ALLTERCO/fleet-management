// Dev delegate; the shipped copy is src/cli and runs from dist in a container.

import {runMigrationCli} from '../src/cli/migrate-legacy-role-assignments';

runMigrationCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
        console.error('Fatal:', error);
        process.exit(2);
    });
