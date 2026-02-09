import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import navigation from '../constants/navigation';
import { useSession } from './SessionContext';
import { useTranslation } from 'react-i18next';
import { useNavStatus } from './NavStatusContext';
import usePersistentState from '../hooks/usePersistentState';

const { valueSystemCards, valueSystemGroups, findTabInfo } = navigation;

const ValueNavContext = createContext(null);

export const useValueNav = () => {
    const ctx = useContext(ValueNavContext);
    if (!ctx) {
        throw new Error('useValueNav must be used within ValueNavProvider');
    }
    return ctx;
};

const findCardForGroup = (groupId) =>
    valueSystemCards.find((card) => Array.isArray(card.groups) && card.groups.includes(groupId));

const repairMojibake = (value) => {
    if (!value || typeof value !== 'string') return value;
    if (!/[\u00c3\u00c2\u00d8\u00d9]/.test(value)) return value;
    try {
        const bytes = Uint8Array.from(value, (ch) => ch.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
    } catch (err) {
        return value;
    }
};

const normalizeCompany = (company) => {
    if (!company) return company;
    const fixedName = repairMojibake(company.name);
    if (fixedName === company.name) return company;
    return { ...company, name: fixedName };
};

const getCompanyKey = (company) => {
    if (!company) return '';
    const officeId = company.officeId || company.office_id;
    if (officeId !== undefined && officeId !== null) {
        return String(officeId);
    }
    return company.url || company.id || company.name || '';
};

const resolvePreferredCompanyStorageKey = (user, isGuest) => {
    const identifier =
        user?.phone ||
        user?.id ||
        user?._id ||
        user?.userId ||
        user?.user?._id ||
        null;
    if (identifier) {
        return `nav:preferred-company-url:${identifier}`;
    }
    if (isGuest) {
        return 'nav:preferred-company-url:guest';
    }
    return 'nav:preferred-company-url:anonymous';
};

export const ValueNavProvider = ({ children }) => {
    const { user, token, isGuest } = useSession();
    const { t } = useTranslation();
    const { taqeemStatus, setCompanyStatus, setTaqeemStatus } = useNavStatus();
    const [selectedCard, setSelectedCard] = useState(null);
    const [selectedDomain, setSelectedDomain] = useState(null);
    const [selectedCompany, setSelectedCompanyState] = usePersistentState('nav:selected-company', null, {
        storage: 'session',
        revive: (value) => normalizeCompany(value)
    });
    const preferredCompanyStorageKey = useMemo(
        () => resolvePreferredCompanyStorageKey(user, isGuest),
        [isGuest, user]
    );
    const [preferredCompanyKey, setPreferredCompanyKey] = usePersistentState(preferredCompanyStorageKey, '', {
        storage: 'local'
    });
    const [companies, setCompanies] = useState([]);
    const companiesRef = useRef(companies);
    const [loadingCompanies, setLoadingCompanies] = useState(false);
    const [companyError, setCompanyError] = useState('');
    const [activeGroup, setActiveGroup] = useState(null);
    const [activeTab, setActiveTab] = useState(null);
    const [companySyncDone, setCompanySyncDone] = useState(false);
    const [autoLoadedCompanies, setAutoLoadedCompanies] = useState(false);
    const [initialDefaultApplied, setInitialDefaultApplied] = useState(false);

    useEffect(() => {
        companiesRef.current = companies;
    }, [companies]);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.localStorage) return;
        if (!user && !isGuest) return;
        if (preferredCompanyKey) return;
        const legacyKey = 'nav:preferred-company-url';
        try {
            const raw = window.localStorage.getItem(legacyKey);
            if (raw === null || raw === undefined) return;
            const parsed = JSON.parse(raw);
            if (!parsed) return;
            setPreferredCompanyKey(String(parsed));
            window.localStorage.removeItem(legacyKey);
        } catch (err) {
            // ignore legacy migration errors
        }
    }, [isGuest, preferredCompanyKey, setPreferredCompanyKey, user]);

    const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);
    const preferredCompanyMatches = useCallback((company) => {
        if (!preferredCompanyKey || !company) return false;
        const candidates = [
            getCompanyKey(company),
            company.url,
            company.id,
            company.officeId,
            company.office_id,
            company.name
        ]
            .filter((value) => value !== undefined && value !== null && value !== '')
            .map((value) => String(value));
        return candidates.includes(String(preferredCompanyKey));
    }, [preferredCompanyKey]);

    const preferredCompany = useMemo(() => {
        if (!preferredCompanyKey) return null;
        const match = companies.find((c) => preferredCompanyMatches(c));
        return match ? normalizeCompany(match) : null;
    }, [companies, preferredCompanyKey, preferredCompanyMatches]);

    const getCardLabel = useCallback(
        (cardId) => {
            const card = valueSystemCards.find((c) => c.id === cardId);
            return t(`navigation.cards.${cardId}.title`, { defaultValue: card?.title || cardId });
        },
        [t]
    );

    const getDomainLabel = useCallback(
        (domainId) => {
            const fallbacks = {
                'real-estate': 'Real Estate',
                equipments: 'Equipment'
            };
            return t(`sidebar.domains.${domainId}`, { defaultValue: fallbacks[domainId] || domainId });
        },
        [t]
    );

    const normalizeCompanyList = useCallback((payload) => {
        if (!payload) return [];
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload.data)) return payload.data;
        if (Array.isArray(payload.items)) return payload.items;
        if (Array.isArray(payload.results)) return payload.results;
        if (Array.isArray(payload?.data?.data)) return payload.data.data;
        return [];
    }, []);

    const resetNavigation = useCallback(() => {
        setSelectedCard(null);
        setSelectedDomain(null);
        setActiveGroup(null);
        setActiveTab(null);
    }, []);

    const resetAll = useCallback(() => {
        resetNavigation();
        setSelectedCompanyState(null);
        setCompanies([]);
        setCompanyError('');
        setAutoLoadedCompanies(false);
        setInitialDefaultApplied(false);
    }, [resetNavigation, setSelectedCompanyState]);

    const chooseCard = useCallback((cardId) => {
        setSelectedCard(cardId);
        setSelectedDomain(null);
        setActiveGroup(null);
        setActiveTab(null);
    }, []);

    const chooseDomain = useCallback((domainId) => {
        setSelectedDomain(domainId);
        setActiveGroup(null);
        setActiveTab(null);
    }, []);

    const loadSavedCompanies = useCallback(async (type = 'equipment') => {
        if (!window?.electronAPI?.apiRequest) {
            setCompanyError(t('navigation.companyFetchUnavailable'));
            return [];
        }
        if (!user) {
            setCompanies([]);
            setCompanyError('');
            return [];
        }
        if (!token) {
            setCompanyError('');
            return companiesRef.current || [];
        }

        setLoadingCompanies(true);
        setCompanyError('');
        try {
            const res = await window.electronAPI.apiRequest('GET', `/api/companes/me?type=${type}`, {}, authHeaders);
            const list = normalizeCompanyList(res).map(normalizeCompany);
            const current = companiesRef.current || [];
            if (list.length > 0 || current.length > 0) {
                setCompanies(list);
            }
            return list;
        } catch (err) {
            const msg = err?.response?.data?.message || err?.message || t('navigation.loadCompaniesFailed');
            setCompanyError(msg);
            return [];
        } finally {
            setLoadingCompanies(false);
        }
    }, [authHeaders, normalizeCompanyList, t, token, user]);

    const syncCompanies = useCallback(async (items = [], defaultType = 'equipment') => {
        if (!window?.electronAPI?.apiRequest) {
            throw new Error(t('navigation.companySyncUnavailable'));
        }
        if (!user) {
            throw new Error(t('navigation.loginRequiredToSaveCompanies'));
        }

        const payload = {
            companies: items.map((item) => ({
                ...item,
                type: item.type || defaultType
            }))
        };

        const res = await window.electronAPI.apiRequest('POST', '/api/companes/sync', payload, authHeaders);
        const list = normalizeCompanyList(res);
        // refresh from backend to reflect normalization and any merging
        const fresh = await loadSavedCompanies(defaultType);
        if (fresh.length === 0 && list.length > 0) {
            setCompanies(list);
        }
        return list;
    }, [authHeaders, loadSavedCompanies, normalizeCompanyList, t, user]);

    useEffect(() => {
        if (user) {
            loadSavedCompanies();
        } else {
            setCompanies([]);
            setCompanyError('');
            setAutoLoadedCompanies(false);
        }
    }, [user, loadSavedCompanies]);

    useEffect(() => {
        if (taqeemStatus?.state === 'success' && user && (!companies || companies.length === 0)) {
            loadSavedCompanies(selectedDomain || 'equipment');
        }
    }, [companies, loadSavedCompanies, selectedDomain, taqeemStatus?.state, user]);

    useEffect(() => {
        if (taqeemStatus?.state !== 'success') {
            return;
        }
        if (!window?.electronAPI?.checkStatus) return;
        let cancelled = false;

        const heartbeat = async () => {
            if (cancelled) return;
            try {
                const res = await window.electronAPI.checkStatus();
                const browserClosed = res?.browserOpen === false || String(res?.status || '').toUpperCase().includes('CLOSED');
                const notLogged = String(res?.status || '').toUpperCase().includes('NOT_LOGGED_IN');
                if (browserClosed || notLogged) {
                    setTaqeemStatus('info', 'Taqeem login: Off');
                    setCompanyStatus('info', t('layout.status.companyDefault', { defaultValue: 'No company selected' }));
                } else if (res?.browserOpen && String(res?.status || '').toUpperCase().includes('SUCCESS')) {
                    setTaqeemStatus('success', 'Taqeem login: On');
                }
            } catch (err) {
                setTaqeemStatus('info', 'Taqeem login: Off');
                setCompanyStatus('info', t('layout.status.companyDefault', { defaultValue: 'No company selected' }));
            } finally {
                if (!cancelled) {
                    setTimeout(heartbeat, 8000);
                }
            }
        };

        heartbeat();
        return () => {
            cancelled = true;
        };
    }, [setCompanyStatus, setTaqeemStatus, taqeemStatus?.state, t]);

    useEffect(() => {
        if (taqeemStatus?.state !== 'success') {
            setAutoLoadedCompanies(false);
        }
    }, [taqeemStatus?.state]);

    const setSelectedCompany = useCallback(async (company, options = {}) => {
        const { skipNavigation = true, quiet = false, setAsDefault = false, onlyIfUnset = true } = options;
        if (!company) {
            setSelectedCompanyState(null);
            if (!quiet) {
                setCompanyStatus('info', t('layout.status.companyDefault', { defaultValue: 'No company selected' }));
            }
            return null;
        }
        const normalized = normalizeCompany(company);
        setSelectedCompanyState(normalized);
        if (setAsDefault) {
            const hasPreferred = Boolean(preferredCompanyKey);
            if (!hasPreferred || !onlyIfUnset) {
                setPreferredCompanyKey(getCompanyKey(normalized));
            }
        }
        if (!window?.electronAPI?.navigateToCompany) {
            if (!quiet) setCompanyStatus('info', `Company: ${normalized.name || t('sidebar.company.fallback')}`);
            return normalized;
        }

        try {
            const payload = {
                name: normalized.name,
                url: normalized.url,
                officeId: normalized.officeId || normalized.office_id,
                sectorId: normalized.sectorId || normalized.sector_id,
                skipNavigation
            };
            const result = await window.electronAPI.navigateToCompany(payload);
            if (result?.status === 'SUCCESS') {
                const chosen = normalizeCompany(result.selectedCompany || normalized);
                setSelectedCompanyState(chosen);
                if (!quiet) setCompanyStatus('success', `Company: ${chosen.name || t('sidebar.company.fallback')}`);
                return chosen;
            }
            if (!quiet) setCompanyStatus('error', result?.error || t('navigation.loadCompaniesFailed'));
        } catch (err) {
            if (!quiet) setCompanyStatus('error', err?.message || t('navigation.loadCompaniesFailed'));
        }
        return normalized;
    }, [preferredCompanyKey, setCompanyStatus, setPreferredCompanyKey, setSelectedCompanyState, t]);

    const setPreferredCompany = useCallback(async (company, options = {}) => {
        const { applySelection = true, skipNavigation = true, quiet = false } = options;
        const normalized = company ? normalizeCompany(company) : null;
        setPreferredCompanyKey(getCompanyKey(normalized));
        if (applySelection) {
            await setSelectedCompany(normalized, { skipNavigation, quiet });
        }
        return normalized;
    }, [setPreferredCompanyKey, setSelectedCompany]);

    const replaceCompanies = useCallback(async (list = [], options = {}) => {
        const normalized = Array.isArray(list) ? list.map(normalizeCompany) : [];
        setCompanies(normalized);
        setCompanyError('');
        const autoSelect = options.autoSelect !== false;
        if (autoSelect && normalized.length > 0) {
            const candidate =
                preferredCompany ||
                normalized.find((c) => preferredCompanyMatches(c)) ||
                normalized[0];
            await setPreferredCompany(candidate, {
                applySelection: true,
                skipNavigation: options.skipNavigation !== false,
                quiet: options.quiet || false
            });
        }
        return normalized;
    }, [preferredCompany, preferredCompanyMatches, setPreferredCompany]);

    useEffect(() => {
        const shouldAutoFetch = taqeemStatus?.state === 'success' && user && !loadingCompanies && !autoLoadedCompanies;
        if (!shouldAutoFetch) return;
        if (!window?.electronAPI?.getCompanies) return;
        setAutoLoadedCompanies(true);
        (async () => {
            setLoadingCompanies(true);
            setCompanyError('');
            try {
                const data = await window.electronAPI.getCompanies();
                if (data?.status === 'SUCCESS') {
                    const fetched = data.data || [];
                    const normalized = fetched.map(normalizeCompany);
                    let synced = normalized;
                    if (syncCompanies && normalized.length > 0) {
                        try {
                            const syncedRes = await syncCompanies(normalized.map((c) => ({ ...c, type: c.type || 'equipment' })), 'equipment');
                            if (Array.isArray(syncedRes) && syncedRes.length > 0) {
                                synced = syncedRes.map(normalizeCompany);
                            }
                        } catch (err) {
                            console.warn('Failed to sync companies', err);
                        }
                    }
                    await replaceCompanies(synced, { quiet: true, skipNavigation: true, autoSelect: true });
                    setCompanyStatus('info', t('sidebar.company.selectToContinue', { defaultValue: 'Select a company to view main links.' }));
                } else {
                    setCompanyError(data?.error || t('navigation.loadCompaniesFailed'));
                }
            } catch (err) {
                setCompanyError(err?.message || t('navigation.loadCompaniesFailed'));
            } finally {
                setLoadingCompanies(false);
            }
        })();
    }, [autoLoadedCompanies, loadingCompanies, replaceCompanies, setCompanyStatus, syncCompanies, taqeemStatus?.state, t, user]);

    useEffect(() => {
        if (taqeemStatus?.state !== 'success') {
            setCompanySyncDone(false);
            return;
        }
        if (selectedCompany && !companySyncDone) {
            setCompanySyncDone(true);
            setSelectedCompany(selectedCompany, { quiet: true });
        }
    }, [companySyncDone, selectedCompany, setSelectedCompany, taqeemStatus?.state]);

    useEffect(() => {
        if (!selectedCompany || !companies || companies.length === 0) return;
        const key = getCompanyKey(selectedCompany);
        if (!key) return;
        const match = companies.find((company) => getCompanyKey(company) === key);
        if (match && match !== selectedCompany) {
            setSelectedCompanyState(normalizeCompany(match));
        }
    }, [companies, selectedCompany, setSelectedCompanyState]);

    const ensureCompaniesLoaded = useCallback(async (type = 'equipment') => {
        if (companies && companies.length > 0) return companies;
        return loadSavedCompanies(type);
    }, [companies, loadSavedCompanies]);

    const autoSelectDefaultCompany = useCallback(async (options = {}) => {
        const { type = 'equipment', skipNavigation = true, quiet = false, companiesList = null } = options;
        const availableCompanies = companiesList && companiesList.length > 0
            ? companiesList
            : companies && companies.length > 0
                ? companies
                : await ensureCompaniesLoaded(type);
        const candidate = preferredCompany || availableCompanies?.[0];
        if (!candidate) return null;
        return setPreferredCompany(candidate, { applySelection: true, skipNavigation, quiet });
    }, [companies, ensureCompaniesLoaded, preferredCompany, setPreferredCompany]);

    useEffect(() => {
        if (selectedDomain !== 'equipments') return;
        if (!companies || companies.length === 0) return;
        if (selectedCompany) return;
        autoSelectDefaultCompany({ skipNavigation: true }).catch(() => {});
    }, [autoSelectDefaultCompany, companies, selectedCompany, selectedDomain]);

    useEffect(() => {
        if (!user) {
            setInitialDefaultApplied(false);
            return;
        }
        if (initialDefaultApplied) return;
        if (!companies || companies.length === 0) return;
        if (selectedCompany) {
            setInitialDefaultApplied(true);
            return;
        }
        autoSelectDefaultCompany({ skipNavigation: true, quiet: true }).finally(() => {
            setInitialDefaultApplied(true);
        });
    }, [autoSelectDefaultCompany, companies, initialDefaultApplied, selectedCompany, user]);

    const syncNavForView = useCallback((viewId) => {
        const info = findTabInfo(viewId);
        if (!info) {
            setActiveTab(null);
            return;
        }
        const owningCard = findCardForGroup(info.groupId);
        if (owningCard?.id) {
            setSelectedCard(owningCard.id);
        }

        if (owningCard?.id === 'uploading-reports') {
            // preserve existing domain/company if already set; otherwise default to equipments
            if (!selectedDomain) {
                setSelectedDomain('equipments');
            }
        } else {
            setSelectedDomain(null);
        }
        setActiveGroup(info.groupId);
        setActiveTab(viewId);
    }, [selectedDomain]);

    const breadcrumbs = useMemo(() => {
        const items = [{ label: t('navigation.apps'), key: 'apps' }];
        if (selectedCard) {
            items.push({ label: getCardLabel(selectedCard), key: selectedCard, kind: 'card' });
        }
        if (selectedDomain) {
            items.push({ label: getDomainLabel(selectedDomain), key: selectedDomain, kind: 'domain' });
        }
        if (selectedCompany) {
            items.push({
                label: selectedCompany.name || t('sidebar.company.fallback'),
                key: selectedCompany.name || 'company',
                kind: 'company',
                value: selectedCompany
            });
        }
        if (activeGroup) {
            const group = valueSystemGroups[activeGroup];
            items.push({
                label: t(`navigation.groups.${activeGroup}.title`, { defaultValue: group?.title || activeGroup }),
                key: activeGroup,
                kind: 'group'
            });
        }
        if (activeTab) {
            const info = findTabInfo(activeTab);
            if (info?.tab) {
                items.push({
                    label: t(`navigation.tabs.${activeTab}.label`, { defaultValue: info.tab.label }),
                    key: activeTab,
                    kind: 'tab'
                });
            }
        }
        return items;
    }, [activeGroup, activeTab, getCardLabel, getDomainLabel, selectedCard, selectedCompany, selectedDomain, t]);

    return (
        <ValueNavContext.Provider
            value={{
                selectedCard,
                selectedDomain,
                selectedCompany,
                preferredCompany,
                preferredCompanyKey,
                companies,
                loadingCompanies,
                companyError,
                activeGroup,
                activeTab,
                setActiveGroup,
                setActiveTab,
                resetAll,
                chooseCard,
                chooseDomain,
                loadSavedCompanies,
                ensureCompaniesLoaded,
                autoSelectDefaultCompany,
                syncCompanies,
                replaceCompanies,
                setSelectedCompany,
                setPreferredCompany,
                syncNavForView,
                breadcrumbs,
                valueSystemCards,
                valueSystemGroups,
                resetNavigation
            }}
        >
            {children}
        </ValueNavContext.Provider>
    );
};

export default ValueNavContext;
