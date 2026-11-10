// What ties the sound chip to a CPU's scheduler. Building a CPU hands the one chip to its scheduler, so a CPU that
// fails to build gives it back to the one still running, whose own tasks go on using these.
export function chipBindings(chip) {
    const {scheduler, lastRunEpoch, activeTask, progressTask} = chip;
    return {scheduler, lastRunEpoch, activeTask, progressTask};
}

export function restoreChipBindings(chip, bindings) {
    Object.assign(chip, bindings);
}
