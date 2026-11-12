/**
 * The machines Owlet can run a program on, by jsbeeb's name for each, which is also what a saved or shared state
 * holds in its `model` field. startCycles is how long a machine runs after a reset before the program goes in, past
 * the BASIC prompt: for the Model B it is bbcmicrobot's start time. The OS's keyboard buffer is at &3E0 on both, but
 * its write pointer is not.
 */
export const Machines = {
    B: {
        name: "BBC Micro Model B",
        label: "Model B",
        startCycles: 725000,
        keyboardWritePointer: 0x2e1,
    },
    Master: {
        name: "BBC Master 128",
        label: "Master 128",
        startCycles: 1600000,
        keyboardWritePointer: 0x2e0,
    },
};

export const DefaultMachine = "B";

/** The machine a state asks for; a state from before there was a choice, or one naming no known machine, is a B. */
export function machineOf(state) {
    return Object.hasOwn(Machines, state?.model) ? state.model : DefaultMachine;
}

/** A state holds its machine only when that is not the default, so a Model B link is what it always was. */
export function withMachine(state, machine) {
    return machine === DefaultMachine ? state : {...state, model: machine};
}
