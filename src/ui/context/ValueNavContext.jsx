import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import navigation from "../constants/navigation";
import { useSession } from "./SessionContext";
import { useTranslation } from "react-i18next";
import { useNavStatus } from "./NavStatusContext";
import usePersistentState from "../hooks/usePersistentState";

const { valueSystemCards, valueSystemGroups, findTabInfo } = navigation;

const ValueNavContext = createContext(null);

export const useValueNav = () => {
  const ctx = useContext(ValueNavContext);
  if (!ctx) {
    throw new Error("useValueNav must be used within ValueNavProvider");
  }
  return ctx;
};

const findCardForGroup = (groupId) =>
  valueSystemCards.find(
    (card) => Array.isArray(card.groups) && card.groups.includes(groupId),
  );

const repairMojibake = (value) => {
  if (!value || typeof value !== "string") return value;
  if (!/[\u00c3\u00c2\u00d8\u00d9]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from(value, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
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
  if (!company) return "";
  const officeId = company.officeId || company.office_id;
  if (officeId !== undefined && officeId !== null) {
    return String(officeId);
  }
  return company.url || company.id || company.name || "";
};

const getCompanyOfficeId = (company) => {
  if (!company) return "";
  const officeId = company.officeId || company.office_id || "";
  return String(officeId || "").trim();
};

const getUserDefaultCompanyOfficeId = (user) => {
  const direct = user?.defaultCompanyOfficeId;
  if (direct !== undefined && direct !== null && String(direct).trim()) {
    return String(direct).trim();
  }
  const nested = user?.taqeem?.defaultCompanyOfficeId;
  if (nested !== undefined && nested !== null && String(nested).trim()) {
    return String(nested).trim();
  }
  return "";
};

const resolvePreferredCompanyStorageKey = (user, isGuest) => {
  const taqeemIdentifier = user?.taqeemUser || user?.taqeem?.username || null;
  if (taqeemIdentifier) {
    return `nav:preferred-company-url:taqeem:${String(taqeemIdentifier).trim()}`;
  }

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
    return "nav:preferred-company-url:guest";
  }
  return "nav:preferred-company-url:anonymous";
};

export const ValueNavProvider = ({ children }) => {
  const { user, token, isGuest } = useSession();
  const { t } = useTranslation();
  const { taqeemStatus, setCompanyStatus, setTaqeemStatus } = useNavStatus();
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [selectedCompany, setSelectedCompanyState] = usePersistentState(
    "nav:selected-company",
    null,
    {
      storage: "session",
      revive: (value) => normalizeCompany(value),
    },
  );
  const preferredCompanyStorageKey = useMemo(
    () => resolvePreferredCompanyStorageKey(user, isGuest),
    [isGuest, user],
  );
  const [preferredCompanyKey, setPreferredCompanyKey] = usePersistentState(
    preferredCompanyStorageKey,
    "",
    {
      storage: "local",
    },
  );
  const domainToType = (domain) =>
    domain === "real-estate" ? "real-estate" : "equipment";

  const [companiesByType, setCompaniesByType] = useState({
    equipment: [],
    "real-estate": [],
  });
  const companiesByTypeRef = useRef(companiesByType);
  useEffect(() => {
    companiesByTypeRef.current = companiesByType;
  }, [companiesByType]);

  // Derived "active" list for whatever domain is selected
  const companies = companiesByType[domainToType(selectedDomain)] || [];

  const setCompaniesForType = useCallback((type, list) => {
    setCompaniesByType((prev) => ({ ...prev, [type]: list }));
  }, []);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [companyError, setCompanyError] = useState("");
  const [activeGroup, setActiveGroup] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  const [defaultCompanyOfficeId, setDefaultCompanyOfficeId] = useState(
    getUserDefaultCompanyOfficeId(user),
  );
  const [companySyncDone, setCompanySyncDone] = useState(false);
  const [autoLoadedCompanies, setAutoLoadedCompanies] = useState({
    equipment: false,
    "real-estate": false,
  });

  useEffect(() => {
    setDefaultCompanyOfficeId(getUserDefaultCompanyOfficeId(user));
  }, [
    user?._id,
    user?.id,
    user?.defaultCompanyOfficeId,
    user?.taqeem?.defaultCompanyOfficeId,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    console.log("[syncCompanies] user at call time:", user, "token:", token);
    if (!user && !isGuest) return;
    if (preferredCompanyKey) return;
    const legacyKey = "nav:preferred-company-url";
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

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );
  const preferredCompanyMatches = useCallback(
    (company) => {
      if (!preferredCompanyKey || !company) return false;
      const candidates = [
        getCompanyKey(company),
        company.url,
        company.id,
        company.officeId,
        company.office_id,
        company.name,
      ]
        .filter(
          (value) => value !== undefined && value !== null && value !== "",
        )
        .map((value) => String(value));
      return candidates.includes(String(preferredCompanyKey));
    },
    [preferredCompanyKey],
  );

  const preferredCompany = useMemo(() => {
    if (!preferredCompanyKey) return null;
    const match = companies.find((c) => preferredCompanyMatches(c));
    return match ? normalizeCompany(match) : null;
  }, [companies, preferredCompanyKey, preferredCompanyMatches]);

  const getCardLabel = useCallback(
    (cardId) => {
      const card = valueSystemCards.find((c) => c.id === cardId);
      return t(`navigation.cards.${cardId}.title`, {
        defaultValue: card?.title || cardId,
      });
    },
    [t],
  );

  const getDomainLabel = useCallback(
    (domainId) => {
      const fallbacks = {
        "real-estate": "Real Estate",
        equipments: "Equipment",
      };
      return t(`sidebar.domains.${domainId}`, {
        defaultValue: fallbacks[domainId] || domainId,
      });
    },
    [t],
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

  const extractCompaniesMeta = useCallback((payload) => {
    if (!payload || typeof payload !== "object") return null;
    if (payload.meta && typeof payload.meta === "object") return payload.meta;
    if (payload.data?.meta && typeof payload.data.meta === "object")
      return payload.data.meta;
    return null;
  }, []);

  const applyCompaniesMeta = useCallback((meta) => {
    if (!meta || typeof meta !== "object") return;
    if (Object.prototype.hasOwnProperty.call(meta, "defaultCompanyOfficeId")) {
      const raw = meta.defaultCompanyOfficeId;
      const normalized =
        raw === undefined || raw === null ? "" : String(raw).trim();
      setDefaultCompanyOfficeId(normalized);
    }
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
    setCompaniesByType({ equipment: [], "real-estate": [] });
    setCompanyError("");
    setAutoLoadedCompanies({ equipment: false, "real-estate": false });
    setDefaultCompanyOfficeId("");
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

  const loadSavedCompanies = useCallback(
    async (type = "equipment") => {
      if (!window?.electronAPI?.apiRequest) {
        setCompanyError(t("navigation.companyFetchUnavailable"));
        return [];
      }
      const fetchAutomationCompanies = () =>
        type === "real-estate"
          ? window.electronAPI.getCompaniesRealEstate?.()
          : window.electronAPI.getCompanies?.();

      if (!token) {
        if (!fetchAutomationCompanies()) {
          setCompanyError("");
          return companiesByTypeRef.current[type] || [];
        }
        setLoadingCompanies(true);
        setCompanyError("");
        try {
          const data = await fetchAutomationCompanies();
          if (data?.status === "SUCCESS") {
            const fetched = (data.data || []).map(normalizeCompany);
            if (fetched.length) setCompaniesForType(type, fetched);
            return fetched;
          }
          setCompanyError(data?.error || t("navigation.loadCompaniesFailed"));
          return [];
        } catch (err) {
          setCompanyError(err?.message || t("navigation.loadCompaniesFailed"));
          return [];
        } finally {
          setLoadingCompanies(false);
        }
      }
      console.log("[syncCompanies] user at call time:", user, "token:", token);
      if (!user) {
        setCompanyError("");
        const fetcher = fetchAutomationCompanies();
        if (!fetcher) return [];
        setLoadingCompanies(true);
        try {
          const data = await fetcher;
          if (data?.status === "SUCCESS") {
            const fetched = (data.data || []).map(normalizeCompany);
            if (fetched.length) setCompaniesForType(type, fetched);
            return fetched;
          }
          return [];
        } catch {
          return [];
        } finally {
          setLoadingCompanies(false);
        }
      }

      setLoadingCompanies(true);
      setCompanyError("");
      try {
        const res = await window.electronAPI.apiRequest(
          "GET",
          `/api/companes/me?type=${type}`,
          {},
          authHeaders,
        );
        applyCompaniesMeta(extractCompaniesMeta(res));
        const list = normalizeCompanyList(res).map(normalizeCompany);
        const current = companiesByTypeRef.current[type] || [];
        if (list.length > 0 || current.length > 0)
          setCompaniesForType(type, list);
        return list;
      } catch (err) {
        setCompanyError(
          err?.response?.data?.message ||
            err?.message ||
            t("navigation.loadCompaniesFailed"),
        );
        return [];
      } finally {
        setLoadingCompanies(false);
      }
    },
    [
      applyCompaniesMeta,
      authHeaders,
      extractCompaniesMeta,
      normalizeCompanyList,
      setCompaniesForType,
      t,
      token,
      user,
    ],
  );

  const syncCompanies = useCallback(
    async (items = [], defaultType = "equipment", overrides = {}) => {
      if (!window?.electronAPI?.apiRequest) {
        throw new Error(t("navigation.companySyncUnavailable"));
      }

      const effectiveUserId = overrides.userId || user?._id || user?.id;
      const effectiveToken = overrides.token || token;

      if (!effectiveUserId && !effectiveToken) {
        throw new Error(t("navigation.loginRequiredToSaveCompanies"));
      }

      const headers = effectiveToken
        ? { Authorization: `Bearer ${effectiveToken}` }
        : authHeaders;

      const payload = {
        companies: items.map((item) => ({
          ...item,
          type: item.type || defaultType,
        })),
      };

      const res = await window.electronAPI.apiRequest(
        "POST",
        "/api/companes/sync",
        payload,
        headers,
      );
      applyCompaniesMeta(extractCompaniesMeta(res));
      const list = normalizeCompanyList(res);
      const fresh = await loadSavedCompanies(defaultType);
      if (fresh.length === 0 && list.length > 0) {
        setCompaniesForType(defaultType, list.map(normalizeCompany));
      }
      return list;
    },
    [
      applyCompaniesMeta,
      authHeaders,
      extractCompaniesMeta,
      loadSavedCompanies,
      normalizeCompanyList,
      setCompaniesForType,
      t,
      token,
      user,
    ],
  );

  useEffect(() => {
    if (user) {
      loadSavedCompanies();
    } else {
      setCompaniesByType({ equipment: [], "real-estate": [] });
      setCompanyError("");
      setAutoLoadedCompanies(false);
    }
  }, [user, loadSavedCompanies]);

  useEffect(() => {
    if (
      taqeemStatus?.state === "success" &&
      (!companies || companies.length === 0)
    ) {
      loadSavedCompanies(domainToType(selectedDomain));
    }
  }, [companies, loadSavedCompanies, selectedDomain, taqeemStatus?.state]);

  useEffect(() => {
    if (taqeemStatus?.state !== "success") {
      return;
    }
    if (!window?.electronAPI?.checkStatus) return;
    let cancelled = false;

    const heartbeat = async () => {
      if (cancelled) return;
      try {
        const res = await window.electronAPI.checkStatus();
        const statusCode = String(res?.status || "").toUpperCase();
        const browserClosed =
          res?.browserOpen === false || statusCode.includes("CLOSED");
        const notLogged = statusCode.includes("NOT_LOGGED_IN");
        const sessionLikelyAlive =
          res?.browserOpen === true && !browserClosed && !notLogged;
        if (browserClosed || notLogged) {
          setTaqeemStatus("info", "Taqeem login: Off");
          setCompanyStatus(
            "info",
            t("layout.status.companyDefault", {
              defaultValue: "No company selected",
            }),
          );
        } else if (sessionLikelyAlive) {
          setTaqeemStatus("success", "Taqeem login: On");
        }
      } catch (err) {
        console.warn(
          "Taqeem heartbeat check failed; keeping current session state.",
          err,
        );
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
    if (taqeemStatus?.state !== "success") {
      setAutoLoadedCompanies({ equipment: false, "real-estate": false });
    }
  }, [taqeemStatus?.state]);

  const persistDefaultCompany = useCallback(
    async (officeId) => {
      const normalizedOffice = String(officeId || "").trim();
      if (!normalizedOffice) return null;
      if (!token || !window?.electronAPI?.apiRequest) return normalizedOffice;

      try {
        const response = await window.electronAPI.apiRequest(
          "POST",
          "/api/users/taqeem/default-company",
          { officeId: normalizedOffice },
          authHeaders,
        );
        const resolved = String(response?.officeId || normalizedOffice).trim();
        setDefaultCompanyOfficeId(resolved);
        return resolved;
      } catch (err) {
        const msg =
          err?.response?.data?.message ||
          err?.message ||
          t("navigation.loadCompaniesFailed");
        setCompanyStatus("error", msg);
        return null;
      }
    },
    [authHeaders, setCompanyStatus, t, token],
  );

  const setSelectedCompany = useCallback(
    async (company, options = {}) => {
      const {
        skipNavigation = true,
        quiet = false,
        setAsDefault = false,
        onlyIfUnset = false,
        persistDefault = false,
      } = options;
      if (!company) {
        setSelectedCompanyState(null);
        if (!quiet) {
          setCompanyStatus(
            "info",
            t("layout.status.companyDefault", {
              defaultValue: "No company selected",
            }),
          );
        }
        return null;
      }
      const normalized = normalizeCompany(company);
      const preferredKey = getCompanyKey(normalized);
      const selectedOfficeId = getCompanyOfficeId(normalized);

      setSelectedCompanyState(normalized);
      if (setAsDefault) {
        const hasPreferred = Boolean(preferredCompanyKey);
        if (!hasPreferred || !onlyIfUnset) {
          setPreferredCompanyKey(preferredKey);
        }
        if (persistDefault && selectedOfficeId) {
          await persistDefaultCompany(selectedOfficeId);
        }
      }
      if (!window?.electronAPI?.navigateToCompany) {
        if (!quiet)
          setCompanyStatus(
            "info",
            `Company: ${normalized.name || t("sidebar.company.fallback")}`,
          );
        return normalized;
      }

      try {
        const payload = {
          name: normalized.name,
          url: normalized.url,
          officeId: normalized.officeId || normalized.office_id,
          sectorId: normalized.sectorId || normalized.sector_id,
          skipNavigation,
        };
        const result = await window.electronAPI.navigateToCompany(payload);
        if (result?.status === "SUCCESS") {
          const chosen = normalizeCompany(result.selectedCompany || normalized);
          setSelectedCompanyState(chosen);
          if (!quiet)
            setCompanyStatus(
              "success",
              `Company: ${chosen.name || t("sidebar.company.fallback")}`,
            );
          return chosen;
        }
        if (!quiet)
          setCompanyStatus(
            "error",
            result?.error || t("navigation.loadCompaniesFailed"),
          );
      } catch (err) {
        if (!quiet)
          setCompanyStatus(
            "error",
            err?.message || t("navigation.loadCompaniesFailed"),
          );
      }
      return normalized;
    },
    [
      persistDefaultCompany,
      preferredCompanyKey,
      setCompanyStatus,
      setPreferredCompanyKey,
      setSelectedCompanyState,
      t,
    ],
  );

  const setPreferredCompany = useCallback(
    async (company, options = {}) => {
      const {
        applySelection = true,
        skipNavigation = true,
        quiet = false,
        persistDefault = false,
      } = options;
      const normalized = company ? normalizeCompany(company) : null;
      setPreferredCompanyKey(getCompanyKey(normalized));
      if (!normalized) {
        if (applySelection) {
          await setSelectedCompany(null, { skipNavigation, quiet });
        }
        return null;
      }

      if (!applySelection) {
        if (persistDefault) {
          const officeId = getCompanyOfficeId(normalized);
          if (officeId) {
            await persistDefaultCompany(officeId);
          }
        }
        return normalized;
      }

      if (applySelection) {
        await setSelectedCompany(normalized, {
          skipNavigation,
          quiet,
          setAsDefault: true,
          onlyIfUnset: false,
          persistDefault,
        });
      }
      return normalized;
    },
    [persistDefaultCompany, setPreferredCompanyKey, setSelectedCompany],
  );

  const replaceCompanies = useCallback(
    async (list = [], options = {}) => {
      const type = options.type || "equipment";
      const normalized = Array.isArray(list) ? list.map(normalizeCompany) : [];
      setCompaniesForType(type, normalized);
      setCompanyError("");
      const autoSelect = options.autoSelect !== false;
      if (autoSelect && normalized.length > 0) {
        const serverDefault = defaultCompanyOfficeId
          ? normalized.find(
              (c) => getCompanyOfficeId(c) === defaultCompanyOfficeId,
            )
          : null;
        const preferred =
          normalized.find((c) => preferredCompanyMatches(c)) || null;
        const candidate = serverDefault || preferred;
        if (candidate) {
          await setSelectedCompany(candidate, {
            skipNavigation: options.skipNavigation !== false,
            quiet: options.quiet || false,
          });
        }
      }
      return normalized;
    },
    [
      defaultCompanyOfficeId,
      preferredCompanyMatches,
      setCompaniesForType,
      setSelectedCompany,
    ],
  );

  useEffect(() => {
    const type = domainToType(selectedDomain);
    const currentList = companiesByType[type] || [];
    const shouldAutoFetch =
      taqeemStatus?.state === "success" &&
      !loadingCompanies &&
      !autoLoadedCompanies[type] &&
      currentList.length === 0;
    if (!shouldAutoFetch) return;

    const fetcher =
      type === "real-estate"
        ? window?.electronAPI?.getCompaniesRealEstate
        : window?.electronAPI?.getCompanies;
    if (!fetcher) return;

    setAutoLoadedCompanies((prev) => ({ ...prev, [type]: true }));
    (async () => {
      setLoadingCompanies(true);
      setCompanyError("");
      try {
        const data = await fetcher();
        if (data?.status === "SUCCESS") {
          const normalized = (data.data || []).map(normalizeCompany);
          let synced = normalized;
          if (syncCompanies && normalized.length > 0) {
            try {
              const syncedRes = await syncCompanies(
                normalized.map((c) => ({ ...c, type: c.type || type })),
                type,
              );
              if (Array.isArray(syncedRes) && syncedRes.length > 0) {
                synced = syncedRes.map(normalizeCompany);
              }
            } catch (err) {
              console.warn("Failed to sync companies", err);
            }
          }
          await replaceCompanies(synced, {
            quiet: true,
            skipNavigation: true,
            autoSelect: true,
            type,
          });
          setCompanyStatus(
            "info",
            t("sidebar.company.selectToContinue", {
              defaultValue: "Select a company to view main links.",
            }),
          );
        } else {
          setCompanyError(data?.error || t("navigation.loadCompaniesFailed"));
        }
      } catch (err) {
        setCompanyError(err?.message || t("navigation.loadCompaniesFailed"));
      } finally {
        setLoadingCompanies(false);
      }
    })();
  }, [
    autoLoadedCompanies,
    companiesByType,
    loadingCompanies,
    replaceCompanies,
    selectedDomain,
    setCompanyStatus,
    syncCompanies,
    taqeemStatus?.state,
    t,
  ]);

  useEffect(() => {
    if (taqeemStatus?.state !== "success") {
      setCompanySyncDone(false);
      return;
    }
    if (selectedCompany && !companySyncDone) {
      setCompanySyncDone(true);
      setSelectedCompany(selectedCompany, { quiet: true });
    }
  }, [
    companySyncDone,
    selectedCompany,
    setSelectedCompany,
    taqeemStatus?.state,
  ]);

  useEffect(() => {
    if (!selectedCompany || !companies || companies.length === 0) return;
    const key = getCompanyKey(selectedCompany);
    if (!key) return;
    const match = companies.find((company) => getCompanyKey(company) === key);
    if (match && match !== selectedCompany) {
      setSelectedCompanyState(normalizeCompany(match));
    }
  }, [companies, selectedCompany, setSelectedCompanyState]);

  const ensureCompaniesLoaded = useCallback(
    async (type = "equipment") => {
      const existing = companiesByType[type];
      if (existing && existing.length > 0) return existing;
      return loadSavedCompanies(type);
    },
    [companiesByType, loadSavedCompanies],
  );

  const autoSelectDefaultCompany = useCallback(
    async (options = {}) => {
      const {
        type = "equipment",
        skipNavigation = true,
        quiet = false,
        companiesList = null,
      } = options;
      const availableCompanies =
        companiesList && companiesList.length > 0
          ? companiesList
          : companiesByType[type] && companiesByType[type].length > 0
            ? companiesByType[type]
            : await ensureCompaniesLoaded(type);
      const normalizedOfficeId = String(defaultCompanyOfficeId || "").trim();
      const defaultCompany = normalizedOfficeId
        ? availableCompanies.find(
            (c) => getCompanyOfficeId(c) === normalizedOfficeId,
          )
        : null;
      const preferredCandidate =
        availableCompanies.find((c) => preferredCompanyMatches(c)) || null;
      const candidate = defaultCompany || preferredCandidate;
      if (!candidate) return null;
      return setSelectedCompany(candidate, { skipNavigation, quiet });
    },
    [
      companiesByType,
      defaultCompanyOfficeId,
      ensureCompaniesLoaded,
      preferredCompanyMatches,
      setSelectedCompany,
    ],
  );

  useEffect(() => {
    if (!companies || companies.length === 0) return;
    if (selectedCompany) return;
    autoSelectDefaultCompany({
      type: domainToType(selectedDomain),
      skipNavigation: true,
      quiet: true,
    }).catch(() => {});
  }, [autoSelectDefaultCompany, companies, selectedCompany]);

  const syncNavForView = useCallback(
    (viewId) => {
      const info = findTabInfo(viewId);
      if (!info) {
        setActiveTab(null);
        return;
      }
      const owningCard = findCardForGroup(info.groupId);
      if (owningCard?.id) {
        setSelectedCard(owningCard.id);
      }

      if (owningCard?.id === "uploading-reports") {
        // preserve existing domain/company if already set; otherwise default to equipments
        if (!selectedDomain) {
          setSelectedDomain("equipments");
        }
      } else {
        setSelectedDomain(null);
      }
      setActiveGroup(info.groupId);
      setActiveTab(viewId);
    },
    [selectedDomain],
  );

  const breadcrumbs = useMemo(() => {
    const items = [{ label: t("navigation.apps"), key: "apps" }];
    if (selectedCard) {
      items.push({
        label: getCardLabel(selectedCard),
        key: selectedCard,
        kind: "card",
      });
    }
    if (selectedDomain) {
      items.push({
        label: getDomainLabel(selectedDomain),
        key: selectedDomain,
        kind: "domain",
      });
    }
    if (selectedCompany) {
      items.push({
        label: selectedCompany.name || t("sidebar.company.fallback"),
        key: selectedCompany.name || "company",
        kind: "company",
        value: selectedCompany,
      });
    }
    if (activeGroup) {
      const group = valueSystemGroups[activeGroup];
      items.push({
        label: t(`navigation.groups.${activeGroup}.title`, {
          defaultValue: group?.title || activeGroup,
        }),
        key: activeGroup,
        kind: "group",
      });
    }
    if (activeTab) {
      const info = findTabInfo(activeTab);
      if (info?.tab) {
        items.push({
          label: t(`navigation.tabs.${activeTab}.label`, {
            defaultValue: info.tab.label,
          }),
          key: activeTab,
          kind: "tab",
        });
      }
    }
    return items;
  }, [
    activeGroup,
    activeTab,
    getCardLabel,
    getDomainLabel,
    selectedCard,
    selectedCompany,
    selectedDomain,
    t,
  ]);

  return (
    <ValueNavContext.Provider
      value={{
        selectedCard,
        selectedDomain,
        selectedCompany,
        preferredCompany,
        preferredCompanyKey,
        defaultCompanyOfficeId,
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
        resetNavigation,
      }}
    >
      {children}
    </ValueNavContext.Provider>
  );
};

export default ValueNavContext;
