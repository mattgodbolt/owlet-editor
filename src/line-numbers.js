import {MarkerSeverity} from "monaco-editor/editor/editor.api";
import {ModelBDialect} from "./parser/dialect";
import {ImplicitLineNumberStep, lineNumberTokens} from "./renumber";

const MaxLineNumber = 32767;
// BASIC looks the number up when it runs these; LIST, DELETE, AUTO and RENUMBER take numbers that need not be lines, and
// TRACE's is a limit.
const LookedUpBy = new Set(["GOTO", "GOSUB", "THEN", "ELSE", "RESTORE"]);
// THEN and ELSE give Syntax error for a number above MaxLineNumber, where the others look it up and say No such line.
const SyntaxErrorAbove = new Set(["THEN", "ELSE"]);
// Verified on the BBC BASIC II and Master ROMs: GOTO, GOSUB, RESTORE and TRACE keep the bottom 16 bits of a number up to
// 2147483647 and say Too big above that.
const WrapsAt = 65536;
const TooBigAt = 2147483648;

const tooBig = `BASIC cannot have line numbers above ${MaxLineNumber}`;

function marker(lineNumber, startColumn, endColumn, message) {
    return {
        severity: MarkerSeverity.Error,
        message,
        startLineNumber: lineNumber,
        startColumn,
        endLineNumber: lineNumber,
        endColumn,
    };
}

// The markers for line numbers that cannot be right: those above 32767, which end the program where they are, and
// references to lines the program does not have. The line the cursor (`cursorLine`) is on is still being typed, so a
// reference on it is not marked as missing.
export function getLineNumberMarkers(text, cursorLine = 0, dialect = ModelBDialect) {
    const lines = text.split("\n");
    const tokens = lineNumberTokens(text, dialect);
    const ownNumbers = new Map(
        tokens.filter(token => token.own).map(token => [token.lineNumber, token]),
    );
    const markers = [];
    const existing = new Set();
    let ended = false;
    lines.forEach((line, index) => {
        const content = line.trim();
        if (content === "") return;
        const lineNumber = index + 1;
        const own = ownNumbers.get(lineNumber);
        const number = own ? own.target : lineNumber * ImplicitLineNumberStep;
        if (number > MaxLineNumber) {
            if (own) {
                markers.push(
                    marker(
                        lineNumber,
                        own.startColumn,
                        own.endColumn,
                        `Line number ${number} is too big: ${tooBig}, and the program ends at the first line that has one (BASIC: Syntax error if typed in)`,
                    ),
                );
            } else if (!ended) {
                const start = line.length - line.trimStart().length + 1;
                markers.push(
                    marker(
                        lineNumber,
                        start,
                        start + content.length,
                        `This line would be numbered ${number}: ${tooBig}, so the program ends before it and BASIC will never run it`,
                    ),
                );
            }
            ended = true;
        } else if (!ended) {
            existing.add(number);
        }
    });
    for (const {lineNumber, startColumn, endColumn, target, own, keyword} of tokens) {
        const looksUp = LookedUpBy.has(keyword);
        if (own || !(looksUp || keyword === "TRACE")) continue;
        if (target >= TooBigAt) {
            markers.push(
                marker(
                    lineNumber,
                    startColumn,
                    endColumn,
                    `Line number ${target} is too big (BASIC: Too big)`,
                ),
            );
        } else if (target >= WrapsAt && !SyntaxErrorAbove.has(keyword)) {
            markers.push(
                marker(
                    lineNumber,
                    startColumn,
                    endColumn,
                    `Line number ${target} is too big: BASIC keeps only the bottom 16 bits of it, so it means ${target % WrapsAt}`,
                ),
            );
        } else if (target > MaxLineNumber && looksUp) {
            const error = SyntaxErrorAbove.has(keyword) ? "Syntax error" : "No such line";
            markers.push(
                marker(
                    lineNumber,
                    startColumn,
                    endColumn,
                    `There cannot be a line ${target}: ${tooBig} (BASIC: ${error})`,
                ),
            );
        } else if (
            looksUp &&
            target <= MaxLineNumber &&
            !existing.has(target) &&
            lineNumber !== cursorLine
        ) {
            markers.push(
                marker(
                    lineNumber,
                    startColumn,
                    endColumn,
                    `No line ${target} (BASIC: No such line)`,
                ),
            );
        }
    }
    return markers.sort(
        (a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn,
    );
}
