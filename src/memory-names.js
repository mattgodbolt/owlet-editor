// The numbers a memory expression can name, from BASIC's workspace as jsbeeb reads it.
import {readPointers, readResidentIntegers, readVariables} from "jsbeeb/src/basic-state";

const ResidentName = /^[A-Z]%$/;

/** A function giving the number of `PAGE`, `TOP`, `HIMEM`, `LOMEM`, `A%` to `Z%` or any variable, from `peek`. */
export function basicNames(peek) {
    const pointers = readPointers(peek);
    const named = new Map([
        ["PAGE", pointers.page],
        ["TOP", pointers.top],
        ["HIMEM", pointers.himem],
        ["LOMEM", pointers.lomem],
    ]);
    // Every resident integer exists, as 0 until written; others only once the program has made them.
    for (const {name, value} of readResidentIntegers(peek))
        if (ResidentName.test(name)) named.set(name, Number(value));
    for (const {name, value} of readVariables(peek).variables)
        if (!name.endsWith("$") && !name.endsWith(")")) named.set(name, Number(value));
    return name => named.get(name);
}
