export function isEmpty(obj:any) {
    for(let key in obj) {
        if(obj.hasOwnProperty(key))
            return false;
    }
    return true;
}

export function isConstructor(f:any) {
    try {
        new f();
    } catch (err) {
        // verify err is the expected error and then
        return false;
    }
    return true;
}

export function isUndefined(obj:any) {
    return obj === undefined;
}