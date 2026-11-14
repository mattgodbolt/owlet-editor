// The assembler between [ and ].
export class Assembler {
    constructor(recogniser) {
        this.recogniser = recogniser;
    }

    // Reads assembler statements up to the "]" that ends the block or the end of the line; returns whether the block
    // is still open.
    block() {
        const r = this.recogniser;
        while (!r.is("end")) {
            if (r.next().text === "]") return false;
        }
        return true;
    }
}
