export default class Snapshot {
    constructor() {}
    load(state, processor) {
        function copyRegion(data, startAddr, endAddr) {
            for (let i = startAddr; i <= endAddr; i++) {
                processor.writemem(i, data.charCodeAt(i));
            }
        }
        const data = window.atob(state.RAM);
        const registers = state.CPU6502;
        const flags = registers.F;

        copyRegion(data, 0x0000, 0x7fff);

        processor.pc = registers.PC;
        processor.a = registers.A;
        processor.s = registers.S;
        processor.x = registers.X;
        processor.y = registers.Y;

        processor.p.n = flags.indexOf("N") !== -1;
        processor.p.v = flags.indexOf("V") !== -1;
        processor.p.d = flags.indexOf("D") !== -1;
        processor.p.i = flags.indexOf("I") !== -1;
        processor.p.z = flags.indexOf("Z") !== -1;
        processor.p.c = flags.indexOf("C") !== -1;

        // write CRTC registers
        for (let r = 0; r < 17; r++) {
            processor.writemem(0xfe00, r);
            processor.writemem(0xfe01, state.CRTC[r]);
        }

        // write ULA control reg
        processor.writemem(0xfe20, state.ULAcontrol);

        // write ULA Palette - see https://beebwiki.mdfs.net/Video_ULA
        for (let p = 0; p < 16; p++) {
            processor.writemem(
                0xfe21,
                (p << 4) | (~state.ULApalette[p] & 0b00000111) | (state.ULApalette[p] & 0b00001000)
            );
        }
    }

    save(processor) {
        function copyRegion(startAddr, endAddr) {
            let out = "";
            for (let i = startAddr; i <= endAddr; i++) {
                let b = processor.readmem(i);
                out += String.fromCharCode(b);
            }
            return out;
        }

        let state = {};

        const mem = copyRegion(0x0000, 0x7fff);
        state.RAM = btoa(mem);
        state.CPU6502 = {};
        state.CPU6502.PC = processor.pc;
        state.CPU6502.A = processor.a;
        state.CPU6502.S = processor.s;
        state.CPU6502.X = processor.x;
        state.CPU6502.Y = processor.y;

        let flags = "";
        if (processor.p.n) flags += "N";
        if (processor.p.v) flags += "V";
        if (processor.p.d) flags += "D";
        if (processor.p.i) flags += "I";
        if (processor.p.z) flags += "Z";
        if (processor.p.c) flags += "C";
        state.CPU6502.F = flags;

        // CRTC registers
        state.CRTC = [];
        for (let r = 0; r < 17; r++) {
            state.CRTC.push(processor.video.regs[r]);
        }

        // write ULA control reg
        state.ULAcontrol = processor.readmem(0x248);

        // write ULA Palette - see https://beebwiki.mdfs.net/Video_ULA
        state.ULApalette = [];
        for (let p = 0; p < 16; p++) {
            let pal =
                (~processor.video.actualPal[p] & 0b00000111) |
                (processor.video.actualPal[p] & 0b00001000);
            state.ULApalette.push(pal);
        }

        let sampleBytes = new Int8Array(1024 * 32);
        for (let i = 0; i <= 0x7fff; i++) {
            sampleBytes[i] = mem.charCodeAt(i);
        }

        // var downloadSnapshot = (function () {
        //     var a = document.createElement("a");
        //     document.body.appendChild(a);
        //     a.style = "display: none";
        //     return function (data, name) {
        //         var blob = new Blob(data, {type: "octet/stream"}),
        //             url = window.URL.createObjectURL(blob);
        //         a.href = url;
        //         a.download = name;
        //         a.click();
        //         window.URL.revokeObjectURL(url);
        //     };
        // }());
        //
        // downloadSnapshot ([JSON.stringify(state)], 'BbcMicro-snapshot.json');

        return {
            state,
        };
    }
}
