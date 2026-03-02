const { emitTaqeemConflict, syncTaqeemSnapshot } = require("./taqeemSync");

const CACHED_SNAPSHOT_SYNC_INTERVAL_MS = 3 * 60 * 1000;
let lastCachedSnapshotSyncSignature = "";
let lastCachedSnapshotSyncAt = 0;

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

function extractTaqeemUsernameFromUser(userData = null) {
    if (!userData || typeof userData !== "object") return "";
    const username =
        userData?.taqeemUser ||
        userData?.taqeem?.username ||
        userData?.username ||
        userData?.taqeem?.profile?.taqeemUser ||
        userData?.taqeem?.profile?.user_id ||
        userData?.taqeem?.profile?.username ||
        "";
    return String(username || "").trim();
}

function readUserFromStorage() {
    if (typeof window === "undefined") return null;

    const storageCandidates = [window.sessionStorage, window.localStorage].filter(Boolean);
    for (const storage of storageCandidates) {
        try {
            const raw = storage.getItem("user");
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                return parsed;
            }
        } catch (err) {
            // ignore invalid/blocked storage and continue fallback lookup
        }
    }

    return null;
}

function resolveCachedUser(cachedUser = null) {
    if (cachedUser && typeof cachedUser === "object") return cachedUser;
    return readUserFromStorage();
}

function getCachedSnapshot(cachedUser = null) {
    const userData = resolveCachedUser(cachedUser);
    const profile =
        userData?.taqeem?.profile ||
        userData?.profile ||
        null;
    const companies = Array.isArray(userData?.taqeem?.companies)
        ? userData.taqeem.companies
        : Array.isArray(userData?.companies)
            ? userData.companies
            : [];
    const taqeemUser = extractTaqeemUsernameFromUser(userData) || extractTaqeemUsername(profile);
    return {
        user: userData,
        profile,
        companies,
        taqeemUser,
    };
}

async function maybeSyncCachedSnapshot({
    token,
    cachedUser,
    selectedCompanyOfficeId = null,
}) {
    if (!token) return null;

    const snapshot = getCachedSnapshot(cachedUser);
    if (!snapshot.taqeemUser) return null;
    if (!snapshot.profile && (!Array.isArray(snapshot.companies) || snapshot.companies.length === 0)) {
        return null;
    }

    const signature = [
        snapshot.taqeemUser,
        String(selectedCompanyOfficeId || ""),
        String(Array.isArray(snapshot.companies) ? snapshot.companies.length : 0),
        snapshot.profile ? "1" : "0",
    ].join("|");

    const now = Date.now();
    if (
        signature === lastCachedSnapshotSyncSignature &&
        now - lastCachedSnapshotSyncAt < CACHED_SNAPSHOT_SYNC_INTERVAL_MS
    ) {
        return { status: "SKIPPED", reason: "cached_snapshot_recent" };
    }

    const syncResult = await syncTaqeemSnapshot({
        token,
        taqeemUser: snapshot.taqeemUser,
        selectedCompanyOfficeId,
        profileData: snapshot.profile,
        companies: snapshot.companies,
        cachedUser: snapshot.user,
        skipProfileFetch: true,
        skipCompaniesFetch: true,
    });

    if (syncResult?.status === "SYNCED") {
        lastCachedSnapshotSyncSignature = signature;
        lastCachedSnapshotSyncAt = now;
    }

    return syncResult;
}

async function verifyCurrentTaqeemOwnership({
    token,
    login,
    setTaqeemStatus,
    redirectToSystemLogin,
    cachedUser = null,
}) {
    if (!token || !window?.electronAPI?.apiRequest) {
        return null;
    }

    const cachedSnapshot = getCachedSnapshot(cachedUser);
    let taqeemUser = cachedSnapshot.taqeemUser || "";

    // Fallback only when cache is missing. This avoids re-scraping profile on every action.
    if (!taqeemUser && window?.electronAPI?.getTaqeemProfile) {
        try {
            const profileRes = await window.electronAPI.getTaqeemProfile();
            if (profileRes?.status === "SUCCESS") {
                taqeemUser = extractTaqeemUsername(profileRes?.data || {});
            }
        } catch (err) {
            taqeemUser = "";
        }
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
            emitTaqeemConflict({
                ...bootstrapResponse,
                taqeemUser,
            });
            const conflictReason = String(bootstrapResponse?.reason || "").toUpperCase();
            if (conflictReason === "SYSTEM_LOGIN_REQUIRED") {
                setTaqeemStatus?.("success", "Taqeem login: On");
            } else {
                setTaqeemStatus?.("error", bootstrapResponse?.message || "Taqeem account is already linked.");
            }
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
            emitTaqeemConflict({
                ...payload,
                taqeemUser,
            });
            const conflictReason = String(payload?.reason || "").toUpperCase();
            if (conflictReason === "SYSTEM_LOGIN_REQUIRED") {
                setTaqeemStatus?.("success", "Taqeem login: On");
            } else {
                setTaqeemStatus?.("error", payload?.message || "Taqeem account is already linked.");
            }
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
    cachedUser = null,
    selectedCompanyOfficeId = null,
}) {
    const cachedSnapshot = getCachedSnapshot(cachedUser);
    const fallbackTaqeemUser = String(cachedSnapshot?.taqeemUser || "").trim();

    const loginFlow = await runPublicLogin(false);
    if (loginFlow?.status !== "CHECK") {
        return loginFlow;
    }

    // Manual login in browser was completed successfully.
    // Keep the toggle ON even if we still need a system account login.
    setTaqeemStatus?.("success", "Taqeem login: On");

    const resolvedTaqeemUser = String(
        loginFlow?.user_id || fallbackTaqeemUser || ""
    ).trim();
    if (!resolvedTaqeemUser) {
        const conflictPayload = {
            status: "TAQEEM_ALREADY_USED",
            reason: "SYSTEM_LOGIN_REQUIRED",
            message:
                "This Taqeem username is already used before. Please login to the system with your phone number.",
            taqeemUser: fallbackTaqeemUser || null,
        };
        emitTaqeemConflict(conflictPayload);
        setTaqeemStatus?.("success", "Taqeem login: On");
        return conflictPayload;
    }

    const handleConflict = (payload = {}) => {
        const conflictReason = String(payload?.reason || "").toUpperCase();
        emitTaqeemConflict({
            ...payload,
            taqeemUser:
                payload?.taqeemUser ||
                payload?.username ||
                resolvedTaqeemUser ||
                null,
        });
        if (conflictReason === "SYSTEM_LOGIN_REQUIRED") {
            setTaqeemStatus?.("success", "Taqeem login: On");
        } else {
            setTaqeemStatus?.("error", payload?.message || "Taqeem account is already linked.");
        }
        return payload;
    };

    const bootstrapHeaders = currentToken
        ? { Authorization: `Bearer ${currentToken}` }
        : {};

    let bootstrapResponse = null;
    try {
        bootstrapResponse = await window.electronAPI.apiRequest(
            "POST",
            "/api/users/new-bootstrap",
            { username: resolvedTaqeemUser },
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
        taqeemUser: resolvedTaqeemUser,
        selectedCompanyOfficeId,
        profileData: cachedSnapshot.profile,
        companies: cachedSnapshot.companies,
        cachedUser: cachedSnapshot.user,
        skipProfileFetch: Boolean(cachedSnapshot.profile),
        skipCompaniesFetch: Array.isArray(cachedSnapshot.companies) && cachedSnapshot.companies.length > 0,
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
        taqeemUser: resolvedTaqeemUser,
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
        cachedUser = null,
        selectedCompanyOfficeId = null,
    } = options || {};

    const userSnapshot = resolveCachedUser(cachedUser);
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
                    cachedUser: userSnapshot,
                    selectedCompanyOfficeId,
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
                cachedUser: userSnapshot,
            });
            if (ownership?.status === "TAQEEM_ALREADY_USED") {
                return ownership;
            }

            const cachedSync = await maybeSyncCachedSnapshot({
                token,
                cachedUser: userSnapshot,
                selectedCompanyOfficeId,
            });
            if (cachedSync?.status === "TAQEEM_ALREADY_USED") {
                return cachedSync;
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
                cachedUser: userSnapshot,
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
                cachedUser: userSnapshot,
                selectedCompanyOfficeId,
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
                cachedUser: userSnapshot,
                selectedCompanyOfficeId,
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
            const cachedSync = await maybeSyncCachedSnapshot({
                token,
                cachedUser: userSnapshot,
                selectedCompanyOfficeId,
            });
            if (cachedSync?.status === "TAQEEM_ALREADY_USED") {
                return cachedSync;
            }
            setTaqeemStatus?.("success", "Taqeem login: On");
            return true;
        }

        onViewChange?.("taqeem-login");
        return false;
    } catch (err) {
        const conflictData = err?.response?.data;
        if (conflictData?.status === "TAQEEM_ALREADY_USED") {
            emitTaqeemConflict({
                ...conflictData,
                taqeemUser:
                    conflictData?.taqeemUser ||
                    conflictData?.username ||
                    extractTaqeemUsernameFromUser(userSnapshot) ||
                    null,
            });
            const conflictReason = String(conflictData?.reason || "").toUpperCase();
            if (conflictReason === "SYSTEM_LOGIN_REQUIRED") {
                setTaqeemStatus?.("success", "Taqeem login: On");
            } else {
                setTaqeemStatus?.("error", conflictData?.message || "Taqeem account is already linked.");
            }
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
