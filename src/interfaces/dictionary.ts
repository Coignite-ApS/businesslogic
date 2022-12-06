interface Dictionary<K extends string | number | symbol, V> {
    getKeys(): K[];
    getValues(): V[];
    get(key: K): V | null;
    put(key: K, val: V): void; // or boolean?
}
