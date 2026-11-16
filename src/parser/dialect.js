// Which BASIC the parser follows: BASIC II (the Model B's) or BASIC IV (the Master's). The lexer and recogniser read it
// as each line is made, so a change shows in the next line read.
let basicIV = false;

export const isBasicIV = () => basicIV;

export function setBasicIV(enabled) {
    basicIV = Boolean(enabled);
}
