// The text the clipboard gets for some bytes: each as the character BBC BASIC shows it as, which for the control
// codes and 127 to 160 is the one 256 higher, as Owlet takes program text.
export function memoryText(bytes) {
    const counts = new Map();
    let text = "";
    for (let b of bytes) {
        if (b < 32 || (b >= 127 && b < 161)) {
            counts.set(b, (counts.get(b) ?? 0) + 1);
            b += 0x100;
        }
        text += String.fromCodePoint(b);
    }
    return {text, counts};
}
