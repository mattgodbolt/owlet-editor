import {basicSaveAddresses} from "./disc-export";
import {makeUEF} from "./UEF";

export const TapeFileName = "TWEET";

/** The exported tape: the tokenised `program` as a real BASIC `SAVE` on `cpu`'s machine would put it on tape. */
export function tapeImage(program, cpu) {
    const {load, exec} = basicSaveAddresses(cpu);
    return makeUEF(TapeFileName, load, exec, program);
}
