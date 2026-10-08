import fs from 'node:fs';
import {validateOperationalBindings} from '../src/shell/operational-bindings.ts';

const file = process.argv[2] ?? 'public/operational-bindings.json';

let parsed;
try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    validateOperationalBindings(parsed);
} catch (error) {
    console.error(
        `Operational bindings validation failed for ${file}: ${error.message}`
    );
    process.exit(1);
}

console.log(`Operational bindings validation passed: ${file}`);
