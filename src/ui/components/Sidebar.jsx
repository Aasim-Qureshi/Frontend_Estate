import React from 'react';
import { AppWindow, CircleDot, Wrench, Truck, Loader2, AlertCircle, Home, MonitorDot, Settings, Package, BarChart3, Users, ShieldCheck, Building2, Database, MessageCircle } from 'lucide-react';
import { useSystemControl } from '../context/SystemControlContext';
import { useValueNav } from '../context/ValueNavContext';
import { useSession } from '../context/SessionContext';
import { useNavStatus } from '../context/NavStatusContext';
import navigation from '../constants/navigation';
import { useTranslation } from 'react-i18next';
import { emitTaqeemConflict, syncTaqeemSnapshot } from '../../shared/helper/taqeemSync';

const { valueSystemGroups } = navigation;

const getCompanyIdentity = (company) => {
    if (!company) return '';
    return String(
        company.officeId ||
        company.office_id ||
        company.url ||
        company.id ||
        company.name ||
        ''
    );
};

const Sidebar = ({ currentView, onViewChange }) => {
    const { t } = useTranslation();
    const { isFeatureBlocked, isAdmin } = useSystemControl();
    const { user, isAuthenticated, token, login } = useSession();
    const { taqeemStatus, setTaqeemStatus, setCompanyStatus } = useNavStatus();
    const {
        selectedCard,
        selectedDomain,
        selectedCompany,
        companies,
        loadingCompanies,
        companyError,
        activeGroup,
        setActiveGroup,
        setActiveTab,
        resetNavigation,
        chooseCard,
        chooseDomain,
        ensureCompaniesLoaded,
        autoSelectDefaultCompany,
        replaceCompanies,
        setSelectedCompany,
        syncCompanies
    } = useValueNav();

    const isAppsActive = currentView === 'apps';
    const isSettingsActive = activeGroup === 'settings';
    const settingsBlocked = isFeatureBlocked('settings');
    const ticketsBlocked = isFeatureBlocked('tickets');
    const isCompanyHead = user?.type === 'company' || user?.role === 'company-head';
    const clickDelayMs = 160;
    const delayViewChange = (nextView) => {
        if (!onViewChange) return;
        setTimeout(() => onViewChange(nextView), clickDelayMs);
    };

    const domainButtons = [
        { id: 'real-estate', label: 'Real Estate', icon: Home },
        { id: 'equipments', label: 'Equipment', icon: Truck }
    ];

    const defaultUploadTab = valueSystemGroups.uploadReports?.tabs?.[0]?.id || 'submit-reports-quickly';

    const mainLinks = [
        { id: 'uploadReports', label: 'Upload Reports' },
        { id: 'uploadSingleReport', label: 'Upload Single Report' },
        { id: 'taqeemInfo', label: 'Taqeem Info' },
        { id: 'deleteReport', label: 'Delete Report' },
        { id: 'myReports', label: 'My Reports' }
    ];

    const adminLinks = [
        { id: 'system-status', label: 'System Operating Status', icon: MonitorDot },
        { id: 'system-updates', label: 'System Updates', icon: Wrench },
        { id: 'admin-packages', label: 'Packages', icon: Package },
        { id: 'statics', label: 'Statics', icon: BarChart3 }
    ];

    const companyLinks = [
        { id: 'company-members', label: 'Company Members', icon: Users },
        { id: 'company-statics', label: 'Company Statics', icon: BarChart3 }
    ];

    const dashboardLinks = [
        ...(isCompanyHead ? [{ id: 'company-console', label: 'Company Dashboard', icon: Building2, groupId: 'companyConsole' }] : []),
        ...(isAdmin ? [{ id: 'admin-console', label: 'Super Admin', icon: ShieldCheck, groupId: 'adminConsole' }] : [])
    ];

    const goToSubmitReportsQuickly = async () => {
        // Force the navigation state into Upload Reports -> Submit Reports Quickly
        chooseCard('uploading-reports');
        chooseDomain('equipments');
        setActiveGroup('uploadReports');
        setActiveTab(defaultUploadTab);
        if (onViewChange) {
            onViewChange(defaultUploadTab);
        }

        // Prime companies/default selection in the background
        if (!selectedCompany) {
            (async () => {
                try {
                    const loadedCompanies = await ensureCompaniesLoaded('equipment');
                    await autoSelectDefaultCompany({ skipNavigation: true, companiesList: loadedCompanies });
                } catch (err) {
                    console.warn('Failed to prepare companies for upload reports', err);
                }
            })();
        }
    };

    const ensureGuestSession = async () => {
        if (token) return token;
        if (!window?.electronAPI?.apiRequest) return null;

        try {
            const tokenObj = await window.electronAPI.getToken?.();
            const bearer = tokenObj?.refreshToken || tokenObj?.token;
            const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {};
            const result = await window.electronAPI.apiRequest('POST', '/api/users/guest', {}, headers);
            if (result?.token && result?.userId) {
                const guestUser = result?.user || { id: result.userId, _id: result.userId, guest: true };
                login?.(guestUser, result.token);
                return result.token;
            }
        } catch (err) {
            console.warn('Failed to ensure guest session for Taqeem sync:', err?.message || err);
        }

        return null;
    };

    const handleTaqeemLogin = async () => {
        const waitForManualLogin = async (timeoutMs = 180000, intervalMs = 2000) => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                const res = await window.electronAPI.checkStatus();
                const statusText = String(res?.status || '').toUpperCase();
                const loggedIn = res?.browserOpen && statusText.includes('SUCCESS');
                const notLogged = statusText.includes('NOT_LOGGED_IN');
                if (loggedIn) return res;
                if (!res?.browserOpen && !notLogged) {
                    throw new Error(t('sidebar.company.loginClosed', { defaultValue: 'Login window closed.' }));
                }
                await new Promise((resolve) => setTimeout(resolve, intervalMs));
            }
            throw new Error(t('sidebar.company.loginTimeout', { defaultValue: 'Timed out waiting for Taqeem login.' }));
        };

        try {
            setTaqeemStatus('info', t('sidebar.company.loginStarting', { defaultValue: 'Opening Taqeem login...' }));
            setCompanyStatus('info', t('sidebar.company.loginPrompt', { defaultValue: 'Login to Taqeem to list your companies.' }));
            if (!window?.electronAPI?.openTaqeemLogin) {
                throw new Error(t('sidebar.company.loginUnavailable', { defaultValue: 'Login handler unavailable.' }));
            }
            chooseDomain('equipments');
            const loginResult = await window.electronAPI.openTaqeemLogin({
                automationOnly: true,
                onlyIfClosed: true,
                navigateIfOpen: false
            });
            if (loginResult?.status !== 'SUCCESS') {
                throw new Error(loginResult?.error || t('sidebar.company.loginFailed', { defaultValue: 'Taqeem login failed.' }));
            }

            setTaqeemStatus('info', t('sidebar.company.waitingForLogin', { defaultValue: 'Waiting for you to finish login...' }));
            await waitForManualLogin();

            const activeToken = await ensureGuestSession();
            setCompanyStatus('info', t('sidebar.company.fetching', { defaultValue: 'Fetching companies from Taqeem...' }));

            let snapshot = null;
            if (activeToken) {
                try {
                    snapshot = await syncTaqeemSnapshot({
                        token: activeToken,
                        cachedUser: user || null,
                    });
                } catch (err) {
                    snapshot = null;
                }
            }

            if (snapshot?.status === 'TAQEEM_ALREADY_USED') {
                const message = snapshot?.message || 'This Taqeem user is already linked. Please login with your phone.';
                setTaqeemStatus('error', message);
                setCompanyStatus('error', message);
                emitTaqeemConflict({
                    ...snapshot,
                    taqeemUser:
                        snapshot?.taqeemUser ||
                        user?.taqeemUser ||
                        user?.taqeem?.username ||
                        null,
                });
                return;
            }

            if (snapshot?.user && activeToken) {
                login?.(snapshot.user, activeToken);
            }

            setTaqeemStatus('success', t('sidebar.company.loginSuccess', { defaultValue: 'Taqeem login: On' }));

            const snapshotCompanies = Array.isArray(snapshot?.companies) ? snapshot.companies : [];
            if (snapshotCompanies.length > 0) {
                const prepared = snapshotCompanies.map((c) => ({ ...c, type: c.type || 'equipment' }));
                await replaceCompanies(prepared, { quiet: true, skipNavigation: true, autoSelect: true });
                setCompanyStatus('info', t('sidebar.company.selectToContinue', { defaultValue: 'Select a company to view main links.' }));
                return;
            }

            if (window?.electronAPI?.getCompanies) {
                const data = await window.electronAPI.getCompanies();
                const fetched = Array.isArray(data?.data) ? data.data : Array.isArray(data?.companies) ? data.companies : [];
                if (fetched.length > 0) {
                    const prepared = fetched.map((c) => ({ ...c, type: c.type || 'equipment' }));
                    let synced = prepared;
                    try {
                        const syncedRes = await syncCompanies(prepared, 'equipment');
                        if (Array.isArray(syncedRes) && syncedRes.length > 0) {
                            synced = syncedRes;
                        }
                    } catch (err) {
                        console.warn('Failed to sync companies after Taqeem login', err);
                    }
                    await replaceCompanies(synced, { quiet: true, skipNavigation: true, autoSelect: true });
                    setCompanyStatus('info', t('sidebar.company.selectToContinue', { defaultValue: 'Select a company to view main links.' }));
                } else {
                    setCompanyStatus('error', t('sidebar.company.empty', { defaultValue: 'No companies found.' }));
                }
            }
        } catch (err) {
            setTaqeemStatus('error', err?.message || t('sidebar.company.loginFailed', { defaultValue: 'Taqeem login failed.' }));
            setCompanyStatus('error', err?.message || t('sidebar.company.loginFailed', { defaultValue: 'Taqeem login failed.' }));
            alert(err?.message || t('sidebar.company.loginFailed', { defaultValue: 'Taqeem login failed.' }));
        }
    };

    const renderDomains = () => {
        if (selectedCard !== 'uploading-reports') return null;
        return (
            <div
                className="rounded-lg border border-slate-800/70 bg-slate-900/45 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)] sidebar-animate"
                style={{ animationDelay: '80ms' }}
            >
                <ul className="space-y-1">
                    {domainButtons.map((item, index) => {
                        const Icon = item.icon;
                        const isActive = selectedDomain === item.id;
                        return (
                            <li
                                key={item.id}
                                className="sidebar-animate"
                                style={{ animationDelay: `${120 + index * 40}ms` }}
                            >
                                <button
                                    onClick={async () => {
                                        chooseDomain(item.id);
                                        setActiveGroup(null);

                                        if (item.id === 'real-estate') {
                                            delayViewChange('coming-soon');
                                            return;
                                        }

                                        if (item.id === 'equipments') {
                                            await goToSubmitReportsQuickly();
                                            return;
                                        }

                                        delayViewChange('apps');
                                    }}
                                    className={`group relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all duration-150 ${
                                        isActive
                                            ? 'bg-gradient-to-r from-cyan-600/90 to-blue-600 text-white shadow-[0_8px_20px_rgba(14,116,144,0.35)]'
                                            : 'bg-slate-900/40 text-slate-200 hover:bg-slate-800/70'
                                    }`}
                                >
                                    <span
                                        className={`absolute left-1 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full ${
                                            isActive ? 'bg-cyan-200' : 'bg-transparent group-hover:bg-cyan-300/50'
                                        }`}
                                    />
                                    <Icon className="w-3.5 h-3.5 opacity-90" />
                                    <span className="text-[11px] font-semibold">
                                        {t(`sidebar.domains.${item.id}`, { defaultValue: item.label })}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        );
    };

    const renderCompanyList = () => {
        if (selectedDomain !== 'equipments') return null;
        const showPlaceholder = !selectedCompany && !loadingCompanies && !companyError && (!companies || companies.length === 0);
        const visibleCompanies = companies;
        const hasCompanies = visibleCompanies && visibleCompanies.length > 0;
        const showLoginPrompt = !isAuthenticated || taqeemStatus?.state !== 'success';
        return (
            <div
                className="rounded-lg border border-slate-800/70 bg-slate-900/45 px-2 py-1.5 space-y-1.5 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)] sidebar-animate"
                style={{ animationDelay: '160ms' }}
            >
                {loadingCompanies && (
                    <div className="flex items-center gap-2 text-[10px] text-slate-100 bg-slate-900/70 border border-slate-800 rounded-md px-2 py-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>{t('sidebar.company.loading')}</span>
                    </div>
                )}
                {companyError && (
                    <div className="flex items-center gap-2 text-[10px] text-amber-100 bg-amber-900/40 border border-amber-800 rounded-md px-2 py-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{companyError}</span>
                    </div>
                )}
                {showPlaceholder && (
                    <div className="space-y-2 bg-gradient-to-br from-slate-950/70 via-slate-900/70 to-slate-900/50 border border-slate-800 rounded-md px-2.5 py-2 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)]">
                        {showLoginPrompt && (
                            <>
                                <div className="flex items-start gap-2 rounded-md border border-cyan-400/20 bg-cyan-950/40 px-2 py-1.5 text-[10px] text-cyan-100">
                                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-cyan-200" />
                                    <div className="text-[9px] font-semibold text-cyan-100">
                                        {t('sidebar.company.loginPrompt', { defaultValue: 'Login to Taqeem to list your companies.' })}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleTaqeemLogin}
                                    className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-r from-emerald-500 via-green-500 to-emerald-600 px-3 py-2 text-[10px] font-semibold text-white shadow-[0_12px_24px_rgba(16,185,129,0.35)] hover:from-emerald-400 hover:via-green-400 hover:to-emerald-500 transition-colors"
                                >
                                    {t('sidebar.company.loginButton', { defaultValue: 'Login to Taqeem to get companies' })}
                                </button>
                            </>
                        )}
                        {!showLoginPrompt && (
                            <div className="text-[10px] text-slate-300">
                                {t('sidebar.company.empty')}
                            </div>
                        )}
                    </div>
                )}
                {hasCompanies && (
                    <ul className="space-y-1">
                        {visibleCompanies.map((company, index) => {
                            const isActive = getCompanyIdentity(selectedCompany) === getCompanyIdentity(company);
                            return (
                                <li
                                    key={`${getCompanyIdentity(company) || company.name || 'company'}-${index}`}
                                    className="sidebar-animate"
                                    style={{ animationDelay: `${200 + index * 35}ms` }}
                                >
                                    <button
                                        onClick={async () => {
                                            await setSelectedCompany(company, {
                                                setAsDefault: true,
                                                onlyIfUnset: false,
                                                persistDefault: true
                                            });
                                            setActiveGroup(null);
                                            delayViewChange('apps');
                                        }}
                                        className={`group relative w-full text-left px-2.5 py-1.5 rounded-md flex flex-col gap-0.5 ${
                                            isActive
                                                ? 'bg-cyan-600/25 text-white shadow-[0_8px_20px_rgba(14,116,144,0.2)]'
                                                : 'bg-slate-900/50 text-slate-100 hover:bg-slate-800/80'
                                        }`}
                                    >
                                        <span
                                            className={`absolute left-1 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full ${
                                                isActive ? 'bg-cyan-200' : 'bg-transparent group-hover:bg-cyan-300/50'
                                            }`}
                                        />
                                        <div className="text-[11px] font-semibold truncate">
                                            {company.name || t('sidebar.company.fallback')}
                                        </div>
                                        {company.officeId && (
                                            <div className="text-[9px] text-slate-400">
                                                {t('sidebar.company.office', { officeId: company.officeId })}
                                            </div>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        );
    };

    const renderMainLinks = () => {
        if (selectedDomain !== 'equipments') return null;
        const hasCompanies = companies && companies.length > 0;
        if (hasCompanies && !selectedCompany) {
            return (
                <div
                    className="rounded-lg border border-amber-400/30 bg-amber-900/30 px-3 py-2 text-[11px] text-amber-100 shadow-[inset_0_1px_0_rgba(248,180,0,0.12)] sidebar-animate"
                    style={{ animationDelay: '220ms' }}
                >
                    {t('sidebar.company.selectToContinue', { defaultValue: 'Select a company to view main links.' })}
                </div>
            );
        }
        return (
            <div
                className="rounded-lg border border-slate-800/70 bg-slate-900/45 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)] sidebar-animate"
                style={{ animationDelay: '240ms' }}
            >
                <ul className="space-y-1">
                    {mainLinks.map((item, index) => {
                        const blocked = isFeatureBlocked(item.id);
                        const isActive = activeGroup === item.id;
                        const groupTabs = valueSystemGroups[item.id]?.tabs || [];
                        const firstTab = groupTabs?.[0]?.id;
                        return (
                            <li
                                key={item.id}
                                className="sidebar-animate"
                                style={{ animationDelay: `${280 + index * 35}ms` }}
                            >
                                <button
                                    onClick={() => {
                                        if (blocked) return;
                                        if (item.id === 'uploadReports') {
                                            goToSubmitReportsQuickly();
                                            return;
                                        }
                                        setActiveGroup(item.id);
                                        // Automatically set and navigate to the first tab immediately if it exists
                                        if (firstTab) {
                                            setActiveTab(firstTab);
                                            // Navigate immediately without delay to skip intermediate apps view
                                            if (onViewChange) {
                                                onViewChange(firstTab);
                                            }
                                        } else {
                                            setActiveTab(null);
                                            delayViewChange('apps');
                                        }
                                    }}
                                    disabled={blocked}
                                    className={`group relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all duration-150 text-[11px] ${
                                        isActive
                                            ? 'bg-gradient-to-r from-cyan-600/90 to-blue-600 text-white shadow-[0_8px_20px_rgba(14,116,144,0.35)]'
                                            : 'bg-slate-900/40 text-slate-200 hover:bg-slate-800/70'
                                    } ${blocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <span
                                        className={`absolute left-1 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full ${
                                            isActive ? 'bg-cyan-200' : 'bg-transparent group-hover:bg-cyan-300/50'
                                        }`}
                                    />
                                    <span className="font-medium">
                                        {t(`navigation.groups.${item.id}.title`, {
                                            defaultValue: valueSystemGroups[item.id]?.title || item.label
                                        })}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        );
    };

    const renderEvaluationSourcesLinks = () => {
        if (selectedCard !== 'evaluation-sources') return null;
          const evaluationLinks = [
              { id: 'yalla-motor', label: 'Yalla Motor', icon: Database },
              { id: 'haraj', label: 'Haraj Data', icon: Database },
              { id: 'haraj-scrape', label: 'Haraj Scrape Data', icon: Database },
              { id: 'haraj-data-updated', label: 'Haraj Data Updated', icon: Database },
              { id: 'mobasher-data', label: 'Mobasher Data', icon: Database }
          ];
        return (
            <div
                className="rounded-lg border border-emerald-400/30 bg-gradient-to-br from-emerald-950/35 via-slate-950/60 to-slate-900/70 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(52,211,153,0.08)] sidebar-animate"
                style={{ animationDelay: '240ms' }}
            >
                <div className="px-2 pb-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                    {t('sidebar.evaluationSources.title', { defaultValue: 'Evaluation Sources' })}
                </div>
                <ul className="space-y-1">
                    {evaluationLinks.map((item, index) => {
                        const Icon = item.icon;
                        const blocked = isFeatureBlocked(item.id);
                        const isActive = currentView === item.id || (item.id === 'haraj' && currentView === 'haraj-data');
                        return (
                            <li
                                key={item.id}
                                className="sidebar-animate"
                                style={{ animationDelay: `${280 + index * 35}ms` }}
                            >
                                <button
                                    onClick={() => {
                                        if (blocked) return;
                                        setActiveGroup('evaluationSources');
                                        delayViewChange(item.id);
                                    }}
                                    disabled={blocked}
                                    className={`group relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all duration-150 text-[11px] ${
                                        isActive
                                            ? 'bg-gradient-to-r from-emerald-500/90 to-teal-500 text-white shadow-[0_8px_20px_rgba(16,185,129,0.35)]'
                                            : 'bg-slate-900/40 text-slate-200 hover:bg-slate-800/70'
                                    } ${blocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <span
                                        className={`absolute left-1 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full ${
                                            isActive ? 'bg-emerald-200' : 'bg-transparent group-hover:bg-emerald-300/50'
                                        }`}
                                    />
                                    <Icon className="w-3.5 h-3.5 opacity-90" />
                                    <span className="font-medium">
                                        {t(`navigation.tabs.${item.id}.label`, { defaultValue: item.label })}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        );
    };

    const renderAdminLinks = () => {
        if (!isAdmin || selectedCard !== 'admin-console') return null;
        return (
            <div
                className="rounded-lg border border-amber-400/30 bg-gradient-to-br from-amber-950/40 via-slate-950/60 to-slate-900/70 px-2 py-2 shadow-[inset_0_1px_0_rgba(252,211,77,0.08)] sidebar-animate"
                style={{ animationDelay: '200ms' }}
            >
                <div className="px-2 pb-1 text-[9px] font-semibold uppercase tracking-wide text-amber-200">
                    {t('sidebar.admin.title')}
                </div>
                <ul className="space-y-1">
                    {adminLinks.map((item, index) => {
                        const Icon = item.icon;
                        const blocked = isFeatureBlocked(item.id);
                        const isActive = currentView === item.id;
                        return (
                            <li
                                key={item.id}
                                className="sidebar-animate"
                                style={{ animationDelay: `${240 + index * 35}ms` }}
                            >
                                <button
                                    onClick={() => {
                                        if (blocked) return;
                                        delayViewChange(item.id);
                                    }}
                                    disabled={blocked}
                                    className={`group relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all duration-150 text-[11px] ${
                                        isActive
                                            ? 'bg-gradient-to-r from-amber-500/90 to-orange-500 text-white shadow-[0_8px_20px_rgba(251,146,60,0.35)]'
                                            : 'bg-slate-900/40 text-slate-200 hover:bg-slate-800/70'
                                    } ${blocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <span
                                        className={`absolute left-1 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full ${
                                            isActive ? 'bg-amber-200' : 'bg-transparent group-hover:bg-amber-300/50'
                                        }`}
                                    />
                                    <Icon className="w-3.5 h-3.5 opacity-90" />
                                    <span className="font-medium">
                                        {t(`sidebar.admin.links.${item.id}`, { defaultValue: item.label })}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        );
    };

    const renderCompanyLinks = () => {
        if (!isCompanyHead || selectedCard !== 'company-console') return null;
        return (
            <div
                className="rounded-lg border border-emerald-400/30 bg-gradient-to-br from-emerald-950/35 via-slate-950/60 to-slate-900/70 px-2 py-2 shadow-[inset_0_1px_0_rgba(52,211,153,0.08)] sidebar-animate"
                style={{ animationDelay: '200ms' }}
            >
                <div className="px-2 pb-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                    {t('sidebar.company.title')}
                </div>
                <ul className="space-y-1">
                    {companyLinks.map((item, index) => {
                        const Icon = item.icon;
                        const blocked = isFeatureBlocked(item.id);
                        const isActive = currentView === item.id;
                        return (
                            <li
                                key={item.id}
                                className="sidebar-animate"
                                style={{ animationDelay: `${240 + index * 35}ms` }}
                            >
                                <button
                                    onClick={() => {
                                        if (blocked) return;
                                        delayViewChange(item.id);
                                    }}
                                    disabled={blocked}
                                    className={`group relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all duration-150 text-[11px] ${
                                        isActive
                                            ? 'bg-gradient-to-r from-emerald-500/90 to-teal-500 text-white shadow-[0_8px_20px_rgba(16,185,129,0.35)]'
                                            : 'bg-slate-900/40 text-slate-200 hover:bg-slate-800/70'
                                    } ${blocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <span
                                        className={`absolute left-1 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full ${
                                            isActive ? 'bg-emerald-200' : 'bg-transparent group-hover:bg-emerald-300/50'
                                        }`}
                                    />
                                    <Icon className="w-3.5 h-3.5 opacity-90" />
                                    <span className="font-medium">
                                        {t(`sidebar.company.links.${item.id}`, { defaultValue: item.label })}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        );
    };

    const renderDashboardLinks = () => {
        if (dashboardLinks.length === 0) return null;
        return (
            <div
                className="px-2 py-1.5 sidebar-animate"
                style={{ animationDelay: '260ms' }}
            >
                <div className="px-1 pb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                    {t('sidebar.dashboards.title')}
                </div>
                <div className="space-y-1">
                    {dashboardLinks.map((item, index) => {
                        const Icon = item.icon;
                        const blocked = isFeatureBlocked(item.groupId);
                        const isActive = activeGroup === item.groupId;
                        const groupTabs = valueSystemGroups[item.groupId]?.tabs || [];
                        const firstTab = groupTabs?.[0]?.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => {
                                    if (blocked) return;
                                    chooseCard(item.id);
                                    setActiveGroup(item.groupId);
                                    if (firstTab) {
                                        setActiveTab(firstTab);
                                        if (onViewChange) onViewChange(firstTab);
                                    } else {
                                        if (setActiveTab) setActiveTab(null);
                                        delayViewChange('apps');
                                    }
                                }}
                                disabled={blocked}
                                className={`group relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all duration-150 text-[11px] ${
                                    isActive
                                        ? 'bg-gradient-to-r from-cyan-600/90 to-blue-600 text-white shadow-[0_8px_20px_rgba(14,116,144,0.35)]'
                                        : 'bg-slate-900/50 text-slate-100 hover:bg-slate-800/80'
                                } ${blocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                                style={{ animationDelay: `${300 + index * 35}ms` }}
                            >
                                <span
                                    className={`absolute left-1 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full ${
                                        isActive ? 'bg-cyan-200' : 'bg-transparent group-hover:bg-cyan-300/50'
                                    }`}
                                />
                                <Icon className="w-3.5 h-3.5 opacity-90" />
                                <span className="font-medium">
                                    {t(`sidebar.dashboards.links.${item.groupId}`, { defaultValue: item.label })}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="relative w-[218px] min-w-[218px] h-screen text-white text-[11px] overflow-hidden border-r border-slate-800/80 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/5 to-transparent" />
            <div className="pointer-events-none absolute -left-10 top-16 h-32 w-32 rounded-full bg-cyan-500/20 blur-2xl" />
            <div className="pointer-events-none absolute -right-12 bottom-20 h-32 w-32 rounded-full bg-blue-500/10 blur-2xl" />

            <div className="relative flex h-full flex-col">
                <div
                    className="px-2.5 py-2 border-b border-slate-800/80 bg-slate-950/50 backdrop-blur-sm sidebar-animate"
                    style={{ animationDelay: '0ms' }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-tr from-cyan-300 to-blue-500 shadow-[0_0_12px_rgba(56,189,248,0.45)]" />
                            <div>
                                <h1 className="text-[12px] font-semibold tracking-wide">{t('sidebar.brand.name')}</h1>
                                <p className="text-[9px] text-slate-400 leading-tight">{t('sidebar.brand.subtitle')}</p>
                            </div>
                        </div>
                        <span className="px-1.5 py-0.5 text-[9px] rounded-full border border-cyan-300/30 bg-cyan-900/40 text-cyan-100">
                            {t('sidebar.brand.status')}
                        </span>
                    </div>

                    <div className="mt-1.5 flex gap-1">
                        <button
                            onClick={() => {
                                resetNavigation();
                                chooseCard(null);
                                delayViewChange('apps');
                            }}
                            className={`flex-1 inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-all duration-150 ${
                                isAppsActive
                                    ? 'bg-gradient-to-r from-cyan-600/90 to-blue-600 text-white shadow-[0_8px_20px_rgba(14,116,144,0.35)]'
                                    : 'bg-slate-900/60 text-slate-100 hover:bg-slate-800/80'
                            }`}
                        >
                            <AppWindow className="w-3.5 h-3.5" />
                            <div className="flex flex-col leading-tight">
                                <span className="font-semibold text-[11px]">{t('sidebar.apps.title')}</span>
                                <span className="text-[9px] text-slate-300">{t('sidebar.apps.subtitle')}</span>
                            </div>
                        </button>
                    </div>
                </div>

                <nav className="flex-1 px-2 py-1.5 overflow-y-auto space-y-1.5">
                    {renderDomains()}
                    {renderCompanyList()}
                    {renderCompanyLinks()}
                    {renderAdminLinks()}
                    {renderMainLinks()}
                    {renderEvaluationSourcesLinks()}
                </nav>

                {renderDashboardLinks()}

                <div
                    className="px-2 py-1.5 sidebar-animate"
                    style={{ animationDelay: '300ms' }}
                >
                    <button
                        onClick={() => {
                            if (ticketsBlocked) return;
                            setActiveGroup(null);
                            setActiveTab(null);
                            if (onViewChange) onViewChange('tickets');
                        }}
                        disabled={ticketsBlocked}
                        className={`group relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all duration-150 text-[11px] ${
                            currentView === 'tickets'
                                ? 'bg-gradient-to-r from-cyan-600/90 to-blue-600 text-white shadow-[0_8px_20px_rgba(14,116,144,0.35)]'
                                : 'bg-slate-900/50 text-slate-100 hover:bg-slate-800/80'
                        } ${ticketsBlocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span
                            className={`absolute left-1 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full ${
                                currentView === 'tickets' ? 'bg-cyan-200' : 'bg-transparent group-hover:bg-cyan-300/50'
                            }`}
                        />
                        <MessageCircle className="w-3.5 h-3.5 opacity-90" />
                        <span className="font-medium">{t('sidebar.tickets')}</span>
                    </button>
                    <button
                        onClick={() => {
                            if (settingsBlocked) return;
                            setActiveGroup('settings');
                            const groupTabs = valueSystemGroups.settings?.tabs || [];
                            const firstTab = groupTabs?.[0]?.id;
                            if (firstTab) {
                                setActiveTab(firstTab);
                                if (onViewChange) onViewChange(firstTab);
                            } else {
                                setActiveTab(null);
                                delayViewChange('apps');
                            }
                        }}
                        disabled={settingsBlocked}
                        className={`group relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all duration-150 text-[11px] ${
                            isSettingsActive
                                ? 'bg-gradient-to-r from-cyan-600/90 to-blue-600 text-white shadow-[0_8px_20px_rgba(14,116,144,0.35)]'
                                : 'bg-slate-900/50 text-slate-100 hover:bg-slate-800/80'
                        } ${settingsBlocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span
                            className={`absolute left-1 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full ${
                                isSettingsActive ? 'bg-cyan-200' : 'bg-transparent group-hover:bg-cyan-300/50'
                            }`}
                        />
                        <Settings className="w-3.5 h-3.5 opacity-90" />
                        <span className="font-medium">{t('sidebar.settings')}</span>
                    </button>
                </div>

                <div
                    className="px-2.5 py-1.5 border-t border-slate-800/80 text-[9px] text-slate-400 flex items-center gap-1.5 bg-slate-950/60 sidebar-animate"
                    style={{ animationDelay: '320ms' }}
                >
                    <CircleDot className="w-3 h-3 text-emerald-400" />
                    <span>{t('sidebar.systemOnline')}</span>
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
