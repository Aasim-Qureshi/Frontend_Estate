const { useEffect, useRef, useState } = require("react");

/**
 * Small helper to persist simple state in localStorage.
 * Values must be JSON serializable; a revive function can massage parsed values.
 */
const usePersistentState = (key, defaultValue, options = {}) => {
    const { revive, storage = "local" } = options;
    const isBrowser = typeof window !== "undefined";
    const storageImpl = (() => {
        if (!isBrowser) return null;
        if (storage === "session" && window.sessionStorage) return window.sessionStorage;
        if (window.localStorage) return window.localStorage;
        return null;
    })();

    const readInitial = () => {
        if (!storageImpl) return defaultValue;
        try {
            const raw = storageImpl.getItem(key);
            if (raw !== null && raw !== undefined) {
                const parsed = JSON.parse(raw);
                return revive ? revive(parsed) : parsed;
            }
        } catch (err) {
            console.warn(`Failed to read persisted state for ${key}`, err);
        }
        return defaultValue;
    };

    const [state, setState] = useState(readInitial);
    const initial = useRef(true);
    const keyRef = useRef(key);

    useEffect(() => {
        if (keyRef.current === key) return;
        keyRef.current = key;
        initial.current = true;
        setState(readInitial());
    }, [key]);

    useEffect(() => {
        if (!storageImpl) return;
        if (initial.current) {
            initial.current = false;
            return;
        }
        try {
            storageImpl.setItem(key, JSON.stringify(state));
        } catch (err) {
            console.warn(`Failed to persist state for ${key}`, err);
        }
    }, [key, state, storageImpl]);

    const reset = () => {
        if (storageImpl) {
            storageImpl.removeItem(key);
        }
        setState(defaultValue);
    };

    return [state, setState, reset];
};

module.exports = usePersistentState;
