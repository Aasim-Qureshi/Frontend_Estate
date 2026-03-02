import React, { useEffect, useMemo, useState } from "react";
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

function StatusBadge({ state, reportStatus, t }) {
  const statusUpper = String(reportStatus || "").trim().toUpperCase();
  const stateLabelMap = {
    1: t("myReportsPage.states.COMPLETE", "Complete"),
    0: t("myReportsPage.states.PENDING", "Pending"),
    2: t("myReportsPage.states.FAILED", "Failed"),
  };
  const statusLabelMap = {
    SENT: t("myReportsPage.states.SENT", "Sent"),
    COMPLETE: t("myReportsPage.states.COMPLETE", "Complete"),
    CONFIRMED: t("myReportsPage.states.CONFIRMED", "Confirmed"),
    EDITED: t("myReportsPage.states.EDITED", "Edited"),
    INCOMPLETE: t("myReportsPage.states.INCOMPLETE", "Incomplete"),
    "NOT AVAILABLE": t("myReportsPage.states.NOT_AVAILABLE", "Not Available"),
  };
  const label =
    state !== undefined && state !== null
      ? stateLabelMap[state] || t("myReportsPage.states.NOT_AVAILABLE", "Not Available")
      : statusLabelMap[statusUpper] || reportStatus || "-";

  const cls =
    statusUpper === "SENT"
      ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
      : statusUpper === "COMPLETE"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : statusUpper === "CONFIRMED"
      ? "bg-green-50 text-green-700 ring-1 ring-green-200"
      : statusUpper === "EDITED"
      ? "bg-green-50 text-blue-700 ring-1 ring-green-200"
      : statusUpper === "INCOMPLETE"
      ? "bg-slate-50 text-slate-700 ring-1 ring-slate-200"
      : statusUpper === "NOT AVAILABLE"
      ? "bg-red-50 text-red-700 ring-1 ring-red-200"
      : state === 1
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : state === 0
      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
      : state === 2
      ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
      : "bg-slate-50 text-slate-700 ring-1 ring-slate-200";

  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

export default function ReportsPage({ onViewChange = () => {} }) {
  const { t, i18n } = useTranslation();
  const { user, isGuest } = useSession();
  const { selectedCompany } = useValueNav();
  const userId = useMemo(
    () => user?._id || user?.id || user?.userId || user?.user?._id || null,
    [user],
  );
  const taqeemUser = useMemo(
    () => user?.taqeemUser || user?.taqeem?.username || null,
    [user],
  );
  const selectedCompanyOfficeId = useMemo(() => {
    const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
    return officeId ? String(officeId) : "";
  }, [selectedCompany]);
  const defaultCompanyOfficeId = useMemo(() => {
    const officeId = user?.defaultCompanyOfficeId || user?.taqeem?.defaultCompanyOfficeId;
    return officeId ? String(officeId).trim() : "";
  }, [user?.defaultCompanyOfficeId, user?.taqeem?.defaultCompanyOfficeId]);
  const companyOfficeIdForLookup = selectedCompanyOfficeId || defaultCompanyOfficeId;
  const shouldBlockGuestReports = useMemo(
    () => Boolean(isGuest && (taqeemUser || companyOfficeIdForLookup)),
    [companyOfficeIdForLookup, isGuest, taqeemUser],
  );
  const isArabicUi = String(i18n.resolvedLanguage || i18n.language || "")
    .toLowerCase()
    .startsWith("ar");
  const guestReloginMessage = isArabicUi
    ? "انت مسجل بالفعل على التطبيق، من فضلك اعد تسجيل الدخول مرة اخرى حتى تتمكن من عرض التقارير واخذ اي اجراءات."
    : "Your account is already registered. Please log in again to view reports and take actions.";
  const guestReloginActionLabel = isArabicUi ? "تسجيل الدخول بالهاتف" : "Login with phone";

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // filters
  const [reportId, setReportId] = useState("");
  const [source, setSource] = useState("ALL");
  const [submitState, setSubmitState] = useState("ALL");

  const sourceOptions = useMemo(
    () =>
      SOURCE_KEYS.map((key) => ({
        value: key,
        label: t(`myReportsPage.sources.${key}`, key),
      })),
    [t],
  );
  const sourceLabelForRow = (row) =>
    t(`myReportsPage.sources.${row?.sourceKey}`, row?.sourceLabel || row?.sourceKey || "-");


  async function load() {
    if (shouldBlockGuestReports) {
      setRows([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    try {
      const res = await reportApi.getMyReports({
        page,
        limit,
        companyOfficeId: companyOfficeIdForLookup || null,
        userId,
        taqeemUser: isGuest ? null : taqeemUser,
      });
      console.log(res);
      
      setRows(res.data.data || []);
      setTotal(res.data.total || 0);
    } finally {
      setLoading(false);
    }
  }

async function searchAnything() {
  if (shouldBlockGuestReports) {
    setRows([]);
    setTotal(0);
    return;
  }
  const q = String(reportId || "").trim();

  if (!q) {
    alert(t("myReportsPage.messages.searchPrompt", "Please enter something to search"));
    return;
  }

  setLoading(true);
  try {
    const res = await reportApi.searchReports({
      q,
      page: 1,
      limit,
      source,
      companyOfficeId: companyOfficeIdForLookup || null,
      userId,
      taqeemUser: isGuest ? null : taqeemUser,
    });
    setRows(res.data.data || []);
    setTotal(res.data.total || res.data.totalApprox || 0);
    setPage(1);
  } catch (err) {
    console.error("Search failed:", err);
    console.log("status:", err?.response?.status);
    console.log("data:", err?.response?.data);
    alert(
      err?.response?.data?.error ||
        err?.message ||
        t("myReportsPage.messages.searchFailed", "Search failed"),
    );
  } finally {
    setLoading(false);
  }
}


  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, companyOfficeIdForLookup, userId, taqeemUser, isGuest, shouldBlockGuestReports]);

  useEffect(() => {
    setPage(1);
  }, [companyOfficeIdForLookup]);

  if (shouldBlockGuestReports) {
    return (
      <div className="p-2">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm">
          <h2 className="text-base font-semibold">
            {isArabicUi ? "إعادة تسجيل الدخول مطلوبة" : "Login required"}
          </h2>
          <p className="mt-2 text-sm leading-6">{guestReloginMessage}</p>
          <button
            type="button"
            onClick={() => onViewChange("login")}
            className="mt-3 inline-flex h-9 items-center justify-center rounded-md bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-700"
          >
            {guestReloginActionLabel}
          </button>
        </div>
      </div>
    );
  }

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      // ✅ Source filter
      if (source !== "ALL" && String(r?.sourceKey || "") !== String(source)) return false;

      // ✅ Submit State filter
      if (submitState !== "ALL") {
        const reportStatus = r?.raw?.report_status;
        const reportStatusUpper = String(reportStatus || "").toUpperCase();

        // Map the filter options to the actual status values
        if (submitState === "SENT") {
          return reportStatusUpper === "SENT";
        }
        if (submitState === "COMPLETE") {
          return reportStatusUpper === "COMPLETE";
        }
        if (submitState === "CONFIRMED") {
          return reportStatusUpper === "CONFIRMED";
        }
        if (submitState === "EDITED") {
          return reportStatusUpper === "EDITED";
        }
        if (submitState === "INCOMPLETE") {
          return reportStatusUpper === "INCOMPLETE";
        }
        if (submitState === "NOT_AVAILABLE") {
          return reportStatusUpper === "NOT AVAILABLE" || reportStatusUpper === "" || !reportStatus;
        }

        return true;
      }

      return true;
    });
  }, [rows, source, submitState]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const isFirst = page === 1;
  const isLast = page === totalPages;

  const getPageNumbers = () => {
    const delta = 2; // how many pages before/after current
    const range = [];
    const rangeWithDots = [];
    let last;

    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= page - delta && i <= page + delta)
      ) {
        range.push(i);
      }
    }

    for (let i of range) {
      if (last) {
        if (i - last === 2) {
          rangeWithDots.push(last + 1);
        } else if (i - last !== 1) {
          rangeWithDots.push("...");
        }
      }
      rangeWithDots.push(i);
      last = i;
    }

    return rangeWithDots;
  };

  return (
    <div className="p-2">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {t("myReportsPage.title", "My Reports")}
          </h2>
          <p className="text-sm text-slate-500">
            {t("myReportsPage.summary", "Showing {{count}} rows (page {{page}})", {
              count: filteredRows.length,
              page,
            })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {t("myReportsPage.pagination.perPage", "{{count}}/page", { count: n })}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {t("myReportsPage.filters.reportId", "Report ID")}
            </label>
            <input
              className="h-8 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder={t("myReportsPage.filters.searchPlaceholder", "Search for anything...")}
              value={reportId}
              onChange={(e) => setReportId(e.target.value)}
            />
          </div>

          <div className="md:col-span-4">
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {t("myReportsPage.filters.source", "Source")}
            </label>
            <select
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={source}
              onChange={(e) => setSource(e.target.value)}
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
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {t("myReportsPage.filters.submitState", "Submit State")}
            </label>
            <select
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={submitState}
              onChange={(e) => setSubmitState(e.target.value)}
            >
              <option value="ALL">{t("myReportsPage.filters.allStates", "All States")}</option>
              <option value="SENT">{t("myReportsPage.states.SENT", "Sent")}</option>
              <option value="COMPLETE">{t("myReportsPage.states.COMPLETE", "Complete")}</option>
              <option value="CONFIRMED">{t("myReportsPage.states.CONFIRMED", "Confirmed")}</option>
              <option value="EDITED">{t("myReportsPage.states.EDITED", "Edited")}</option>
              <option value="INCOMPLETE">{t("myReportsPage.states.INCOMPLETE", "Incomplete")}</option>
              <option value="NOT_AVAILABLE">{t("myReportsPage.states.NOT_AVAILABLE", "Not Available")}</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={searchAnything}
            disabled={loading}
            className="inline-flex h-8 items-center justify-center rounded-md bg-slate-900 px-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? t("myReportsPage.actions.searching", "Searching...")
              : t("myReportsPage.actions.search", "Search")}
          </button>

          <button
            onClick={load}
            disabled={loading}
            className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("myReportsPage.actions.reset", "Reset")}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-[10px] text-slate-700">
            <thead className="bg-blue-900/10 text-blue-900 sticky top-0">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 ">{t("myReportsPage.table.index", "#")}</th>
                <th className="whitespace-nowrap px-3 py-2">{t("myReportsPage.table.reportId", "Report ID")}</th>
                <th className="whitespace-nowrap px-3 py-2">{t("myReportsPage.table.clientName", "Client Name")}</th>
                <th className="whitespace-nowrap px-3 py-2">{t("myReportsPage.table.source", "Source")}</th>  
                <th className="whitespace-nowrap px-3 py-2">{t("myReportsPage.table.status", "Status")}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-slate-500 text-center" colSpan={5}>
                    {t("myReportsPage.messages.loading", "Loading...")}
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-slate-500 text-center" colSpan={5}>
                    {t("myReportsPage.messages.noRecords", "No records")}
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, index) => {
                  const serial = (page - 1) * limit + index + 1;
                  const sourceView = SOURCE_ROUTE_MAP[r.sourceKey];
                  const canOpenSource = sourceView && canAccessView(sourceView, user);

                  return (
                    <tr key={`${r.source}:${r._id}`} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-slate-500">
                        {serial}
                      </td>

                      <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-slate-500">
                        {r.report_id || t("myReportsPage.messages.notCreated", "Not Created")}
                      </td>

                      <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-slate-500">
                        {r.raw?.client_name || r.title || t("myReportsPage.messages.noTitle", "No Title")}
                      </td>

                      <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] font-medium">
                        {canOpenSource ? (
                          <button
                            type="button"
                            onClick={() => onViewChange(sourceView)}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {sourceLabelForRow(r)}
                          </button>
                        ) : (
                          <span className="text-slate-500">{sourceLabelForRow(r)}</span>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-slate-500">
                        <StatusBadge
                          t={t}
                          state={r.raw?.submit_state}
                          reportStatus={r.raw?.report_status || "NOT AVAILABLE"}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-2">
          {getPageNumbers().map((p, idx) =>
            p === "..." ? (
              <span
                key={`dots-${idx}`}
                className="px-2 py-1.5 text-[10px] text-slate-400"
              >
                ...
              </span>
            ) : (
              <button
                key={p}
                onClick={() => setPage(p)}
                disabled={loading}
                className={`h-9 min-w-[36px] rounded-md border px-2 py-1.5 text-[10px]
                  ${
                    p === page
                      ? "bg-black text-white border-black"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                  }
                  disabled:opacity-60`}
              >
                {p}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
