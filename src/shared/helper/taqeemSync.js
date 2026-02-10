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

const syncTaqeemSnapshot = async ({
    token,
    taqeemUser = "",
    selectedCompanyOfficeId = null,
}) => {
    if (!window?.electronAPI?.apiRequest) {
        return { status: "SKIPPED", reason: "apiRequest_unavailable" };
    }

    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    let profileData = null;
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

    let companies = [];
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
            emitTaqeemConflict(syncResponse);
        }

        return syncResponse;
    } catch (error) {
        const conflictData = error?.response?.data;
        if (conflictData?.status === "TAQEEM_ALREADY_USED") {
            emitTaqeemConflict(conflictData);
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
