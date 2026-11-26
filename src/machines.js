/**
 * The machines Owlet can run a program on, by jsbeeb's name for each, which is also what a saved or shared state
 * holds in its `model` field. startCycles is how long a machine runs after a reset before the program goes in, past
 * the BASIC prompt: for the Model B it is bbcmicrobot's start time. The OS's keyboard buffer is at &3E0 on both, but
 * its write pointer is not.
 */
export const Machines = {
    B: {
        label: "Model B",
        startCycles: 725000,
        keyboardWritePointer: 0x2e1,
    },
    Master: {
        label: "Master 128",
        startCycles: 1600000,
        keyboardWritePointer: 0x2e0,
    },
};

export const DefaultMachine = "B";

/**
 * What the machine menu offers. A choice is a machine plus whether the Model B has the GXR ROM fitted; the GXR is
 * hardware, not a dialect, and the Master's own graphics extension is built in. Its keys are the saved and shared
 * names of the choices: "B" and "Master" are jsbeeb's, as they always were, and the Model B without the GXR is the only
 * other, so that a state or saved choice from before it was offered means what it did.
 */
export const NoGxr = "B-no-GXR";
export const Choices = {
    B: {machine: "B", gxr: true},
    [NoGxr]: {machine: "B", gxr: false},
    Master: {machine: "Master", gxr: true},
};

export function labelOf(choice) {
    const {machine, gxr} = Choices[choice];
    return `${Machines[machine].label}${gxr ? "" : " (no GXR)"}`;
}

/** The machine a state asks for; a state from before there was a choice, or one naming no known machine, is a B. */
export function machineOf(state) {
    return Object.hasOwn(Machines, state?.model) ? state.model : DefaultMachine;
}

/** The menu choice a state asks for; the GXR is only left off by a Model B state that says `gxr: false`. */
export function choiceOf(state) {
    const machine = machineOf(state);
    return machine === "B" && state?.gxr === false ? NoGxr : machine;
}

/** The choice a saved choice names, which is a Model B with the GXR when it names none this version knows. */
export function choiceNamed(name) {
    return Object.hasOwn(Choices, name) ? name : DefaultMachine;
}

/** The choice for a machine and whether its GXR is fitted. */
export function choiceFor(machine, gxr) {
    return machine === "B" && !gxr ? NoGxr : machine;
}

/**
 * A state holds its machine only when that is not the default, and `gxr: false` only when the GXR is left off, so a
 * link made for a Model B or a Master is what it always was. An Owlet from before the choice reads a link without the
 * GXR as a Model B with it.
 */
export function withMachine(state, choice) {
    const {machine, gxr} = Choices[choice];
    const withModel = machine === DefaultMachine ? state : {...state, model: machine};
    return gxr ? withModel : {...withModel, gxr: false};
}

/** The query suffix that tells an export site which machine to run, left out for a Model B as its links always were. */
export function modelQuery(machine) {
    return machine === DefaultMachine ? "" : `&model=${machine}`;
}
