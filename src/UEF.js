// Takes data and returns a Acorn Data Cassette in UEF format

// http://beebwiki.mdfs.net/CRC-16
function crc16(d) {
    const poly = 0x1021;
    let crc = 0x0000;
    for (let num = 0; num < d.length; num++) {
        let c = typeof d === "string" ? d.charCodeAt(num) & 0xff : d[num] & 0xff;
        crc = crc ^ (c << 8);
        for (let i = 0; i < 8; i++) {
            crc = crc << 1; /* rotate */
            if (crc & 0x10000) {
                /* bit 15 was set (now bit 16)... */
                crc = (crc ^ poly) & 0xffff;
            } /* XOR with XMODEM polynomic */
        }
    }

    crc = ((crc << 8) & 0xff00) | (crc >> 8);
    return crc;
}

Array.prototype.add = function (d, l) {
    if (l) {
        for (let b = 0; b < l; b++) {
            this.push(d & 0xff);
            d >>= 8;
        }
    } else {
        for (let a = 0; a < d.length; a++) {
            let c = typeof d === "string" ? d.charCodeAt(a) & 0xff : d[a] & 0xff;
            this.push(c);
        }
    }
};

function makeAcornBlock(filename, loadAddress, execAddress, payload, blockNumber, eof) {
    let block = [];

    // header
    block.add(0x2a, 1); // One synchronisation byte (&2A).
    block.add(filename); // File name (one to ten characters).
    block.add(0x00, 1); // One end of file name marker byte (&00).
    block.add(loadAddress, 4); // Load address of file, four bytes, low byte first.
    block.add(execAddress, 4); // Execution address of file, four bytes, low byte first.
    block.add(blockNumber, 2); // Block number, two bytes, low byte first.
    block.add(payload.length, 2); // Data block length, two bytes, low byte first.
    block.add(eof ? 1 << 7 : 0, 1); // Block flag (Bit 7), one byte.
    block.add(0, 4); // Spare, four bytes, currently &00.
    let headerCRC = crc16(block.slice(1, block.length));
    block.add(headerCRC, 2); // CRC on header, two bytes.

    // data
    block.add(payload);
    let dataCRC = crc16(payload);
    block.add(dataCRC, 2); // CRC on data, two bytes.
    return block;
}

export function makeUEF(filename, loadAddress, execAddress, payload) {
    let UEF = [];
    let blockNumber = 0;
    let blockStart = 0;

    UEF.add("UEF File!");
    UEF.add([0, 0, 0], 3);

    UEF.add(0x0110, 2); // carrier tone
    UEF.add(2, 4); // chunk length
    UEF.add(1500, 2); // chunk length

    while (blockStart < payload.length - 1) {
        let EOF = false;
        let blockEnd = blockStart + 255;

        if (blockEnd >= payload.length - 1) {
            blockEnd = payload.length - 1;
            EOF = true;
        }

        let blockData = payload.slice(blockStart, blockEnd + 1);

        let block = makeAcornBlock(filename, loadAddress, execAddress, blockData, blockNumber, EOF);

        UEF.add(0x0110, 2); // carrier tone
        UEF.add(2, 4); // chunk length
        UEF.add(600, 2); // chunk length

        UEF.add(0x0100, 2); // data block
        UEF.add(block.length, 4); // chunk length
        UEF.add(block); // block data

        blockStart = blockEnd + 1;
        blockNumber++;
    }

    UEF.add(0x0110, 2); // carrier tone
    UEF.add(2, 4); // chunk length
    UEF.add(1500, 2); // chunk length
    UEF.add(0x0110, 2); // carrier tone
    UEF.add(2, 4); // chunk length
    UEF.add(1500, 2); // chunk length

    return UEF;
}
