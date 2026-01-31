import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import reportApi from "../../api/report.service";
import { useValueNav } from "../context/ValueNavContext";

const submitStateMap = {
  1: "Completed",
  0: "Pending",
  2: "Failed",
};

function StatusBadge({ state, reportStatus }) {
  // Prefer submit_state mapping, fallback to report_status string
  const label =
    state !== undefined && state !== null ? submitStateMap[state] || "NOT AVAILABLE" : reportStatus || "-";

  // Get status in uppercase for comparison
  const statusUpper = String(label).toUpperCase();

  // Color mapping based on report_status
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
  const { selectedCompany } = useValueNav();
  const selectedCompanyOfficeId = useMemo(() => {
    const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
    return officeId ? String(officeId) : "";
  }, [selectedCompany]);

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // filters
  const [reportId, setReportId] = useState("");
  const [source, setSource] = useState("ALL");
  const [submitState, setSubmitState] = useState("ALL");

  // Map source keys to their respective routes
  const sourceRouteMap = {
    "Upload Report (ElRajhi)": "upload-report-elrajhi",
    "Upload Manual Report": "duplicate-report",
    "Multi Excel Upload": "multi-excel-upload",
    "Submit Reports Quickly": "submit-reports-quickly",
    "Upload Assets": "upload-assets",
  };



  async function load() {
    setLoading(true);
    try {
      const res = await reportApi.getMyReports({
        page,
        limit,
        companyOfficeId: selectedCompanyOfficeId || null
      });
      console.log(res);
      
      setRows(res.data.data || []);
      setTotal(res.data.total || 0);
    } finally {
      setLoading(false);
    }
  }

async function searchAnything() {
  const q = String(reportId || "").trim();   // or use a new input state like searchText

  if (!q) {
    alert("Please enter something to search");
    return;
  }

  setLoading(true);
  try {
    const res = await reportApi.searchReports({
      q,
      page: 1,
      limit,
      source,
      companyOfficeId: selectedCompanyOfficeId || null
    });
    setRows(res.data.data || []);
    setTotal(res.data.total || res.data.totalApprox || 0);
    setPage(1);
  } catch (err) {
    console.error("Search failed:", err);
    console.log("status:", err?.response?.status);
    console.log("data:", err?.response?.data);
    alert(err?.response?.data?.error || err?.message || "Search failed");
  } finally {
    setLoading(false);
  }
}


  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, selectedCompanyOfficeId]);

  useEffect(() => {
    setPage(1);
  }, [selectedCompanyOfficeId]);

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
          <h2 className="text-xl font-semibold text-slate-900">My Reports</h2>
          <p className="text-sm text-slate-500">
            Showing <span className="font-sm text-slate-700">{filteredRows.length}</span> rows (page{" "}
            <span className="text-sm text-slate-700">{page}</span>)
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
                {n}/page
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="mb-1 block text-xs font-medium text-slate-600">Report ID</label>
            <input
              className="h-8 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Search For Anything..."
              value={reportId}
              onChange={(e) => setReportId(e.target.value)}
            />
          </div>

          <div className="md:col-span-4">
            <label className="mb-1 block text-xs font-medium text-slate-600">Source</label>
            <select
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="ALL">All Sources</option>
              <option value="Upload Report (ElRajhi)">Upload Report (ElRajhi)</option>
              <option value="Upload Manual Report">Upload Manual Report</option>
              <option value="Multi Excel Upload">Multi Excel Upload</option>
              <option value="Submit Reports Quickly">Submit Reports Quickly</option>
              <option value="Upload Assets">Upload Assets</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="mb-1 block text-xs font-medium text-slate-600">Submit State</label>
            <select
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={submitState}
              onChange={(e) => setSubmitState(e.target.value)}
            >
              <option value="ALL">All States</option>
              <option value="SENT">SENT</option>
              <option value="COMPLETE">COMPLETE</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="EDITED">EDITED</option>
              <option value="INCOMPLETE">INCOMPLETE</option>
              <option value="NOT_AVAILABLE">Not Available</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={searchAnything}
            disabled={loading}
            className="inline-flex h-8 items-center justify-center rounded-md bg-slate-900 px-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Searching..." : "Search"}
          </button>

          <button
            onClick={load}
            disabled={loading}
            className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-[10px] text-slate-700">
            <thead className="bg-blue-900/10 text-blue-900 sticky top-0">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 ">#</th>
                <th className="whitespace-nowrap px-3 py-2">Report ID</th>
                <th className="whitespace-nowrap px-3 py-2">Client Name</th>
                <th className="whitespace-nowrap px-3 py-2">Source</th>  
                <th className="whitespace-nowrap px-3 py-2">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-slate-500 text-center" colSpan={5}>
                    Loading...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-slate-500 text-center" colSpan={5}>
                    No records
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, index) => {
                  const serial = (page - 1) * limit + index + 1;

                  return (
                    <tr key={`${r.source}:${r._id}`} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-slate-500">
                        {serial}
                      </td>

                      <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-slate-500">
                        {r.report_id || "Not Created"}
                      </td>

                      <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-slate-500">
                        {r.raw?.client_name || r.title || "No Title"}
                      </td>

<td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] font-medium">
  {sourceRouteMap[r.sourceLabel || r.sourceKey] ? (
    <button
      type="button"
      onClick={() =>
        onViewChange(sourceRouteMap[r.sourceLabel || r.sourceKey])
      }
      className="text-blue-600 hover:text-blue-800 hover:underline"
    >
      {r.sourceLabel || r.sourceKey}
    </button>
  ) : (
    <span className="text-slate-500">
      {r.sourceLabel || r.sourceKey || "-"}
    </span>
  )}
</td>




                      <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-slate-500">
                        <StatusBadge
                          reportStatus={r.raw?.report_status || "Not Available"}
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
