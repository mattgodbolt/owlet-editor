const ProgramKey = "program";
const MachineKey = "machine";

/**
 * The program, and the machine it runs on, are kept per tab (sessionStorage, which survives a reload and a reopened
 * closed tab) and also as the most recent edit anywhere (localStorage), which is what a brand new tab starts from.
 * Without the per-tab copy, the last keystroke in any tab was what every tab came back with.
 */
function save(key, value) {
    // Nothing has been edited when a tab loads its own back, so that must not become the latest edit.
    if (sessionStorage.getItem(key) === value) return;
    localStorage.setItem(key, value);
    sessionStorage.setItem(key, value);
}

function saved(key) {
    const thisTabs = sessionStorage.getItem(key);
    return thisTabs !== null ? thisTabs : localStorage.getItem(key);
}

export function saveProgram(text) {
    save(ProgramKey, text);
}

export function savedProgram() {
    return saved(ProgramKey);
}

export function saveMachine(machine) {
    save(MachineKey, machine);
}

export function savedMachine() {
    return saved(MachineKey);
}
