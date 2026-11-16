/** Wraps an async function so that each call starts only once the one before it has settled, failed or not. */
export function oneAtATime(fn) {
    let last = Promise.resolve();
    return (...args) => {
        const call = last.then(
            () => fn(...args),
            () => fn(...args),
        );
        last = call;
        return call;
    };
}
