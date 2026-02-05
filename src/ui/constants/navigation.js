// Centralized navigation/link registry for the Value Tech experience.
// This keeps all view labels and groupings in one place so the sidebar, layout,
// and the new Apps hub stay in sync.
const valueSystemGroups = {
    evaluationSources: {
        id: 'evaluationSources',
        title: 'Evaluation Sources',
        tabs: [
            {
                id: 'word-copy',
                label: 'Word Copy',
                description: 'Duplicate Word report templates, optionally append images, and generate batch outputs.'
            },
            {
                id: 'valuation-system',
                label: 'Valuation System',
                description: 'Create valuation folders, calculations, and report files from the valuation system.'
            },
            {
                id: 'haraj',
                label: 'Haraj Data',
                description: 'Access and manage Haraj scraped data with advanced filtering and professional table display.'
            },
            {
                id: 'haraj-scrape',
                label: 'Haraj Scrape Data',
                description: 'New Haraj scrape dataset with tags, pricing filters, and detailed modal insights.'
            },
            {
                id: 'haraj-data-updated',
                label: 'Haraj Data Updated',
                description: 'Updated Haraj ads feed with backend filters, comments, and phone visibility.'
            },
            {
                id: 'mobasher-data',
                label: 'Mobasher Data',
                description: 'Explore Mobasher ads with brand/model/year/fuel filters and detail insights.'
            },
            {
                id: 'yalla-motor',
                label: 'Yalla Motor Link',
                description: 'Filter Yalla Motor listings, inspect scraped headers, and link back to the source.'
            }
        ]
    },
    uploadReports: {
        id: 'uploadReports',
        title: 'Upload Reports',
        tabs: [
            {
                id: 'submit-reports-quickly',
                label: 'Submit Reports Quickly',
                description: 'Quickly submit reports with minimal data entry using Excel sheets.'
            },
            {
                id: 'upload-assets',
                label: 'Upload Assets',
                description: 'Upload asset files and attach them to existing reports.'
            },
            {
                id: 'multi-excel-upload',
                label: 'Multi-Excel Upload',
                description: 'Upload multiple Excel files and create reports in bulk.'
            },
            {
                id: 'duplicate-report',
                label: 'Upload Manual Report',
                description: 'Fill report info, upload Excel assets, and send to Taqeem.'
            },
            {
                id: 'upload-report-elrajhi',
                label: 'Upload Report (El Rajhi)',
                description: 'Upload El Rajhi reports, validate data, and process batches.'
            }
        ]
    },
    uploadSingleReport: {
        id: 'uploadSingleReport',
        title: 'Upload Single Report',
        tabs: [
            { id: 'macro-edit', label: 'Edit Macro', description: 'Edit macro values and update report fields.' },
            { id: 'grab-macro-ids', label: 'Grab Macro IDs', description: 'Fetch macro IDs from reports for processing.' },
            { id: 'common-fields', label: 'Add Common Fields', description: 'Add shared fields to a report in one step.' },
            { id: 'upload-excel', label: 'Upload Excel', description: 'Upload a single Excel report file.' },
            { id: 'asset-create', label: 'Create Asset', description: 'Create report assets from uploaded data.' },
            { id: 'validate-report', label: 'Validate Report', description: 'Validate report data before submission.' }
        ]
    },
    taqeemInfo: {
        id: 'taqeemInfo',
        title: 'Taqeem Info',
        tabs: [
            { id: 'taqeem-login', label: 'Taqeem Login', description: 'Authenticate and connect to the Taqeem system.' },
            { id: 'get-companies', label: 'Get Companies', description: 'Fetch and sync your companies from Taqeem.' },
            { id: 'check-status', label: 'Check Browser', description: 'Check the browser status for Taqeem automation.' }
        ]
    },
    companyConsole: {
        id: 'companyConsole',
        title: 'Company Dashboard',
        tabs: [
            { id: 'company-members', label: 'Company Members', description: 'Manage team accounts and permissions.' },
            { id: 'company-statics', label: 'Company Statics', description: 'Track user and report activity for your company.' }
        ]
    },
    settings: {
        id: 'settings',
        title: 'Settings',
        tabs: [
            { id: 'profile', label: 'Profile', description: 'Manage your profile, password, and account details.' },
            { id: 'packages', label: 'Packages', description: 'Review and manage packages and subscriptions.' }
        ]
    },
    deleteReport: {
        id: 'deleteReport',
        title: 'Delete Assets / Reports',
        tabs: [
            { id: 'delete-report', label: 'Delete Assets / Reports', description: 'Delete reports and related assets safely.' }
        ]
    },
    myReports: {
        id: 'myReports',
        title: 'My Reports',
        tabs: [
            { id: 'my-reports', label: 'My Reports', description: 'Get Your All Reports At One place.' }
        ]
    },
    adminConsole: {
        id: 'adminConsole',
        title: 'Super Admin Console',
        tabs: [
            { id: 'system-status', label: 'System Operating Status', description: 'Monitor and control system availability.' },
            { id: 'system-updates', label: 'System Updates', description: 'Publish and manage system update releases.' },
            { id: 'admin-packages', label: 'Packages', description: 'Manage packages and subscriptions.' },
            { id: 'statics', label: 'Statics', description: 'Review system-wide statistics and activity.' }
        ]
    }
};

const valueSystemCards = [
    {
        id: 'uploading-reports',
        title: 'Uploading Reports',
        description: 'Upload, validate, and manage valuation reports across domains.',
        groups: ['uploadReports', 'uploadSingleReport', 'taqeemInfo', 'settings', 'deleteReport', 'myReports']
    },
    {
        id: 'evaluation-sources',
        title: 'Evaluation Sources',
        description: 'Manage valuation sources, reports, and supporting tools.',
        groups: ['evaluationSources']
    },
    {
        id: 'company-console',
        title: 'Company Dashboard',
        description: 'Team members, access, and company statics in one hub.',
        groups: ['companyConsole'],
        defaultGroup: 'companyConsole'
    },
    {
        id: 'admin-console',
        title: 'Super Admin',
        description: 'System controls, updates, packages, and live statics in one command center.',
        groups: ['adminConsole'],
        defaultGroup: 'adminConsole'
    }
];

const viewTitles = {
    apps: 'Apps',
    'upload-report-elrajhi': 'Upload Report (El Rajhi)',
    'duplicate-report': 'Upload Manual Report',
    'multi-excel-upload': 'Multi-Excel Upload',
    'submit-reports-quickly': 'Submit Reports Quickly',
    'macro-edit': 'Edit Macro',
    'grab-macro-ids': 'Grab Macro IDs',
    'common-fields': 'Add Common Fields',
    'upload-excel': 'Upload Excel',
    'asset-create': 'Create Asset',
    'validate-report': 'Validate Report',
    'taqeem-login': 'Taqeem Login',
    'get-companies': 'Get Companies',
    'check-status': 'Check Browser',
    'company-members': 'Company Members',
    'company-statics': 'Company Statics',
    profile: 'Profile',
    packages: 'Packages',
    tickets: 'Contact technical support',
    'admin-packages': 'Packages',
    'valuation-system': 'Valuation System',
    'word-copy': 'Word Copy',
    'haraj': 'Haraj',
    'haraj-data': 'Haraj Data',
    'haraj-scrape': 'Haraj Scrape Data',
    'haraj-data-updated': 'Haraj Data Updated',
    'mobasher-data': 'Mobasher Data',
    'yalla-motor': 'Yalla Motor',
    'delete-report': 'Delete Assets / Reports',
    'my-reports': 'My Reports',
    'system-status': 'System Operating Status',
    'system-updates': 'System Updates',
    statics: 'Statics',
    'coming-soon': 'Coming Soon'
};

const allValueSystemViews = [
    ...Object.values(valueSystemGroups).flatMap((group) => group.tabs.map((tab) => tab.id))
];

const isValueSystemView = (viewId) => allValueSystemViews.includes(viewId);

// Helper maps to lookup group and tab metadata by tab id
const tabToGroup = allValueSystemViews.reduce((acc, tabId) => {
    const groupEntry = Object.values(valueSystemGroups).find((g) =>
        g.tabs.some((t) => t.id === tabId)
    );
    if (groupEntry) acc[tabId] = groupEntry.id;
    return acc;
}, {});

const findTabInfo = (tabId) => {
    for (const group of Object.values(valueSystemGroups)) {
        const tab = group.tabs.find((t) => t.id === tabId);
        if (tab) {
            return { groupId: group.id, groupTitle: group.title, tab };
        }
    }
    return null;
};

module.exports = {
    valueSystemGroups,
    valueSystemCards,
    viewTitles,
    allValueSystemViews,
    isValueSystemView,
    tabToGroup,
    findTabInfo
};
