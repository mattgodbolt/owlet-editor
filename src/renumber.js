import {editor, Selection} from "monaco-editor/esm/vs/editor/editor.api";

const LanguageId = "BBCBASIC";
const LineNumberType = `constant.linenum.${LanguageId}`;
const ImplicitLineNumberStep = 10;
const ExplicitLineNumberRegex = /^\s*\d/;

// The line numbers the program refers to, as the tokeniser reads them: {lineNumber, startColumn, endColumn, target},
// where lineNumber is the editor's line and target is the BASIC line number referred to.
export function lineNumberReferences(text) {
    const lines = text.split("\n");
    return editor.tokenize(text, LanguageId).flatMap((lineTokens, index) =>
        lineTokens.flatMap((token, tokenIndex) => {
            // A number at the very start of a line is that line's own number.
            if (token.type !== LineNumberType || token.offset === 0) return [];
            const end =
                tokenIndex + 1 < lineTokens.length
                    ? lineTokens[tokenIndex + 1].offset
                    : lines[index].length;
            return [
                {
                    lineNumber: index + 1,
                    startColumn: token.offset + 1,
                    endColumn: end + 1,
                    target: Number(lines[index].slice(token.offset, end)),
                },
            ];
        }),
    );
}

function renumberEdits(references, oldToNew) {
    return references
        .filter(ref => oldToNew.has(ref.target) && oldToNew.get(ref.target) !== ref.target)
        .map(ref => ({
            range: {
                startLineNumber: ref.lineNumber,
                startColumn: ref.startColumn,
                endLineNumber: ref.lineNumber,
                endColumn: ref.endColumn,
            },
            text: `${oldToNew.get(ref.target)}`,
        }));
}

// The program with each line number it refers to that is in the oldToNew map replaced by the new number.
export function renumberReferences(text, oldToNew) {
    const lines = text.split("\n");
    const edits = renumberEdits(lineNumberReferences(text), oldToNew);
    for (const {range, text: newNumber} of edits.reverse()) {
        const line = lines[range.startLineNumber - 1];
        lines[range.startLineNumber - 1] =
            line.slice(0, range.startColumn - 1) + newNumber + line.slice(range.endColumn - 1);
    }
    return lines.join("\n");
}

function comparePositions(a, b) {
    return a.lineNumber - b.lineNumber || a.column - b.column;
}

// Where a position is once a change is made, or null if the change replaced it. Text inserted at the position goes
// before it, or after it if stickBefore.
function positionAfter(position, {range, text}, stickBefore = false) {
    const start = {lineNumber: range.startLineNumber, column: range.startColumn};
    const end = {lineNumber: range.endLineNumber, column: range.endColumn};
    const fromStart = comparePositions(position, start);
    if (fromStart < 0 || (fromStart === 0 && stickBefore)) return position;
    if (comparePositions(position, end) < 0) return null;
    const inserted = text.split("\n");
    const lastLine = start.lineNumber + inserted.length - 1;
    const lastColumn =
        (inserted.length === 1 ? start.column : 1) + inserted[inserted.length - 1].length;
    if (position.lineNumber === end.lineNumber) {
        return {lineNumber: lastLine, column: lastColumn + position.column - end.column};
    }
    return {lineNumber: position.lineNumber + lastLine - end.lineNumber, column: position.column};
}

// Each change's range is in the text left by the changes before it, as in Monaco's content change events.
function positionAfterAll(position, changes, stickBefore) {
    for (const change of changes) {
        if (!position) return null;
        position = positionAfter(position, change, stickBefore);
    }
    return position;
}

const changesLines = ({range, text}) =>
    range.startLineNumber !== range.endLineNumber || text.includes("\n");
const isImplicit = lines => !lines.some(line => ExplicitLineNumberRegex.test(line));

// The edits that keep a program's line-number references pointing at the same lines when the changes add or remove
// lines and the program has no line numbers, so that its lines are numbered 10, 20, 30... by position. A line is the
// same line while what starts it does, and a reference to a line that no longer is one is left as it is. References
// in the text the changes insert are left as they are.
export function implicitRenumberEdits(oldText, newText, changes) {
    if (!changes.some(changesLines)) return [];
    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");
    if (!isImplicit(oldLines) || !isImplicit(newLines)) return [];

    const oldToNew = new Map();
    oldLines.forEach((line, index) => {
        const start = {lineNumber: index + 1, column: line.length - line.trimStart().length + 1};
        const moved = positionAfterAll(start, changes, false);
        if (moved && newLines[moved.lineNumber - 1].slice(0, moved.column - 1).trim() === "") {
            oldToNew.set(
                (index + 1) * ImplicitLineNumberStep,
                moved.lineNumber * ImplicitLineNumberStep,
            );
        }
    });

    const references = lineNumberReferences(oldText).flatMap(ref => {
        const start = positionAfterAll(
            {lineNumber: ref.lineNumber, column: ref.startColumn},
            changes,
            false,
        );
        const end = positionAfterAll(
            {lineNumber: ref.lineNumber, column: ref.endColumn},
            changes,
            true,
        );
        if (!start || !end || start.lineNumber !== end.lineNumber) return [];
        // Still the same number, not cut into or run together with digits on either side.
        const digits = oldLines[ref.lineNumber - 1].slice(ref.startColumn - 1, ref.endColumn - 1);
        const line = newLines[start.lineNumber - 1];
        const stillThere =
            line.slice(start.column - 1, end.column - 1) === digits &&
            !/\d/.test(line.charAt(start.column - 2)) &&
            !/\d/.test(line.charAt(end.column - 1));
        return stillThere
            ? [
                  {
                      ...ref,
                      lineNumber: start.lineNumber,
                      startColumn: start.column,
                      endColumn: end.column,
                  },
              ]
            : [];
    });
    return renumberEdits(references, oldToNew);
}

// Rewrites the references as lines are added and removed in the editor's program (see implicitRenumberEdits). The
// rewrite joins the edit's own undo step, so undo and redo need nothing from here.
export function followImplicitLineNumbers(codeEditor) {
    const model = codeEditor.getModel();
    let previous = model.getValue();
    return model.onDidChangeContent(event => {
        const oldText = previous;
        previous = model.getValue();
        if (event.isFlush || event.isUndoing || event.isRedoing) return;
        const edits = implicitRenumberEdits(oldText, previous, event.changes);
        if (edits.length === 0) return;
        // Redo puts the cursors where the undo step's last edit, this one, says. The editor moves them for the user's
        // edit only after this, so here they are moved by both edits.
        const cursors = codeEditor
            .getSelections()
            .map(selection =>
                positionAfterAll(
                    selection.getPosition(),
                    [...event.changes, ...[...edits].reverse()],
                    false,
                ),
            );
        const cursorsAfter = cursors.every(Boolean)
            ? cursors.map(
                  ({lineNumber, column}) => new Selection(lineNumber, column, lineNumber, column),
              )
            : null;
        model.pushEditOperations(codeEditor.getSelections(), edits, () => cursorsAfter);
    });
}
