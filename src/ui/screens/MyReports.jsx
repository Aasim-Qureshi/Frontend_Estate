import React, { useEffect, useMemo, useRef, useState } from "react";
import reportApi from "../../api/report.service";
import { useValueNav } from "../context/ValueNavContext";
import { useSession } from "../context/SessionContext";
import { canAccessView } from "../utils/viewAccess";
import { useTranslation } from "react-i18next";

const SOURCE_ROUTE_MAP = {
  UrgentReport: "upload-report-elrajhi",
  DuplicateReport: "duplicate-report",
  MultiApproachReport: "multi-excel-upload",
  SubmitReportsQuickly: "submit-reports-quickly",
  Reports: "upload-assets",
  ElrajhiReport: "upload-report-elrajhi",
};

const SOURCE_KEYS = [
  "UrgentReport",
  "DuplicateReport",
  "MultiApproachReport",
  "SubmitReportsQuickly",
  "Reports",
  "ElrajhiReport",
];

const STATUS_OPTIONS = [
  "ALL",
  "NEW",
  "PENDING",
  "IN_PROGRESS",
  "SENT",
  "CONFIRMED",
  "APPROVED",
  "COMPLETE",
  "INCOMPLETE",
  "EDITED",
  "FAILED",
  "DRAFT",
  "NOT_AVAILABLE",
];

const STATUS_BADGE_CLASSES = {
  NEW: "border-slate-200 bg-slate-50 text-slate-700",
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  IN_PROGRESS: "border-cyan-200 bg-cyan-50 text-cyan-700",
  SENT: "border-sky-200 bg-sky-50 text-sky-700",
  CONFIRMED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  APPROVED: "border-green-200 bg-green-50 text-green-700",
  COMPLETE: "border-blue-200 bg-blue-50 text-blue-700",
  INCOMPLETE: "border-rose-200 bg-rose-50 text-rose-700",
  EDITED: "border-indigo-200 bg-indigo-50 text-indigo-700",
  FAILED: "border-red-200 bg-red-50 text-red-700",
  DRAFT: "border-violet-200 bg-violet-50 text-violet-700",
  NOT_AVAILABLE: "border-slate-300 bg-slate-100 text-slate-600",
};

const RAW_STATUS_TO_KEY = {
  new: "NEW",
  pending: "PENDING",
  "in progress": "IN_PROGRESS",
  in_progress: "IN_PROGRESS",
  sent: "SENT",
  confirmed: "CONFIRMED",
  approved: "APPROVED",
  complete: "COMPLETE",
  completed: "COMPLETE",
  incomplete: "INCOMPLETE",
  edited: "EDITED",
  failed: "FAILED",
  draft: "DRAFT",
  "not available": "NOT_AVAILABLE",
  not_available: "NOT_AVAILABLE",
};

function fallbackStatusLabel(statusKey) {
  return String(statusKey || "NOT_AVAILABLE")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeRawStatusToKey(statusValue) {
  const normalized = String(statusValue || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!normalized) return "";
  return RAW_STATUS_TO_KEY[normalized] || normalized.toUpperCase().replace(/\s+/g, "_");
}

function hasTaqeemReportId(report) {
  return Boolean(String(report?.report_id || report?.reportId || "").trim());
}

function isAssetComplete(asset) {
  const value = asset?.submitState ?? asset?.submit_state;
  return value === 1 || value === "1" || value === true;
}

function hasAnyCompletedAsset(report) {
  const assets = Array.isArray(report?.asset_data) ? report.asset_data : [];
  return assets.some((asset) => isAssetComplete(asset));
}

function areAllAssetsComplete(report) {
  const assets = Array.isArray(report?.asset_data) ? report.asset_data : [];
  return assets.length > 0 && assets.every((asset) => isAssetComplete(asset));
}

function resolveReportStatusKey(row) {
  const report = row?.raw || {};
  const report_id = row?.report_id ?? report?.report_id ?? report?.reportId ?? "";
  const hasReportId = hasTaqeemReportId({ report_id });
  const rawStatusKey = normalizeRawStatusToKey(report?.report_status || report?.status);
  const submitState = report?.submit_state ?? report?.submitState;
  const sourceKey = String(row?.sourceKey || "");

  switch (sourceKey) {
    case "SubmitReportsQuickly":
      if (!hasReportId) return "NEW";
      if (rawStatusKey === "SENT") return "SENT";
      if (rawStatusKey === "CONFIRMED" || rawStatusKey === "APPROVED") return "CONFIRMED";
      return areAllAssetsComplete(report) ? "COMPLETE" : "INCOMPLETE";

    case "MultiApproachReport":
      if (!hasReportId) return "NEW";
      if (rawStatusKey === "SENT") return "SENT";
      if (report?.checked || rawStatusKey === "APPROVED" || rawStatusKey === "CONFIRMED") {
        return "APPROVED";
      }
      return areAllAssetsComplete(report) ? "COMPLETE" : "INCOMPLETE";

    case "DuplicateReport":
      if (!hasReportId) return "NEW";
      if (report?.checked || rawStatusKey === "APPROVED" || rawStatusKey === "CONFIRMED") {
        return "APPROVED";
      }
      if (report?.endSubmitTime || rawStatusKey === "COMPLETE") return "COMPLETE";
      if (rawStatusKey === "INCOMPLETE") return "INCOMPLETE";
      if (rawStatusKey === "EDITED") return "EDITED";
      if (rawStatusKey === "FAILED") return "FAILED";
      return "SENT";

    case "Reports":
      if (rawStatusKey && rawStatusKey !== "NEW") return rawStatusKey;
      if (rawStatusKey === "NEW") return "NEW";
      if (areAllAssetsComplete(report)) return "COMPLETE";
      if (hasAnyCompletedAsset(report)) return "IN_PROGRESS";
      if (Array.isArray(report?.asset_data) && report.asset_data.length === 0) return "DRAFT";
      return "PENDING";

    case "UrgentReport":
      if (rawStatusKey) return rawStatusKey;
      if (submitState === 1 || submitState === "1" || submitState === true) return "COMPLETE";
      if (submitState === 0 || submitState === "0") return "PENDING";
      return hasReportId ? "SENT" : "NOT_AVAILABLE";

    case "ElrajhiReport":
      if (rawStatusKey) return rawStatusKey;
      if (report?.checked) return "APPROVED";
      return hasReportId ? "SENT" : "NOT_AVAILABLE";

    default:
      if (rawStatusKey) return rawStatusKey;
      if (report?.checked) return "APPROVED";
      if (submitState === 1 || submitState === "1" || submitState === true) return "COMPLETE";
      if (submitState === 0 || submitState === "0") return "PENDING";
      return hasReportId ? "SENT" : "NOT_AVAILABLE";
  }
}

function formatDateTime(value, locale = "en") {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch (_err) {
    return date.toLocaleString();
  }
}

function StatusBadge({ statusKey, t }) {
  const normalized = String(statusKey || "NOT_AVAILABLE").toUpperCase();
  const label = t(`myReportsPage.states.${normalized}`, fallbackStatusLabel(normalized));
  const cls = STATUS_BADGE_CLASSES[normalized] || STATUS_BADGE_CLASSES.NOT_AVAILABLE;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

export default function ReportsPage({ onViewChange = () => {} }) {
  const { t, i18n } = useTranslation();
  const { user, isGuest, token, login } = useSession();
  const { selectedCompany } = useValueNav();
  const activeLanguage = i18n?.resolvedLanguage || i18n?.language || "en";
  const isRtl = (i18n?.dir?.(activeLanguage) || "ltr") === "rtl";

  const isGuestUser = Boolean(isGuest || !user?.phone);
  const userId = useMemo(
    () => user?._id || user?.id || user?.userId || user?.user?._id || null,
    [user],
  );
  const taqeemUser = useMemo(() => user?.taqeemUser || user?.taqeem?.username || null, [user]);

  const selectedCompanyOfficeId = useMemo(() => {
    const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
    return officeId ? String(officeId) : "";
  }, [selectedCompany]);

  const defaultCompanyOfficeId = useMemo(() => {
    const officeId = user?.defaultCompanyOfficeId || user?.taqeem?.defaultCompanyOfficeId;
    return officeId ? String(officeId).trim() : "";
  }, [user?.defaultCompanyOfficeId, user?.taqeem?.defaultCompanyOfficeId]);

  const companyOfficeIdForLookup = selectedCompanyOfficeId || defaultCompanyOfficeId;

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");

  const [reportId, setReportId] = useState("");
  const [source, setSource] = useState("ALL");
  const [submitState, setSubmitState] = useState("ALL");
  const guestSessionPromiseRef = useRef(null);

  const accessibleSourceKeys = useMemo(
    () =>
      SOURCE_KEYS.filter((key) => {
        const sourceView = SOURCE_ROUTE_MAP[key];
        return !sourceView || canAccessView(sourceView, user);
      }),
    [user],
  );

  const sourceOptions = useMemo(
    () =>
      accessibleSourceKeys.map((key) => ({
        value: key,
        label: t(`myReportsPage.sources.${key}`, key),
      })),
    [accessibleSourceKeys, t],
  );

  const submitStateOptions = useMemo(
    () =>
      STATUS_OPTIONS.map((status) => ({
        value: status,
        label:
          status === "ALL"
            ? t("myReportsPage.filters.allStates", "All States")
            : t(`myReportsPage.states.${status}`, fallbackStatusLabel(status)),
      })),
    [t],
  );

  const sourceLabelForRow = (row) =>
    t(`myReportsPage.sources.${row?.sourceKey}`, row?.sourceLabel || row?.sourceKey || "-");

  async function ensureViewerSession() {
    if (userId) {
      return {
        userId: String(userId),
        taqeemUser: isGuestUser ? null : taqeemUser || null,
        isGuestSession: isGuestUser,
      };
    }

    if (guestSessionPromiseRef.current) {
      return guestSessionPromiseRef.current;
    }

    guestSessionPromiseRef.current = (async () => {
      if (!window?.electronAPI?.apiRequest) {
        throw new Error(
          t("myReportsPage.messages.guestBootstrapFailed", "Failed to initialize guest session."),
        );
      }

      const result = await window.electronAPI.apiRequest("POST", "/api/users/guest", {});
      if (!result?.token || !result?.userId) {
        throw new Error(
          result?.message ||
            result?.error ||
            t("myReportsPage.messages.guestBootstrapFailed", "Failed to initialize guest session."),
        );
      }

      if (result?.refreshToken && window.electronAPI?.setRefreshToken) {
        try {
          await window.electronAPI.setRefreshToken(result.refreshToken, {
            name: "refreshToken",
            maxAgeDays: 7,
            sameSite: "lax",
          });
        } catch (err) {
          console.warn("Failed to set refresh token for guest session:", err);
        }
      }

      const guestUser = {
        ...(result?.user && typeof result.user === "object" ? result.user : {}),
        _id: result?.user?._id || result.userId,
        id: result?.user?.id || result.userId,
        guest: true,
      };
      login(guestUser, result.token);

      return {
        userId: String(result.userId),
        taqeemUser: null,
        isGuestSession: true,
      };
    })().finally(() => {
      guestSessionPromiseRef.current = null;
    });

    return guestSessionPromiseRef.current;
  }

  async function load() {
    setLoading(true);
    try {
      setSessionError("");
      const sessionInfo = await ensureViewerSession();
      const resolvedUserId = String(sessionInfo?.userId || "").trim();
      if (!resolvedUserId) {
        setRows([]);
        setTotal(0);
        return;
      }

      const res = await reportApi.getMyReports({
        page,
        limit,
        companyOfficeId: sessionInfo?.isGuestSession ? null : companyOfficeIdForLookup || null,
        userId: resolvedUserId,
        taqeemUser: sessionInfo?.isGuestSession ? null : sessionInfo?.taqeemUser || null,
      });

      setRows(Array.isArray(res?.data?.data) ? res.data.data : []);
      setTotal(Number(res?.data?.total) || 0);
    } catch (err) {
      const message =
        err?.response?.data?.error ||
        err?.message ||
        t("myReportsPage.messages.loadingFailed", "Failed to load reports.");
      setSessionError(message);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function searchAnything() {
    const q = String(reportId || "").trim();
    if (!q) {
      alert(t("myReportsPage.messages.searchPrompt", "Please enter something to search"));
      return;
    }

    setLoading(true);
    try {
      setSessionError("");
      const sessionInfo = await ensureViewerSession();
      const resolvedUserId = String(sessionInfo?.userId || "").trim();
      if (!resolvedUserId) {
        setRows([]);
        setTotal(0);
        return;
      }

      const res = await reportApi.searchReports({
        q,
        page: 1,
        limit,
        source,
        companyOfficeId: sessionInfo?.isGuestSession ? null : companyOfficeIdForLookup || null,
        userId: resolvedUserId,
        taqeemUser: sessionInfo?.isGuestSession ? null : sessionInfo?.taqeemUser || null,
      });

      setRows(Array.isArray(res?.data?.data) ? res.data.data : []);
      setTotal(Number(res?.data?.total || res?.data?.totalApprox) || 0);
      setPage(1);
    } catch (err) {
      const message =
        err?.response?.data?.error ||
        err?.message ||
        t("myReportsPage.messages.searchFailed", "Search failed");
      setSessionError(message);
      alert(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, companyOfficeIdForLookup, userId, taqeemUser, isGuestUser, token]);

  useEffect(() => {
    setPage(1);
  }, [companyOfficeIdForLookup]);

  useEffect(() => {
    if (source === "ALL") return;
    if (accessibleSourceKeys.includes(source)) return;
    setSource("ALL");
  }, [accessibleSourceKeys, source]);

  const resolvedRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        statusKey: resolveReportStatusKey(row),
      })),
    [rows],
  );

  const filteredRows = useMemo(
    () =>
      resolvedRows.filter((row) => {
        if (!accessibleSourceKeys.includes(String(row?.sourceKey || ""))) return false;
        if (source !== "ALL" && String(row?.sourceKey || "") !== String(source)) return false;
        if (submitState !== "ALL" && String(row?.statusKey || "") !== String(submitState)) {
          return false;
        }
        return true;
      }),
    [accessibleSourceKeys, resolvedRows, source, submitState],
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const isFirst = page === 1;
  const isLast = page === totalPages;
  const headerSummary = isGuestUser
    ? t("submitReportsQuickly.temporaryModal.guestSession", "Guest temporary reports.")
    : t("myReportsPage.summary", "Showing {{count}} rows (page {{page}})", {
        count: filteredRows.length,
        page,
      });

  const getPageNumbers = () => {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];
    let last;

    for (let i = 1; i <= totalPages; i += 1) {
      if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
        range.push(i);
      }
    }

    for (const value of range) {
      if (last) {
        if (value - last === 2) {
          rangeWithDots.push(last + 1);
        } else if (value - last !== 1) {
          rangeWithDots.push("...");
        }
      }
      rangeWithDots.push(value);
      last = value;
    }

    return rangeWithDots;
  };

  return (
    <div className="p-2" dir={isRtl ? "rtl" : "ltr"}>
      <div className="mb-3 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {t("myReportsPage.title", "My Reports")}
            </h2>
            <p className="text-sm text-slate-500">
              {headerSummary}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {t("myReportsPage.pagination.perPage", "{{count}}/page", { count: n })}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {sessionError && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 shadow-sm">
          {sessionError}
        </div>
      )}

      <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              {t("myReportsPage.filters.reportId", "Report ID")}
            </label>
            <input
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder={t("myReportsPage.filters.searchPlaceholder", "Search for anything...")}
              value={reportId}
              onChange={(event) => setReportId(event.target.value)}
            />
          </div>

          <div className="md:col-span-4">
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              {t("myReportsPage.filters.source", "Source")}
            </label>
            <select
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="ALL">{t("myReportsPage.filters.allSources", "All Sources")}</option>
              {sourceOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              {t("myReportsPage.filters.submitState", "Submit State")}
            </label>
            <select
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={submitState}
              onChange={(event) => setSubmitState(event.target.value)}
            >
              {submitStateOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={searchAnything}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? t("myReportsPage.actions.searching", "Searching...")
              : t("myReportsPage.actions.search", "Search")}
          </button>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("myReportsPage.actions.reset", "Reset")}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-slate-700">
            <thead className="sticky top-0 z-10 bg-slate-900 text-slate-100">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide">
                  {t("myReportsPage.table.index", "#")}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                  {t("myReportsPage.table.reportId", "Report ID")}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                  {t("myReportsPage.table.clientName", "Client Name")}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                  {t("myReportsPage.table.source", "Source")}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                  {t("myReportsPage.table.status", "Status")}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                  {t("myReportsPage.table.updatedAt", "Updated At")}
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                    {t("myReportsPage.messages.loading", "Loading...")}
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                    {t("myReportsPage.messages.noRecords", "No records")}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, index) => {
                  const serial = (page - 1) * limit + index + 1;
                  const sourceView = SOURCE_ROUTE_MAP[row?.sourceKey];
                  const canOpenSource = sourceView && canAccessView(sourceView, user);
                  const clientName =
                    row?.raw?.client_name ||
                    row?.title ||
                    t("myReportsPage.messages.noTitle", "No Title");
                  const updatedAt = formatDateTime(
                    row?.updatedAt || row?.createdAt || row?.raw?.updatedAt || row?.raw?.createdAt,
                    activeLanguage,
                  );

                  return (
                    <tr
                      key={`${row?.sourceKey || "unknown"}:${row?._id || index}`}
                      className="odd:bg-white even:bg-slate-50/50 hover:bg-cyan-50/40"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-center text-xs text-slate-500">
                        {serial}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-800">
                        {row?.report_id || t("myReportsPage.messages.notCreated", "Not Created")}
                      </td>

                      <td className="max-w-[260px] truncate px-4 py-3 text-sm text-slate-700">
                        {clientName}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium">
                        {canOpenSource ? (
                          <button
                            type="button"
                            onClick={() => onViewChange(sourceView)}
                            className="text-cyan-700 underline-offset-4 hover:text-cyan-900 hover:underline"
                          >
                            {sourceLabelForRow(row)}
                          </button>
                        ) : (
                          <span className="text-slate-500">{sourceLabelForRow(row)}</span>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <StatusBadge t={t} statusKey={row?.statusKey} />
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">{updatedAt}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
          <button
            type="button"
            onClick={() => !isFirst && setPage((prev) => Math.max(1, prev - 1))}
            disabled={loading || isFirst}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("myReportsPage.pagination.previous", "Previous")}
          </button>

          <div className="flex flex-wrap items-center gap-1">
            {getPageNumbers().map((value, idx) =>
              value === "..." ? (
                <span key={`dots-${idx}`} className="px-2 py-1.5 text-xs text-slate-400">
                  ...
                </span>
              ) : (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPage(value)}
                  disabled={loading}
                  className={`h-9 min-w-[36px] rounded-lg border px-2 text-xs font-semibold ${
                    value === page
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  } disabled:opacity-60`}
                >
                  {value}
                </button>
              ),
            )}
          </div>

          <button
            type="button"
            onClick={() => !isLast && setPage((prev) => prev + 1)}
            disabled={loading || isLast}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("myReportsPage.pagination.next", "Next")}
          </button>
        </div>
      </div>
    </div>
  );
}
