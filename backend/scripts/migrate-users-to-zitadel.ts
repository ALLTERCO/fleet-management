/**
 * User Migration Script: PostgreSQL to Zitadel
 *
 * This script migrates users from the PostgreSQL database to Zitadel.
 * Passwords cannot be migrated - users will receive password reset emails.
 *
 * Usage:
 *   npx tsx scripts/migrate-users-to-zitadel.ts [options]
 *
 * Options:
 *   --dry-run        Preview changes without making them
 *   --skip-existing  Skip users that already exist in Zitadel
 *   --send-reset     Send password reset emails to migrated users
 */

import {configRc} from '../src/config';
import * as store from '../src/modules/PostgresProvider';
import {zitadelService, type FleetUserMetadata} from '../src/modules/zitadel';

interface PostgresUser {
    id: number;
    username: string;
    name?: string;
    email?: string;
    full_name?: string;
    fullname?: string;
    group: string;
    permissions: string[];
    enabled: boolean;
    deleted?: boolean;
}

interface MigrationResult {
    username: string;
    status: 'created' | 'skipped' | 'error' | 'dry-run';
    zitadelUserId?: string;
    error?: string;
}

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_EXISTING = args.includes('--skip-existing');
const SEND_RESET = args.includes('--send-reset');

async function main() {
    console.log('='.repeat(60));
    console.log('Fleet Manager: User Migration to Zitadel');
    console.log('='.repeat(60));
    console.log('');
    console.log('Options:');
    console.log(`  Dry run:        ${DRY_RUN}`);
    console.log(`  Skip existing:  ${SKIP_EXISTING}`);
    console.log(`  Send reset:     ${SEND_RESET}`);
    console.log('');

    // Check Zitadel configuration
    if (!zitadelService.isAvailable()) {
        console.error('ERROR: Zitadel is not configured.');
        console.error(
            'Please ensure the OIDC backend configuration is set in .fleet-managerrc'
        );
        process.exit(1);
    }

    // Initialize database
    console.log('Initializing database connection...');
    await store.initDatabase();

    // Fetch all users from PostgreSQL
    console.log('Fetching users from PostgreSQL...');
    const {rows: users} = await store.userList({});

    // Filter out deleted users
    const activeUsers = (users as PostgresUser[]).filter(
        (u) => u.deleted !== true
    );

    console.log(`Found ${activeUsers.length} active users in PostgreSQL`);
    console.log('');

    if (activeUsers.length === 0) {
        console.log('No users to migrate.');
        process.exit(0);
    }

    // Get existing Zitadel users for comparison
    console.log('Fetching existing Zitadel users...');
    const existingZitadelUsers = await zitadelService.listUsers();
    const existingEmails = new Set(
        existingZitadelUsers
            .filter((u) => u.email)
            .map((u) => u.email!.toLowerCase())
    );
    const existingUsernames = new Set(
        existingZitadelUsers.map((u) => u.userName.toLowerCase())
    );

    console.log(`Found ${existingZitadelUsers.length} existing Zitadel users`);
    console.log('');

    // Migration results
    const results: MigrationResult[] = [];

    // Process each user
    console.log('-'.repeat(60));
    console.log('Starting migration...');
    console.log('-'.repeat(60));

    for (const user of activeUsers) {
        const username = user.username || user.name || '';
        const email = user.email || `${username}@local.fleet`;
        const fullName = user.full_name || user.fullname || username;

        console.log(`\nProcessing: ${username} (${email})`);

        // Check if user already exists
        const emailExists = existingEmails.has(email.toLowerCase());
        const usernameExists = existingUsernames.has(username.toLowerCase());

        if (emailExists || usernameExists) {
            if (SKIP_EXISTING) {
                console.log(
                    `  -> SKIPPED: User already exists in Zitadel`
                );
                results.push({
                    username,
                    status: 'skipped',
                    error: 'Already exists in Zitadel'
                });
                continue;
            }

            // Find existing user and update metadata
            const existingUser = existingZitadelUsers.find(
                (u) =>
                    u.email?.toLowerCase() === email.toLowerCase() ||
                    u.userName.toLowerCase() === username.toLowerCase()
            );

            if (existingUser) {
                console.log(`  -> Updating metadata for existing user`);

                if (!DRY_RUN) {
                    try {
                        const metadata: FleetUserMetadata = {
                            permissions: user.permissions || [],
                            group: user.group || ''
                        };
                        await zitadelService.setUserMetadata(
                            existingUser.userId,
                            metadata
                        );
                        console.log(`  -> Metadata updated successfully`);
                        results.push({
                            username,
                            status: 'created',
                            zitadelUserId: existingUser.userId
                        });
                    } catch (error) {
                        console.error(`  -> ERROR: ${error}`);
                        results.push({
                            username,
                            status: 'error',
                            error: String(error)
                        });
                    }
                } else {
                    console.log(`  -> DRY RUN: Would update metadata`);
                    results.push({username, status: 'dry-run'});
                }
                continue;
            }
        }

        // Create new user in Zitadel
        if (DRY_RUN) {
            console.log(`  -> DRY RUN: Would create user`);
            console.log(`     Email: ${email}`);
            console.log(`     Full name: ${fullName}`);
            console.log(`     Group: ${user.group}`);
            console.log(`     Permissions: ${JSON.stringify(user.permissions)}`);
            results.push({username, status: 'dry-run'});
            continue;
        }

        try {
            // Parse full name into first/last
            const nameParts = fullName.split(' ');
            const firstName = nameParts[0] || username;
            const lastName = nameParts.slice(1).join(' ') || 'User';

            // Create user
            const {userId} = await zitadelService.createHumanUser({
                email,
                userName: username,
                firstName,
                lastName,
                displayName: fullName
            });

            console.log(`  -> Created user with ID: ${userId}`);

            // Set metadata
            const metadata: FleetUserMetadata = {
                permissions: user.permissions || [],
                group: user.group || ''
            };
            await zitadelService.setUserMetadata(userId, metadata);
            console.log(`  -> Set permissions: ${JSON.stringify(user.permissions)}`);
            console.log(`  -> Set group: ${user.group}`);

            // Send password reset email if requested
            if (SEND_RESET) {
                try {
                    await zitadelService.sendPasswordResetEmail(userId);
                    console.log(`  -> Password reset email sent`);
                } catch (resetError) {
                    console.warn(
                        `  -> WARNING: Could not send reset email: ${resetError}`
                    );
                }
            }

            results.push({username, status: 'created', zitadelUserId: userId});
        } catch (error) {
            console.error(`  -> ERROR: ${error}`);
            results.push({username, status: 'error', error: String(error)});
        }
    }

    // Print summary
    console.log('');
    console.log('='.repeat(60));
    console.log('Migration Summary');
    console.log('='.repeat(60));

    const created = results.filter((r) => r.status === 'created').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const errors = results.filter((r) => r.status === 'error').length;
    const dryRun = results.filter((r) => r.status === 'dry-run').length;

    console.log(`  Created:    ${created}`);
    console.log(`  Skipped:    ${skipped}`);
    console.log(`  Errors:     ${errors}`);
    if (DRY_RUN) {
        console.log(`  Dry run:    ${dryRun}`);
    }
    console.log('');

    if (errors > 0) {
        console.log('Errors:');
        for (const result of results.filter((r) => r.status === 'error')) {
            console.log(`  - ${result.username}: ${result.error}`);
        }
        console.log('');
    }

    if (DRY_RUN) {
        console.log('This was a dry run. No changes were made.');
        console.log('Run without --dry-run to perform the actual migration.');
    } else if (!SEND_RESET && created > 0) {
        console.log('NOTE: Password reset emails were not sent.');
        console.log(
            'Users will need to use "Forgot Password" or run with --send-reset'
        );
    }

    console.log('');
    process.exit(errors > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
