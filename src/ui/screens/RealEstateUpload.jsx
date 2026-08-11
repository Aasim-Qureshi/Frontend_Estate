import React, { useState, useRef, useEffect } from "react";
import { useValueNav } from "../context/ValueNavContext";
import {
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Send,
  RotateCw,
  Globe,
  Loader2,
  MapPin,
  User,
  Calendar,
  Building2,
  Hash,
  Layers,
  Home,
  Info,
  Activity,
  DollarSign,
  ClipboardList,
  Search,
  FileText,
  RefreshCw,
} from "lucide-react";

import { useSession } from "../context/SessionContext";
import { useNavStatus } from "../context/NavStatusContext";
import { ensureTaqeemAuthorized } from "../../shared/helper/taqeemAuthWrap";

// ─── Option dictionaries (mirrors TransactionEvaluationPage.tsx) ──────────
const VALUATION_PURPOSES = {
  "1": "التمويل", "2": "الشراء", "3": "البيع", "4": "الرهن", "5": "محاسبة",
  "6": "إفلاس", "7": "استحواذ", "8": "التقرير المالي", "9": "الضرائب",
  "10": "الأغراض التأمينية", "11": "تقاضي", "12": "أغراض داخلية",
  "13": "نزع الملكية", "14": "نقل", "15": "ورث", "16": "اخرى",
  "17": "توزيع تركه", "18": "البيع القسري", "19": "معرفة القيمة السوقية",
  "20": "معرفة القيمة الإيجارية", "21": "التصفية", "50": "أغراض إستثمارية",
  "54": "التعويض",
};
const VALUATION_BASES = {
  "1": "القيمة السوقية", "2": "القيمة الاستثمارية", "3": "القيمة المنصفة",
  "4": "قيمة التصفية", "5": "القيمة التكاملية", "6": "الايجار السوقي",
  "7": "القيمة السوقية / قيمة الايجار السوقي", "8": "القيمة العادلة",
  "10": "الإدراج في القوائم المالية",
};
const VALUATION_HYPOTHESES = {
  "1": "الاستخدام الحالي", "2": "الاستخدام الأعلى والأفضل",
  "3": "التصفية المنظمة", "4": "البيع القسري",
};
const OWNERSHIP_TYPES = {
  "1": "الملكية المطلقة", "2": "الملكية المشروطة", "3": "الملكية المقيدة",
  "4": "ملكية مدى الحياة", "5": "منفعة", "6": "مشاع", "7": "ملكية مرهونة",
};
const STREET_FRONTS = { "0": "لا يوجد شارع", "1": "شارع واحد", "2": "شارعين", "3": "3 شوارع", "4": "4 شوارع" };
const ELEVATIONS = { "مرتفع": "مرتفع", "مستوي": "مستوي", "منخفض": "منخفض" };
const ASSET_CATEGORIES = { "1": "أراضي", "2": "مباني" };
const ENV_OPTIONS = [
  ["mosque", "مسجد"], ["commercialMarket", "سوق تجاري"], ["park", "حديقة"],
  ["governmentFacility", "مرفق حكومي"], ["highSpeedRoad", "طريق سريع"],
  ["otherServices", "خدمات أخرى"], ["educationalFacility", "مرفق تعليمي"],
  ["securityFacility", "مرفق أمني"], ["medicalFacility", "مرفق طبي"],
];

// key/src -> where the value lives on `report`; type drives which input renders.
const EDIT_FIELDS = [
  { key: "report_title", src: "report", label: "Report Title", type: "text" },
  { key: "valuationPurpose", src: "report", label: "Valuation Purpose", type: "select", options: VALUATION_PURPOSES },
  { key: "valuationHypothesis", src: "report", label: "Value Premise", type: "select", options: VALUATION_HYPOTHESES },
  { key: "valuationBasis", src: "report", label: "Value Base", type: "select", options: VALUATION_BASES },
  { key: "evalDate", src: "evalData", label: "Valuation Date", type: "date" },
  { key: "reportDate", src: "evalData", label: "Report Issuing Date", type: "date" },
  { key: "finalAssetValue", src: "evalData", label: "Final Value", type: "number" },
  { key: "propertyType", src: "evalData", label: "Asset Type", type: "text" },
  { key: "assetCategoryId", src: "evalData", label: "Asset Usage/Sector", type: "select", options: ASSET_CATEGORIES },
  { key: "evalDate", src: "evalData", label: "Inspection Date", type: "date", dupKey: "inspectionDate" },
  { key: "lat", src: "evalData", label: "Latitude", type: "text" },
  { key: "lng", src: "evalData", label: "Longitude", type: "text" },
  { key: "deedNumber", src: "evalData", label: "Certificate No.", type: "text" },
  { key: "ownershipType", src: "report", label: "Ownership Type", type: "select", options: OWNERSHIP_TYPES },
  { key: "streetFronts", src: "evalData", label: "Street Facing Fronts", type: "select", options: STREET_FRONTS },
  { key: "landSpace", src: "evalData", label: "Land Area", type: "text" },
  { key: "authorizedLandCoverPct", src: "evalData", label: "Authorized Land Cover %", type: "number" },
  { key: "elevation", src: "evalData", label: "Authorized Height", type: "select", options: ELEVATIONS },
  { key: "streetWidth", src: "evalData", label: "Street Width", type: "text" },
];

// ─── Data fetching ─────────────────────────────────────────────────────────
const useTransactions = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        // "http://167.71.231.64:3000/api/transactions?limit=100",
        "http://localhost:3000/api/transactions?limit=100",
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      console.log(json);
      const items = (json.items ?? []).map((t) => ({
        ...t,
        report_status: t.report_status ?? "UNKNOWN",
        // DB stores this as `reportId` (camelCase) — that IS the Taqeem ID.
        // Fall back through the other historical field names just in case
        // different endpoints/versions serialize it differently.
        taqeemId: t.taqeemId ?? t.reportId ?? t.report_id ?? null,
        taqeemSubmitted:
          t.taqeemSubmitted ?? !!(t.taqeemId ?? t.reportId ?? t.report_id),
        taqeemSent: t.taqeemSent ?? false,
        taqeemApproved: t.taqeemApproved ?? false,
        report_id: t.report_id ?? t.reportId ?? null,
        evalData: { ...(t.evalData ?? {}) },
      }));
      setReports(items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  return { reports, loading, error, refetch: fetchReports };
};

// ─── Config ────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  INCOMPLETE: {
    label: "Incomplete",
    dot: "bg-amber-400",
    pill: "bg-amber-50 text-amber-700 border-amber-200",
  },
  COMPLETE: {
    label: "Complete",
    dot: "bg-emerald-400",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  SENT: {
    label: "Sent",
    dot: "bg-blue-400",
    pill: "bg-blue-50 text-blue-700 border-blue-200",
  },
  CONFIRMED: {
    label: "Confirmed",
    dot: "bg-violet-400",
    pill: "bg-violet-50 text-violet-700 border-violet-200",
  },
  MISSING_ID: {
    label: "Missing ID",
    dot: "bg-rose-400",
    pill: "bg-rose-50 text-rose-700 border-rose-200",
  },
  DELETED: {
    label: "Deleted",
    dot: "bg-slate-300",
    pill: "bg-slate-50 text-slate-400 border-slate-200",
  },
  UNKNOWN: {
    label: "Unknown",
    dot: "bg-slate-300",
    pill: "bg-slate-50 text-slate-500 border-slate-200",
  },
};

const PROGRESS_STATUS_CONFIG = {
  NOT_SUBMITTED: {
    label: "Not Submitted",
    dot: "bg-slate-300",
    pill: "bg-slate-50 text-slate-500 border-slate-200",
  },
  SUBMITTED: {
    label: "Submitted",
    dot: "bg-indigo-400",
    pill: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  SENT: {
    label: "Sent to Approver",
    dot: "bg-blue-400",
    pill: "bg-blue-50 text-blue-700 border-blue-200",
  },
  APPROVED: {
    label: "Approved",
    dot: "bg-emerald-400",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
};

const getProgressStatus = (taqeemState) => {
  if (taqeemState.approved) return "APPROVED";
  if (taqeemState.sent) return "SENT";
  if (taqeemState.submitted || taqeemState.taqeemId) return "SUBMITTED";
  return "NOT_SUBMITTED";
};

const ENV_LABELS = {
  mosque: "Mosque",
  commercialMarket: "Commercial Market",
  park: "Park",
  governmentFacility: "Gov. Facility",
  highSpeedRoad: "Highway",
  educationalFacility: "Education",
  securityFacility: "Security",
  medicalFacility: "Medical",
  otherServices: "Other",
};

const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// Mirrors every field marked `# req` in realEstateSteps.py's field_map_1/2/3.
const REQUIRED_STEP1 = [
  { key: "valuationPurpose", src: "report", label: "Valuation Purpose" },
  { key: "valuationHypothesis", src: "report", label: "Valuation Hypothesis" },
  { key: "valuationBasis", src: "report", label: "Valuation Basis" },
  { key: "evalDate", src: "evalData", label: "Valuation Date" },
  { key: "reportDate", src: "evalData", label: "Report Date" },
  { key: "finalAssetValue", src: "evalData", label: "Final Asset Value" },
];

const REQUIRED_STEP2 = [
  { key: "propertyType", src: "evalData", label: "Property Type" },
  { key: "landUse", src: "evalData", label: "Land Use" }, // ⚠ verify evalData key
  { key: "lat", src: "evalData", label: "Latitude" },
  { key: "lng", src: "evalData", label: "Longitude" },
];

const REQUIRED_STEP3 = [
  { key: "deedNumber", src: "evalData", label: "Deed / Certificate No." },
  { key: "ownershipType", src: "report", label: "Ownership Type" },
  { key: "streetFronts", src: "evalData", label: "Street Facing Fronts" }, // ⚠ verify
  {
    key: "surroundingEnvironment",
    src: "evalData",
    label: "Surrounding Environment",
    isArray: true,
  },
  { key: "landSpace", src: "evalData", label: "Land Area" },
  {
    key: "authorizedLandCoverPct",
    src: "evalData",
    label: "Authorized Land Cover %",
  }, // ⚠ verify
  { key: "elevation", src: "evalData", label: "Authorized Height" }, // ⚠ verify
  { key: "streetWidth", src: "evalData", label: "Street Width" }, // ⚠ verify
];

const ALL_REQUIRED = [...REQUIRED_STEP1, ...REQUIRED_STEP2, ...REQUIRED_STEP3];

const getMissingFields = (report) => {
  const evalData = report.evalData || {};
  const hasClient = !!report.clientId;

  const missing = ALL_REQUIRED.filter(({ key, src, isArray }) => {
    const val = src === "report" ? report[key] : evalData?.[key];
    if (isArray) return !Array.isArray(val) || val.length === 0;
    return !val || String(val).trim() === "";
  });

  const warnings = [];

  // Client: clientId covers name/email/contact — nothing to check/require.
  if (!hasClient) {
    if (!evalData.clientName || String(evalData.clientName).trim() === "") {
      missing.push({ key: "clientName", label: "Client Name" });
    }
    if (!report.contactNo || String(report.contactNo).trim() === "") {
      missing.push({ key: "contactNo", label: "Client Contact No." });
    }
  }

  // Region: has ID → fine. Has name only → warn (name-match attempt).
  // Has neither → missing (defaults will be used).
  if (!evalData.regionId) {
    if (evalData.regionName && String(evalData.regionName).trim() !== "") {
      warnings.push({
        key: "regionName",
        label: `Region ("${evalData.regionName}") has no ID — will attempt to match by name; defaults used if unmatched`,
      });
    } else {
      missing.push({ key: "regionName", label: "Region" });
    }
  }

  // City: same pattern.
  if (!evalData.cityId) {
    if (evalData.cityName && String(evalData.cityName).trim() !== "") {
      warnings.push({
        key: "cityName",
        label: `City ("${evalData.cityName}") has no ID — will attempt to match by name; defaults used if unmatched`,
      });
    } else {
      missing.push({ key: "cityName", label: "City" });
    }
  }

  // Constraint: at least one valuation approach (market/income/cost) must have data.
  const usedApproaches = getUsedApproachMethods(evalData);
  if (Object.keys(usedApproaches).length === 0) {
    missing.push({
      key: "valuationApproach",
      label: "Valuation Approach (Market, Income or Cost)",
    });
  }

  return { missing, warnings };
};

const hasIncompleteData = (report) =>
  getMissingFields(report).missing.length > 0;

// ─── Open Taqeem browser ───────────────────────────────────────────────────
const openTaqeemBrowser = async (setBusy, reportId, action) => {
  setBusy(action);
  try {
    if (window?.electronAPI?.openTaqeemLogin) {
      await window.electronAPI.openTaqeemLogin({
        context: { reportId, action },
        preferChrome: false,
        waitForLogin: false,
      });
    } else {
      console.log(`[RealEstateUpload] ${action} → ${reportId}`);
    }
  } catch (err) {
    console.error(`[RealEstateUpload] openTaqeemLogin error:`, err);
  } finally {
    setBusy(null);
  }
};

// Steps match Taqeem workflow — no "ID Fetched", just 4 states
const PROGRESS_STEPS = [
  { id: "new", label: "New", color: "#94a3b8", activeBg: "#f1f5f9" },
  {
    id: "submitted",
    label: "Submitted",
    color: "#6366f1",
    activeBg: "#eef2ff",
  },
  { id: "sent", label: "Sent", color: "#3b82f6", activeBg: "#eff6ff" },
  { id: "approved", label: "Approved", color: "#10b981", activeBg: "#f0fdf4" },
];

const getProgressIndex = (report, queuedActions = []) => {
  if (report.taqeemApproved || queuedActions.includes("approve")) return 3;
  if (report.taqeemSent || queuedActions.includes("send")) return 2;
  if (report.taqeemSubmitted || queuedActions.includes("submit")) return 1;
  return 0;
};

// Maps a step's index to the dummyState/taqeemState key that ActionSelector
// puts into its `animating` array while that step's async work is in flight
// (see ActionSelector's setAnimating calls).
const STEP_KEYS = [null, "submitted", "sent", "approved"];

const StepProgress = ({ submitted, sent, approved, animating = [] }) => {
  const steps = [
    { label: "New" },
    { label: "Submitted" },
    { label: "Sent" },
    { label: "Approved" },
  ];

  const currentIdx = approved ? 3 : sent ? 2 : submitted ? 1 : 0;

  return (
    <div className="flex items-center gap-2 flex-1">
      {steps.map((step, i) => {
        const done = i <= currentIdx;
        const isLoading = STEP_KEYS[i] && animating.includes(STEP_KEYS[i]);

        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <div className="h-px flex-1 bg-slate-100">
                <div
                  style={{
                    height: "100%",
                    background: done ? "#6366f1" : "transparent",
                    transition: "width 600ms ease",
                    width: done ? "100%" : "0%",
                  }}
                />
              </div>
            )}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className="flex items-center justify-center rounded-full border"
                style={{
                  width: 22,
                  height: 22,
                  borderColor: isLoading || done ? "#6366f1" : "#e2e8f0",
                  background: isLoading ? "#fff" : done ? "#6366f1" : "#fff",
                }}
              >
                {isLoading ? (
                  <Loader2
                    className="animate-spin"
                    style={{ width: 12, height: 12, color: "#6366f1" }}
                  />
                ) : done ? (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="white"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="2,6 5,9 10,3" />
                  </svg>
                ) : (
                  <span
                    style={{ fontSize: 10, fontWeight: 700, color: "#cbd5e1" }}
                  >
                    {i + 1}
                  </span>
                )}
              </div>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: isLoading || done ? "#6366f1" : "#94a3b8",
                  whiteSpace: "nowrap",
                }}
              >
                {step.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
const ACTIONS = [
  { id: "submit", label: "Submit to Taqeem", requires: null },
  { id: "send", label: "Send to Approver", requires: "submit" },
  { id: "approve", label: "Approve", requires: "send" },
];

const ActionDropdown = ({ actions, done, queued, onToggle, isUnlocked }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedCount = queued.length;
  const allDone = actions.every((a) => done.has(a.id));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
      >
        {selectedCount > 0 ? (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
            {selectedCount} action{selectedCount > 1 ? "s" : ""} selected
          </span>
        ) : allDone ? (
          <span className="flex items-center gap-1 text-emerald-600">
            <CheckCircle2 className="w-3 h-3" />
            All done
          </span>
        ) : (
          "Select actions…"
        )}
        <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-20 w-52 rounded-xl border border-slate-200 bg-white shadow-lg py-1.5">
          {actions.map((a) => {
            const isDone = done.has(a.id);
            const isSelected = queued.includes(a.id);
            const unlocked = isUnlocked(a.id);
            const disabled = !unlocked && !isSelected;

            return (
              <label
                key={a.id}
                className={`flex items-center gap-2.5 px-3 py-2 text-[12px] font-medium transition-colors
                  ${
                    disabled
                      ? "text-slate-300 cursor-not-allowed"
                      : "text-slate-700 hover:bg-slate-50 cursor-pointer"
                  }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected || isDone}
                  disabled={disabled}
                  onChange={() => !disabled && onToggle(a.id)}
                  className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600 cursor-pointer disabled:cursor-not-allowed"
                />
                {isDone && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 -ml-0.5" />
                )}
                <span>{a.label}</span>
                {!isDone && !unlocked && (
                  <span className="ml-auto text-[10px] text-slate-300 font-normal">
                    locked
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Valuation method value calculations (ported from TransactionEvaluationPage.tsx) ──
const numFrom = (s) => {
  if (s === null || s === undefined || s === "") return 0;
  const n = parseFloat(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function computeSettlementNetMeter(evalData) {
  const comparisonRows = evalData.comparisonRows || [];
  const section1Rows = evalData.section1Rows || [];
  const settlementRows = evalData.settlementRows || [];
  const bases = evalData.settlementBases || [];
  const weights = evalData.settlementWeights || [];

  const activeComps = comparisonRows
    .map((row, i) => ({ row, originalIndex: i }))
    .filter(({ row }) => row.inReport !== false);
  const n = activeComps.length;
  if (n === 0) return 0;

  const origIdx = (c) => activeComps[c].originalIndex;
  const getBase = (c) => {
    const idx = origIdx(c);
    const stored = bases[idx];
    return stored !== undefined && stored !== ""
      ? stored
      : (comparisonRows[idx]?.price ?? "");
  };
  const getAdj = (row, c) => {
    const idx = origIdx(c);
    return (row.colAdj || [])[idx] ?? "";
  };

  const effectiveBases = Array.from({ length: n }, (_, c) => getBase(c));

  const s1AdjAmounts = Array.from({ length: n }, (_, c) => {
    const base = numFrom(effectiveBases[c]);
    return section1Rows
      .filter((r) => r.inReport !== false)
      .reduce((sum, r) => sum + base * (numFrom(getAdj(r, c)) / 100), 0);
  });

  const priceAfterS1 = Array.from({ length: n }, (_, c) => {
    const base = numFrom(effectiveBases[c]);
    return base ? base + s1AdjAmounts[c] : 0;
  });

  const s2AdjAmounts = Array.from({ length: n }, (_, c) => {
    const base = priceAfterS1[c];
    return settlementRows
      .filter((r) => r.inReport !== false)
      .reduce((sum, r) => sum + base * (numFrom(getAdj(r, c)) / 100), 0);
  });

  const priceAfterAll = Array.from(
    { length: n },
    (_, c) => priceAfterS1[c] + s2AdjAmounts[c],
  );

  const getWeight = (c) => weights[origIdx(c)] ?? "";
  const totalWeight = Array.from({ length: n }, (_, c) =>
    numFrom(getWeight(c)),
  ).reduce((s, v) => s + v, 0);
  if (Math.abs(totalWeight - 100) > 0.01) return 0;

  return Array.from(
    { length: n },
    (_, c) => priceAfterAll[c] * (numFrom(getWeight(c)) / 100),
  ).reduce((s, v) => s + v, 0);
}

function computeReplacementDerived(evalData) {
  const lines = evalData.replacementLines || [];
  const totalArea = lines.reduce((s, l) => s + numFrom(l.space), 0);
  const totalVal = lines.reduce((s, l) => s + numFrom(l.total || "0"), 0);

  const adminPct = numFrom(evalData.managementPct) / 100;
  const profPct = numFrom(evalData.professionalPct) / 100;
  const utilPct = numFrom(evalData.utilityNetworkPct) / 100;
  const emrgPct = numFrom(evalData.emergencyPct) / 100;
  const finPct = numFrom(evalData.financePct) / 100;
  const devProfit = numFrom(evalData.earningsRate) / 100;
  const yearDevPct = numFrom(evalData.yearDev) / 100;

  const indirectPct =
    adminPct + profPct + utilPct + emrgPct + finPct + yearDevPct;
  const indirect = totalVal * indirectPct;
  const directTotal = totalVal + indirect;
  const devProfitVal = directTotal * devProfit;
  const assetVal = directTotal + devProfitVal;

  const physPct = numFrom(evalData.depreciationPct);
  const econPct = numFrom(evalData.economicPct);
  const funcPct = numFrom(evalData.careerPct);
  const totalDep = Math.min(100, physPct + econPct + funcPct);

  const depVal = assetVal * (totalDep / 100);
  const netAsset = assetVal - depVal;
  const landDataTotal =
    numFrom(evalData.meterPriceLand) * numFrom(evalData.landSpace);
  const landAsset = landDataTotal + netAsset;

  return { netAsset, landDataTotal, landAsset };
}

function computeInvestmentTotal(evalData) {
  const entries = evalData.investmentEntries || [];
  return entries.reduce((total, entry) => {
    const lines = entry.lines || [];
    const capIncludedIncome = lines
      .filter((l) => l.inCapitalization !== false)
      .reduce((s, l) => s + numFrom(l.space) * numFrom(l.value), 0);
    const vacancyRate = numFrom(entry.vacancyRate);
    const vacancyAmt =
      capIncludedIncome * (vacancyRate ? vacancyRate / 100 : 0);
    const effectiveIncome = capIncludedIncome - vacancyAmt;
    const maintenanceRate = numFrom(entry.maintenanceRate);
    const maintenanceAmt =
      effectiveIncome * (maintenanceRate ? maintenanceRate / 100 : 0);
    const noi = effectiveIncome - maintenanceAmt;
    const capRate = numFrom(entry.capitalizationRate);
    return total + (capRate > 0 ? noi / (capRate / 100) : 0);
  }, 0);
}

function computeComparisonValue(evalData) {
  const manual = numFrom(evalData.marketMethodTotal);
  if (manual > 0) return manual;
  const settlNetMeter = computeSettlementNetMeter(evalData);
  const meterPrice = numFrom(evalData.marketMeterPrice) || settlNetMeter;
  const area =
    numFrom(evalData.propertyAreaMethod) || numFrom(evalData.propertyArea);
  return meterPrice * area;
}

function computeReplacementCostValue(evalData) {
  const manual = numFrom(evalData.costLandBuildTotal);
  if (manual > 0) return manual;
  const derived = computeReplacementDerived(evalData);
  const userBuildings = numFrom(evalData.costNetBuildings);
  const userLand = numFrom(evalData.costNetLandPrice);
  if (userBuildings > 0 || userLand > 0) {
    return (
      (userBuildings || derived.netAsset) + (userLand || derived.landDataTotal)
    );
  }
  return derived.landAsset;
}

function computeInvestmentMethodValue(evalData) {
  return computeInvestmentTotal(evalData);
}

function getUsedApproachMethods(evalData) {
  const used = {};
  const market = computeComparisonValue(evalData);
  const income = computeInvestmentMethodValue(evalData);
  const cost = computeReplacementCostValue(evalData);
  if (market > 0) used.market = market;
  if (income > 0) used.income = income;
  if (cost > 0) used.cost = cost;
  return used;
}
const RealEstateCompanyFetchModal = ({ busy, error, onContinue, onCancel }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
    onClick={busy ? undefined : onCancel}
  >
    <div
      className="w-96 rounded-2xl border border-slate-200 bg-white shadow-2xl p-5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100">
          <Building2 className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <p className="text-[13px] font-bold text-slate-800">
            No real estate companies found
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            We couldn't find any saved real estate companies. Continue to fetch
            them from Taqeem — you may need to log in first.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={onContinue}
          disabled={busy}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Continue"}
        </button>
      </div>
    </div>
  </div>
);
// ─── Approach role picker (primary / secondary / unused) ─────────────────────
const APPROACH_LABELS = {
  market: "Comparison Approach",
  income: "Investment Approach",
  cost: "Replacement Cost Approach",
};

const ApproachSelectionModal = ({ usedMethods, onConfirm, onCancel }) => {
  const keys = Object.keys(usedMethods);
  const [selections, setSelections] = useState(() => {
    const init = {};
    keys.forEach((k, i) => {
      init[k] = i === 0 ? "1" : "2"; // default: first = primary, rest = secondary
    });
    return init;
  });

  const hasPrimary = Object.values(selections).some((v) => v === "1");

  const setStatus = (key, status) =>
    setSelections((prev) => ({ ...prev, [key]: status }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-96 rounded-2xl border border-slate-200 bg-white shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[13px] font-bold text-slate-800 mb-1">
          Select valuation approach roles
        </p>
        <p className="text-[11px] text-slate-500 mb-4">
          More than one valuation method has data. Choose which is primary,
          which are secondary, or mark any as unused.
        </p>

        <div className="space-y-3 mb-4">
          {keys.map((key) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-semibold text-slate-700">
                {APPROACH_LABELS[key]}
              </span>
              <select
                value={selections[key] ?? "unused"}
                onChange={(e) =>
                  setStatus(
                    key,
                    e.target.value === "unused" ? null : e.target.value,
                  )
                }
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
              >
                <option value="1">Primary</option>
                <option value="2">Secondary</option>
                <option value="unused">Unused</option>
              </select>
            </div>
          ))}
        </div>

        {!hasPrimary && (
          <p className="text-[11px] text-amber-600 font-medium mb-3">
            Select one approach as Primary to continue.
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            disabled={!hasPrimary}
            onClick={() => onConfirm(selections)}
            className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Shared Taqeem action runner — used by both the single-row selector
// and the bulk action bar, so behavior (and the Python/IPC call) is
// identical either way. ─────────────────────────────────────────────────
async function performTaqeemActions({
  report,
  queuedActions,
  approachSelections,
  token,
  login,
  onViewChange,
  isTaqeemLoggedIn,
  setTaqeemStatus,
  onProgress, // (patch) => void — merged into the report's taqeem state
  onAnimating, // (stepKeys[]) => void — drives the progress-bar spinner
}) {
  const authStatus = await ensureTaqeemAuthorized(
    token,
    onViewChange,
    isTaqeemLoggedIn,
    0, // assetCount — no point deduction for real estate
    login,
    setTaqeemStatus,
    { isGuest: !token },
  );

  const ok =
    authStatus === true ||
    authStatus?.success === true ||
    [
      "SUCCESS",
      "CHECK",
      "AUTHORIZED",
      "SYNCED",
      "LOGIN_SUCCESS",
      "NORMAL_ACCOUNT",
      "BOOTSTRAP_GRANTED",
    ].includes(String(authStatus?.status || "").toUpperCase());

  if (!ok) return { ok: false };

  if (queuedActions.includes("submit")) {
    onAnimating(["submitted"]);
    let submitResult = null;
    try {
      let pdfPath = null;

      if (window?.electronAPI?.downloadRealEstatePdf) {
        const pdfResult = await window.electronAPI.downloadRealEstatePdf(
          report.id,
        );
        if (pdfResult?.status === "SUCCESS" && pdfResult.filePath) {
          pdfPath = pdfResult.filePath;
        } else {
          console.warn(
            "[RealEstateUpload] PDF download failed, submitting without report_asset_file:",
            pdfResult?.error,
          );
        }
      }

      if (window?.electronAPI?.submitRealEstateReport) {
        submitResult = await window.electronAPI.submitRealEstateReport(
          report.id,
          pdfPath,
          approachSelections,
        );
      } else {
        console.log(
          "[RealEstateUpload] submitRealEstateReport not available, recordId:",
          report.id,
        );
      }
    } catch (err) {
      console.error("[RealEstateUpload] submitRealEstateReport error:", err);
    }

    const newTaqeemId =
      submitResult?.report_id ??
      submitResult?.results?.[0]?.report_id ??
      submitResult?.data?.report_id ??
      null;

    onProgress({
      submitted: true,
      ...(newTaqeemId ? { taqeemId: newTaqeemId, idFetched: true } : {}),
    });
    onAnimating([]);
  }

  if (queuedActions.includes("send")) {
    onAnimating(["sent"]);
    await new Promise((r) => setTimeout(r, 5000));
    onProgress({ sent: true });
    await new Promise((r) => setTimeout(r, 100));
    onAnimating([]);
  }

  if (queuedActions.includes("approve")) {
    onAnimating(["approved"]);
    await new Promise((r) => setTimeout(r, 5000));
    onProgress({ approved: true });
    await new Promise((r) => setTimeout(r, 100));
    onAnimating([]);
  }

  return { ok: true };
}

const ActionSelector = ({
  reportId,
  report,
  onAction,
  missingFields = [],
  warningFields = [],
  taqeemState,
  onStateChange,
  onAnimatingChange,
  token,
  login,
  onViewChange,
  isTaqeemLoggedIn,
  setTaqeemStatus,
  selectedCompany,
}) => {
  const [queued, setQueued] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [showApproachModal, setShowApproachModal] = useState(false);
  const [pendingUsedMethods, setPendingUsedMethods] = useState({});
  const [approachSelections, setApproachSelections] = useState(null);

  const doneFromReport = new Set();
  if (taqeemState.submitted || taqeemState.taqeemId)
    doneFromReport.add("submit");
  if (taqeemState.sent) doneFromReport.add("send");
  if (taqeemState.approved) doneFromReport.add("approve");

  const isUnlocked = (actionId) => {
      // Temporarily disabled — only "submit" is available for now.
      if (actionId !== "submit") return false;
      return true;
    };

  const toggleAction = (actionId) => {
    setQueued((prev) => {
      if (prev.includes(actionId)) return prev.slice(0, prev.indexOf(actionId));
      if (!isUnlocked(actionId)) return prev;
      return [...prev, actionId];
    });
  };

  const proceed = async (resolvedApproachSelections = approachSelections) => {
    setShowWarning(false);
    setBusy(true);

    const result = await performTaqeemActions({
      report,
      queuedActions: queued,
      approachSelections: resolvedApproachSelections,
      token,
      login,
      onViewChange,
      isTaqeemLoggedIn,
      setTaqeemStatus,
      onProgress: onStateChange,
      onAnimating: onAnimatingChange,
    });

    if (result.ok && onAction) queued.forEach((a) => onAction(a, reportId));
    setQueued([]);
    setBusy(false);
  };

  const handleGo = () => {
    if (!queued.length) return;

    if (!selectedCompany || selectedCompany.type !== "real-estate") {
      setShowWarning(true);
      return;
    }

    if (queued.includes("submit")) {
      const used = getUsedApproachMethods(report.evalData || {});
      const usedCount = Object.keys(used).length;

      if (usedCount >= 2) {
        setPendingUsedMethods(used);
        setShowApproachModal(true);
        return;
      }

      const auto = {};
      Object.keys(used).forEach((key) => {
        auto[key] = "1";
      });
      setApproachSelections(auto);

      if (missingFields.length > 0 || warningFields.length > 0)
        setShowWarning(true);
      else proceed(auto);
      return;
    }

    if (missingFields.length > 0 || warningFields.length > 0)
      setShowWarning(true);
    else proceed();
  };

  const handleApproachConfirm = (selections) => {
    setApproachSelections(selections);
    setShowApproachModal(false);
    if (missingFields.length > 0 || warningFields.length > 0)
      setShowWarning(true);
    else proceed(selections);
  };

  return (
    <>
      <div
        className="flex items-center gap-1 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {(missingFields.length > 0 || warningFields.length > 0) && (
          <IncompleteDataBadge
            missingFields={missingFields}
            warningFields={warningFields}
            iconOnly
          />
        )}
        <ActionDropdown
          actions={ACTIONS}
          done={doneFromReport}
          queued={queued}
          onToggle={toggleAction}
          isUnlocked={isUnlocked}
        />
        <button
          type="button"
          disabled={!queued.length || busy}
          onClick={handleGo}
          className="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Go"}
        </button>
      </div>
      {showApproachModal && (
        <ApproachSelectionModal
          usedMethods={pendingUsedMethods}
          onConfirm={handleApproachConfirm}
          onCancel={() => setShowApproachModal(false)}
        />
      )}
      {showWarning && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowWarning(false)}
        >
          <div
            className="w-80 rounded-2xl border border-amber-200 bg-white shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-slate-800">
                  Missing required fields
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  The following fields are missing. If you continue, default
                  values will be used for them:
                </p>
              </div>
            </div>
            <ul className="mb-4 space-y-1 rounded-lg bg-amber-50 border border-amber-100 p-3">
              {missingFields.map(({ label }) => (
                <li
                  key={label}
                  className="flex items-center gap-1.5 text-[11px] text-amber-800 font-medium"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                  {label}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                onClick={() => setShowWarning(false)}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => proceed()}
                className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-[12px] font-semibold text-white hover:bg-amber-600"
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
const IncompleteDataBadge = ({
  missingFields,
  warningFields = [],
  iconOnly = false,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const hasAny = missingFields.length > 0 || warningFields.length > 0;
  if (!hasAny) return null;

  return (
    <div
      className="relative"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        className={
          iconOnly
            ? "flex items-center justify-center w-5 h-5 rounded-full bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
            : "flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
        }
      >
        <AlertTriangle
          className={`${iconOnly ? "w-3 h-3" : "w-3.5 h-3.5"} text-amber-500 shrink-0`}
        />
        {!iconOnly && (
          <>
            {missingFields.length > 0 && (
              <>
                {missingFields.length} missing field
                {missingFields.length > 1 ? "s" : ""}
              </>
            )}
            {missingFields.length > 0 && warningFields.length > 0 && " · "}
            {warningFields.length > 0 && (
              <>
                {warningFields.length} warning
                {warningFields.length > 1 ? "s" : ""}
              </>
            )}
            <ChevronDown className="w-3 h-3 text-amber-400" />
          </>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-20 w-64 rounded-xl border border-amber-200 bg-white shadow-lg p-3 space-y-3">
          {missingFields.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-rose-500 mb-2">
                Missing fields
              </p>
              <ul className="space-y-1">
                {missingFields.map(({ label }) => (
                  <li
                    key={label}
                    className="flex items-center gap-1.5 text-[11px] text-slate-600"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {warningFields.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600 mb-2">
                Warnings
              </p>
              <ul className="space-y-1">
                {warningFields.map(({ label, key }) => (
                  <li
                    key={key}
                    className="flex items-start gap-1.5 text-[11px] text-slate-600"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0 mt-1" />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
// ─── Micro components ──────────────────────────────────────────────────────
const Field = ({ label, value, mono = false, span = 1 }) => (
  <div className={span === 2 ? "col-span-2" : ""}>
    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
      {label}
    </dt>
    <dd
      className={`text-[12px] text-slate-800 leading-snug ${mono ? "font-mono" : "font-medium"}`}
    >
      {value || <span className="text-slate-300 font-normal">—</span>}
    </dd>
  </div>
);

const SectionHeader = ({ icon: Icon, title, accent = "indigo" }) => {
  const colors = {
    indigo: "text-indigo-500 bg-indigo-50",
    emerald: "text-emerald-600 bg-emerald-50",
    amber: "text-amber-600 bg-amber-50",
    blue: "text-blue-600 bg-blue-50",
  };
  return (
    <div className="flex items-center gap-2 mb-3">
      <div
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${colors[accent]}`}
      >
        <Icon className="w-3 h-3" />
      </div>
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {title}
      </span>
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  );
};

const Tag = ({ children, color = "slate" }) => {
  const palettes = {
    slate: "bg-slate-100 text-slate-600 border-slate-200",
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
    blue: "bg-blue-50 text-blue-700 border-blue-100",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${palettes[color]}`}
    >
      {children}
    </span>
  );
};

// ─── Expanded detail (compact, only the fields that matter) ───────────────
const ExpandedDetail = ({ report, onSaved, regions = [], cities = [] }) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

  const e = report.evalData || {};
  const used = getUsedApproachMethods(e);
  const env = (e.surroundingEnvironment || []).map((k) => ENV_LABELS[k] || k);

  const APPROACH_META = {
    market: { label: "Comparison Method", accent: "text-indigo-700 bg-indigo-50 border-indigo-100" },
    income: { label: "Investment Method", accent: "text-emerald-700 bg-emerald-50 border-emerald-100" },
    cost: { label: "Replacement Cost Method", accent: "text-amber-700 bg-amber-50 border-amber-100" },
  };

  // Resolve display text for region/city: prefer the fetched list (by id),
  // fall back to the stored *Name string if the id lookup misses.
  const regionMatch = regions.find((r) => r.id === e.regionId || r._id === e.regionId);
  const regionDisplay = regionMatch?.titleAr || e.regionName || "";

  const citiesForCurrentRegion = e.regionId
    ? cities.filter((c) => (c.regionId ?? c.region_id) === e.regionId)
    : cities;
  const cityMatch = cities.find((c) => c.id === e.cityId || c._id === e.cityId);
  const cityDisplay = cityMatch?.titleAr || e.cityName || "";

  const startEditing = () => {
    const init = {};
    EDIT_FIELDS.forEach((f) => {
      const src = f.src === "report" ? report : e;
      init[f.dupKey || `${f.src}.${f.key}`] = src[f.key] ?? "";
    });
    init.surroundingEnvironment = e.surroundingEnvironment || [];
    init.regionId = e.regionId || "";
    init.cityId = e.cityId || "";
    setForm(init);
    setEditing(true);
  };

  const setVal = (f, val) =>
    setForm((p) => ({ ...p, [f.dupKey || `${f.src}.${f.key}`]: val }));

  const getVal = (f) => form?.[f.dupKey || `${f.src}.${f.key}`] ?? "";

  const toggleEnv = (key) =>
    setForm((p) => ({
      ...p,
      surroundingEnvironment: p.surroundingEnvironment.includes(key)
        ? p.surroundingEnvironment.filter((k) => k !== key)
        : [...p.surroundingEnvironment, key],
    }));

  const citiesForFormRegion = form?.regionId
    ? cities.filter((c) => (c.regionId ?? c.region_id) === form.regionId)
    : cities;

  const handleSave = async () => {
    setSaving(true);
    const evalDataPatch = { ...e };
    const topLevelPatch = {};
    EDIT_FIELDS.forEach((f) => {
      const val = form[f.dupKey || `${f.src}.${f.key}`];
      if (f.dupKey) return;
      if (f.src === "evalData") evalDataPatch[f.key] = val;
      else topLevelPatch[f.key] = val;
    });
    evalDataPatch.surroundingEnvironment = form.surroundingEnvironment;

    // Region/city: persist id + a display-name snapshot (titleAr) so old
    // consumers reading *Name keep working, and the id is authoritative
    // for taqeemId lookups downstream.
    const chosenRegion = regions.find((r) => r.id === form.regionId || r._id === form.regionId);
    const chosenCity = cities.find((c) => c.id === form.cityId || c._id === form.cityId);
    evalDataPatch.regionId = form.regionId || "";
    evalDataPatch.regionName = chosenRegion?.titleAr || "";
    evalDataPatch.cityId = form.cityId || "";
    evalDataPatch.cityName = chosenCity?.titleAr || "";

    try {
      const res = await fetch(`http://localhost:5000/api/transactions/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evalData: evalDataPatch, ...topLevelPatch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await res.json();
      onSaved?.(updated);
      setEditing(false);
    } catch (err) {
      console.error("[ExpandedDetail] save failed:", err);
      alert("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-slate-100 bg-white p-5">
      <div className="flex items-center justify-end mb-3 gap-2">
        {editing ? (
          <>
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
            </button>
          </>
        ) : (
          <button
            onClick={startEditing}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            Edit
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
        {EDIT_FIELDS.map((f) => {
          const rawVal = f.src === "report" ? report[f.key] : e[f.key];
          const displayVal =
            f.type === "select" && rawVal
              ? f.options[rawVal] ?? rawVal
              : f.key === "finalAssetValue" && rawVal
                ? `SAR ${rawVal}`
                : rawVal;

          if (!editing) {
            return <Field key={f.label} label={f.label} value={displayVal} />;
          }
          return (
            <div key={f.label}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                {f.label}
              </dt>
              {f.type === "select" ? (
                <select
                  value={getVal(f)}
                  onChange={(ev) => setVal(f, ev.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]"
                >
                  <option value="">—</option>
                  {Object.entries(f.options).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                  value={getVal(f)}
                  onChange={(ev) => setVal(f, ev.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]"
                />
              )}
            </div>
          );
        })}

        {/* Region — dropdown fetched from SparkVision (localhost:5000) */}
        {!editing ? (
          <Field label="Region" value={regionDisplay} />
        ) : (
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              Region
            </dt>
            <select
              value={form.regionId}
              onChange={(ev) =>
                setForm((p) => ({ ...p, regionId: ev.target.value, cityId: "" }))
              }
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]"
            >
              <option value="">—</option>
              {regions.map((r) => (
                <option key={r.id || r._id} value={r.id || r._id}>
                  {r.titleAr}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* City — filtered by chosen region */}
        {!editing ? (
          <Field label="City" value={cityDisplay} />
        ) : (
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              City
            </dt>
            <select
              value={form.cityId}
              onChange={(ev) => setForm((p) => ({ ...p, cityId: ev.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]"
            >
              <option value="">—</option>
              {citiesForFormRegion.map((c) => (
                <option key={c.id || c._id} value={c.id || c._id}>
                  {c.titleAr}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Surrounding environment — multi-select */}
      <div className="mt-4">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
          Surrounding Environment
        </dt>
        {!editing ? (
          <div className="flex flex-wrap gap-1.5">
            {env.map((item) => <Tag key={item} color="indigo">{item}</Tag>)}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ENV_OPTIONS.map(([key, label]) => {
              const active = form.surroundingEnvironment.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleEnv(key)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                    active
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-slate-500 border-slate-200"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {Object.keys(used).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(used).map(([key, val]) => (
            <div key={key} className={`rounded-lg border px-3 py-2 ${APPROACH_META[key].accent}`}>
              <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{APPROACH_META[key].label}</p>
              <p className="text-[13px] font-black">
                SAR {val.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
// ─── Bulk Action Bar ──────────────────────────────────────────────────────
const BulkBar = ({ selected, total, onSelectAll, onClearAll, onAction }) => {
  const [pendingAction, setPendingAction] = useState("");
  const count = selected.size;

  const handleGo = () => {
    if (!pendingAction || count === 0) return;
    onAction(pendingAction, Array.from(selected));
    setPendingAction("");
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5">
      <span className="text-[12px] font-semibold text-indigo-700 shrink-0">
        {count} selected
      </span>
      <div className="h-4 w-px bg-indigo-200 shrink-0" />
      <select
        value={pendingAction}
        onChange={(e) => setPendingAction(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 cursor-pointer"
      >
        <option value="">Select action…</option>
        {ACTIONS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!pendingAction}
        onClick={handleGo}
        className="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Go
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onSelectAll}
        className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
      >
        Select all {total}
      </button>
      <button
        type="button"
        onClick={onClearAll}
        className="text-[11px] font-semibold text-slate-500 hover:text-slate-700"
      >
        Clear
      </button>
    </div>
  );
};

// ─── Table Header Row ─────────────────────────────────────────────────────
const TableHeader = ({ allSelected, onToggleAll }) => (
  <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-100 border border-slate-200">
    <div className="shrink-0 w-5 flex items-center justify-center">
      <input
        type="checkbox"
        checked={allSelected}
        onChange={onToggleAll}
        className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600 cursor-pointer"
      />
    </div>
    <div className="shrink-0 w-4" />
    <div className="shrink-0 w-24 flex items-center">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Status
      </span>
    </div>
    <div className="shrink-0 w-16">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        No.
      </span>
    </div>
    <div className="shrink-0 w-px" />
    <div className="shrink-0 w-28 hidden lg:flex justify-center">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Taqeem ID
      </span>
    </div>
    <div className="flex-1 flex justify-center">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Progress
      </span>
    </div>
    <div className="shrink-0 w-48 flex justify-end">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Action
      </span>
    </div>
  </div>
);
const ReportRow = ({
  report,
  selected,
  onToggle,
  token,
  login,
  onViewChange,
  isTaqeemLoggedIn,
  setTaqeemStatus,
  selectedCompany,
  taqeemState,
  onStateChange,
  animatingSteps,
  onAnimatingChange,
  onReportSaved,
  regions,
  cities,

}) => {
  const [expanded, setExpanded] = useState(false);

  const e = report.evalData;
  const cfg = STATUS_CONFIG[report.report_status] || STATUS_CONFIG.INCOMPLETE;
  const { missing: missingFields, warnings: warningFields } =
    getMissingFields(report);

  const getBottomBadge = () => {
    if (taqeemState.approved)
      return {
        label: "Approved",
        dot: "bg-emerald-400",
        pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    if (taqeemState.sent)
      return {
        label: "Sent",
        dot: "bg-blue-400",
        pill: "bg-blue-50 text-blue-700 border-blue-200",
      };
    if (taqeemState.submitted)
      return {
        label: "Submitted",
        dot: "bg-indigo-400",
        pill: "bg-indigo-50 text-indigo-700 border-indigo-200",
      };
    if (taqeemState.idFetched)
      return {
        label: "Incomplete",
        dot: "bg-violet-400",
        pill: "bg-violet-50 text-violet-700 border-violet-200",
      };
    return {
      label: "New",
      dot: "bg-slate-300",
      pill: "bg-slate-50 text-slate-500 border-slate-200",
    };
  };

  const bottomBadge = getBottomBadge();

  return (
    <div
      className={`rounded-xl border bg-white transition-all duration-200 ${
        expanded
          ? "border-indigo-200 shadow-[0_4px_20px_rgba(99,102,241,0.08)]"
          : selected
            ? "border-indigo-300 bg-indigo-50/30"
            : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      <div
        className="px-4 pt-3 pb-2 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <div
            className="shrink-0 w-5 flex items-center justify-center"
            onClick={(ev) => ev.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggle(report.id)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600 cursor-pointer"
            />
          </div>
          <div className="shrink-0 w-4 text-slate-300">
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-indigo-400" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>
          <div className="shrink-0 w-24 flex items-center">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${bottomBadge.pill}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${bottomBadge.dot}`}
              />
              {bottomBadge.label}
            </span>
          </div>
          <div className="shrink-0 w-16">
            <p className="text-[13px] font-black text-slate-800 font-mono">
              #{report.assignmentNumber}
            </p>
          </div>

          <div className="shrink-0 w-28 hidden lg:flex justify-center">
            <p className="text-[12px] font-mono text-slate-700">
              {taqeemState.taqeemId || (
                <span className="text-slate-300">—</span>
              )}
            </p>
          </div>
          <div
            className="flex-1 flex items-center min-w-0"
            onClick={(ev) => ev.stopPropagation()}
          >
            <StepProgress
              submitted={taqeemState.submitted}
              sent={taqeemState.sent}
              approved={taqeemState.approved}
              animating={animatingSteps}
            />
          </div>
          <div
            className="shrink-0 w-48 flex items-center justify-end gap-2"
            onClick={(ev) => ev.stopPropagation()}
          >
            <ActionSelector
              reportId={report.id}
              report={report}
              missingFields={missingFields}
              warningFields={warningFields}
              taqeemState={taqeemState}
              onStateChange={onStateChange}
              onAnimatingChange={onAnimatingChange}
              token={token}
              login={login}
              onViewChange={onViewChange}
              isTaqeemLoggedIn={isTaqeemLoggedIn}
              setTaqeemStatus={setTaqeemStatus}
              selectedCompany={selectedCompany}
            />
          </div>
        </div>
      </div>

      {expanded && (
        <div className="overflow-hidden">
          <ExpandedDetail
              report={report}
              onSaved={(updated) => onReportSaved?.(updated)}
              regions={regions}
              cities={cities}

            />
        </div>
      )}
    </div>
  );
};


// ─── Main Screen ────────────────────────────────────────────────────────────
export default function RealEstateUpload({ onViewChange }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const { token, login, user } = useSession();
  const { taqeemStatus, setTaqeemStatus } = useNavStatus();
  const isTaqeemLoggedIn = taqeemStatus?.state === "success";
  const [authError, setAuthError] = useState("");
  const [taqeemStates, setTaqeemStates] = useState({});
  const [animatingByReport, setAnimatingByReport] = useState({});
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [companyModalBusy, setCompanyModalBusy] = useState(false);
  const [companyModalError, setCompanyModalError] = useState("");
  const [regions, setRegions] = useState([]);
  const [cities, setCities] = useState([]);

  useEffect(() => {
    fetch("http://localhost:5000/api/locations/regions")
      .then((r) => r.json())
      .then(setRegions)
      .catch((err) => console.error("[RealEstateUpload] regions fetch failed:", err));
    fetch("http://localhost:5000/api/locations/cities")
      .then((r) => r.json())
      .then(setCities)
      .catch((err) => console.error("[RealEstateUpload] cities fetch failed:", err));
  }, []);

  const waitForManualTaqeemLogin = async (timeoutMs = 180000, intervalMs = 2000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await window.electronAPI.checkStatus();
      const statusText = String(res?.status || "").toUpperCase();
      const loggedIn = res?.browserOpen && statusText.includes("SUCCESS");
      const notLogged = statusText.includes("NOT_LOGGED_IN");
      if (loggedIn) return res;
      if (!res?.browserOpen && !notLogged) {
        throw new Error("Login window closed.");
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error("Timed out waiting for Taqeem login.");
  };

  const fetchRealEstateCompaniesViaTaqeem = async () => {
    setCompanyModalBusy(true);
    setCompanyModalError("");
    try {
      if (!isTaqeemLoggedIn) {
        if (!window?.electronAPI?.openTaqeemLogin) {
          throw new Error("Login handler unavailable.");
        }
        setTaqeemStatus("info", "Opening Taqeem login...");
        const loginResult = await window.electronAPI.openTaqeemLogin({
          automationOnly: true,
          onlyIfClosed: true,
          navigateIfOpen: false,
        });
        if (loginResult?.status !== "SUCCESS") {
          throw new Error(loginResult?.error || "Taqeem login failed.");
        }
        setTaqeemStatus("info", "Waiting for you to finish login...");
        await waitForManualTaqeemLogin();
        setTaqeemStatus("success", "Taqeem login: On");
      }

      if (!window?.electronAPI?.getCompaniesRealEstate) {
        throw new Error("Real estate company fetch unavailable.");
      }

      const data = await window.electronAPI.getCompaniesRealEstate();
      if (
        data?.status === "SUCCESS" &&
        Array.isArray(data.data) &&
        data.data.length > 0
      ) {
        const tagged = data.data.map((c) => ({ ...c, type: "real-estate" }));
        const freshSession = await ensureGuestSession();
        let synced = tagged;
        if (syncCompanies) {
          try {
            const result = await syncCompanies(tagged, "real-estate", {
              token: freshSession?.token,
              userId: freshSession?.userId,
            });
            if (Array.isArray(result) && result.length > 0) {
              synced = result.map((c) => ({ ...c, type: c.type || "real-estate" }));
            }
          } catch (syncErr) {
            console.error("[RealEstateUpload] syncCompanies failed:", syncErr);
            synced = tagged;
          }
        }
        await replaceCompanies(synced, {
          type: "real-estate",
          quiet: true,
          skipNavigation: true,
          autoSelect: true,
        });
        setShowCompanyModal(false);
      } else {
        setCompanyModalError(data?.error || "No real estate companies found.");
      }
    } catch (err) {
      setCompanyModalError(err?.message || "Failed to fetch companies from Taqeem.");
      setTaqeemStatus("error", err?.message || "Taqeem login failed.");
    } finally {
      setCompanyModalBusy(false);
    }
  };

  const defaultTaqeemState = (report) => ({
    idFetched: !!report.taqeemId,
    submitted: report.taqeemSubmitted,
    sent: report.taqeemSent,
    approved: report.taqeemApproved,
    taqeemId: report.taqeemId,
  });

  const getTaqeemState = (report) =>
    taqeemStates[report.id] ?? defaultTaqeemState(report);

  const patchTaqeemState = (report, patch) => {
    setTaqeemStates((prev) => ({
      ...prev,
      [report.id]: {
        ...(prev[report.id] ?? defaultTaqeemState(report)),
        ...patch,
      },
    }));
  };

  const getAnimating = (reportId) => animatingByReport[reportId] || [];

  const setAnimatingForReport = (reportId, arr) => {
    setAnimatingByReport((prev) => ({ ...prev, [reportId]: arr }));
  };

  const {
    reports: allReports,
    loading,
    error: fetchError,
    refetch,
  } = useTransactions();

  const {
    selectedCompany,
    companies,
    chooseDomain,
    loadingCompanies,
    companyError,
    ensureCompaniesLoaded,
    autoSelectDefaultCompany,
    syncCompanies,
    replaceCompanies,
  } = useValueNav();

  useEffect(() => {
    chooseDomain("real-estate");
  }, [chooseDomain]);

  const ensureGuestSession = async () => {
    if (token) {
      console.log("[ensureGuestSession] using existing context token", {
        token,
        user,
      });
      return { token, userId: user?._id || user?.id };
    }
    if (!window?.electronAPI?.apiRequest) {
      console.log("[ensureGuestSession] no electronAPI.apiRequest available");
      return null;
    }

    try {
      const tokenObj = await window.electronAPI.getToken?.();
      console.log("[ensureGuestSession] getToken() returned:", tokenObj);

      if (tokenObj?.token) {
        const restoredUser =
          tokenObj.user ||
          (tokenObj.userId
            ? { id: tokenObj.userId, _id: tokenObj.userId }
            : null);
        console.log("[ensureGuestSession] restoring persisted session", {
          hasUser: !!tokenObj.user,
          hasUserId: !!tokenObj.userId,
          restoredUser,
        });
        if (restoredUser) login?.(restoredUser, tokenObj.token);
        return {
          token: tokenObj.token,
          userId: tokenObj.userId || restoredUser?._id,
        };
      }

      console.log(
        "[ensureGuestSession] nothing persisted — minting NEW guest user",
      );
      const result = await window.electronAPI.apiRequest(
        "POST",
        "/api/users/guest",
        {},
        {},
      );
      console.log("[ensureGuestSession] guest creation result:", result);
      if (result?.token && result?.userId) {
        const guestUser = result?.user || {
          id: result.userId,
          _id: result.userId,
          guest: true,
        };
        login?.(guestUser, result.token);
        return { token: result.token, userId: result.userId };
      }
    } catch (err) {
      console.warn("[RealEstateUpload] Failed to ensure guest session:", err);
    }
    return null;
  };



  useEffect(() => {
    const hasRealEstateSelection = selectedCompany?.type === "real-estate";
    if (hasRealEstateSelection) return;

    (async () => {
      try {
        const freshSession = await ensureGuestSession();

        const loaded = await ensureCompaniesLoaded("real-estate", {
          token: freshSession?.token,
          user: freshSession?.userId ? { _id: freshSession.userId } : undefined,
        });

        if (loaded && loaded.length > 0) {
          await autoSelectDefaultCompany({
            type: "real-estate",
            skipNavigation: true,
            companiesList: loaded,
          });
          return;
        }

        // Nothing saved yet — don't silently trigger a Taqeem fetch/login.
        // Ask the user first.
        setShowCompanyModal(true);
      } catch (err) {
        console.warn(
          "[RealEstateUpload] Failed to load real estate companies on mount",
          err,
        );
      }
    })();
  }, [selectedCompany?.type]);
  const filtered = allReports.filter((r) => {
      const matchStatus = statusFilter
        ? getProgressStatus(getTaqeemState(r)) === statusFilter
        : true;
    const q = search.toLowerCase();
    const matchSearch = q
      ? (r.assignmentNumber ?? "").includes(q) ||
        (r.evalData?.ownerName ?? "").toLowerCase().includes(q) ||
        (r.evalData?.cityName ?? "").toLowerCase().includes(q) ||
        (r.evalData?.propertyType ?? "").toLowerCase().includes(q) ||
        (r.report_id ?? "").toLowerCase().includes(q) ||
        String(r.taqeemId ?? "").includes(q)
      : true;
    return matchStatus && matchSearch;
  });
  const total = allReports.length;
  const filteredIds = filtered.map((r) => r.id);
  const allSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));

  const toggleOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...filteredIds]));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkAction = async (actionId, ids) => {
    if (!selectedCompany || selectedCompany.type !== "real-estate") {
      setAuthError(
        "Select a Real Estate company from the sidebar before submitting reports to Taqeem.",
      );
      return;
    }
    setAuthError("");

    // Go through the selected reports one at a time (not in parallel) so
    // each row's own progress bar animates in turn, mirroring the single-row
    // "Go" button's behavior.
    for (const reportId of ids) {
      const report = allReports.find((r) => r.id === reportId);
      if (!report) continue;

      const currentState = getTaqeemState(report);

      // Same locking rules as the single-row selector — skip a step if its
      // prerequisite hasn't happened for this particular report yet.
      if (
        actionId === "send" &&
        !(currentState.submitted || currentState.taqeemId)
      ) {
        continue;
      }
      if (actionId === "approve" && !currentState.sent) {
        continue;
      }

      let approachSelections = null;
      if (actionId === "submit") {
        const used = getUsedApproachMethods(report.evalData || {});
        // Bulk submit can't pop a per-report modal to choose primary/secondary,
        // so default to the same convention used for the single-row auto-path:
        // first used method is primary, any others are secondary.
        approachSelections = {};
        Object.keys(used).forEach((key, idx) => {
          approachSelections[key] = idx === 0 ? "1" : "2";
        });
      }

      await performTaqeemActions({
        report,
        queuedActions: [actionId],
        approachSelections,
        token,
        login,
        onViewChange,
        isTaqeemLoggedIn,
        setTaqeemStatus,
        onProgress: (patch) => patchTaqeemState(report, patch),
        onAnimating: (arr) => setAnimatingForReport(report.id, arr),
      });
    }

    clearSelection();
  };
  const statusCounts = Object.keys(PROGRESS_STATUS_CONFIG).reduce((acc, k) => {
      acc[k] = allReports.filter(
        (r) => getProgressStatus(getTaqeemState(r)) === k,
      ).length;
      return acc;
    }, {});
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 space-y-4">
      {/* ── Page Header ── */}
      {/* ── Loading / Error ── */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-medium">Loading transactions…</span>
        </div>
      )}
      {fetchError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="text-sm">Failed to load: {fetchError}</span>
          <button
            onClick={refetch}
            className="ml-auto text-xs font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}
      {loadingCompanies && (
        <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-700">
          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
          <span className="text-sm font-medium">
            Fetching your real estate companies…
          </span>
        </div>
      )}
      {companyError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="text-sm">{companyError}</span>
        </div>
      )}
      {!loadingCompanies && !companyError && !selectedCompany && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="text-sm font-medium">
            Select a Real Estate company from the sidebar before submitting
            reports to Taqeem.
          </span>
        </div>
      )}
      {!loading && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-[18px] font-black text-slate-900 leading-tight tracking-tight">
                  Real Estate Upload
                </h1>
                <p className="text-[11px] text-slate-400 font-medium">
                  {total} reports from database
                </p>
              </div>
            </div>

            {/* Status filter counters */}
            <div className="flex flex-wrap gap-2">
                          {Object.entries(PROGRESS_STATUS_CONFIG).map(([key, cfg]) => {
                            if (!statusCounts[key]) return null;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      setStatusFilter((p) => (p === key ? "" : key))
                    }
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all ${
                      statusFilter === key
                        ? cfg.pill + " shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                    <span className="ml-0.5 font-mono text-[10px] opacity-70">
                      {statusCounts[key]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Search bar ── */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search assignment #, owner, city, Taqeem ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-[12px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
              />
            </div>
            {(statusFilter || search) && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter("");
                  setSearch("");
                }}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>

          {authError && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="text-sm">{authError}</span>
            </div>
          )}

          {/* ── Bulk action bar (only when rows selected) ── */}
          {selectedIds.size > 0 && (
            <BulkBar
              selected={selectedIds}
              total={filtered.length}
              onSelectAll={toggleAll}
              onClearAll={clearSelection}
              onAction={handleBulkAction}
            />
          )}

          {/* ── Table header + rows ── */}
          {filtered.length > 0 && (
            <TableHeader allSelected={allSelected} onToggleAll={toggleAll} />
          )}

          <div className="space-y-2">
            {filtered.length ? (
              filtered.map((report) => (
                <ReportRow
                  key={report.id}
                  report={report}
                  onReportSaved={() => refetch()}
                  selected={selectedIds.has(report.id)}
                  onToggle={toggleOne}
                  token={token}
                  login={login}
                  onViewChange={onViewChange}
                  isTaqeemLoggedIn={isTaqeemLoggedIn}
                  setTaqeemStatus={setTaqeemStatus}
                  selectedCompany={selectedCompany}
                  taqeemState={getTaqeemState(report)}
                  onStateChange={(patch) => patchTaqeemState(report, patch)}
                  animatingSteps={getAnimating(report.id)}
                  onAnimatingChange={(arr) =>
                  setAnimatingForReport(report.id, arr)
                  }
                  regions={regions}
                  cities={cities}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Info className="w-8 h-8 mb-3" />
                <p className="text-sm font-semibold text-slate-500">
                  No reports match your filters.
                </p>
                <button
                  onClick={() => {
                    setStatusFilter("");
                    setSearch("");
                  }}
                  className="mt-3 text-[12px] font-semibold text-indigo-500 hover:text-indigo-700"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {showCompanyModal && (
        <RealEstateCompanyFetchModal
          busy={companyModalBusy}
          error={companyModalError}
          onContinue={fetchRealEstateCompaniesViaTaqeem}
          onCancel={() => setShowCompanyModal(false)}
        />
      )}
    </div>
  );
}
