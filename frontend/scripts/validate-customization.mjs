import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
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

const sourceDir = process.env.BM_TEMPLATE_SOURCE
    ? path.resolve(process.env.BM_TEMPLATE_SOURCE)
    : '';
if (sourceDir) {
    const validatorPath = path.join(
        sourceDir,
        'shared/component-library/registry/validate.ts'
    );
    const blockPath = path.join(
        sourceDir,
        'shared/component-library/registry/dashboard-block.ts'
    );
    const {validateCustomization} = await import(
        pathToFileURL(validatorPath).href
    );
    const {resolveDashboardBlock} = await import(pathToFileURL(blockPath).href);
    const patch = {
        ...(parsed.components === undefined
            ? {}
            : {components: parsed.components}),
        ...(parsed.theme === undefined ? {} : {theme: parsed.theme})
    };
    const issues = validateCustomization(patch);
    if (Array.isArray(parsed.dashboardBlocks)) {
        parsed.dashboardBlocks.forEach((block, index) => {
            const resolved = resolveDashboardBlock(block);
            if (!resolved.ok) {
                resolved.issues.forEach((issue) => {
                    issues.push({
                        ...issue,
                        field: `dashboardBlocks[${index}].${issue.field}`
                    });
                });
            }
        });
    }
    if (issues.length > 0) {
        console.error(`Customization registry validation failed for ${file}:`);
        for (const issue of issues) {
            console.error(`- ${issue.field}: ${issue.reason}`);
        }
        process.exit(1);
    }
}

console.log(`Customization validation passed: ${file}`);
