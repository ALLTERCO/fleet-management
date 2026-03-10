import * as fs from 'fs';
import * as path from 'path';
import Driver from './Driver';

const FILE_PATH = path.resolve(__dirname, './groups.json');
export let groupsJSON: Record<string, Set<string>> = JSON.parse(
    fs.readFileSync(FILE_PATH, 'utf8') || "{}",
    (key, value) => {
        if (Array.isArray(value)) {
            return new Set(value);
        }
        return value;
    }
);

function editJsonFile() {
    const updatedData = JSON.stringify(groupsJSON, (_key, value) => (value instanceof Set ? [...value] : value), 2);
    fs.writeFileSync(FILE_PATH, updatedData, 'utf8');
}

function addToGroup(shellyID: string, groupToBeAddedTo: string) {
    if (!groupsJSON[groupToBeAddedTo]) {
        createGroup(groupToBeAddedTo)
    }
    try {
        if (!groupsJSON[groupToBeAddedTo].has(shellyID)) {
            groupsJSON[groupToBeAddedTo].add(shellyID);
            editJsonFile()
        }
    } catch (e) {
        groupsJSON[groupToBeAddedTo].add(shellyID);
        editJsonFile()
    }
    if (!groupsJSON[groupToBeAddedTo].has(shellyID)) return false;
    return true;

}

function createGroup(name: string) {
    let groups = new Set(Object.keys(groupsJSON))
    if (!groups.has(name)) {
        groupsJSON[name] = new Set<string>();
        editJsonFile();
        groups = new Set(Object.keys(groupsJSON))
    }
    return groups.has(name); 
}

function deleteGroup(name: string) {
    delete groupsJSON[name];
    editJsonFile();
    let groups = new Set(Object.keys(groupsJSON))

    return !groups.has(name);
}

function removeFromGroup(shellyID: string, groupToBeRemovedFrom: string) {
    if (groupsJSON[groupToBeRemovedFrom].has(shellyID)) {
        groupsJSON[groupToBeRemovedFrom].delete(shellyID);
        editJsonFile()
    }
    return !groupsJSON[groupToBeRemovedFrom].has(shellyID); 
}

export default class JSONDriver extends Driver {
    close(): void {
    }
    list(): any {
        const data = JSON.stringify(groupsJSON, (_key, value) => (value instanceof Set ? [...value] : value), 2)
        return JSON.parse(data);
    }
    add(shellyID: string, groups: Set<string>): boolean[] {
        let successRate: boolean[] = [];
        for (let group of groups) {
            successRate.push(addToGroup(shellyID, group));
        }
        return successRate;
    }
    remove(shellyID: string, groups: Set<string>): boolean[] {
        let successRate: boolean[] = [];
        for (let group of groups) {
            successRate.push(removeFromGroup(shellyID, group));
        }
        return successRate;
    }
    intersection(groups: string[]): string[] {
        let common = new Set<string>();
        for (let i = 0; i < groups.length; i++) {
            if (i != 0) {
                common = new Set([...common].filter(element => groupsJSON[groups[i]].has(element)));
            } else {
                common = new Set([...groupsJSON[groups[i]]].filter(element => groupsJSON[groups[i + 1]].has(element)));
            }
        }
        return [...common];
    }
    create(name: string): boolean {
        return createGroup(name);
    }
    delete(name: string): boolean {
        return deleteGroup(name);
    }
    rename(name: string, newName: string): boolean {
        let groups = new Set(Object.keys(groupsJSON))
        if (!groups.has(newName) && groups.has(name)) {
            groupsJSON[newName] = groupsJSON[name];
            deleteGroup(name);
        }
        if (!groups.has(newName) || groups.has(name)) {
            return false;
        }

        return true;
    }
    union(groups: string[]): string[] {
        let unification = new Set<string>();
        for (let i = 0; i < groups.length; i++) {
            if (i != 0) {
                unification = new Set([...unification, ...new Set(groupsJSON[groups[i]])]);
            } else {
                unification = new Set(groupsJSON[groups[i]]);
            }
        }
        return [...unification];
    }
    enrichJSON(shellyID: string) {
        const groups = Object.keys(groupsJSON);
        let thisBelongsTo: string[] = [];
        groups.forEach((group: string) => {
            if (groupsJSON[group].has(shellyID)) {
                thisBelongsTo.push(group);
            }
        })
        return thisBelongsTo;
    }
}