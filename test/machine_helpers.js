import {existsSync} from "node:fs";
import {MachineSession} from "jsbeeb/machine-session";

// Fitted the way Owlet fits it; the ROM is fetched by the Makefile rather than kept in the repository, so a checkout
// without it tests the other machines.
export const GxrRom = "gxr.rom";
export const HasGxr = existsSync(
    new URL(`../node_modules/jsbeeb/public/roms/${GxrRom}`, import.meta.url),
);

// What a real BASIC SAVE writes on each machine Owlet offers: the PAGE it saves from and the exec address's low word.
export const SavingMachines = [
    {
        name: "Model B with the GXR",
        machine: "B",
        extraRoms: [GxrRom],
        page: 0x1c00,
        exec: 0x8023,
        skip: !HasGxr,
    },
    {name: "Model B without the GXR", machine: "B", extraRoms: [], page: 0x1900, exec: 0x8023},
    {name: "Master 128", machine: "Master", extraRoms: [], page: 0x0e00, exec: 0x802b},
];

export async function booted(machine, extraRoms = [], bankRoms = []) {
    const session = new MachineSession(machine, {extraRoms, bankRoms});
    await session.initialise();
    await session.boot();
    return session;
}

export const cpuOf = session => session._machine.processor;
