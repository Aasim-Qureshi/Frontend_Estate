const { emitTaqeemConflict, syncTaqeemSnapshot } = require("./taqeemSync");

async function runPublicLogin(isAuth) {
    try {
        const loginFlow = await window.electronAPI.publicLogin(isAuth);

        if (!loginFlow || loginFlow.status === "FAILED") {
            return { status: "FAILED", error: loginFlow?.error || "Unknown login failure" };
        }

        return loginFlow;
    } catch (err) {
        console.error("Login failed:", err);
        return { status: "FAILED", error: err.message };
    }
}

function buildLoginPayloadFromResponse(response = {}) {
    if (response?.user && typeof response.user === "object") {
        return response.user;
    }

    const userId = response?.userId || response?.id || null;
    return {
        _id: userId,
        id: userId,
        guest: response?.guest !== false,
        taqeemUser: response?.taqeemUser || null,
    };
}

function extractTaqeemUsername(profileData = {}) {
    const username =
        profileData?.taqeemUser ||
        profileData?.user_id ||
        profileData?.username ||
        profileData?.fields?.username ||
        "";
    return String(username || "").trim();
}

async function verifyCurrentTaqeemOwnership({
    token,
    login,
    setTaqeemStatus,
    redirectToSystemLogin,
}) {
    if (!token || !window?.electronAPI?.apiRequest || !window?.electronAPI?.getTaqeemProfile) {
        return null;
    }

    let taqeemUser = "";
    try {
        const profileRes = await window.electronAPI.getTaqeemProfile();
        if (profileRes?.status === "SUCCESS") {
            taqeemUser = extractTaqeemUsername(profileRes?.data || {});
        }
    } catch (err) {
        taqeemUser = "";
    }

    if (!taqeemUser) {
        return null;
    }

    try {
        const bootstrapResponse = await window.electronAPI.apiRequest(
            "POST",
            "/api/users/new-bootstrap",
            { username: taqeemUser },
            { Authorization: `Bearer ${token}` },
        );

        if (bootstrapResponse?.status === "TAQEEM_ALREADY_USED") {
            emitTaqeemConflict(bootstrapResponse);
            setTaqeemStatus?.("error", bootstrapResponse?.message || "Taqeem account is already linked.");
            redirectToSystemLogin(true);
            return bootstrapResponse;
        }

        if (bootstrapResponse?.token && typeof login === "function") {
            const loginPayload = buildLoginPayloadFromResponse(bootstrapResponse);
            login(loginPayload, bootstrapResponse.token);
        }

        return bootstrapResponse;
    } catch (error) {
        const payload = error?.response?.data;
        if (payload?.status === "TAQEEM_ALREADY_USED") {
            emitTaqeemConflict(payload);
            setTaqeemStatus?.("error", payload?.message || "Taqeem account is already linked.");
            redirectToSystemLogin(true);
            return payload;
        }
        return null;
    }
}

async function bootstrapAndSync({
    currentToken,
    login,
    setTaqeemStatus,
    redirectToSystemLogin,
}) {
    const handleConflict = (payload = {}) => {
        emitTaqeemConflict(payload);
        setTaqeemStatus?.("error", payload?.message || "Taqeem account is already linked.");
        redirectToSystemLogin(true);
        return payload;
    };

    const loginFlow = await runPublicLogin(false);
    if (loginFlow?.status !== "CHECK") {
        return loginFlow;
    }

    const bootstrapHeaders = currentToken
        ? { Authorization: `Bearer ${currentToken}` }
        : {};

    let bootstrapResponse = null;
    try {
        bootstrapResponse = await window.electronAPI.apiRequest(
            "POST",
            "/api/users/new-bootstrap",
            { username: loginFlow.user_id },
            bootstrapHeaders,
        );
    } catch (error) {
        const payload = error?.response?.data;
        if (payload?.status === "TAQEEM_ALREADY_USED") {
            return handleConflict(payload);
        }
        throw error;
    }

    if (bootstrapResponse?.status === "TAQEEM_ALREADY_USED") {
        return handleConflict(bootstrapResponse);
    }

    const resolvedToken = bootstrapResponse?.token || currentToken || null;

    if (resolvedToken && typeof login === "function") {
        const loginPayload = buildLoginPayloadFromResponse(bootstrapResponse);
        login(loginPayload, resolvedToken);
    }

    const syncResult = await syncTaqeemSnapshot({
        token: resolvedToken,
        taqeemUser: loginFlow.user_id,
    });

    if (syncResult?.status === "TAQEEM_ALREADY_USED") {
        return handleConflict(syncResult);
    }

    if (syncResult?.status === "SYNCED" && resolvedToken && typeof login === "function") {
        const syncUser = syncResult?.user || buildLoginPayloadFromResponse(bootstrapResponse);
        login(syncUser, resolvedToken);
    }

    setTaqeemStatus?.("success", "Taqeem login: On");

    return {
        status: "AUTHORIZED",
        token: resolvedToken,
        userId: bootstrapResponse?.userId || syncResult?.userId || null,
        taqeemUser: loginFlow.user_id,
        bootstrap: bootstrapResponse,
        sync: syncResult,
    };
}

async function ensureTaqeemAuthorized(
    token,
    onViewChange,
    isTaqeemLoggedIn,
    assetCount = 0,
    login = null,
    setTaqeemStatus = null,
    options = {}
) {
    const {
        allowLoginRedirect = true,
        isGuest = false,
        guestAccessEnabled,
    } = options || {};

    const suppressSystemRedirect = isGuest && guestAccessEnabled !== undefined;
    const canRedirect = allowLoginRedirect && typeof onViewChange === "function";

    const redirectToSystemLogin = (force = false) => {
        if (canRedirect && (force || !suppressSystemRedirect)) {
            onViewChange("login");
        }
    };

    const redirectToRegistration = () => {
        if (canRedirect && !suppressSystemRedirect) {
            onViewChange("registration");
        }
    };

    try {
        let browserStatus = null;
        let browserStatusFailed = false;

        if (window?.electronAPI?.checkStatus) {
            try {
                browserStatus = await window.electronAPI.checkStatus();
            } catch (err) {
                browserStatusFailed = true;
            }
        }

        const browserStatusCode = String(browserStatus?.status || "").toUpperCase();
        const browserConfirmedLoggedIn = Boolean(
            browserStatus?.browserOpen && browserStatusCode.includes("SUCCESS")
        );
        const browserExplicitlyNotLoggedIn = Boolean(
            browserStatus?.browserOpen && browserStatusCode.includes("NOT_LOGGED_IN")
        );

        if (browserConfirmedLoggedIn) {
            if (!token) {
                const result = await bootstrapAndSync({
                    currentToken: null,
                    login,
                    setTaqeemStatus,
                    redirectToSystemLogin,
                });

                if (result?.status === "TAQEEM_ALREADY_USED") {
                    return result;
                }

                if (result?.status === "FAILED") {
                    setTaqeemStatus?.("info", "Taqeem login: Off");
                }

                return result;
            }

            const ownership = await verifyCurrentTaqeemOwnership({
                token,
                login,
                setTaqeemStatus,
                redirectToSystemLogin,
            });
            if (ownership?.status === "TAQEEM_ALREADY_USED") {
                return ownership;
            }

            setTaqeemStatus?.("success", "Taqeem login: On");
            return true;
        }

        if (browserExplicitlyNotLoggedIn) {
            setTaqeemStatus?.("info", "Taqeem login: Off");
        }

        if ((browserStatusFailed || !browserStatus) && isTaqeemLoggedIn) {
            const ownership = await verifyCurrentTaqeemOwnership({
                token,
                login,
                setTaqeemStatus,
                redirectToSystemLogin,
            });
            if (ownership?.status === "TAQEEM_ALREADY_USED") {
                return ownership;
            }
            setTaqeemStatus?.("success", "Taqeem login: On");
            return true;
        }

        if (!token) {
            const result = await bootstrapAndSync({
                currentToken: null,
                login,
                setTaqeemStatus,
                redirectToSystemLogin,
            });

            if (result?.status === "TAQEEM_ALREADY_USED") {
                return result;
            }

            if (result?.status === "FAILED") {
                setTaqeemStatus?.("info", "Taqeem login: Off");
            }

            return result;
        }

        const authStatus = await window.electronAPI.apiRequest(
            "POST",
            "/api/users/authorize",
            { assetCount },
            { Authorization: `Bearer ${token}` },
        );

        if (authStatus?.status === "INSUFFICIENT_POINTS") {
            return authStatus;
        }

        if (authStatus?.status === "LOGIN_REQUIRED") {
            setTaqeemStatus?.("info", "Taqeem login: Off");
            redirectToSystemLogin();
            return authStatus;
        }

        const needsFreshTaqeemLogin =
            authStatus?.status === "AUTHORIZED" &&
            (browserExplicitlyNotLoggedIn || (!browserConfirmedLoggedIn && !isTaqeemLoggedIn));

        if (needsFreshTaqeemLogin) {
            const result = await bootstrapAndSync({
                currentToken: token,
                login,
                setTaqeemStatus,
                redirectToSystemLogin,
            });

            if (result?.status === "TAQEEM_ALREADY_USED") {
                return result;
            }

            if (result?.status === "FAILED") {
                setTaqeemStatus?.("info", "Taqeem login: Off");
            }

            return result;
        }

        if (authStatus?.status === "AUTHORIZED") {
            setTaqeemStatus?.("success", "Taqeem login: On");
            return true;
        }

        onViewChange?.("taqeem-login");
        return false;
    } catch (err) {
        const conflictData = err?.response?.data;
        if (conflictData?.status === "TAQEEM_ALREADY_USED") {
            emitTaqeemConflict(conflictData);
            setTaqeemStatus?.("error", conflictData?.message || "Taqeem account is already linked.");
            redirectToSystemLogin(true);
            return conflictData;
        }

        if (String(err?.message || "").includes("403")) {
            setTaqeemStatus?.("info", "Taqeem login: Off");
            redirectToRegistration();
            return false;
        }

        setTaqeemStatus?.("info", "Taqeem login: Off");
        onViewChange?.("taqeem-login");
        return false;
    }
}

module.exports = { ensureTaqeemAuthorized };
