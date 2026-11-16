import {MarkerSeverity} from "monaco-editor/esm/vs/editor/editor.api";

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

// What the status line says of the markers: `syntax` and `lineNumbers` are the problem markers of the program (a
// warning-severity syntax marker is a line that is unfinished), `warnings` those about the way things are written.
export function problemCount({syntax, lineNumbers, warnings}) {
    const errors = [...syntax, ...lineNumbers].filter(
        marker => marker.severity === MarkerSeverity.Error,
    ).length;
    const unfinished =
        syntax.length - syntax.filter(marker => marker.severity === MarkerSeverity.Error).length;
    return [
        errors && plural(errors, "error"),
        unfinished && `${unfinished} unfinished`,
        warnings.length && plural(warnings.length, "warning"),
    ]
        .filter(Boolean)
        .join(", ");
}
