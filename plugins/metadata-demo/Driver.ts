export default abstract class Driver {

    abstract list(): Promise<JSON>;

    abstract add(shellyID: string, groups: Set<string>): boolean[] | Promise<boolean[]>;

    abstract remove(shellyID: string, groups: Set<string>): boolean[] | Promise<boolean[]>;

    abstract intersection(groups: string[]): any;

    abstract create(name: string): boolean | Promise<boolean>;

    abstract delete(name: string): boolean | Promise<boolean>;

    abstract rename(name: string, newName: string): boolean | Promise<boolean>;

    abstract union(groups: string[]): any;

    abstract enrichJSON(shellyID: string): object | Promise<object>;

    abstract close(): void;

}
