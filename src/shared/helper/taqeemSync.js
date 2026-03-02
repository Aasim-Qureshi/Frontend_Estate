const TAQEEM_CONFLICT_EVENT = "taqeem-user-conflict";

const emitTaqeemConflict = (detail = {}) => {
    if (typeof window === "undefined" || !window.dispatchEvent) return;
    window.dispatchEvent(new CustomEvent(TAQEEM_CONFLICT_EVENT, { detail }));
};

const extractTaqeemUser = (explicitUser, profileData) => {
    const explicit = String(explicitUser || "").trim();
    if (explicit) return explicit;

    const profileUser = String(
        profileData?.taqeemUser ||
        profileData?.user_id ||
        profileData?.username ||
        ""
    ).trim();

    return profileUser || "";
};

const readUserFromStorage = () => {
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
};

const getCachedUserSnapshot = (cachedUser = null) => {
    if (cachedUser && typeof cachedUser === "object") return cachedUser;
    return readUserFromStorage();
};

const getCachedProfile = (cachedUser = null) => {
    if (!cachedUser || typeof cachedUser !== "object") return null;
    return cachedUser?.taqeem?.profile || cachedUser?.profile || null;
};

const getCachedCompanies = (cachedUser = null) => {
    if (!cachedUser || typeof cachedUser !== "object") return [];
    const nestedCompanies = Array.isArray(cachedUser?.taqeem?.companies)
        ? cachedUser.taqeem.companies
        : [];
    if (nestedCompanies.length > 0) return nestedCompanies;
    return Array.isArray(cachedUser?.companies) ? cachedUser.companies : [];
};

const syncTaqeemSnapshot = async ({
    token,
    taqeemUser = "",
    selectedCompanyOfficeId = null,
    profileData: providedProfile = undefined,
    companies: providedCompanies = undefined,
    cachedUser = null,
    skipProfileFetch = false,
    skipCompaniesFetch = false,
}) => {
    if (!window?.electronAPI?.apiRequest) {
        return { status: "SKIPPED", reason: "apiRequest_unavailable" };
    }

    const userSnapshot = getCachedUserSnapshot(cachedUser);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    let profileData = providedProfile !== undefined ? providedProfile : getCachedProfile(userSnapshot);
    if (!profileData && !skipProfileFetch) {
        try {
            if (window?.electronAPI?.getTaqeemProfile) {
                const profileRes = await window.electronAPI.getTaqeemProfile();
                if (profileRes?.status === "SUCCESS") {
                    profileData = profileRes.data || null;
                }
            }
        } catch (err) {
            profileData = null;
        }
    }

    let companies = Array.isArray(providedCompanies)
        ? providedCompanies
        : getCachedCompanies(userSnapshot);
    if (companies.length === 0 && !skipCompaniesFetch) {
        try {
            if (window?.electronAPI?.getCompanies) {
                const companiesRes = await window.electronAPI.getCompanies();
                if (companiesRes?.status === "SUCCESS" && Array.isArray(companiesRes?.data)) {
                    companies = companiesRes.data;
                }
            }
        } catch (err) {
            companies = [];
        }
    }

    const resolvedTaqeemUser = extractTaqeemUser(taqeemUser, profileData);

    if (!resolvedTaqeemUser) {
        return { status: "SKIPPED", reason: "missing_taqeem_user" };
    }

    const payload = {
        taqeemUser: resolvedTaqeemUser,
        profile: profileData,
        companies,
    };

    if (selectedCompanyOfficeId) {
        payload.selectedCompanyOfficeId = String(selectedCompanyOfficeId);
    }

    try {
        const syncResponse = await window.electronAPI.apiRequest(
            "POST",
            "/api/users/taqeem/sync",
            payload,
            headers,
        );

        if (syncResponse?.status === "TAQEEM_ALREADY_USED") {
            emitTaqeemConflict({
                ...syncResponse,
                taqeemUser: resolvedTaqeemUser,
            });
        }

        return syncResponse;
    } catch (error) {
        const conflictData = error?.response?.data;
        if (conflictData?.status === "TAQEEM_ALREADY_USED") {
            emitTaqeemConflict({
                ...conflictData,
                taqeemUser: resolvedTaqeemUser,
            });
            return conflictData;
        }

        return {
            status: "ERROR",
            message: error?.response?.data?.message || error?.message || "Failed to sync taqeem snapshot",
            error,
        };
    }
};

module.exports = {
    TAQEEM_CONFLICT_EVENT,
    emitTaqeemConflict,
    syncTaqeemSnapshot,
};
