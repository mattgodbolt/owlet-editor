const Key = "program";

/**
 * The program is kept per tab (sessionStorage, which survives a reload and a reopened closed tab) and also as the most
 * recent edit anywhere (localStorage), which is what a brand new tab starts from. Without the per-tab copy, the last
 * keystroke in any tab was what every tab came back with.
 */
export function saveProgram(text) {
    // Nothing has been edited when a tab loads its own program back, so that must not become the latest edit.
    if (sessionStorage.getItem(Key) === text) return;
    localStorage.setItem(Key, text);
    sessionStorage.setItem(Key, text);
}

export function savedProgram() {
    const thisTabs = sessionStorage.getItem(Key);
    return thisTabs !== null ? thisTabs : localStorage.getItem(Key);
}
