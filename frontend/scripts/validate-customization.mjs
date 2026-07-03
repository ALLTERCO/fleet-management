import fs from 'node:fs';
import {validateProjectOverrides} from '../src/shell/customizationSchema.ts';

const file = process.argv[2] ?? 'public/customization.json';

let parsed;
try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
    console.error(`Invalid customization JSON in ${file}: ${err.message}`);
    process.exit(1);
}

const result = validateProjectOverrides(parsed);
if (!result.ok) {
    console.error(`Customization validation failed for ${file}:`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
}

console.log(`Customization validation passed: ${file}`);
