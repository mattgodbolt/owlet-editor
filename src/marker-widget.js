import {editor as monacoEditor} from "monaco-editor/editor/editor.api";
import ResizeObserver from "resize-observer-polyfill";

const MarkerControllerId = "editor.contrib.markerController";
const WidgetChromeLines = 3;

// Monaco sizes the problem widget's view zone from the message's line count, so a message wrapped to the editor's
// width needs the zone resized to match or it covers the code below. This relies on the marker controller's private
// `_widget` and its `computeRequiredHeight` and `_relayout`, as there is no public hook; it does nothing if they go.
export function fitMarkerWidgetToWrappedMessage(editor) {
    let observed = null;
    const resizeObserver = new ResizeObserver(() => {
        const widget = editor.getContribution(MarkerControllerId)?._widget;
        if (!observed || !widget?._relayout) return;
        const message = observed;
        widget.computeRequiredHeight = () =>
            WidgetChromeLines +
            Math.ceil(
                message.offsetHeight / editor.getOption(monacoEditor.EditorOption.lineHeight),
            );
        widget._relayout();
    });
    new MutationObserver(() => {
        const message = editor.getDomNode().querySelector(".marker-widget .message");
        if (message === observed) return;
        if (observed) resizeObserver.unobserve(observed);
        observed = message;
        if (observed) resizeObserver.observe(observed);
    }).observe(editor.getDomNode(), {childList: true, subtree: true});
}
