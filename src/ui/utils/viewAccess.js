const SUPER_ADMIN_PHONE = '000';

const UPLOAD_SINGLE_REPORT_VIEW_IDS = [
    'macro-edit',
    'grab-macro-ids',
    'common-fields',
    'upload-excel',
    'asset-create',
    'validate-report'
];

const ADMIN_ONLY_VIEW_IDS = new Set([
    'upload-report-elrajhi',
    ...UPLOAD_SINGLE_REPORT_VIEW_IDS
]);

const isSuperAdminUser = (user) => String(user?.phone || '').trim() === SUPER_ADMIN_PHONE;

const canAccessView = (viewId, user) => {
    if (!viewId) return true;
    if (!ADMIN_ONLY_VIEW_IDS.has(viewId)) return true;
    return isSuperAdminUser(user);
};

const canAccessGroup = (groupId, user) => {
    if (groupId === 'uploadSingleReport') {
        return isSuperAdminUser(user);
    }
    return true;
};

const filterTabsByAccess = (tabs = [], user) =>
    (Array.isArray(tabs) ? tabs : []).filter((tab) => canAccessView(tab?.id, user));

const getFirstAccessibleTabId = (tabs = [], user) =>
    filterTabsByAccess(tabs, user)[0]?.id || null;

export {
    SUPER_ADMIN_PHONE,
    UPLOAD_SINGLE_REPORT_VIEW_IDS,
    ADMIN_ONLY_VIEW_IDS,
    isSuperAdminUser,
    canAccessView,
    canAccessGroup,
    filterTabsByAccess,
    getFirstAccessibleTabId
};
