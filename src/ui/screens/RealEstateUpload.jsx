import React, { useState, useRef, useEffect } from "react";
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
        "http://localhost:3000/api/transactions?limit=100",
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      console.log(json);
      const items = (json.items ?? []).map((t) => ({
        ...t,
        report_status: t.report_status ?? "UNKNOWN",
        taqeemId: t.taqeemId ?? null,
        taqeemSubmitted: t.taqeemSubmitted ?? false,
        taqeemSent: t.taqeemSent ?? false,
        taqeemApproved: t.taqeemApproved ?? false,
        report_id: t.report_id ?? null,
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

// Fields required by each form step, mapped to report/evalData keys.
// step1: report-level fields
const REQUIRED_STEP1 = [
  { key: "valuationPurpose", src: "report", label: "Valuation Purpose" },
  { key: "ownershipType", src: "report", label: "Ownership Type" },
  { key: "valuationBasis", src: "report", label: "Valuation Basis" },
  { key: "assignmentDate", src: "report", label: "Assignment Date" },
  { key: "clientName", src: "evalData", label: "Client Name" },
];
// step2: asset + location fields
const REQUIRED_STEP2 = [
  { key: "propertyType", src: "evalData", label: "Property Type" },
  { key: "cityName", src: "evalData", label: "City" },
  { key: "propertyArea", src: "evalData", label: "Land Area" },
  { key: "lat", src: "evalData", label: "Latitude" },
  { key: "lng", src: "evalData", label: "Longitude" },
];
// step3: property detail fields
const REQUIRED_STEP3 = [
  { key: "deedNumber", src: "evalData", label: "Deed / Certificate No." },
  { key: "ownerName", src: "evalData", label: "Owner Name" },
  { key: "address", src: "evalData", label: "Address" },
];

const ALL_REQUIRED = [...REQUIRED_STEP1, ...REQUIRED_STEP2, ...REQUIRED_STEP3];

const getMissingFields = (report) => {
  return ALL_REQUIRED.filter(({ key, src }) => {
    const val = src === "report" ? report[key] : report.evalData?.[key];
    return !val || String(val).trim() === "";
  });
};

const hasIncompleteData = (report) => getMissingFields(report).length > 0;

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

const StepProgress = ({ submitted, sent, approved }) => {
  const steps = [
    { num: 1, label: "Submitted", done: submitted },
    { num: 2, label: "Sent", done: sent },
    { num: 3, label: "Approved", done: approved },
  ];
  const currentIdx = approved ? 2 : sent ? 1 : submitted ? 0 : -1;

  return (
    <div className="flex items-center gap-2 flex-1">
      {steps.map((step, i) => {
        const done = i <= currentIdx;
        const current = i === currentIdx;
        return (
          <React.Fragment key={step.num}>
            {i > 0 && (
              <div className="h-0.5 flex-1 rounded-full overflow-hidden bg-slate-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: i <= currentIdx ? "100%" : "0%",
                    background: "#6366f1",
                    transition: "width 600ms ease",
                  }}
                />
              </div>
            )}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className="flex items-center justify-center rounded-full border-2"
                style={{
                  width: 24,
                  height: 24,
                  borderColor: done ? "#6366f1" : "#cbd5e1",
                  background: current ? "#eef2ff" : "#fff",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: done ? "#4f46e5" : "#94a3b8",
                  }}
                >
                  {step.num}
                </span>
              </div>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: current ? 800 : 600,
                  color: done ? "#4f46e5" : "#94a3b8",
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
            const disabled = isDone || (!unlocked && !isSelected);

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

const ActionSelector = ({
  reportId,
  report,
  onAction,
  missingFields = [],
  onStateChange,
  token,
  login,
  onViewChange,
  isTaqeemLoggedIn,
  setTaqeemStatus,
}) => {
  const [dummyState, setDummyState] = useState({
    idFetched: !!report.taqeemId,
    submitted: report.taqeemSubmitted,
    sent: report.taqeemSent,
    approved: report.taqeemApproved,
    taqeemId: report.taqeemId,
  });
  const [animating, setAnimating] = useState([]);
  const [queued, setQueued] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [showApproachModal, setShowApproachModal] = useState(false);
  const [pendingUsedMethods, setPendingUsedMethods] = useState({});
  const [approachSelections, setApproachSelections] = useState(null);

  const doneFromReport = new Set();
  if (dummyState.submitted) doneFromReport.add("submit");
  if (dummyState.sent) doneFromReport.add("send");
  if (dummyState.approved) doneFromReport.add("approve");

  const isUnlocked = (actionId) => {
    const action = ACTIONS.find((a) => a.id === actionId);
    if (!action) return false;
    if (doneFromReport.has(actionId)) return false;
    if (!action.requires) return true;
    return (
      doneFromReport.has(action.requires) || queued.includes(action.requires)
    );
  };

  const toggleAction = (actionId) => {
    setQueued((prev) => {
      if (prev.includes(actionId)) return prev.slice(0, prev.indexOf(actionId));
      if (!isUnlocked(actionId)) return prev;
      return [...prev, actionId];
    });
  };

  const animateStep = async (key, stateKey, dummyId = null) => {
    setAnimating([key]);
    await new Promise((r) => setTimeout(r, 5000));
    setDummyState((prev) => {
      const next = { ...prev, [stateKey]: true };
      if (dummyId) next.taqeemId = dummyId;
      if (onStateChange) onStateChange(next);
      return next;
    });
    await new Promise((r) => setTimeout(r, 100));
    setAnimating([]);
  };

  const proceed = async (resolvedApproachSelections = approachSelections) => {
    setShowWarning(false);
    setBusy(true);

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

    if (!ok) {
      setBusy(false);
      return; // ensureTaqeemAuthorized already redirects to login if needed
    }

    if (queued.includes("submit")) {
      setAnimating(["submitted"]);
      try {
        let pdfPath = null;

        if (window?.electronAPI?.downloadRealEstatePdf) {
          const pdfResult = await window.electronAPI.downloadRealEstatePdf(
            report.id || report.id,
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
          await window.electronAPI.submitRealEstateReport(
            reportId,
            pdfPath,
            resolvedApproachSelections,
          );
        } else {
          console.log(
            "[RealEstateUpload] submitRealEstateReport not available, recordId:",
            reportId,
          );
        }
      } catch (err) {
        console.error("[RealEstateUpload] submitRealEstateReport error:", err);
      }
      setDummyState((prev) => {
        const next = { ...prev, submitted: true };
        if (onStateChange) onStateChange(next);
        return next;
      });
      setAnimating([]);
    }
    if (queued.includes("send")) await animateStep("sent", "sent");
    if (queued.includes("approve")) await animateStep("approved", "approved");

    if (onAction) queued.forEach((a) => onAction(a, reportId));
    setQueued([]);
    setBusy(false);
  };
  const handleGo = () => {
    if (!queued.length) return;

    if (queued.includes("submit")) {
      const used = getUsedApproachMethods(report.evalData || {});
      const usedCount = Object.keys(used).length;

      if (usedCount >= 2) {
        setPendingUsedMethods(used);
        setShowApproachModal(true);
        return;
      }

      // 0 or 1 method — auto-assign primary and proceed directly
      const auto = {};
      Object.keys(used).forEach((key) => {
        auto[key] = "1";
      });
      setApproachSelections(auto);

      if (missingFields.length > 0) setShowWarning(true);
      else proceed(auto);
      return; // ← early return so we don't fall through to the proceed below
    }

    if (missingFields.length > 0) setShowWarning(true);
    else proceed();
  };
  const handleApproachConfirm = (selections) => {
    setApproachSelections(selections);
    setShowApproachModal(false);
    if (missingFields.length > 0) setShowWarning(true);
    else proceed(selections);
  };

  return (
    <>
      <div
        className="flex items-center gap-1 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {missingFields.length > 0 && (
          <IncompleteDataBadge missingFields={missingFields} iconOnly />
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
                  Action may fail
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  These fields are missing and could cause the submission to
                  fail:
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
                onClick={proceed}
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
const IncompleteDataBadge = ({ missingFields, iconOnly = false }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

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
            {missingFields.length} missing field
            {missingFields.length > 1 ? "s" : ""}
            <ChevronDown className="w-3 h-3 text-amber-400" />
          </>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-20 w-56 rounded-xl border border-amber-200 bg-white shadow-lg p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600 mb-2">
            Missing fields
          </p>
          <ul className="space-y-1">
            {missingFields.map(({ label }) => (
              <li
                key={label}
                className="flex items-center gap-1.5 text-[11px] text-slate-600"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                {label}
              </li>
            ))}
          </ul>
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

// ─── Expanded detail ───────────────────────────────────────────────────────
const ExpandedDetail = ({ report }) => {
  const e = report.evalData;
  const s = e.availableServices || {};
  const env = (e.surroundingEnvironment || []).map((k) => ENV_LABELS[k] || k);

  return (
    <div className="border-t border-slate-100 bg-white">
      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
        {/* ── Left column (2/3) ─────────────────────────────── */}
        <div className="lg:col-span-2 p-5 space-y-6">
          {/* Property Identity */}
          <div>
            <SectionHeader icon={Home} title="Property Identity" />
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
              <Field label="Property Type" value={e.propertyType} />
              <Field label="Area (m²)" value={e.propertyArea} />
              <Field label="City" value={e.cityName} />
              <Field label="Neighbourhood" value={e.neighborhoodName} />
              <Field label="Address" value={e.address} span={2} />
              <Field
                label="Building Condition"
                value={
                  e.buildingCondition?.status
                    ? `${e.buildingCondition.status}${e.buildingCondition.completionPct ? ` · ${e.buildingCondition.completionPct}%` : ""}`
                    : null
                }
              />
              <Field label="Deed No." value={e.deedNumber} mono />
              <Field label="Deed Date" value={e.deedDate} />
              <Field label="Parcel No." value={e.parcelNumber} />
              <Field label="Block No." value={e.blockNumber} />
              <Field label="Plan No." value={e.planNumber} />
              <Field
                label="Subdivision Record"
                value={e.subDivisionRecordNumber}
              />
            </dl>
          </div>

          {/* Boundaries */}
          <div>
            <SectionHeader icon={MapPin} title="Boundaries" accent="blue" />
            <div className="grid grid-cols-2 gap-2">
              {[
                ["N", "North", e.northBoundary, e.northLength],
                ["S", "South", e.southBoundary, e.southLength],
                ["E", "East", e.eastBoundary, e.eastLength],
                ["W", "West", e.westBoundary, e.westLength],
              ].map(([abbr, dir, desc, len]) => (
                <div
                  key={dir}
                  className="flex gap-2.5 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5"
                >
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-100 text-[10px] font-black text-blue-700">
                    {abbr}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-slate-700 leading-snug">
                      {desc || "—"}
                    </div>
                    {len && (
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {len} m
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Comparisons */}
          {(e.comparisonRows || []).filter((r) => r.landSpace || r.price)
            .length > 0 && (
            <div>
              <SectionHeader
                icon={ClipboardList}
                title="Market Comparisons"
                accent="emerald"
              />
              <div className="overflow-x-auto">
                <table className="min-w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="pb-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-400 pr-4">
                        Kind
                      </th>
                      <th className="pb-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-400 pr-4">
                        Area m²
                      </th>
                      <th className="pb-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-400 pr-4">
                        Unit Price
                      </th>
                      <th className="pb-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Total (SAR)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {e.comparisonRows
                      .filter((r) => r.landSpace || r.price)
                      .map((row, idx) => (
                        <tr key={idx}>
                          <td className="py-1.5 pr-4 text-slate-700 font-medium">
                            {row.comparisonKind || "—"}
                          </td>
                          <td className="py-1.5 pr-4 text-slate-600 font-mono">
                            {row.landSpace || "—"}
                          </td>
                          <td className="py-1.5 pr-4 text-slate-600 font-mono">
                            {row.price || "—"}
                          </td>
                          <td className="py-1.5 font-semibold text-slate-800 font-mono">
                            {row.total || "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Investment */}
          {(e.investmentEntries || []).length > 0 && (
            <div>
              <SectionHeader
                icon={DollarSign}
                title="Investment Analysis"
                accent="amber"
              />
              <div className="flex flex-wrap gap-3">
                {e.investmentEntries.map((entry, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-amber-100 bg-amber-50/40 p-3 min-w-[200px]"
                  >
                    <p className="text-[11px] font-bold text-slate-700 mb-2">
                      {entry.title}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Tag color="indigo">Cap {entry.capitalizationRate}%</Tag>
                      <Tag color="amber">Vacancy {entry.vacancyRate}%</Tag>
                      <Tag color="rose">Maint. {entry.maintenanceRate}%</Tag>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right column (1/3) ─────────────────────────────── */}
        <div className="p-5 space-y-6">
          {/* Valuation Outputs */}
          <div>
            <SectionHeader icon={Activity} title="Valuation" />
            <div className="space-y-3">
              <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-slate-50 border border-indigo-100 p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-400 mb-1">
                  Final Asset Value
                </p>
                <p className="text-[20px] font-black text-indigo-900 tracking-tight">
                  {e.finalAssetValue ? (
                    <>
                      SAR <span>{e.finalAssetValue}</span>
                    </>
                  ) : (
                    <span className="text-[14px] font-medium text-slate-300">
                      Pending
                    </span>
                  )}
                </p>
              </div>
              {e.marketMeterPrice && (
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">
                    Market Price / m²
                  </p>
                  <p className="text-[15px] font-bold text-slate-800">
                    SAR {e.marketMeterPrice}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Parties */}
          <div>
            <SectionHeader icon={User} title="Parties" />
            <dl className="space-y-3">
              <Field label="Owner" value={e.ownerName} />
              <Field label="Client" value={e.clientName} />
              <Field label="Authorized" value={e.authorizedName} />
            </dl>
          </div>

          {/* Assignment meta */}
          <div>
            <SectionHeader icon={Hash} title="Assignment" />
            <dl className="space-y-3">
              <Field label="Purpose" value={report.valuationPurpose} />
              <Field label="Basis" value={report.valuationBasis} />
              <Field label="Ownership" value={report.ownershipType} />
              <Field label="Taqeem Report ID" value={report.report_id} mono />
              <Field
                label="Taqeem ID"
                value={report.taqeemId ? String(report.taqeemId) : null}
                mono
              />
              <Field
                label="Inspectors"
                value={String(report.assignedInspectorIds?.length || 0)}
              />
              <div className="flex gap-3">
                <Field
                  label="Attachments"
                  value={String(report.attachmentsCount)}
                />
                <Field label="Images" value={String(report.imagesCount)} />
              </div>
              <Field
                label="Last Updated"
                value={formatDate(report.updatedAt)}
              />
            </dl>
          </div>

          {/* Services */}
          <div>
            <SectionHeader icon={Layers} title="Services" />
            <div className="flex flex-wrap gap-1.5">
              {[
                ["Electricity", s.electricity],
                ["Drainage", s.sanitaryDrainage],
                ["Telephone", s.telephoneLine],
              ].map(([name, on]) => (
                <Tag key={name} color={on ? "emerald" : "slate"}>
                  {!on && <span className="opacity-40">{name}</span>}
                  {on && name}
                </Tag>
              ))}
              {s.waterMetersCount > 0 && (
                <Tag color="blue">Water ×{s.waterMetersCount}</Tag>
              )}
              {s.electricityMetersCount > 0 && (
                <Tag color="amber">Elec. ×{s.electricityMetersCount}</Tag>
              )}
            </div>
          </div>

          {/* Environment */}
          {env.length > 0 && (
            <div>
              <SectionHeader icon={MapPin} title="Surroundings" />
              <div className="flex flex-wrap gap-1.5">
                {env.map((item) => (
                  <Tag key={item} color="indigo">
                    {item}
                  </Tag>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
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
}) => {
  const [expanded, setExpanded] = useState(false);
  const [taqeemState, setTaqeemState] = useState({
    idFetched: !!report.taqeemId,
    submitted: report.taqeemSubmitted,
    sent: report.taqeemSent,
    approved: report.taqeemApproved,
    taqeemId: report.taqeemId,
  });

  const e = report.evalData;
  const cfg = STATUS_CONFIG[report.report_status] || STATUS_CONFIG.INCOMPLETE;
  const missingFields = getMissingFields(report);

  // Bottom-left badge: reflects the taqeem workflow state
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
        {/* Main info line */}
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
          {/* Badge — fixed w-24 so "Approved", "Submitted", "New" etc. don't shift layout */}
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
            />
          </div>
          {/* Action — fixed w-48 so the dropdown+button never shift other columns */}
          <div
            className="shrink-0 w-48 flex items-center justify-end gap-2"
            onClick={(ev) => ev.stopPropagation()}
          >
            <ActionSelector
              reportId={report.id}
              report={report}
              missingFields={missingFields}
              onStateChange={setTaqeemState}
              token={token}
              login={login}
              onViewChange={onViewChange}
              isTaqeemLoggedIn={isTaqeemLoggedIn}
              setTaqeemStatus={setTaqeemStatus}
            />
          </div>
        </div>
      </div>

      {expanded && (
        <div className="overflow-hidden">
          <ExpandedDetail report={report} />
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
  const {
    reports: allReports,
    loading,
    error: fetchError,
    refetch,
  } = useTransactions();

  const filtered = allReports.filter((r) => {
    const matchStatus = statusFilter ? r.report_status === statusFilter : true;
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
    for (const reportId of ids) {
      await openTaqeemBrowser(() => {}, reportId, actionId);
    }
    clearSelection();
  };

  const statusCounts = Object.keys(STATUS_CONFIG).reduce((acc, k) => {
    acc[k] = allReports.filter((r) => r.report_status === k).length;
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
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
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
                  selected={selectedIds.has(report.id)}
                  onToggle={toggleOne}
                  token={token}
                  login={login}
                  onViewChange={onViewChange}
                  isTaqeemLoggedIn={isTaqeemLoggedIn}
                  setTaqeemStatus={setTaqeemStatus}
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
    </div>
  );
}
