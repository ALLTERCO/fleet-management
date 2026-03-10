import Driver from './Driver';
import * as fs from 'fs';

const sqlite3 = require('sqlite3').verbose();
export default class SQLiteDriver extends Driver {
    db: any;

    constructor(dbName: string) {
        super();
        if (!fs.existsSync(dbName)) {
            this.db = new sqlite3.Database(dbName, (err: any) => {
                if (err) {
                    return console.error(err.message);
                }
                console.log('Connected to the SQLite database.');
            });

            this._initializeTables();
        } else {
            this.db = new sqlite3.Database(dbName);
        }
    }

    private _initializeTables() {
        this.db.serialize(() => {
            // Create items table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    shellyID TEXT UNIQUE NOT NULL
                )
            `);

            // Create groups table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL
                )
            `);

            // Create many-to-many table to link items to groups
            this.db.run(`
                CREATE TABLE IF NOT EXISTS item_group (
                    item_id INTEGER,
                    group_id INTEGER,
                    PRIMARY KEY (item_id, group_id),
                    FOREIGN KEY (item_id) REFERENCES items(id),
                    FOREIGN KEY (group_id) REFERENCES groups(id)
                )
            `);
        });
    }

    list(): Promise<any> {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT g.name as groupName, i.shellyID
                FROM groups g
                LEFT JOIN item_group ig ON g.id = ig.group_id
                LEFT JOIN items i ON i.id = ig.item_id
            `;

            this.db.all(query, [], (err: any, rows: any[]) => {
                if (err) {
                    reject(err);
                    return;
                }

                const result: { [key: string]: string[] } = {};
                rows.forEach(row => {
                    if (!result[row.groupName]) {
                        result[row.groupName] = [];
                    }
                    result[row.groupName].push(row.shellyID);
                });

                resolve(result);
            });
        });
    }

    async add(shellyID: string, groups: Set<string>): Promise<boolean[]> {
        const results: boolean[] = [];

        // Add shellyID to items table if it doesn't exist
        let itemId: number | null;
        await new Promise((resolve, reject) => {
            const query = `INSERT OR IGNORE INTO items (shellyID) VALUES (?)`;
            this.db.run(query, [shellyID], function (this: any, err: any) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(true);
            });
        });

        // Retrieve the item ID, whether it was just inserted or already existed
        itemId = await this._getItemIdForShellyID(shellyID);

        if (!itemId) {
            throw new Error('Unexpected error: Unable to fetch item ID after insert.');
        }

        // Attempt to add shellyID to each group
        for (let group of groups) {
            await new Promise((resolve, reject) => {
                const query = `
                    INSERT INTO item_group (item_id, group_id) 
                    VALUES (?, (SELECT id FROM groups WHERE name = ?))
                `;

                this.db.run(query, [itemId, group], function (this: any, err: any) {
                    if (err) {
                        if (err.code === 'SQLITE_CONSTRAINT') {
                            // Constraint violation, which means a duplicate mapping.
                            results.push(false);
                            resolve(false);
                        } else {
                            reject(err);
                            return;
                        }
                    } else {
                        results.push(true);
                        resolve(true);
                    }
                });
            });
        }

        return results;
    }

    async remove(shellyID: string, groups: Set<string>): Promise<boolean[]> {
        const results: boolean[] = [];

        // Retrieve the ID for the given shellyID from the items table
        const itemId = await new Promise<number | null>((resolve, reject) => {
            const query = `SELECT id FROM items WHERE shellyID = ?`;
            this.db.get(query, [shellyID], (err: any, row: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row ? row.id : null);
            });
        });

        if (!itemId) {
            // If the shellyID doesn't exist in the items table, then it cannot be removed from any groups
            // Return false for all the groups
            return Array(groups.size).fill(false);
        }

        // Attempt to remove the shellyID from each group
        for (let group of groups) {
            const success = await new Promise<boolean>((resolve) => {
                const query = `
                    DELETE FROM item_group 
                    WHERE item_id = ? AND group_id = (SELECT id FROM groups WHERE name = ?)
                `;

                this.db.run(query, [itemId, group], function (this: any, err: any) {
                    if (err) {
                        resolve(false);
                        return;
                    }

                    // If changes occurred (i.e., deletion was successful), return true. Otherwise, return false.
                    resolve(this.changes > 0);
                });
            });
            results.push(success);
        }

        return results;
    }

    create(name: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const query = `INSERT INTO groups (name) VALUES (?)`;

            this.db.run(query, [name], function (err: any) { // Use a regular function for the callback
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
                        // Unique constraint failed (duplicate group name), return false
                        resolve(false);
                    } else {
                        // Some other error, reject the promise
                        reject(err);
                    }
                    return;
                }

                resolve(true);
            });
        });
    }


    delete(name: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const query = `DELETE FROM groups WHERE name = ?`;

            this.db.run(query, [name], function (this: any, err: any) {
                if (err) {
                    reject(err);
                    return;
                }

                // If changes occurred (i.e., deletion was successful), return true. Otherwise, return false.
                resolve(this.changes > 0);
            });
        });
    }

    rename(oldName: string, newName: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const query = `UPDATE groups SET name = ? WHERE name = ?`;

            this.db.run(query, [newName, oldName], function (this: any, err: any) {
                if (err) {
                    reject(err);
                    return;
                }

                // If changes occurred (i.e., renaming was successful), return true. Otherwise, return false.
                resolve(this.changes > 0);
            });
        });
    }

    async union(groups: string[]): Promise<string[]> {
        let unification = new Set<string>();

        for (let group of groups) {
            const currentShellyIDs = await this._getShellyIDsForGroup(group);
            currentShellyIDs.forEach(shellyID => unification.add(shellyID));
        }

        return [...unification];
    }

    async intersection(groups: string[]): Promise<string[]> {
        if (!groups || groups.length === 0) {
            return [];
        }

        // Fetch shellyIDs for the first group to initialize our common set
        let common = await this._getShellyIDsForGroup(groups[0]);

        // Iterate through the remaining groups and filter out shellyIDs that don't exist in all groups
        for (let i = 1; i < groups.length && common.length > 0; i++) {
            const currentShellyIDs = await this._getShellyIDsForGroup(groups[i]);
            common = common.filter(shellyID => currentShellyIDs.includes(shellyID));
        }

        return common;
    }
    private async _getItemIdForShellyID(shellyID: string): Promise<number | null> {
        return new Promise<number | null>((resolve, reject) => {
            const query = `SELECT id FROM items WHERE shellyID = ?`;
            this.db.get(query, [shellyID], (err: any, row: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row ? row.id : null);
            });
        });
    }

    // Helper function to fetch shellyIDs for a specific group
    private async _getShellyIDsForGroup(groupName: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const query = `
            SELECT i.shellyID
            FROM groups g
            INNER JOIN item_group ig ON g.id = ig.group_id
            INNER JOIN items i ON i.id = ig.item_id
            WHERE g.name = ?
        `;

            this.db.all(query, [groupName], (err: any, rows: any[]) => {
                if (err) {
                    reject(err);
                    return;
                }

                const shellyIDs = rows.map(row => row.shellyID);
                resolve(shellyIDs);
            });
        });
    }
    // Add this method to the SQLiteDriver class

    async getGroupsForShellyID(shellyID: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const query = `
            SELECT g.name
            FROM items i
            INNER JOIN item_group ig ON i.id = ig.item_id
            INNER JOIN groups g ON g.id = ig.group_id
            WHERE i.shellyID = ?
        `;

            this.db.all(query, [shellyID], (err: any, rows: any[]) => {
                if (err) {
                    reject(err);
                    return;
                }

                const groupNames = rows.map(row => row.name);
                resolve(groupNames);
            });
        });
    }

    async enrichJSON(shellyID: string): Promise<string[]> {
        let thisBelongsTo: Set<string> = new Set();

        // Fetch the group names for the given shellyID
        const groupsForShelly = await this.getGroupsForShellyID(shellyID);
        groupsForShelly.forEach(groupName => thisBelongsTo.add(groupName));

        return [...thisBelongsTo];
    }

    close() {
        if (this.db) {
            this.db.close((err: any) => {
                if (err) {
                    console.error('Failed to close SQLite database:', err);
                } else {
                    console.log('SQLite database closed.');
                }
            });
        }
    }

}
