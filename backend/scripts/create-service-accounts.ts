/**
 * Service Account Creation Script
 *
 * Creates machine users (service accounts) in Zitadel for:
 * - Node-RED: Local websocket authentication
 * - Alexa: Voice assistant integration (optional)
 *
 * Usage:
 *   npx tsx scripts/create-service-accounts.ts [options]
 *
 * Options:
 *   --nodered       Create Node-RED service account
 *   --alexa         Create Alexa service account
 *   --all           Create all service accounts
 *   --dry-run       Preview changes without making them
 *
 * Output:
 *   Prints the Personal Access Token for each created service account.
 *   Store these tokens securely in your .fleet-managerrc configuration.
 */

import {zitadelService, type FleetUserMetadata} from '../src/modules/zitadel';

// Service account definitions
const SERVICE_ACCOUNTS = {
    nodered: {
        userName: 'fleet-nodered',
        name: 'Fleet Manager Node-RED',
        description: 'Service account for Node-RED local websocket authentication',
        permissions: ['*'] as string[],
        group: 'service'
    },
    alexa: {
        userName: 'fleet-alexa',
        name: 'Fleet Manager Alexa',
        description: 'Service account for Alexa voice assistant integration',
        permissions: [
            'device.list',
            'device.command',
            'entity.list',
            'entity.command'
        ],
        group: 'service'
    }
} as const;

type ServiceAccountType = keyof typeof SERVICE_ACCOUNTS;

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CREATE_NODERED = args.includes('--nodered') || args.includes('--all');
const CREATE_ALEXA = args.includes('--alexa') || args.includes('--all');

interface CreatedAccount {
    type: ServiceAccountType;
    userId: string;
    userName: string;
    token: string;
}

async function createServiceAccount(
    type: ServiceAccountType
): Promise<CreatedAccount | null> {
    const config = SERVICE_ACCOUNTS[type];

    console.log(`\nCreating ${type} service account...`);
    console.log(`  Username: ${config.userName}`);
    console.log(`  Name: ${config.name}`);
    console.log(`  Permissions: ${JSON.stringify(config.permissions)}`);

    if (DRY_RUN) {
        console.log('  -> DRY RUN: Would create service account');
        return null;
    }

    try {
        // Check if user already exists
        const existing = await zitadelService.findUserByUsername(config.userName);
        if (existing) {
            console.log(
                `  -> Service account already exists with ID: ${existing.userId}`
            );
            console.log('  -> Generating new Personal Access Token...');

            // Generate new PAT for existing user
            const pat = await zitadelService.createPersonalAccessToken(
                existing.userId
            );

            // Update metadata
            const metadata: FleetUserMetadata = {
                permissions: config.permissions,
                group: config.group
            };
            await zitadelService.setUserMetadata(existing.userId, metadata);

            return {
                type,
                userId: existing.userId,
                userName: config.userName,
                token: pat.token
            };
        }

        // Create new machine user
        const {userId} = await zitadelService.createMachineUser({
            userName: config.userName,
            name: config.name,
            description: config.description
        });

        console.log(`  -> Created with ID: ${userId}`);

        // Set permissions metadata
        const metadata: FleetUserMetadata = {
            permissions: config.permissions,
            group: config.group
        };
        await zitadelService.setUserMetadata(userId, metadata);
        console.log('  -> Metadata set successfully');

        // Create Personal Access Token
        const pat = await zitadelService.createPersonalAccessToken(userId);
        console.log('  -> Personal Access Token created');

        return {
            type,
            userId,
            userName: config.userName,
            token: pat.token
        };
    } catch (error) {
        console.error(`  -> ERROR: ${error}`);
        return null;
    }
}

async function main() {
    console.log('='.repeat(60));
    console.log('Fleet Manager: Service Account Creation');
    console.log('='.repeat(60));
    console.log('');
    console.log('Options:');
    console.log(`  Dry run:      ${DRY_RUN}`);
    console.log(`  Node-RED:     ${CREATE_NODERED}`);
    console.log(`  Alexa:        ${CREATE_ALEXA}`);
    console.log('');

    if (!CREATE_NODERED && !CREATE_ALEXA) {
        console.log('No service accounts selected.');
        console.log('Usage: npx tsx scripts/create-service-accounts.ts [--nodered] [--alexa] [--all]');
        process.exit(0);
    }

    // Check Zitadel configuration
    if (!zitadelService.isAvailable()) {
        console.error('ERROR: Zitadel is not configured.');
        console.error(
            'Please ensure the OIDC backend configuration is set in .fleet-managerrc'
        );
        process.exit(1);
    }

    const createdAccounts: CreatedAccount[] = [];

    // Create requested service accounts
    if (CREATE_NODERED) {
        const account = await createServiceAccount('nodered');
        if (account) createdAccounts.push(account);
    }

    if (CREATE_ALEXA) {
        const account = await createServiceAccount('alexa');
        if (account) createdAccounts.push(account);
    }

    // Print results
    console.log('');
    console.log('='.repeat(60));
    console.log('Results');
    console.log('='.repeat(60));

    if (DRY_RUN) {
        console.log('\nThis was a dry run. No changes were made.');
        console.log('Run without --dry-run to create the service accounts.');
        process.exit(0);
    }

    if (createdAccounts.length === 0) {
        console.log('\nNo service accounts were created.');
        process.exit(1);
    }

    console.log('\nCreated/Updated Service Accounts:');
    console.log('');

    for (const account of createdAccounts) {
        console.log(`${account.type.toUpperCase()}:`);
        console.log(`  User ID:  ${account.userId}`);
        console.log(`  Username: ${account.userName}`);
        console.log(`  Token:    ${account.token}`);
        console.log('');
    }

    // Print configuration snippet
    console.log('='.repeat(60));
    console.log('Configuration');
    console.log('='.repeat(60));
    console.log('\nAdd the following to your .fleet-managerrc file:');
    console.log('');
    console.log('{');
    console.log('  "serviceAccounts": {');

    const configParts: string[] = [];
    for (const account of createdAccounts) {
        configParts.push(`    "${account.type}": {
      "userId": "${account.userId}",
      "token": "${account.token}"
    }`);
    }
    console.log(configParts.join(',\n'));

    console.log('  }');
    console.log('}');
    console.log('');
    console.log('IMPORTANT: Store these tokens securely!');
    console.log('They provide full API access to Fleet Manager.');

    process.exit(0);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
