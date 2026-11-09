// jsbeeb keeps a CPU's currentCycles within one second, and counts the whole seconds in cycleSeconds.
export function totalCycles(cpu) {
    return cpu.cycleSeconds * cpu.model.cyclesPerSecond + cpu.currentCycles;
}

export function setTotalCycles(cpu, cycles) {
    const {cyclesPerSecond} = cpu.model;
    cpu.cycleSeconds = Math.floor(cycles / cyclesPerSecond);
    cpu.currentCycles = cpu.targetCycles = cycles % cyclesPerSecond;
}
