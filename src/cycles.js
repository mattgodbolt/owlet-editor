// jsbeeb keeps a CPU's currentCycles within one second, and counts the whole seconds in cycleSeconds.
export const ClocksPerSecond = (2 * 1000 * 1000) | 0;

export function totalCycles(cpu) {
    return cpu.cycleSeconds * ClocksPerSecond + cpu.currentCycles;
}

export function setTotalCycles(cpu, cycles) {
    cpu.cycleSeconds = Math.floor(cycles / ClocksPerSecond);
    cpu.currentCycles = cpu.targetCycles = cycles % ClocksPerSecond;
}
