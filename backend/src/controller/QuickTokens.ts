const tokens = new Map<string, string>();

function randomId(offset = 1): string{
    let id = (Date.now() + offset).toString(36);
    if(tokens.has(id)){
        return randomId(offset*2);
    }
    return id;
}

export function generateToken(permission: string){
    const id = randomId();
    tokens.set(id, permission);
    return id;
}

export function useToken(id: string){
    const permission = tokens.get(id);
    if(permission == undefined) return false;
    tokens.delete(id);
    return permission;
}