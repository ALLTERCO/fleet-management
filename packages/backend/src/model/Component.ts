import * as clientWss from "../controller/ws/client";

export default class Component {
    public readonly name: string;
    public readonly shellyID: string;
    private _fields: Record<string, string>;

    constructor(shellyID: string, name: string, fields: Record<string, string> = {}) {
        this.name = name;
        this.shellyID = shellyID;
        this._fields = fields;
    }

    public update(field: string, value: string) {
        this._fields[field] = value;
        clientWss.emitFieldChanged(this.shellyID, this.name, field, value);
    }

    public getFields(){
        return this._fields;
    }
}