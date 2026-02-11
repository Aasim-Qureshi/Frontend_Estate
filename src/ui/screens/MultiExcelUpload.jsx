import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRam } from "../context/RAMContext";
import { useSession } from "../context/SessionContext";
import { useNavStatus } from "../context/NavStatusContext";
import { useValueNav } from "../context/ValueNavContext";
import { useSystemControl } from "../context/SystemControlContext";
import { useAuthAction } from "../hooks/useAuthAction";
import usePersistentState from "../hooks/usePersistentState";
import { deductPoints } from "../utils/points";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { ensureTaqeemAuthorized } from "../../shared/helper/taqeemAuthWrap";
import {
    FileSpreadsheet,
    Files,
    Loader2,
    CheckCircle2,
    AlertTriangle,
    FileIcon,
    FileText,
    FileUp,
    RefreshCw,
    Info,
    Send,
    Table,
    ChevronDown,
    ChevronUp,
    ChevronRight,
    Download,
} from "lucide-react";

import { multiExcelUpload, updateMultiApproachReport, updateMultiApproachAsset, deleteMultiApproachReport } from "../../api/report";
import InsufficientPointsModal from "../components/InsufficientPointsModal";

const MULTI_UPLOAD_PAGE_NAME = "Multi-Excel Upload";
const MULTI_UPLOAD_PAGE_SOURCE = "multi-batch";

const isTaqeemAuthSuccess = (authStatus) => {
    if (authStatus === true) return true;
    if (authStatus?.success === true) return true;
    const status = String(authStatus?.status || "").toUpperCase();
    return (
        status === "SUCCESS" ||
        status === "CHECK" ||
        status === "AUTHORIZED" ||
        status === "SYNCED" ||
        status === "LOGIN_SUCCESS" ||
        status === "NORMAL_ACCOUNT" ||
        status === "BOOTSTRAP_GRANTED"
    );
};

const getTaqeemAuthErrorMessage = (authStatus, fallback) =>
    authStatus?.error || authStatus?.message || fallback;

const InputField = ({
    label,
    required = false,
    error,
    className = "",
    ...props
}) => (
    <div className={`space-y-1 ${className}`}>
        <label className="block text-[10px] font-semibold text-slate-700">
            {label} {required && <span className="text-rose-500 ml-0.5">*</span>}
        </label>
        <input
            {...props}
            className={`w-full px-2 py-1.5 border rounded-md text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all ${error ? "border-rose-400 bg-rose-50" : "border-slate-300 bg-white"
                }`}
        />
        {error && <p className="text-rose-600 text-[10px] mt-0.5 font-medium">{error}</p>}
    </div>
);

const SelectField = ({
    label,
    required = false,
    options,
    error,
    className = "",
    ...props
}) => (
    <div className={`space-y-1 ${className}`}>
        <label className="block text-[10px] font-semibold text-slate-700">
            {label} {required && <span className="text-rose-500 ml-0.5">*</span>}
        </label>
        <select
            {...props}
            className={`w-full px-2 py-1.5 border rounded-md text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all cursor-pointer ${error ? "border-rose-400 bg-rose-50" : "border-slate-300 bg-white"
                }`}
        >
            {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
        {error && <p className="text-rose-600 text-[10px] mt-0.5 font-medium">{error}</p>}
    </div>
);

const TextAreaField = ({
    label,
    required = false,
    error,
    className = "",
    ...props
}) => (
    <div className={`space-y-1 ${className}`}>
        <label className="block text-[10px] font-semibold text-slate-700">
            {label} {required && <span className="text-rose-500 ml-0.5">*</span>}
        </label>
        <textarea
            {...props}
            className={`w-full px-2 py-1.5 border rounded-md text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all resize-none ${error ? "border-rose-400 bg-rose-50" : "border-slate-300 bg-white"
                }`}
        />
        {error && <p className="text-rose-600 text-[10px] mt-0.5 font-medium">{error}</p>}
    </div>
);

const Section = ({ title, children }) => (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        {children}
    </div>
);

const Modal = ({ open, onClose, title, children, maxWidth = "max-w-6xl" }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 backdrop-blur-sm px-4 py-4 overflow-auto">
            <div className={`w-full ${maxWidth}`}>
                <div className="rounded-xl border border-slate-200 bg-white shadow-2xl">
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 bg-slate-50/50">
                        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
                        <button
                            type="button"
                            onClick={onClose}
                            className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                    <div className="p-4">{children}</div>
                </div>
            </div>
        </div>
    );
};

const normalizeCellValue = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
        if (value.text !== undefined) return value.text;
        if (Array.isArray(value.richText)) {
            return value.richText.map((t) => t.text || "").join("");
        }
        if (value.result !== undefined) return value.result;
        if (value.value !== undefined) return value.value;
    }
    return value;
};

const normalizeKey = (value) =>
    (value || "")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[\W_]+/g, "");

const stripExtension = (filename = "") => filename.replace(/\.[^.]+$/, "");

const DUMMY_PDF_NAME = "dummy_placeholder.pdf";

const reportStatusLabels = {
    approved: "Approved",
    complete: "Complete",
    sent: "Sent",
    incomplete: "Incomplete",
};

const assetStatusLabels = {
    complete: "Complete",
    incomplete: "Incomplete",
};

const reportStatusClasses = {
    approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
    complete: "border-blue-200 bg-blue-50 text-blue-700",
    sent: "border-amber-200 bg-amber-50 text-amber-700",
    incomplete: "border-rose-200 bg-rose-50 text-rose-700",
};

const assetStatusClasses = {
    complete: "border-emerald-200 bg-emerald-50 text-emerald-700",
    incomplete: "border-rose-200 bg-rose-50 text-rose-700",
};

const buildDefaultFormData = () => ({
    report_id: "",
    title: "",
    purpose_id: "to set",
    value_premise_id: "1",
    report_type: "",
    valued_at: "",
    submitted_at: "",
    inspection_date: "",
    assumptions: "",
    special_assumptions: "",
    value: "",
    final_value: "",
    valuation_currency: "1",
    client_name: "",
    owner_name: "",
    telephone: "",
    email: "",
    region: "",
    city: "",
    has_other_users: false,
    report_users: [],
    pdf_path: "",
});

const buildDefaultValuers = () => ([
    {
        valuer_name: "",
        contribution_percentage: 100,
    },
]);

const getReportStatus = (report) => {
    if (report?.checked) return "approved";

    // Check if all assets are complete
    const allAssetsComplete = Array.isArray(report?.asset_data) && report.asset_data.length > 0
        ? report.asset_data.every(asset => asset?.submitState === 1)
        : false;

    // If report has no assets, check endSubmitTime as fallback
    if (allAssetsComplete) {
        return "complete";
    }
    return "incomplete";
};

const getAssetMacroId = (asset, report) => {
    if (!(report?.report_id || report?.reportId)) return "";
    return asset?.id || asset?.macro_id || asset?.macroId || "";
};

const getAssetStatus = (asset, report) => {
    if (asset?.submitState === 1) return "complete";
    if (asset?.submitState === 0) return "incomplete";
    // Fallback to existing logic if submitState doesn't exist
    return getAssetMacroId(asset, report) ? "complete" : "incomplete";
};

const getAssetApproach = (asset) => {
    const hasMarket = asset?.market_approach || asset?.market_approach_value;
    const hasCost = asset?.cost_approach || asset?.cost_approach_value;
    if (hasMarket && hasCost) return "Market + Cost";
    if (hasMarket) return "Market";
    if (hasCost) return "Cost";
    if (asset?.source_sheet) return String(asset.source_sheet);
    if (asset?.sheet) return String(asset.sheet);
    return "-";
};

const parseExcelDateValue = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;

    if (typeof value === "number") {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const msPerDay = 24 * 60 * 60 * 1000;
        return new Date(excelEpoch.getTime() + value * msPerDay);
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;

        if (/^\d+$/.test(trimmed)) {
            const serial = parseInt(trimmed, 10);
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            const msPerDay = 24 * 60 * 60 * 1000;
            return new Date(excelEpoch.getTime() + serial * msPerDay);
        }

        const normalized = trimmed.replace(/[.]/g, "/");
        const parts = normalized.split(/[\/\-]/).map((p) => p.trim());
        if (parts.length === 3) {
            const [a, b, c] = parts;
            if (a.length === 4) {
                const year = parseInt(a, 10);
                const month = parseInt(b, 10);
                const day = parseInt(c, 10);
                if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
                    return new Date(year, month - 1, day);
                }
            } else {
                const day = parseInt(a, 10);
                const month = parseInt(b, 10);
                const year = parseInt(c, 10);
                if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
                    return new Date(year, month - 1, day);
                }
            }
        }
    }

    return null;
};

const formatDateForDisplay = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
};

const CONTRIBUTION_OPTIONS = Array.from({ length: 20 }, (_, idx) => (idx + 1) * 5);

const asDateString = (value) => {
    if (!value) return "";
    if (typeof value === "string") {
        return value.slice(0, 10);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10);
};

const hasValue = (val) =>
    val !== undefined &&
    val !== null &&
    (typeof val === "number" || String(val).toString().trim() !== "");

const pickFieldValue = (row, candidates = []) => {
    if (!row) return undefined;
    const normalizedMap = Object.keys(row).reduce((acc, key) => {
        acc[normalizeKey(key)] = key;
        return acc;
    }, {});

    for (const candidate of candidates) {
        const matchKey = normalizedMap[normalizeKey(candidate)];
        if (matchKey !== undefined) {
            return row[matchKey];
        }
    }
    return undefined;
};

const isValidEmail = (email) => {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
};

const worksheetToObjects = (worksheet) => {
    const headerRow = worksheet.getRow(1);
    const headerMap = [];
    const maxCol = worksheet.columnCount || (headerRow.values.length - 1);
    const headerCounts = {};

    const nextHeaderName = (rawHeader, fallback) => {
        const base = (String(rawHeader || fallback || "").trim()) || fallback;
        const count = (headerCounts[base] || 0) + 1;
        headerCounts[base] = count;
        return count === 1 ? base : `${base}_${count}`;
    };

    for (let col = 1; col <= maxCol; col++) {
        const header = String(
            normalizeCellValue(headerRow.getCell(col).value) || `col_${col}`
        )
            .trim() || `col_${col}`;
        headerMap[col] = nextHeaderName(header, `col_${col}`);
    }

    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const obj = {};

        for (let col = 1; col < headerMap.length; col++) {
            const key = headerMap[col] || `col_${col}`;
            obj[key] = normalizeCellValue(row.getCell(col).value);
        }

        rows.push(obj);
    });

    return rows;
};

const validateReportInfoAndMarket = (reportRow = {}, marketRows = []) => {
    const issues = [];
    const addIssue = (field, location, message) => issues.push({ field, location, message });

    const purpose = pickFieldValue(reportRow, ["purpose_id", "purpose of valuation", "purpose"]);
    const valueAttributes = pickFieldValue(reportRow, ["value_premise_id", "value attributes", "value_attribute", "value premise id"]);
    const reportType = pickFieldValue(reportRow, ["report_type", "report", "report name", "report title", "title"]);
    const clientName = pickFieldValue(reportRow, ["client_name", "client name"]);
    const telephone = pickFieldValue(reportRow, ["telephone", "phone", "client telephone", "client phone", "mobile"]);
    const email = pickFieldValue(reportRow, ["email", "client email"]);

    const valuedAtRaw = pickFieldValue(reportRow, ["valued_at", "date of valuation", "valuation date"]);
    const submittedAtRaw = pickFieldValue(reportRow, ["submitted_at", "report issuing date", "report date", "report issuing"]);
    const inspectionDateRaw = pickFieldValue(reportRow, ["inspection_date", "inspection date", "inspectiondate"]);
    const valuedAt = parseExcelDateValue(valuedAtRaw);
    const submittedAt = parseExcelDateValue(submittedAtRaw);
    const inspectionDate = parseExcelDateValue(inspectionDateRaw);

    if (!hasValue(purpose)) addIssue("Purpose of Valuation", "Report Info", "Field Purpose of Valuation is required");
    if (!hasValue(valueAttributes)) addIssue("Value Attributes", "Report Info", "Field Value Attributes is required");
    if (!hasValue(reportType)) addIssue("Report", "Report Info", "Field Report is required");

    if (!hasValue(clientName)) {
        addIssue("Client Name", "Report Info", "Field client name is required");
    } else if (String(clientName).trim().length < 9) {
        addIssue("Client Name", "Report Info", "Client name field must contain at least 9 characters");
    }

    const telephoneClean = hasValue(telephone) ? String(telephone).replace(/\s+/g, "") : "";
    if (!hasValue(telephone)) {
        addIssue("Client Telephone", "Report Info", "Field client telephone is required");
    } else if (telephoneClean.length < 8) {
        addIssue("Client Telephone", "Report Info", "Client telephone must contain at least 8 characters");
    }

    if (!hasValue(email)) {
        addIssue("Client Email", "Report Info", "Field client email is required");
    } else if (!isValidEmail(email)) {
        addIssue("Client Email", "Report Info", "Client email field must contain a valid email address");
    }

    // Date validation with future date checks
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to start of day for fair comparison

    if (!valuedAt) {
        addIssue("Date of Valuation", "Report Info", "Field Date of Valuation is required");
    } else if (valuedAt > today) {
        addIssue("Date of Valuation", "Report Info", "Date of Valuation cannot be in the future");
    }

    if (!submittedAt) {
        addIssue("Report Issuing Date", "Report Info", "Field Report Issuing Date is required");
    } else if (submittedAt > today) {
        addIssue("Report Issuing Date", "Report Info", "Report Issuing Date cannot be in the future");
    }

    // Inspection date validation - only check if it's not in the future
    if (inspectionDate && inspectionDate > today) {
        addIssue("Inspection Date", "Report Info", "Inspection Date cannot be in the future");
    }

    if (valuedAt && submittedAt && valuedAt > submittedAt) {
        addIssue("Date of Valuation", "Report Info", "Date of Valuation must be on or before Report Issuing Date");
    }

    marketRows.forEach((row, idx) => {
        const assetName = row.asset_name || row.assetName || "";
        if (!hasValue(assetName)) return;
        const finalVal = pickFieldValue(row, ["final_value", "final value", "value"]);
        if (!hasValue(finalVal) || Number.isNaN(Number(finalVal))) {
            const rowNumber = idx + 2;
            addIssue(
                "Final Value",
                `market row ${rowNumber}`,
                `Final Value is required for asset "${assetName || `Row ${rowNumber}`}"`
            );
        }
    });

    const snapshot = {
        purpose,
        valueAttributes,
        reportType,
        clientName,
        telephone,
        email,
        valuedAt,
        submittedAt,
        inspectionDate,
    };

    return { issues, snapshot };
};

const getReportTotalValue = (reportRow = {}) => {
    const raw = pickFieldValue(reportRow, [
        "value",
        "final_value",
        "total_value",
        "total value",
        "Total Value",
        "Final Value",
    ]);

    const num = Number(raw);
    return Number.isNaN(num) ? null : num;
};

const validateAssetUsageId = (sheetName, rows) => {
    const issues = [];

    rows.forEach((row, idx) => {
        const assetName = row.asset_name || row.assetName || "";
        if (!hasValue(assetName)) return; // ignore empty rows

        const rawValue =
            row.asset_usage_id ??
            row.assetUsageId ??
            row["asset usage id"];

        const location = `${sheetName} row ${idx + 2}`;

        // Missing
        if (!hasValue(rawValue)) {
            issues.push({
                field: "asset_usage_id",
                location,
                message: `Missing asset_usage_id for asset "${assetName}".`,
            });
            return;
        }

        const num = Number(rawValue);

        // Not a number
        if (Number.isNaN(num)) {
            issues.push({
                field: "asset_usage_id",
                location,
                message: `asset_usage_id "${rawValue}" is not a valid number for asset "${assetName}".`,
            });
            return;
        }

        // Out of range
        if (num < 38 || num > 56) {
            issues.push({
                field: "asset_usage_id",
                location,
                message: `asset_usage_id ${num} is outside the allowed range (38â€“56) for asset "${assetName}".`,
            });
        }
    });

    return issues;
};


const validateCostSheetIntegers = (rows = []) => {
    const issues = [];
    const addIssue = (field, location, message) => issues.push({ field, location, message });

    rows.forEach((row, idx) => {
        const assetName = row.asset_name || row.assetName || "";
        if (!hasValue(assetName)) return;
        const rawFinal = pickFieldValue(row, ["final_value", "final value", "value", "Final Value", "Value"]);
        if (!hasValue(rawFinal)) {
            addIssue("final_value", `cost row ${idx + 2}`, `Missing final_value for asset "${assetName}"`);
            return;
        }

        const num = Number(rawFinal);
        if (Number.isNaN(num)) {
            addIssue("final_value", `cost row ${idx + 2}`, `Invalid final_value "${rawFinal}" for asset "${assetName}"`);
            return;
        }

        if (!Number.isInteger(num)) {
            addIssue("final_value", `cost row ${idx + 2}`, `final_value must be an integer for asset "${assetName}"`);
            return;
        }

        if (num < 0) {
            addIssue("final_value", `cost row ${idx + 2}`, `final_value cannot be negative for asset "${assetName}"`);
        }
    });

    return issues;
};

const mapReportToForm = (report) => {
    const base = buildDefaultFormData();
    return {
        ...base,
        report_id: report?.report_id || "",
        title: report?.title || "",
        purpose_id:
            report?.purpose_id !== undefined && report?.purpose_id !== null
                ? String(report.purpose_id)
                : base.purpose_id,
        value_premise_id:
            report?.value_premise_id !== undefined && report?.value_premise_id !== null
                ? String(report.value_premise_id)
                : base.value_premise_id,
        report_type: report?.report_type || base.report_type,
        valued_at: asDateString(report?.valued_at),
        submitted_at: asDateString(report?.submitted_at),
        inspection_date: asDateString(report?.inspection_date),
        assumptions: report?.assumptions ?? "",
        special_assumptions: report?.special_assumptions ?? "",
        value:
            report?.value !== undefined && report?.value !== null
                ? String(report.value)
                : report?.final_value !== undefined && report?.final_value !== null
                    ? String(report.final_value)
                    : "",
        final_value:
            report?.final_value !== undefined && report?.final_value !== null
                ? String(report.final_value)
                : report?.value !== undefined && report?.value !== null
                    ? String(report.value)
                    : "",
        valuation_currency:
            report?.valuation_currency !== undefined && report?.valuation_currency !== null
                ? String(report.valuation_currency)
                : base.valuation_currency,
        client_name: report?.client_name || "",
        owner_name: report?.owner_name || "",
        telephone: report?.telephone || "",
        email: report?.email || "",
        region: report?.region || "",
        city: report?.city || "",
        has_other_users: !!report?.has_other_users,
        report_users: Array.isArray(report?.report_users) ? report.report_users : [],
        pdf_path: report?.pdf_path || report?.path_pdf || "",
    };
};

const normalizeValuers = (valuers = []) => {
    if (!Array.isArray(valuers)) return buildDefaultValuers();
    const cleaned = valuers
        .map((valuer) => ({
            valuer_name: (() => {
                const raw = valuer?.valuer_name || valuer?.valuerName || "";
                let name = String(raw || "").trim();
                if (name.includes(" - ")) {
                    const [head, ...rest] = name.split(" - ");
                    if (/^\d+$/.test(head.trim()) && rest.length) {
                        name = rest.join(" - ").trim();
                    }
                }
                return name;
            })(),
            contribution_percentage: Number(
                valuer?.contribution_percentage ?? valuer?.percentage ?? 0
            ),
        }))
        .filter(
            (valuer) =>
                valuer.valuer_name || Number.isFinite(valuer.contribution_percentage)
        );
    return cleaned.length ? cleaned : buildDefaultValuers();
};

const normalizeValuerOption = (valuer = {}) => {
    const valuerId = (valuer?.valuerId || valuer?.valuer_id || valuer?.id || valuer?.value || "").toString().trim();
    const valuerName = (valuer?.valuerName || valuer?.valuer_name || valuer?.name || valuer?.label || valuer?.text || "").toString().trim();
    return { valuerId, valuerName };
};

const normalizeValuerList = (list = []) =>
    (Array.isArray(list) ? list : [])
        .map((valuer) => normalizeValuerOption(valuer))
        .filter((valuer) => valuer.valuerId || valuer.valuerName);

const normalizeSelectedValuers = (list = []) =>
    (Array.isArray(list) ? list : [])
        .map((valuer) => ({
            valuerId: (valuer?.valuerId || valuer?.valuer_id || valuer?.id || "").toString().trim(),
            valuerName: (valuer?.valuerName || valuer?.valuer_name || valuer?.name || valuer?.label || valuer?.text || "").toString().trim(),
            percentage: Number(valuer?.percentage ?? valuer?.contribution_percentage ?? 0) || 0,
        }))
        .filter((valuer) => valuer.valuerId || valuer.valuerName);

const toValuerLabel = (valuer = {}) => {
    const id = (valuer?.valuerId || "").toString().trim();
    const name = (valuer?.valuerName || "").toString().trim();
    if (id && name) return `${id} - ${name}`;
    return name || id || "";
};

const matchCompanyBySelection = (companies = [], selectedCompany) => {
    if (!selectedCompany) return null;
    const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
    const match = (companies || []).find((company) => {
        const candidateOffice = company?.officeId || company?.office_id;
        if (officeId !== undefined && officeId !== null) {
            return String(candidateOffice) === String(officeId);
        }
        if (selectedCompany?.url) {
            return company?.url === selectedCompany.url;
        }
        return company?.name === selectedCompany?.name;
    });
    return match || selectedCompany;
};

const sumValuerPercentages = (list = []) =>
    (Array.isArray(list) ? list : []).reduce((sum, valuer) => {
        const pct = valuer?.percentage ?? valuer?.contribution_percentage ?? 0;
        return sum + (Number(pct) || 0);
    }, 0);

const getReportRecordId = (report) =>
    report?._id || report?.id || report?.recordId || "";

const isReportInfoIssue = (issue) => {
    const location = String(issue?.location || "").toLowerCase();
    return location.includes("report info");
};

const MultiExcelUpload = ({ onViewChange }) => {
    const { token, isGuest, user, login } = useSession();
    const { systemState } = useSystemControl();
    const { executeWithAuth } = useAuthAction();
    const { taqeemStatus, setTaqeemStatus, setCompanyStatus } = useNavStatus();
    const {
        selectedCompany,
        companies,
        loadSavedCompanies,
        syncCompanies,
        replaceCompanies,
        ensureCompaniesLoaded,
        preferredCompany,
        setSelectedCompany,
        setPreferredCompany,
    } = useValueNav();
    const isGuestUser = isGuest || !user?.phone;
    const selectedCompanyOfficeId = useMemo(() => {
        const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
        return officeId ? String(officeId) : "";
    }, [selectedCompany]);
    const userId = useMemo(
        () => user?._id || user?.id || user?.userId || null,
        [user]
    );
    const [excelFiles, setExcelFiles] = useState([]);
    const [pdfFiles, setPdfFiles] = useState([]);
    const [selectedReportActions, setSelectedReportActions] = useState({});
    const [wantsPdfUpload, setWantsPdfUpload] = useState(false);
    const [showInsufficientPointsModal, setShowInsufficientPointsModal] = useState(false);
    const [batchId, setBatchId] = useState("");
    const [reportProgress, setReportProgress] = useState({});
    const [selectedAssetBulkActions, setSelectedAssetBulkActions] = useState({});
    const [uploadResult, setUploadResult] = useState(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [reportsPagination, setReportsPagination] = useState({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
    });
    const [success, setSuccess] = useState("");
    const [creatingReports, setCreatingReports] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [validating, setValidating] = useState(false);
    const [selectedAssetActions, setSelectedAssetActions] = useState({});
    const [validationItems, setValidationItems] = useState([]);
    const [validationMessage, setValidationMessage] = useState(null);
    const [validationTableTab, setValidationTableTab] = useState("report-info");
    const [isValidationTableCollapsed, setIsValidationTableCollapsed] = useState(false);
    const [reports, setReports, resetReports] = usePersistentState("multiExcel:reports", [], { storage: "session" });
    const [reportsLoading, setReportsLoading] = useState(false);
    const [unassignedReports, setUnassignedReports] = useState([]);
    const [unassignedLoading, setUnassignedLoading] = useState(false);
    const [showTemporaryModal, setShowTemporaryModal] = useState(false);
    const [reportsError, setReportsError] = useState(null);
    const [expandedReports, setExpandedReports] = useState([]);
    const [selectedReportIds, setSelectedReportIds] = useState([]);
    const [reportSelectFilter, setReportSelectFilter] = useState("all");
    const [reportActionBusy, setReportActionBusy] = useState({});
    const [selectedAssetsByReport, setSelectedAssetsByReport] = useState({});
    const [assetSelectFilters, setAssetSelectFilters] = useState({});
    const [assetActionBusy, setAssetActionBusy] = useState({});
    const [editingReportId, setEditingReportId] = useState(null);
    const [pdfEditFile, setPdfEditFile] = useState(null);
    const [usePlaceholderPdf, setUsePlaceholderPdf] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [formData, setFormData] = useState(buildDefaultFormData());
    const [errors, setErrors] = useState({});
    const [reportUsers, setReportUsers] = useState([]);
    const [valuers, setValuers] = useState(buildDefaultValuers());
    const [draftValuers, setDraftValuers] = useState([]);
    const [selectedValuers, setSelectedValuers] = useState([]);
    const [valuerModalOpen, setValuerModalOpen] = useState(false);
    const [valuerModalError, setValuerModalError] = useState("");
    const [useDefaultValuers, setUseDefaultValuers] = useState(false);
    const [showValidationModal, setShowValidationModal] = useState(false);
    const [overrideCompanyValuers, setOverrideCompanyValuers] = useState(null);
    const [fetchingCompanyValuers, setFetchingCompanyValuers] = useState(false);
    const [assetEdit, setAssetEdit] = useState(null);
    const [assetDraft, setAssetDraft] = useState({
        asset_name: "",
        asset_usage_id: "",
        final_value: "",
        region: "",
        city: "",
    });
    const [actionStatus, setActionStatus] = useState(null);
    const [updatingReport, setUpdatingReport] = useState(false);
    const [downloadingTemplate, setDownloadingTemplate] = useState(false);
    const [pendingSubmit, setPendingSubmit, resetPendingSubmit] = usePersistentState("multiExcel:pendingSubmit", null, { storage: "session" });
    const [pendingBatch, setPendingBatch, resetPendingBatch] = usePersistentState("multiExcel:pendingBatch", null, { storage: "session" });
    const [, setReturnView, resetReturnView] = usePersistentState("taqeem:returnView", null, { storage: "session" });

    const chargedBatchesRef = useRef(new Set());
    const chargeBatchPoints = useCallback(
        async (batchId, amount, { reportIds = [] } = {}) => {
            if (!batchId || !amount) return;
            const normalized = Number(amount);
            if (!Number.isFinite(normalized) || normalized <= 0) return;
            if (chargedBatchesRef.current.has(batchId)) return;
            if (pendingBatch?.batchId === batchId && pendingBatch.charged) {
                chargedBatchesRef.current.add(batchId);
                return;
            }

            const normalizedReportIds = Array.isArray(reportIds)
                ? Array.from(
                      new Set(
                          reportIds
                              .filter((id) => id || id === 0)
                              .map((id) => String(id))
                      )
                  )
                : [];

            const deductionMeta = {
                batchId,
                source: "multi-batch",
                pageName: MULTI_UPLOAD_PAGE_NAME,
                pageSource: MULTI_UPLOAD_PAGE_SOURCE,
                assetCount: normalized,
            };

            if (normalizedReportIds.length) {
                deductionMeta.reportIds = normalizedReportIds;
                deductionMeta.reportId = normalizedReportIds[0];
            }

            try {
                await deductPoints(token, normalized, deductionMeta);
                chargedBatchesRef.current.add(batchId);
                setPendingBatch((prev) =>
                    prev && prev.batchId === batchId ? { ...prev, charged: true } : prev
                );
            } catch (err) {
                console.error("[MultiExcelUpload] Failed to charge points for batch", err);
            }
        },
        [pendingBatch, setPendingBatch, token]
    );

    const pdfInputRef = useRef(null);
    const editPdfInputRef = useRef(null);
    const selectedCompanyRef = useRef(selectedCompany);
    const selectedValuersRef = useRef(selectedValuers);
    const fetchCompanyValuersPromiseRef = useRef(null);
    const valuerModalPromiseRef = useRef(null);
    const valuerModalResolveRef = useRef(null);
    const pendingCompanySelectionRef = useRef(null);

    useEffect(() => {
        selectedCompanyRef.current = selectedCompany;
    }, [selectedCompany]);

    useEffect(() => {
        if (selectedCompany && pendingCompanySelectionRef.current?.resolve) {
            pendingCompanySelectionRef.current.resolve(selectedCompany);
            pendingCompanySelectionRef.current = null;
        }
    }, [selectedCompany]);

    useEffect(() => {
        return () => {
            if (pendingCompanySelectionRef.current?.timeoutId) {
                clearTimeout(pendingCompanySelectionRef.current.timeoutId);
            }
            pendingCompanySelectionRef.current = null;
        };
    }, []);

    const waitForCompanySelection = useCallback(
        (timeoutMs = 120000) => {
            if (selectedCompany) return Promise.resolve(selectedCompany);
            if (pendingCompanySelectionRef.current?.promise) {
                return pendingCompanySelectionRef.current.promise;
            }

            let resolveFn;
            let timeoutId;
            const promise = new Promise((resolve, reject) => {
                resolveFn = resolve;
                timeoutId = setTimeout(() => {
                    pendingCompanySelectionRef.current = null;
                    reject(new Error("Company selection timed out."));
                }, timeoutMs);
            });

            pendingCompanySelectionRef.current = {
                promise,
                timeoutId,
                resolve: (company) => {
                    clearTimeout(timeoutId);
                    resolveFn(company);
                }
            };

            return promise;
        },
        [selectedCompany]
    );

    const ensureCompanySelected = useCallback(async (options = {}) => {
        const { forceSelection = false, ignorePreferred = false } = options;

        if (forceSelection && selectedCompany) {
            await setSelectedCompany(null, { skipNavigation: true, quiet: true });
        }
        if (!forceSelection && selectedCompany) return selectedCompany;

        let list = companies;
        try {
            if ((!list || list.length === 0) && ensureCompaniesLoaded) {
                list = await ensureCompaniesLoaded("equipment");
            }
            if ((!list || list.length === 0) && loadSavedCompanies) {
                list = await loadSavedCompanies("equipment");
            }
            if ((!list || list.length === 0) && window?.electronAPI?.getCompanies) {
                const data = await window.electronAPI.getCompanies();
                const fetched = Array.isArray(data?.data)
                    ? data.data
                    : Array.isArray(data?.companies)
                        ? data.companies
                        : [];
                if (fetched.length > 0 && replaceCompanies) {
                    list = await replaceCompanies(
                        fetched.map((c) => ({ ...c, type: c.type || "equipment" })),
                        { autoSelect: false, skipNavigation: true, quiet: true }
                    );
                }
            }
        } catch (err) {
            console.warn("Failed to fetch companies for submission", err);
        }

        if (!list || list.length === 0) {
            throw new Error("No companies available. Login to Taqeem and try again.");
        }

        if (preferredCompany && !ignorePreferred) {
            const chosen = await setSelectedCompany(preferredCompany, { skipNavigation: false, quiet: true });
            setCompanyStatus?.("success", `Company: ${chosen?.name || "Selected"}`);
            return chosen;
        }

        if (list.length === 1) {
            const chosen = list[0];
            await setSelectedCompany(chosen, { skipNavigation: false, quiet: true });
            setCompanyStatus?.("success", `Company: ${chosen.name || "Selected"}`);
            return chosen;
        }

        setCompanyStatus?.("info", "Select a company to continue.");
        setSuccess("Select a company to continue.");
        return waitForCompanySelection();
    }, [
        companies,
        ensureCompaniesLoaded,
        loadSavedCompanies,
        preferredCompany,
        replaceCompanies,
        selectedCompany,
        setCompanyStatus,
        setSelectedCompany,
        setSuccess,
        waitForCompanySelection
    ]);

    useEffect(() => {
        selectedValuersRef.current = selectedValuers;
    }, [selectedValuers]);

    // Update state to track batch progress instead of individual report progress
    const [batchProgress, setBatchProgress] = useState({});

    // Add this useEffect to listen for batch progress updates
    useEffect(() => {
        if (!window?.electronAPI?.onCreateReportsByBatchProgress) return;

        const unsubscribe = window.electronAPI.onCreateReportsByBatchProgress((progressData) => {
            const { batchId, processId, current, total, percentage, message, status, currentRecordId } = progressData;
            const id = batchId || processId;

            if (id) {
                setBatchProgress(prev => ({
                    ...prev,
                    [id]: {
                        current: current || 0,
                        total: total || 0,
                        percentage: percentage || 0,
                        message: message || "Processing...",
                        status: status || "processing",
                        currentRecordId: currentRecordId
                    }
                }));
            }
        });

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, []);



    // Update the ProgressBar component to handle batch-level progress
    const BatchProgressBar = ({ current, total, percentage, message, status, currentRecordId }) => {
        const getBarColor = () => {
            if (status === "error") return "bg-rose-500";
            if (status === "completed") return "bg-emerald-500";
            if (status === "partial") return "bg-amber-500";
            return "bg-blue-500";
        };

        const getTextColor = () => {
            if (status === "error") return "text-rose-700";
            if (status === "completed") return "text-emerald-700";
            if (status === "partial") return "text-amber-700";
            return "text-blue-700";
        };

        return (
            <div className="w-full space-y-1">
                <div className="flex items-center justify-between text-[10px] font-medium">
                    <div className="flex-1">
                        <div className={getTextColor()}>{message || "Processing..."}</div>
                        {currentRecordId && (
                            <div className="text-slate-500 text-[9px] mt-0.5">
                                Current: {currentRecordId.slice(0, 8)}...
                            </div>
                        )}
                    </div>
                    <div className="text-right">
                        <div className={getTextColor()}>{Math.round(percentage)}%</div>
                        <div className="text-slate-500 text-[9px]">
                            {current}/{total}
                        </div>
                    </div>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-300 ${getBarColor()}`}
                        style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
                    />
                </div>
            </div>
        );
    };

    const { ramInfo } = useRam();
    const recommendedTabs = ramInfo?.recommendedTabs || 1;
    const guestAccessEnabled = systemState?.guestAccessEnabled ?? true;
    const guestSession = isGuest || !token;
    const authOptions = useMemo(
        () => ({
            isGuest: guestSession,
            guestAccessEnabled,
            cachedUser: user || null,
            selectedCompanyOfficeId: selectedCompanyOfficeId || null,
        }),
        [guestSession, guestAccessEnabled, selectedCompanyOfficeId, user]
    );
    const isTaqeemLoggedIn = taqeemStatus?.state === "success";
    const companyFromList = useMemo(
        () => matchCompanyBySelection(companies, selectedCompany),
        [companies, selectedCompany]
    );
    const companyValuers = useMemo(
        () => normalizeValuerList(companyFromList?.valuers || []),
        [companyFromList]
    );
    const displayCompanyValuers = overrideCompanyValuers ?? companyValuers;
    const valuerNameOptions = useMemo(() => {
        const placeholder = fetchingCompanyValuers
            ? "Loading valuers..."
            : displayCompanyValuers.length
                ? "Select valuer"
                : "No valuers available";
        const options = displayCompanyValuers
            .map((valuer) => {
                const value = (valuer?.valuerName || valuer?.valuerId || "").toString().trim();
                const label = toValuerLabel(valuer) || value;
                if (!value && !label) return null;
                return { value: value || label, label: label || value };
            })
            .filter(Boolean);
        return [
            { value: "", label: placeholder },
            ...options,
        ];
    }, [fetchingCompanyValuers, displayCompanyValuers]);
    const valuerOptionValues = useMemo(
        () =>
            displayCompanyValuers
                .flatMap((valuer) => {
                    const name = (valuer?.valuerName || "").toString().trim();
                    const id = (valuer?.valuerId || "").toString().trim();
                    const label = toValuerLabel(valuer);
                    return [name, id, label].filter(Boolean);
                })
                .filter(Boolean),
        [displayCompanyValuers]
    );
    const selectedCompanyKey = useMemo(
        () =>
            String(
                selectedCompany?.officeId || selectedCompany?.office_id || selectedCompany?.url || ""
            ),
        [selectedCompany]
    );

    const excelInputRef = useRef(null);

    useEffect(() => {
        setSelectedValuers([]);
        selectedValuersRef.current = [];
        setValuerModalOpen(false);
        setDraftValuers([]);
        setValuerModalError("");
        setOverrideCompanyValuers(null);
        setUseDefaultValuers(false);
        setShowValidationModal(false);
        if (valuerModalResolveRef.current) {
            valuerModalResolveRef.current(false);
            valuerModalResolveRef.current = null;
            valuerModalPromiseRef.current = null;
        }
    }, [selectedCompanyKey]);

    useEffect(() => {
        setValuers((prev) => {
            const base = Array.isArray(prev) && prev.length ? prev : buildDefaultValuers();
            if (!valuerOptionValues.length) {
                return base.map((valuer) => ({ ...valuer, valuer_name: "" }));
            }
            const cleaned = base.map((valuer) =>
                valuerOptionValues.includes(valuer.valuer_name)
                    ? valuer
                    : { ...valuer, valuer_name: "" }
            );
            const hasAny = cleaned.some((valuer) => valuer.valuer_name);
            if (!hasAny && valuerOptionValues.length === 1) {
                return [{ valuer_name: valuerOptionValues[0], contribution_percentage: 100 }];
            }
            return cleaned;
        });
    }, [selectedCompanyKey, valuerOptionValues]);

    // Update handleExcelChange to use the ref
    const handleExcelChange = async (e) => {
        const files = Array.from(e.target.files || []);
        setExcelFiles(files);
        resetMessages();
        resetValidation();
        setShowValidationModal(false);
        setUseDefaultValuers(false);
        if (files.length) {
            const ok = await ensureCompanyValuersLoaded();
            if (ok) {
                await openValuerModal();
            }
        }
    };

    // Update handlePdfChange to use the ref
    const handlePdfChange = (e) => {
        const files = Array.from(e.target.files || []);
        setPdfFiles(files);
        resetMessages();
        if (files.length && excelFiles.length) {
            setValidationTableTab("pdf-assets");
            setShowValidationModal(true);
        }
    };

    const handlePdfToggle = (checked) => {
        setWantsPdfUpload(checked);
        if (!checked) {
            setPdfFiles([]);
        } else {
            if (pdfInputRef?.current) {
                pdfInputRef.current.value = null;
                pdfInputRef.current.click();
            }
        }
        resetMessages();
        resetValidation();
    };

    const resetMessages = () => {
        setError("");
        setSuccess("");
    };

    const resetValidation = () => {
        setValidationItems([]);
        setValidationMessage(null);
    };

    // Update the resetAll function to clear file inputs
    const resetAll = () => {
        setExcelFiles([]);
        setPdfFiles([]);
        setWantsPdfUpload(false);
        setBatchId("");
        setUploadResult(null);
        resetMessages();
        resetValidation();
        setDraftValuers([]);
        setSelectedValuers([]);
        selectedValuersRef.current = [];
        setValuerModalOpen(false);
        setValuerModalError("");
        setOverrideCompanyValuers(null);
        setUseDefaultValuers(false);
        setShowValidationModal(false);
        resetPendingSubmit();
        resetPendingBatch();
        resetReturnView();

        // Clear file input values
        if (excelInputRef.current) {
            excelInputRef.current.value = "";
        }
        if (pdfInputRef.current) {
            pdfInputRef.current.value = "";
        }
    };
    const selectedReportSet = useMemo(() => new Set(selectedReportIds), [selectedReportIds]);
    const isEditing = Boolean(editingReportId);
    const temporaryReports = isGuestUser ? reports : unassignedReports;
    const temporaryLoading = isGuestUser ? reportsLoading : unassignedLoading;
    const showTemporarySection =
        isGuestUser || unassignedLoading || unassignedReports.length > 0;

    const loadReports = useCallback(async (append = false) => {
        try {
            if (!token) {
                setReports([]);
                setReportsPagination({
                    page: 1,
                    limit: itemsPerPage,
                    total: 0,
                    totalPages: 1,
                    hasNextPage: false,
                    hasPrevPage: false,
                });
                setReportsError(null);
                return;
            }
            setReportsLoading(true);
            setReportsError(null);

            const pageToUse = append ? currentPage + 1 : currentPage;

            const params = new URLSearchParams({
                page: pageToUse.toString(),
                limit: itemsPerPage.toString(),
            });
            if (selectedCompanyOfficeId && !isGuestUser) {
                params.append("companyOfficeId", selectedCompanyOfficeId);
            }

            const result = await window.electronAPI.apiRequest(
                "GET",
                `/api/multi-approach/user?${params.toString()}`,
                {},
                {
                    Authorization: `Bearer ${token}`
                }
            );

            if (!result?.success) {
                throw new Error(result?.message || "Failed to load reports.");
            }

            const reportList = Array.isArray(result.reports) ? result.reports : [];
            const paginationInfo = result.pagination || {};

            if (append) {
                // Merge with existing reports
                setReports((prev) => [...prev, ...reportList]);
            } else {
                // Replace all reports
                setReports(reportList);
            }

            setReportsPagination(paginationInfo);

        } catch (err) {
            console.log("err props", Object.keys(err));
            setReportsError(err?.message || "Failed to load reports.");
        } finally {
            setReportsLoading(false);
        }
    }, [setReports, setReportsPagination, setReportsError, token, currentPage, itemsPerPage, selectedCompanyOfficeId, isGuestUser]);

    const loadUnassignedReports = useCallback(async () => {
        try {
            if (!token) {
                setUnassignedReports([]);
                return [];
            }
            if (isGuestUser) {
                setUnassignedReports([]);
                return [];
            }
            setUnassignedLoading(true);

            const params = new URLSearchParams({
                page: "1",
                limit: String(Math.max(20, itemsPerPage || 20)),
                unassigned: "true",
            });

            const result = await window.electronAPI.apiRequest(
                "GET",
                `/api/multi-approach/user?${params.toString()}`,
                {},
                {
                    Authorization: `Bearer ${token}`
                }
            );

            if (!result?.success) {
                throw new Error(result?.message || "Failed to load unassigned reports.");
            }

            const reportList = Array.isArray(result.reports) ? result.reports : [];
            setUnassignedReports(reportList);
            return reportList;
        } catch (err) {
            console.warn("[MultiExcelUpload] Failed to load unassigned reports:", err);
            setUnassignedReports([]);
            return [];
        } finally {
            setUnassignedLoading(false);
        }
    }, [token, itemsPerPage, isGuestUser]);

    const handlePageChange = useCallback(async (newPage) => {
        if (newPage < 1 || reportsLoading) return;
        setCurrentPage(newPage);
        // The useEffect will handle the actual loading
    }, [reportsLoading]);

    useEffect(() => {
        setCurrentPage(1);
        setReports([]);
        setReportsPagination((prev) => ({
            ...prev,
            page: 1,
            total: 0,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false,
        }));
    }, [selectedCompanyOfficeId, setReports, setReportsPagination]);

    // Load reports automatically when filter or page size changes
    // Load reports automatically when filter or page size changes
    // Load reports when page, filter, or page size changes
    useEffect(() => {
        loadReports(false);
    }, [currentPage, itemsPerPage, token, loadReports]);

    useEffect(() => {
        if (!isGuestUser) {
            loadUnassignedReports();
        }
    }, [token, loadUnassignedReports, isGuestUser]);

    const pdfMatchInfo = useMemo(() => {
        if (!wantsPdfUpload) {
            return { unmatchedPdfs: [], excelsMissingPdf: [], pdfMap: {} };
        }
        const excelBaseNames = new Set(excelFiles.map((f) => normalizeKey(stripExtension(f.name))));
        const pdfBaseNames = new Set(pdfFiles.map((f) => normalizeKey(stripExtension(f.name))));

        const unmatchedPdfs = pdfFiles
            .filter((f) => !excelBaseNames.has(normalizeKey(stripExtension(f.name))))
            .map((f) => f.name);

        const excelsMissingPdf = excelFiles
            .filter((f) => !pdfBaseNames.has(normalizeKey(stripExtension(f.name))))
            .map((f) => f.name);

        const pdfMap = pdfFiles.reduce((acc, file) => {
            acc[normalizeKey(stripExtension(file.name))] = file;
            return acc;
        }, {});

        return { unmatchedPdfs, excelsMissingPdf, pdfMap };
    }, [excelFiles, pdfFiles, wantsPdfUpload]);

    const resolveTabsForAssets = useCallback(
        (assetCount) => {
            const fallbackTabs = Math.max(1, Number(recommendedTabs) || 1);
            if (!assetCount || assetCount < 1) return fallbackTabs;
            return Math.max(1, Math.min(fallbackTabs, assetCount));
        },
        [recommendedTabs]
    );

    // Add this useEffect to listen for individual report progress updates
    useEffect(() => {
        if (!window?.electronAPI?.onSubmitReportsQuicklyProgress) return;

        const unsubscribe = window.electronAPI.onSubmitReportsQuicklyProgress((progressData) => {
            const { reportId, processId, current, total, percentage, message, status } = progressData;
            const id = reportId || processId;

            if (id) {
                setReportProgress(prev => ({
                    ...prev,
                    [id]: {
                        current: current || 0,
                        total: total || 0,
                        percentage: percentage || 0,
                        message: message || "Processing...",
                        status: status || "processing"
                    }
                }));

                // Clear progress after completion or error
                if (status === "completed" || status === "error") {
                    setTimeout(() => {
                        setReportProgress(prev => {
                            const next = { ...prev };
                            delete next[id];
                            return next;
                        });
                    }, 3000);
                }
            }
        });

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, []);

    const createReportsByBatch = useCallback(
        async (batchId, tabsNum, insertedCount, assetCount = 0, options = {}) => {
            const { resume = false } = options;
            const resolvedTabs = Math.max(1, Number(tabsNum) || Number(recommendedTabs) || 1);

            setCreatingReports(true);

            // Initialize batch progress
            setBatchProgress(prev => ({
                ...prev,
                [batchId]: {
                    current: 0,
                    total: insertedCount || 0,
                    percentage: 0,
                    message: "Initializing...",
                    status: "processing"
                }
            }));

            try {
                if (!batchId) {
                    setError("Missing batch id for report creation.");
                    return;
                }

                const authStatus = await ensureTaqeemAuthorized(
                    token,
                    onViewChange,
                    isTaqeemLoggedIn,
                    0,
                    login,
                    setTaqeemStatus,
                    authOptions
                );
                if (authStatus?.status === "INSUFFICIENT_POINTS") {
                    setShowInsufficientPointsModal(true);
                    return;
                }
                if (authStatus?.status === "LOGIN_REQUIRED" || !isTaqeemAuthSuccess(authStatus)) {
                    setError(
                        getTaqeemAuthErrorMessage(
                            authStatus,
                            "Taqeem login required. Finish login and choose a company to continue."
                        )
                    );
                    setPendingBatch({
                        batchId,
                        tabsNum: resolvedTabs,
                        insertedCount,
                        assetCount,
                        resumeOnLoad: true,
                        charged: false,
                    });
                    setReturnView("multi-excel-upload");
                    return;
                }

                setSuccess(
                    resume
                        ? "Resuming report creation in Taqeem..."
                        : "Creating reports in Taqeem browser..."
                );

                if (!window?.electronAPI?.createReportsByBatch) {
                    throw new Error("Desktop integration unavailable. Restart the app.");
                }

                const electronResult = await window.electronAPI.createReportsByBatch(
                    batchId,
                    resolvedTabs
                );

                if (electronResult?.status === "SUCCESS" || electronResult?.status === "PARTIAL_SUCCESS") {
                    const successCount = electronResult?.successCount || 0;
                    const failureCount = electronResult?.failureCount || 0;
                    const countLabel = insertedCount ? `${insertedCount} report(s)` : "Reports";

                    if (electronResult?.status === "SUCCESS") {
                        setSuccess(`${countLabel} created successfully with ${resolvedTabs} tab(s).`);
                    } else {
                        setSuccess(`Batch completed: ${successCount} succeeded, ${failureCount} failed with ${resolvedTabs} tab(s).`);
                    }

                    // Mark as completed
                    setBatchProgress(prev => ({
                        ...prev,
                        [batchId]: {
                            current: insertedCount || 0,
                            total: insertedCount || 0,
                            percentage: 100,
                            message: electronResult?.status === "SUCCESS"
                                ? "All reports completed"
                                : `${successCount} succeeded, ${failureCount} failed`,
                            status: electronResult?.status === "SUCCESS" ? "completed" : "partial"
                        }
                    }));

                    // Clear progress after 5 seconds
                    setTimeout(() => {
                        setBatchProgress(prev => {
                            const next = { ...prev };
                            delete next[batchId];
                            return next;
                        });
                    }, 5000);

                    resetPendingBatch();
                    resetReturnView();
                    const payloadReportIds = Array.isArray(electronResult?.reportIds)
                        ? electronResult.reportIds
                              .map((id) => (id !== undefined && id !== null ? String(id) : null))
                              .filter(Boolean)
                        : [];
                    const recordReportIds = Array.isArray(electronResult?.records)
                        ? electronResult.records
                              .map((recordEntry) => {
                                  const candidate =
                                      recordEntry?.result?.reportId ||
                                      recordEntry?.result?.report_id;
                                  return candidate !== undefined && candidate !== null
                                      ? String(candidate)
                                      : null;
                              })
                              .filter(Boolean)
                        : [];
                    const reportIdsToCharge = Array.from(
                        new Set([...payloadReportIds, ...recordReportIds])
                    );
                    await chargeBatchPoints(batchId, assetCount, {
                        reportIds: reportIdsToCharge,
                    });
                    await loadReports();
                    return;
                }

                const errMsg = electronResult?.error || "Failed to create reports in Taqeem";
                if (/no company selected/i.test(errMsg)) {
                    setError(errMsg);
                    setPendingBatch({
                        batchId,
                        tabsNum: resolvedTabs,
                        insertedCount,
                        assetCount,
                        resumeOnLoad: true,
                        charged: false,
                    });
                    setReturnView("multi-excel-upload");
                    onViewChange?.("get-companies");
                    return;
                }

                throw new Error(errMsg);
            } catch (err) {
                setError(err?.message || "Failed to create reports in Taqeem");

                // Mark as error
                setBatchProgress(prev => ({
                    ...prev,
                    [batchId]: {
                        current: 0,
                        total: insertedCount || 0,
                        percentage: 0,
                        message: err?.message || "Failed",
                        status: "error"
                    }
                }));

                resetPendingBatch();
                resetReturnView();
            } finally {
                setCreatingReports(false);
            }
        },
        [
            authOptions,
            isTaqeemLoggedIn,
            loadReports,
            onViewChange,
            recommendedTabs,
            resetPendingBatch,
            resetReturnView,
            setTaqeemStatus,
            setPendingBatch,
            setReturnView,
            token,
            login,
        ]
    );

    const submitToTaqeem = useCallback(
        async (recordId, tabsNum, options = {}) => {
            const { withLoading = true, resume = false } = options;
            const resolvedTabs = Math.max(1, Number(tabsNum) || resolveTabsForAssets(0));

            if (withLoading) {
                setSubmitting(true);
            }

            try {
                if (!recordId) {
                    setActionStatus({ type: "error", message: "Missing report record id." });
                    return;
                }

                  const reportForCount =
                      reports.find((item) => getReportRecordId(item) === recordId) ||
                      unassignedReports.find((item) => getReportRecordId(item) === recordId);
                  const assetCount = Array.isArray(reportForCount?.asset_data)
                      ? reportForCount.asset_data.length
                      : 0;
                  const reportBatchId =
                      reportForCount?.batchId || reportForCount?.batch_id || null;

                  const result = await executeWithAuth(
                      async (params) => {
                          const { token: authToken } = params;
                          const targetReport =
                              reports.find((item) => getReportRecordId(item) === recordId) ||
                              unassignedReports.find((item) => getReportRecordId(item) === recordId);
                        const needsCompany = !targetReport?.company_office_id;
                        let assignedOfficeId = targetReport?.company_office_id
                            ? String(targetReport.company_office_id)
                            : "";
                        if (needsCompany) {
                            const chosen = await ensureCompanySelected({
                                forceSelection: true,
                                ignorePreferred: true,
                            });
                            const officeId = chosen?.officeId || chosen?.office_id;
                            if (officeId) {
                                try {
                                    assignedOfficeId = String(officeId);
                                    await updateMultiApproachReport(recordId, {
                                        company_office_id: assignedOfficeId,
                                    });
                                    if (targetReport) {
                                        targetReport.company_office_id = assignedOfficeId;
                                    }
                                    setUnassignedReports((prev) =>
                                        prev.filter((item) => getReportRecordId(item) !== recordId)
                                    );
                                    await loadReports(false);
                                    await loadUnassignedReports();
                                } catch (err) {
                                    console.warn("Failed to update report company office id", err);
                                }
                            }
                        }

                        setActionStatus({
                            type: "info",
                            message: resume ? "Resuming Taqeem submission..." : "Submitting report to Taqeem...",
                        });

                        if (!window?.electronAPI?.createReportById) {
                            throw new Error("Desktop integration unavailable. Restart the app.");
                        }

                        const result = await window.electronAPI.createReportById(recordId, resolvedTabs);

                          if (result?.status === "SUCCESS") {
                              setActionStatus({
                                  type: "success",
                                  message: "Report submitted to Taqeem. Browser closed after completion.",
                              });
                              const createdReportId = result?.reportId || result?.report_id;
                              if (createdReportId) {
                                try {
                                    await updateMultiApproachReport(recordId, {
                                        report_id: createdReportId,
                                        ...(assignedOfficeId
                                            ? { company_office_id: assignedOfficeId }
                                            : {}),
                                    });
                                    if (targetReport) {
                                        targetReport.report_id = createdReportId;
                                    }
                                } catch (err) {
                                    console.warn(
                                        "Failed to update report_id after submission",
                                        err
                                    );
                                }
                            }
                              resetPendingSubmit();
                              resetReturnView();
                              await loadReports();
                              await loadUnassignedReports();
                              return {
                                  success: true,
                                  reportId: createdReportId || recordId,
                                  recordId,
                                  assetCount,
                                  batchId: reportBatchId,
                              };
                          }

                        const errMsg =
                            result?.error ||
                            "Upload to Taqeem failed. Make sure you selected a company.";

                        if (/no company selected/i.test(errMsg)) {
                            setActionStatus({
                                type: "warning",
                                message: errMsg,
                            });
                            setPendingSubmit({ recordId, tabsNum: resolvedTabs, resumeOnLoad: true });
                            setReturnView("multi-excel-upload");
                            onViewChange?.("get-companies");
                            return { success: false, error: errMsg };
                        }

                        throw new Error(errMsg);
                    },
                      { token, recordId, tabsNum: resolvedTabs },
                      {
                          requiredPoints: assetCount,
                          deductPoints: (deductResult) => {
                              const amount =
                                  Number(deductResult?.assetCount ?? assetCount) || 0;
                              if (!amount) return null;
                              if (
                                  reportBatchId &&
                                  (chargedBatchesRef.current.has(reportBatchId) ||
                                      (pendingBatch?.batchId === reportBatchId && pendingBatch.charged))
                              ) {
                                  return null;
                              }
                              const reportId =
                                  deductResult?.reportId || deductResult?.recordId || recordId;
                              const reportIds = reportId ? [reportId] : [];
                              return {
                                  amount,
                                  reportIds,
                                  reportId,
                                  recordId,
                                  batchId: reportBatchId,
                                  source: "multi-batch",
                                  pageName: MULTI_UPLOAD_PAGE_NAME,
                                  pageSource: MULTI_UPLOAD_PAGE_SOURCE,
                                  assetCount: amount,
                              };
                          },
                          showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
                          onViewChange,
                          onAuthSuccess: () => {
                              console.log("[MultiExcelUpload] Authentication successful for Taqeem submission");
                          },
                        onAuthFailure: (reason) => {
                            console.warn("[MultiExcelUpload] Authentication failed for Taqeem:", reason);
                            if (!withLoading) {
                                setActionStatus({
                                    type: "error",
                                    message: reason?.message || "Authentication failed"
                                });
                            }
                        }
                    }
                );

                if (!result || !result?.success && result?.error) {
                    setActionStatus({ type: "error", message: result.error });
                    return
                }
            } catch (err) {
                setActionStatus({
                    type: "error",
                    message: err?.message || "Failed to submit report to Taqeem.",
                });
                resetPendingSubmit();
                resetReturnView();
                return;
            } finally {
                if (withLoading) {
                    setSubmitting(false);
                }
            }
        },
        [
            executeWithAuth,
            ensureCompanySelected,
            isTaqeemLoggedIn,
            loadReports,
            loadUnassignedReports,
            onViewChange,
            reports,
            resolveTabsForAssets,
            resetPendingSubmit,
            resetReturnView,
            setPendingSubmit,
            setReturnView,
            setUnassignedReports,
            token,
            unassignedReports,
        ]
    );

    useEffect(() => {
        if (!pendingSubmit?.recordId || !pendingSubmit?.resumeOnLoad) return;
        if (submitting) return;
        submitToTaqeem(pendingSubmit.recordId, pendingSubmit.tabsNum, { resume: true });
    }, [pendingSubmit, submitToTaqeem, submitting]);

    useEffect(() => {
        if (creatingReports) return;
        if (!pendingBatch?.batchId || !pendingBatch?.resumeOnLoad) return;
        setPendingBatch((prev) => (prev ? { ...prev, resumeOnLoad: false } : prev));
        createReportsByBatch(
            pendingBatch.batchId,
            pendingBatch.tabsNum,
            pendingBatch.insertedCount,
            pendingBatch.assetCount || 0,
            { resume: true }
        );
    }, [pendingBatch, creatingReports, createReportsByBatch, setPendingBatch]);

    const runValidation = async (excelList, pdfMap) => {
        if (!excelList.length) {
            resetValidation();
            return;
        }

        setValidating(true);
        setValidationMessage({
            type: "info",
            text: "Reading Excel files and validating...",
        });

        try {
            const shouldValidatePdf = wantsPdfUpload;
            const results = [];
            for (const file of excelList) {
                const buffer = await file.arrayBuffer();
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(buffer);

                const reportSheet = workbook.getWorksheet("Report Info");
                const marketSheet = workbook.getWorksheet("market");
                const costSheet = workbook.getWorksheet("cost");

                const issues = [];
                const addIssue = (field, location, message) => issues.push({ field, location, message });

                if (!reportSheet || !marketSheet || !costSheet) {
                    addIssue(
                        "Workbook",
                        "Sheets",
                        "Excel must contain sheets named 'Report Info', 'market', and 'cost'."
                    );
                    results.push({
                        fileName: file.name,
                        baseName: normalizeKey(stripExtension(file.name)),
                        pdfMatched: false,
                        pdfName: "",
                        issues,
                        snapshot: null,
                        totals: null,
                        counts: null,
                    });
                    continue;
                }

                const reportRows = worksheetToObjects(reportSheet);
                const marketRows = worksheetToObjects(marketSheet);
                const costRows = worksheetToObjects(costSheet);

                if (!reportRows.length) addIssue("Report Info", "Report Info", "Sheet 'Report Info' is empty.");

                const reportRow = reportRows[0] || {};
                const reportValidation = validateReportInfoAndMarket(reportRow, marketRows);
                issues.push(...(reportValidation.issues || []));
                issues.push(...validateAssetUsageId("market", marketRows));
                issues.push(...validateAssetUsageId("cost", costRows));
                issues.push(...validateCostSheetIntegers(costRows));


                const hasAnyValue = (obj) =>
                    Object.values(obj).some(v => hasValue(v));

                const marketAssetCount = marketRows.filter(hasAnyValue).length;
                const costAssetCount = costRows.filter(hasAnyValue).length;
                console.log("marketAssetCount", marketAssetCount, "costAssetCount", costAssetCount);
                if (marketAssetCount === 0 && costAssetCount === 0) {
                    addIssue(
                        "Assets",
                        "Sheets",
                        "No assets found in market or cost sheets."
                    );
                }

                const reportTotalValue = getReportTotalValue(reportRow);
                if (reportTotalValue === null) {
                    addIssue("Total Value", "Report Info", "Total value is missing or not a number.");
                }

                const sumSheet = (rows, sheetName) =>
                    rows.reduce((acc, row, idx) => {
                        const assetName = row.asset_name || row.assetName || "";
                        if (!hasValue(assetName)) return acc;
                        const rawFinal = pickFieldValue(row, ["final_value", "final value", "value", "Final Value", "Value"]);
                        const num = Number(rawFinal);
                        if (Number.isNaN(num)) {
                            addIssue("final_value", `${sheetName} row ${idx + 2}`, `Invalid final_value "${rawFinal}" for asset "${assetName}"`);
                            return acc;
                        }
                        return acc + num;
                    }, 0);

                const marketTotal = sumSheet(marketRows, "market");
                const costTotal = sumSheet(costRows, "cost");
                const assetsTotal = marketTotal + costTotal;

                if (reportTotalValue !== null) {
                    const diff = Math.abs(assetsTotal - reportTotalValue);
                    if (diff > 0.01) {
                        addIssue(
                            "Totals",
                            "Workbook",
                            `Total assets value (${assetsTotal}) does not match Report Info total value (${reportTotalValue}).`
                        );
                    }
                }

                const baseName = normalizeKey(stripExtension(file.name));
                const matchedPdf = shouldValidatePdf ? pdfMap[baseName] : { name: DUMMY_PDF_NAME };
                if (shouldValidatePdf && !matchedPdf) {
                    addIssue("PDF Match", "Files", `No matching PDF found for Excel "${file.name}" (match by filename).`);
                }

                results.push({
                    fileName: file.name,
                    baseName,
                    pdfMatched: shouldValidatePdf ? Boolean(matchedPdf) : true,
                    pdfName: shouldValidatePdf ? matchedPdf?.name || "" : DUMMY_PDF_NAME,
                    issues,
                    snapshot: reportValidation.snapshot,
                    totals: reportTotalValue === null
                        ? null
                        : {
                            reportTotalValue,
                            assetsTotalValue: assetsTotal,
                            marketTotal,
                            costTotal,
                        },
                    counts: {
                        marketAssets: marketAssetCount,
                        costAssets: costAssetCount,
                    },
                });
            }

            setValidationItems(results);

            const totalIssues = results.reduce((acc, r) => acc + (r.issues?.length || 0), 0);
            const hasPdfMismatch = shouldValidatePdf
                ? (pdfMatchInfo.excelsMissingPdf.length || pdfMatchInfo.unmatchedPdfs.length)
                : false;
            if (totalIssues === 0 && !hasPdfMismatch) {
                setValidationMessage({
                    type: "success",
                    text: shouldValidatePdf
                        ? "All Excel files look valid and PDFs are matched. You can Upload & Send To Taqeem."
                        : `All Excel files look valid. PDFs will use ${DUMMY_PDF_NAME}. You can Upload & Send To Taqeem.`,
                });
            } else {
                console.log("Validation failed", results);

                const firstIssueMessage =
                    results
                        .flatMap(r => r.issues || [])
                        .find(issue => issue?.message)?.message
                    || "Validation failed due to an unknown error.";

                setValidationMessage({
                    type: "error",
                    text: firstIssueMessage,
                });
            }
        } catch (err) {
            console.error("Validation failed", err);
            setValidationMessage({
                type: "error",
                text: err?.message || "Failed to validate Excel files.",
            });
        } finally {
            setValidating(false);
        }
    };

    const filteredReports = useMemo(() => {
        let result = reports;

        // Apply status filter
        if (reportSelectFilter !== "all") {
            result = result.filter((report) => getReportStatus(report) === reportSelectFilter);
        }

        // Apply search filter if there's a query
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            result = result.filter((report) => {
                // Search in report_id
                if (report.report_id && report.report_id.toLowerCase().includes(query)) {
                    return true;
                }
                // Search in client_name
                if (report.client_name && report.client_name.toLowerCase().includes(query)) {
                    return true;
                }
                // Search in final_value (convert to string for comparison)
                if (report.final_value && String(report.final_value).toLowerCase().includes(query)) {
                    return true;
                }
                // Also search in value if final_value is not present
                if (report.value && String(report.value).toLowerCase().includes(query)) {
                    return true;
                }
                return false;
            });
        }

        return result;
    }, [reports, reportSelectFilter, searchQuery]);


    // Use filteredReports for display, but respect backend pagination
    const visibleReports = useMemo(() => {
        // Calculate start and end indices for current page
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;

        return filteredReports.slice(startIndex, endIndex);
    }, [filteredReports, currentPage, itemsPerPage]);
    useEffect(() => {
        runValidation(excelFiles, pdfMatchInfo.pdfMap);
    }, [excelFiles, pdfFiles, wantsPdfUpload]);

    const isReadyToUpload = useMemo(() => {
        if (excelFiles.length === 0) return false;
        if (wantsPdfUpload && pdfFiles.length === 0) return false;
        if (wantsPdfUpload && (pdfMatchInfo.excelsMissingPdf.length || pdfMatchInfo.unmatchedPdfs.length)) {
            return false;
        }
        if (validating) return false;
        if (!validationItems.length) return false;
        const anyIssues = validationItems.some((item) => (item.issues || []).length > 0);
        if (anyIssues) return false;
        return true;
    }, [excelFiles.length, pdfFiles.length, wantsPdfUpload, validating, validationItems, pdfMatchInfo]);

    const handleUploadAndCreate = async () => {
        if (excelFiles.length === 0) {
            setError("Please select at least one Excel file");
            return;
        }
        if (wantsPdfUpload && pdfFiles.length === 0) {
            setError("Please select at least one PDF file or disable PDF upload.");
            return;
        }
        if (wantsPdfUpload && (pdfMatchInfo.excelsMissingPdf.length || pdfMatchInfo.unmatchedPdfs.length)) {
            setError("PDF filenames must match the Excel filenames.");
            return;
        }
        if (!await ensureValuerSelection()) {
            return;
        }

        const result = await executeWithAuth(
            async (params) => {
                const { token: authToken } = params;

                // Step 1: Upload files to backend
                setSuccess(
                    wantsPdfUpload
                        ? "Uploading files to server..."
                        : `Uploading Excel files. PDFs will use ${DUMMY_PDF_NAME}.`
                );

                const data = await multiExcelUpload(
                    excelFiles,
                    wantsPdfUpload ? pdfFiles : [],
                    useDefaultValuers ? [] : buildValuersPayload(),
                    selectedCompanyOfficeId || null
                );

                if (data.status !== "success") {
                    throw new Error(data.error || "Upload failed");
                }

                const batchIdFromApi = data.batchId;
                const insertedCount = data.created || data.inserted || 0;

                setBatchId(batchIdFromApi);
                setUploadResult(data);
                setSuccess(`Files uploaded successfully. Batch ID: ${batchIdFromApi}. Inserted ${insertedCount} report(s).`);

                // Load new reports
                await loadReports();
                await loadUnassignedReports();

                return {
                    success: true,
                    batchId: batchIdFromApi,
                    insertedCount
                };
            },
            { token },
            {
                requiredPoints: excelFiles.length || 0,
                showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
                onViewChange,
                onAuthSuccess: () => {
                    console.log("[MultiExcelUpload] Authentication successful for upload");
                },
                onAuthFailure: (reason) => {
                    console.warn("[MultiExcelUpload] Authentication failed:", reason);

                    if (reason === "LOGIN_REQUIRED") {
                        setError("Please log in to continue. You'll need to re-select your files after logging in.");
                        return;
                    }

                    if (reason !== "INSUFFICIENT_POINTS" && reason !== "TAQEEM_AUTH_REQUIRED") {
                        setError(reason?.message || "Authentication failed");
                        return;
                    }
                }
            }
        );

        if (!result || !result?.success) {
            return
        }

        const batchAssets = validationItems.reduce((sum, item) => {
            const market = Number(item?.counts?.marketAssets) || 0;
            const cost = Number(item?.counts?.costAssets) || 0;
            return sum + market + cost;
        }, 0);

        if (result?.success) {
            // Step 2: Create reports in Taqeem
            await createReportsByBatch(
                result.batchId,
                recommendedTabs,
                result.insertedCount,
                batchAssets
            );
        }
    };

    const handleStoreOnly = async () => {
        if (!await ensureValuerSelection()) {
            return;
        }
        const result = await executeWithAuth(
            async (params) => {
                const { token: authToken } = params;

                setSuccess(
                    wantsPdfUpload
                        ? "Uploading files to server..."
                        : `Uploading Excel files. PDFs will use ${DUMMY_PDF_NAME}.`
                );

                const data = await multiExcelUpload(
                    excelFiles,
                    wantsPdfUpload ? pdfFiles : [],
                    useDefaultValuers ? [] : buildValuersPayload(),
                    selectedCompanyOfficeId || null
                );

                if (!data || data.status !== "success") {
                    throw new Error(data?.error || "Upload failed");
                }

                // ... rest of the logic
                await loadReports();
                await loadUnassignedReports();
                return { success: true, batchId: data.batchId, insertedCount: data.created || 0 };
            },
            { token },
            {
                requiredPoints: excelFiles.length || 0,
                showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
                onViewChange,
                onAuthSuccess: () => {
                    console.log("[MultiExcelUpload] Authentication successful for store only")
                },
                onAuthFailure: (reason) => {
                    console.warn("[MultiExcelUpload] Authentication failed for store only:", reason);
                    if (reason === "LOGIN_REQUIRED") {
                        setError("Please log in to continue.");
                        return;
                    }
                    if (reason !== "INSUFFICIENT_POINTS" && reason !== "TAQEEM_AUTH_REQUIRED") {
                        setError(reason?.message || "Authentication failed");
                    }
                }
            }
        );

        if (!result || !result?.success) {
            return;
        }
    };

    const requiredFields = useMemo(
        () => [
            "title",
            "purpose_id",
            "value_premise_id",
            "report_type",
            "valued_at",
            "submitted_at",
            "inspection_date",
            "value",
            "client_name",
            "telephone",
            "email",
        ],
        []
    );

    const toggleReportExpansion = (reportId) => {
        setExpandedReports((prev) =>
            prev.includes(reportId)
                ? prev.filter((id) => id !== reportId)
                : [...prev, reportId]
        );
    };

    const toggleReportSelection = (reportId) => {
        setSelectedReportIds((prev) =>
            prev.includes(reportId)
                ? prev.filter((id) => id !== reportId)
                : [...prev, reportId]
        );
    };

    const toggleAssetSelection = (reportId, assetIndex) => {
        setSelectedAssetsByReport((prev) => {
            const selected = new Set(prev[reportId] || []);
            if (selected.has(assetIndex)) {
                selected.delete(assetIndex);
            } else {
                selected.add(assetIndex);
            }
            return { ...prev, [reportId]: Array.from(selected) };
        });
    };

    const handleEditReport = (report) => {
        const recordId = getReportRecordId(report);
        if (!recordId) return;
        const mapped = mapReportToForm(report);
        setFormData(mapped);
        setReportUsers(mapped.report_users || []);
        setValuers(normalizeValuers(report?.valuers || []));
        setErrors({});
        setPdfEditFile(null);
        setUsePlaceholderPdf(false);
        setEditingReportId(recordId);
    };

    const closeReportEdit = () => {
        setEditingReportId(null);
        setFormData(buildDefaultFormData());
        setReportUsers([]);
        setValuers(buildDefaultValuers());
        setErrors({});
        setPdfEditFile(null);
        setUsePlaceholderPdf(false);
    };

    const handleFieldChange = (field, value) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        setErrors((prev) => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
        });
    };

    const handleSelectEditPdfFile = (file) => {
        setUsePlaceholderPdf(false);
        setPdfEditFile(file);
        if (file) {
            handleFieldChange("pdf_path", file.name || "selected.pdf");
        }
    };

    const handleUseTemporaryPdfPath = () => {
        setPdfEditFile(null);
        setUsePlaceholderPdf(true);
        if (editPdfInputRef?.current) {
            editPdfInputRef.current.value = "";
        }
    };

    const handleReportUserChange = (idx, value) => {
        setReportUsers((prev) => {
            const next = [...prev];
            next[idx] = value;
            return next;
        });
    };

    const handleAddReportUser = () => {
        setReportUsers((prev) => [...prev, ""]);
    };

    const handleRemoveReportUser = (idx) => {
        setReportUsers((prev) => prev.filter((_, index) => index !== idx));
    };

    const handleValuerChange = (idx, field, value) => {
        setValuers((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], [field]: value };
            return next;
        });
    };

    const handleAddValuer = () => {
        setValuers((prev) => [
            ...prev,
            { valuer_name: "", contribution_percentage: "" },
        ]);
    };

    const handleRemoveValuer = (idx) => {
        setValuers((prev) => prev.filter((_, index) => index !== idx));
    };

    const waitForTaqeemLogin = async (timeoutMs = 180000, intervalMs = 2000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (!window?.electronAPI?.checkStatus) return true;
            const status = await window.electronAPI.checkStatus();
            const ok = status?.browserOpen
                && String(status?.status || "").toUpperCase().includes("SUCCESS");
            if (ok) {
                setTaqeemStatus?.("success", "Taqeem login: On");
                return true;
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
        throw new Error("Timed out waiting for Taqeem login.");
    };

    const refreshCompaniesFromTaqeem = useCallback(async () => {
        if (fetchCompanyValuersPromiseRef.current) {
            return fetchCompanyValuersPromiseRef.current;
        }
        const run = (async () => {
            if (!window?.electronAPI?.getCompanies) {
                throw new Error("Desktop integration unavailable. Restart the app.");
            }
            setFetchingCompanyValuers(true);
            try {
                let isLoggedIn = taqeemStatus?.state === "success";
                if (window?.electronAPI?.checkStatus) {
                    const status = await window.electronAPI.checkStatus();
                    isLoggedIn = status?.browserOpen
                        && String(status?.status || "").toUpperCase().includes("SUCCESS");
                    if (isLoggedIn) {
                        setTaqeemStatus?.("success", "Taqeem login: On");
                    }
                }

                if (!isLoggedIn) {
                    if (!window?.electronAPI?.openTaqeemLogin) {
                        throw new Error("Taqeem login handler unavailable.");
                    }
                    const loginResult = await window.electronAPI.openTaqeemLogin({
                        automationOnly: true,
                        onlyIfClosed: true,
                        navigateIfOpen: false
                    });
                    if (loginResult?.status !== "SUCCESS") {
                        throw new Error(loginResult?.error || "Failed to open Taqeem login.");
                    }
                    await waitForTaqeemLogin();
                }

                setCompanyStatus?.("info", "Fetching companies and valuers from Taqeem...");
                const data = await window.electronAPI.getCompanies();
                if (data?.status !== "SUCCESS") {
                    throw new Error(data?.error || "Failed to fetch companies from Taqeem.");
                }
                const fetched = Array.isArray(data?.data)
                    ? data.data
                    : Array.isArray(data?.companies)
                        ? data.companies
                        : [];
                if (!fetched.length) {
                    throw new Error("No companies found in Taqeem.");
                }
                const prepared = fetched.map((c) => ({ ...c, type: c.type || "equipment" }));
                let synced = prepared;
                if (syncCompanies && !isGuest) {
                    try {
                        const syncedRes = await syncCompanies(prepared, "equipment");
                        if (Array.isArray(syncedRes) && syncedRes.length > 0) {
                            synced = syncedRes;
                        }
                    } catch (err) {
                        console.warn("Failed to sync companies after Taqeem login", err);
                    }
                }
                if (replaceCompanies) {
                    await replaceCompanies(synced, { quiet: true, skipNavigation: true, autoSelect: false });
                } else if (loadSavedCompanies) {
                    await loadSavedCompanies("equipment");
                }
                return synced;
            } finally {
                setFetchingCompanyValuers(false);
            }
        })();
        fetchCompanyValuersPromiseRef.current = run;
        try {
            return await run;
        } finally {
            fetchCompanyValuersPromiseRef.current = null;
        }
    }, [isGuest, loadSavedCompanies, replaceCompanies, setCompanyStatus, setTaqeemStatus, syncCompanies, taqeemStatus?.state]);

    const getValuerModalPromise = () => {
        if (valuerModalPromiseRef.current) return valuerModalPromiseRef.current;
        valuerModalPromiseRef.current = new Promise((resolve) => {
            valuerModalResolveRef.current = resolve;
        });
        return valuerModalPromiseRef.current;
    };

    const closeValuerModal = (result = false) => {
        setValuerModalOpen(false);
        setValuerModalError("");
        setOverrideCompanyValuers(null);
        if (valuerModalResolveRef.current) {
            valuerModalResolveRef.current(result);
            valuerModalResolveRef.current = null;
            valuerModalPromiseRef.current = null;
        }
    };

    const ensureCompanySelectedForDelete = useCallback(async () => {
        if (selectedCompany) return selectedCompany;

        let list = companies;
        try {
            if ((!list || list.length === 0) && ensureCompaniesLoaded) {
                list = await ensureCompaniesLoaded("equipment");
            }
            if ((!list || list.length === 0) && loadSavedCompanies) {
                list = await loadSavedCompanies("equipment");
            }
            if ((!list || list.length === 0) && window?.electronAPI?.getCompanies) {
                const data = await window.electronAPI.getCompanies();
                const fetched = Array.isArray(data?.data)
                    ? data.data
                    : Array.isArray(data?.companies)
                        ? data.companies
                        : [];
                if (fetched.length > 0 && replaceCompanies) {
                    list = await replaceCompanies(
                        fetched.map((c) => ({ ...c, type: c.type || "equipment" })),
                        { autoSelect: false, skipNavigation: true, quiet: true }
                    );
                }
            }
        } catch (err) {
            console.warn("Failed to fetch companies for deleting reports", err);
        }

        if (!list || list.length === 0) {
            throw new Error("No companies available. Login to Taqeem and try again.");
        }

        if (preferredCompany) {
            const chosen = await setPreferredCompany(preferredCompany, {
                applySelection: true,
                skipNavigation: true,
                quiet: true,
            });
            setCompanyStatus?.("success", `Company: ${chosen?.name || "Selected"}`);
            return chosen;
        }

        if (list.length === 1) {
            const chosen = list[0];
            await setSelectedCompany(chosen, { skipNavigation: false, quiet: true });
            setCompanyStatus?.("success", `Company: ${chosen.name || "Selected"}`);
            return chosen;
        }

        throw new Error("Select a company before deleting the report.");
    }, [
        selectedCompany,
        companies,
        replaceCompanies,
        ensureCompaniesLoaded,
        loadSavedCompanies,
        preferredCompany,
        setPreferredCompany,
        setSelectedCompany,
        setCompanyStatus,
    ]);

    const ensureCompanyValuersLoaded = async () => {
        const currentCompany = companyFromList || selectedCompanyRef.current || selectedCompany;
        if (!currentCompany) {
            const msg = "Select a company to load its valuers.";
            setValuerModalError(msg);
            setError(msg);
            return false;
        }
        const availableValuers = normalizeValuerList(currentCompany?.valuers || []);
        if (availableValuers.length) return true;
        try {
            await refreshCompaniesFromTaqeem();
            return true;
        } catch (err) {
            setValuerModalError(err?.message || "Failed to fetch valuers from Taqeem.");
            return false;
        }
    };

    const openValuerModal = async (options = {}) => {
        const { waitForSelection = false } = options;
        if (valuerModalOpen) {
            return waitForSelection ? getValuerModalPromise() : true;
        }

        const currentCompany = companyFromList || selectedCompanyRef.current || selectedCompany;
        if (!currentCompany) {
            const msg = "Select a company to load its valuers.";
            setValuerModalError(msg);
            setError(msg);
            return false;
        }

        let availableValuers = normalizeValuerList(currentCompany?.valuers || []);
        if (!availableValuers.length) {
            try {
                const refreshed = await refreshCompaniesFromTaqeem();
                const officeId = currentCompany?.officeId || currentCompany?.office_id;
                const match = Array.isArray(refreshed)
                    ? refreshed.find((company) => {
                        if (officeId !== undefined && officeId !== null) {
                            return String(company?.officeId || company?.office_id) === String(officeId);
                        }
                        if (currentCompany?.url) {
                            return company?.url === currentCompany.url;
                        }
                        return company?.name === currentCompany?.name;
                    })
                    : null;
                availableValuers = normalizeValuerList(match?.valuers || []);
                if (availableValuers.length) {
                    setOverrideCompanyValuers(availableValuers);
                }
            } catch (err) {
                const msg = err?.message || "Failed to fetch valuers from Taqeem.";
                setValuerModalError(msg);
                setError(msg);
                return false;
            }
        }

        if (!availableValuers.length) {
            const msg = "No valuers found for the selected company.";
            setValuerModalError(msg);
            setError(msg);
            return false;
        }

        const currentSelected = normalizeSelectedValuers(selectedValuersRef.current || selectedValuers);
        const initialDraft = currentSelected.length
            ? currentSelected.map((v) => {
                const match = availableValuers.find(
                    (item) =>
                        (v.valuerId && item.valuerId === v.valuerId)
                        || (v.valuerName && item.valuerName === v.valuerName)
                );
                return {
                    valuerId: v.valuerId || match?.valuerId || "",
                    valuerName: v.valuerName || match?.valuerName || "",
                    percentage: Number(v.percentage) || 0,
                };
            })
            : availableValuers.length === 1
                ? [{ ...availableValuers[0], percentage: 100 }]
                : [];

        setDraftValuers(initialDraft);
        setValuerModalError("");
        setUseDefaultValuers(false);
        setValuerModalOpen(true);
        return waitForSelection ? getValuerModalPromise() : true;
    };

    const ensureValuerSelection = async () => {
        if (useDefaultValuers || (selectedValuersRef.current || []).length) return true;
        const result = await openValuerModal({ waitForSelection: true });
        return result === true;
    };

    const toggleDraftValuer = (valuer, checked) => {
        const key = valuer.valuerId || valuer.valuerName;
        setDraftValuers((prev) => {
            const next = [...prev];
            const idx = next.findIndex((v) => (v.valuerId || v.valuerName) === key);
            if (checked) {
                if (idx === -1) {
                    const nextPct = next.length === 0 ? 100 : 0;
                    next.push({ ...valuer, percentage: nextPct });
                }
            } else if (idx !== -1) {
                next.splice(idx, 1);
            }

            if (next.length === 1) {
                next[0].percentage = 100;
            }
            return next;
        });
    };

    const updateDraftPercentage = (valuer, percentage) => {
        const key = valuer.valuerId || valuer.valuerName;
        setDraftValuers((prev) =>
            prev.map((v) =>
                (v.valuerId || v.valuerName) === key
                    ? { ...v, percentage: Number(percentage) || 0 }
                    : v
            )
        );
    };

    const autoSplitDraft = () => {
        setDraftValuers((prev) => {
            const count = prev.length;
            if (!count) return prev;
            const base = Math.floor(100 / count / 5) * 5;
            let remainder = 100 - base * count;
            return prev.map((v) => {
                const add = remainder >= 5 ? 5 : 0;
                remainder -= add;
                return { ...v, percentage: base + add };
            });
        });
    };

    const skipValuerSelection = () => {
        setDraftValuers([]);
        selectedValuersRef.current = [];
        setSelectedValuers([]);
        setUseDefaultValuers(true);
        setValuerModalError("");
        closeValuerModal(true);
        setShowValidationModal(true);
    };

    const applyValuerDraft = () => {
        const total = sumValuerPercentages(draftValuers);
        if (!draftValuers.length) {
            setValuerModalError("Select at least one valuer.");
            return;
        }
        if (Math.abs(total - 100) > 0.001) {
            setValuerModalError(`Total must be 100%. Currently ${total}%.`);
            return;
        }
        const cleaned = draftValuers.map((v) => ({
            valuerId: v.valuerId || "",
            valuerName: v.valuerName || "",
            percentage: Number(v.percentage) || 0,
        }));
        selectedValuersRef.current = cleaned;
        setSelectedValuers(cleaned);
        setUseDefaultValuers(false);
        setValuerModalError("");
        closeValuerModal(true);
        setShowValidationModal(true);
    };

    const buildValuersPayload = () => {
        const cleaned = normalizeSelectedValuers(selectedValuersRef.current || selectedValuers);
        return cleaned
            .map((valuer) => ({
                valuer_name: String(valuer?.valuerName || valuer?.valuerId || "").trim(),
                contribution_percentage: Number(valuer?.percentage) || 0,
            }))
            .filter((valuer) => valuer.valuer_name);
    };

    const valuerSummary = useMemo(() => {
        const cleaned = buildValuersPayload();
        if (useDefaultValuers || cleaned.length === 0) {
            return "Using default valuer";
        }
        return cleaned
            .map((valuer) => `${valuer.valuer_name} (${valuer.contribution_percentage}%)`)
            .join(", ");
    }, [useDefaultValuers, selectedValuers]);

    const validateReport = () => {
        const newErrors = {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        requiredFields.forEach((field) => {
            if (!formData[field]) {
                newErrors[field] = "Required";
            }
        });

        if (!formData.value && !formData.final_value) {
            newErrors.final_value = "Required";
        }

        if (formData.email && !isValidEmail(formData.email)) {
            newErrors.email = "Invalid email";
        }

        // Validate valued_at date
        if (formData.valued_at) {
            const valuedAtDate = new Date(formData.valued_at);
            valuedAtDate.setHours(0, 0, 0, 0);
            if (valuedAtDate > today) {
                newErrors.valued_at = "Cannot be in future";
            }
        }

        // Validate submitted_at date
        if (formData.submitted_at) {
            const submittedAtDate = new Date(formData.submitted_at);
            submittedAtDate.setHours(0, 0, 0, 0);
            if (submittedAtDate > today) {
                newErrors.submitted_at = "Cannot be in future";
            }
        }

        // Validate inspection_date
        if (formData.inspection_date) {
            const inspectionDate = new Date(formData.inspection_date);
            inspectionDate.setHours(0, 0, 0, 0);
            if (inspectionDate > today) {
                newErrors.inspection_date = "Cannot be in future";
            }
        }

        // Validate valued_at is on or before submitted_at
        if (formData.valued_at && formData.submitted_at && !newErrors.valued_at && !newErrors.submitted_at) {
            const valuedAtDate = new Date(formData.valued_at);
            const submittedAtDate = new Date(formData.submitted_at);
            valuedAtDate.setHours(0, 0, 0, 0);
            submittedAtDate.setHours(0, 0, 0, 0);

            if (valuedAtDate > submittedAtDate) {
                newErrors.valued_at = "Must be on or before submission date";
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSaveReportEdit = async () => {
        if (!editingReportId) return;
        const isValid = validateReport();
        if (!isValid) {
            setActionStatus({ type: "error", message: "Fix required fields before saving." });
            return;
        }

        const result = await executeWithAuth(
            async (params) => {
                const { token: authToken } = params;

                const normalizedFinal = formData.final_value || formData.value || "";
                const payload = {
                    ...formData,
                    value: formData.value || normalizedFinal,
                    final_value: normalizedFinal,
                    report_users: reportUsers || [],
                    valuers,
                };

                const updateOptions = {
                    pdfFile: pdfEditFile,
                    useTemporaryPdf: usePlaceholderPdf,
                };
                const result = await updateMultiApproachReport(editingReportId, payload, updateOptions);
                if (result?.success) {
                    setActionStatus({ type: "success", message: "Report updated." });
                    closeReportEdit();
                    await loadReports();
                    return { success: true };
                } else {
                    throw new Error(result?.message || "Could not update report.");
                }
            },
            { token, editingReportId, formData, reportUsers, valuers },
            {
                requiredPoints: 0, // Editing doesn't cost points
                onViewChange,
                onAuthFailure: (reason) => {
                    setActionStatus({
                        type: "error",
                        message: reason?.message || "Authentication failed for edit"
                    });
                }
            }
        );
    };

    const openAssetEdit = (reportId, assetIndex, asset) => {
        setAssetEdit({ reportId, assetIndex });
        setAssetDraft({
            asset_name: asset?.asset_name || "",
            asset_usage_id: asset?.asset_usage_id || "",
            final_value: asset?.final_value || "",
            region: asset?.region || "",
            city: asset?.city || "",
        });
    };

    const closeAssetEdit = () => {
        setAssetEdit(null);
        setAssetDraft({
            asset_name: "",
            asset_usage_id: "",
            final_value: "",
            region: "",
            city: "",
        });
    };

    const handleSaveAssetEdit = async () => {
        if (!assetEdit?.reportId && assetEdit?.reportId !== 0) return;
        const { reportId, assetIndex } = assetEdit;

        const result = await executeWithAuth(
            async (params) => {
                const { token: authToken } = params;
                const result = await updateMultiApproachAsset(reportId, assetIndex, assetDraft);
                if (!result?.success) {
                    throw new Error(result?.message || "Failed to update asset.");
                }
                setActionStatus({ type: "success", message: "Asset updated." });
                closeAssetEdit();
                await loadReports();
                return { success: true };
            },
            { token, reportId, assetIndex, assetDraft },
            {
                requiredPoints: 0, // Asset edit doesn't cost points
                onViewChange,
                onAuthFailure: (reason) => {
                    setActionStatus({
                        type: "error",
                        message: reason?.message || "Authentication failed for asset edit"
                    });
                }
            }
        );
    };

    const downloadExcelTemplate = async () => {
        try {
            setDownloadingTemplate(true);
            setActionStatus({
                type: "info",
                message: "Downloading Excel template...",
            });

            // Try using Electron API first
            if (window?.electronAPI?.readTemplateFile) {
                try {
                    const result = await window.electronAPI.readTemplateFile('multi-excel-template.xlsx');

                    if (!result?.success) {
                        throw new Error(result?.error || "Failed to read template file");
                    }

                    const buffer = new Uint8Array(result.arrayBuffer);
                    const blob = new Blob([buffer], {
                        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    });

                    const url = window.URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.setAttribute("download", "multi-excel-template.xlsx");
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    window.URL.revokeObjectURL(url);

                    setActionStatus({
                        type: "success",
                        message: "Excel template downloaded successfully.",
                    });
                    return;
                } catch (electronError) {
                    console.log("Electron API method failed, trying fetch:", electronError.message);
                }
            }

            // Fallback: Try using fetch
            const possibleExtensions = [".xlsx", ".xls", ""];
            let downloadSuccess = false;
            let lastError = null;

            for (const ext of possibleExtensions) {
                try {
                    const fileName = `multi-excel-template${ext}`;
                    const templatePath = `/multi-excel-template${ext}`;

                    const response = await fetch(templatePath);

                    if (!response.ok) {
                        if (response.status === 404) {
                            lastError = new Error(`File ${fileName} not found`);
                            continue;
                        }
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    const blob = await response.blob();

                    const disposition = response.headers.get("content-disposition") || "";
                    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                    const filename = match && match[1]
                        ? match[1].replace(/['"]/g, '')
                        : `multi-excel-template${ext || ".xlsx"}`;

                    const url = window.URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.setAttribute("download", filename);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    window.URL.revokeObjectURL(url);

                    downloadSuccess = true;
                    setActionStatus({
                        type: "success",
                        message: "Excel template downloaded successfully.",
                    });
                    break;
                } catch (err) {
                    lastError = err;
                    console.log(`Failed to download multi-excel-template${ext}:`, err.message);
                }
            }

            if (!downloadSuccess) {
                throw lastError || new Error("Template file not found. Please ensure the template exists in the public folder.");
            }
        } catch (err) {
            console.error("Failed to download Excel template", err);
            setActionStatus({
                type: "error",
                message: err?.message?.includes("404") || err?.message?.includes("not found")
                    ? "Template file not found. Please contact administrator to ensure the template file exists in the public folder."
                    : err?.message || "Failed to download Excel template. Please try again.",
            });
        } finally {
            setDownloadingTemplate(false);
        }
    };

    const downloadCertificatesForReports = async (reportList = []) => {
        if (!reportList.length) return;
        if (!window?.electronAPI?.downloadRegistrationCertificates) {
            setActionStatus({
                type: "error",
                message: "Desktop integration unavailable. Restart the app.",
            });
            return;
        }

        const targets = reportList
            .map((report) => ({
                reportId: report.report_id || report.reportId || "",
                assetName: report.client_name || report.title || "",
            }))
            .filter((item) => item.reportId);

        if (!targets.length) {
            setActionStatus({
                type: "warning",
                message: "No reports with IDs found to download certificates.",
            });
            return;
        }

        const folderResult = await window.electronAPI.selectFolder();
        if (!folderResult?.folderPath) {
            setActionStatus({ type: "info", message: "Folder selection canceled." });
            return;
        }

        setActionStatus({
            type: "info",
            message: `Downloading ${targets.length} certificate(s)...`,
        });

        try {
            const result = await window.electronAPI.downloadRegistrationCertificates({
                downloadPath: folderResult.folderPath,
                reports: targets,
                tabsNum: Math.max(1, Number(recommendedTabs) || 1),
            });
            if (result?.status !== "SUCCESS") {
                throw new Error(result?.error || "Certificate download failed");
            }
            const summary = result?.summary || {};
            const downloaded = summary.downloaded ?? 0;
            const failed = summary.failed ?? 0;
            setActionStatus({
                type: failed ? "warning" : "success",
                message: `Certificates downloaded: ${downloaded}. Failed: ${failed}.`,
            });
        } catch (err) {
            setActionStatus({
                type: "error",
                message: err?.message || "Failed to download certificates.",
            });
        }
    };

    const handleDeleteReport = useCallback(
        async (reportOrId, options = {}) => {
            const { confirm = true } = options;
            const report = typeof reportOrId === "string"
                ? reports.find((item) => getReportRecordId(item) === reportOrId)
                : reportOrId;
            const recordId = getReportRecordId(report);
            const taqeemReportId = report?.report_id || report?.reportId || "";

            if (!report || !recordId) {
                setError("Report not found.");
                return;
            }

            if (!taqeemReportId) {
                setError("Report must be submitted to Taqeem first (must have a report_id).");
                return;
            }

            if (confirm && !window.confirm("Are you sure you want to delete this report?")) return;

            setReportActionBusy((prev) => ({ ...prev, [recordId]: "delete" }));

            try {
                if (window?.electronAPI?.checkStatus) {
                    const browserStatus = await window.electronAPI.checkStatus();
                    if (browserStatus?.browserOpen && String(browserStatus?.status || "").toUpperCase().includes("SUCCESS")) {
                        setTaqeemStatus?.("success", "Taqeem login: On");
                    } else {
                        setTaqeemStatus?.("info", "Taqeem login: Off");
                        setSuccess("Taqeem login is off. Complete login in the opened browser window to continue.");
                    }
                }

                await ensureCompanySelectedForDelete();

                if (!window?.electronAPI?.deleteReport) {
                    throw new Error("Desktop integration unavailable. Restart the app.");
                }

                setSuccess(`Deleting report ${taqeemReportId}...`);
                const result = await window.electronAPI.deleteReport(taqeemReportId, 10, userId);
                if (result?.status !== "SUCCESS") {
                    throw new Error(result?.message || result?.error || "Failed to delete report.");
                }

                const deleteResult = await deleteMultiApproachReport(recordId);
                if (!deleteResult?.success) {
                    throw new Error(
                        deleteResult?.message ||
                        "Report deleted in Taqeem, but failed to remove it locally."
                    );
                }

                setSuccess(result?.message || "Report deleted successfully.");
                await loadReports();
            } catch (err) {
                setError(err?.message || "Failed to delete report.");
            } finally {
                setReportActionBusy((prev) => {
                    const next = { ...prev };
                    delete next[recordId];
                    return next;
                });
            }
        },
        [
            deleteMultiApproachReport,
            ensureCompanySelectedForDelete,
            loadReports,
            reports,
            setError,
            setReportActionBusy,
            setSuccess,
            setTaqeemStatus,
            userId,
        ]
    );

    const handleReportAction = async (report, action) => {
        if (!action) return;
        if (action === "edit") {
            handleEditReport(report);
            return;
        }

        const recordId = getReportRecordId(report);
        if (!recordId) {
            setActionStatus({ type: "error", message: "Missing report record id." });
            return;
        }

        if (action === "send-approver") {
            setActionStatus({ type: "info", message: "Report sent to approver." });
            return;
        }

        if (action === "submit-taqeem") {
            // Changed: Use submitToTaqeem for individual report instead of batch creation
            const assetCount = Array.isArray(report.asset_data) ? report.asset_data.length : 0;
            const tabsForAssets = resolveTabsForAssets(assetCount);

            setReportActionBusy((prev) => ({ ...prev, [recordId]: action }));

            try {
                await submitToTaqeem(recordId, tabsForAssets, { withLoading: false });
                await loadReports();
            } catch (err) {
                setActionStatus({
                    type: "error",
                    message: err?.response?.data?.message || err?.message || "Action failed.",
                });
            } finally {
                setReportActionBusy((prev) => {
                    const next = { ...prev };
                    delete next[recordId];
                    return next;
                });
            }
            return;
        }

        if (action === "approve") {
            const result = await executeWithAuth(
                async (params) => {
                    const { token: authToken } = params;
                    const result = await updateMultiApproachReport(recordId, { checked: true });
                    if (!result?.success) {
                        throw new Error(result?.message || "Failed to approve report.");
                    }
                    setActionStatus({ type: "success", message: "Report approved." });
                    await loadReports();
                    return { success: true };
                },
                { token, recordId },
                {
                    requiredPoints: 0,
                    onViewChange,
                    onAuthFailure: (reason) => {
                        setActionStatus({
                            type: "error",
                            message: reason?.message || "Authentication failed for approve action"
                        });
                    }
                }
            );
            return;
        }

        if (action === "download") {
            const result = await executeWithAuth(
                async (params) => {
                    const { token: authToken } = params;
                    await downloadCertificatesForReports([report]);
                    return { success: true };
                },
                { token, report },
                {
                    requiredPoints: 0,
                    onViewChange,
                    onAuthFailure: (reason) => {
                        setActionStatus({
                            type: "error",
                            message: reason?.message || "Authentication failed for download"
                        });
                    }
                }
            );
            return;
        }

        if (action === "delete") {
            await handleDeleteReport(report);
            return;
        }

        if (action === "send") {
            setReportActionBusy((prev) => ({ ...prev, [recordId]: action }));
            try {
                const assetCount = Array.isArray(report.asset_data)
                    ? report.asset_data.length
                    : 0;
                const tabsForAssets = resolveTabsForAssets(assetCount);
                await submitToTaqeem(recordId, tabsForAssets, { withLoading: false });
                await loadReports();
            } catch (err) {
                setActionStatus({
                    type: "error",
                    message:
                        err?.response?.data?.message || err?.message || "Action failed.",
                });
            } finally {
                setReportActionBusy((prev) => {
                    const next = { ...prev };
                    delete next[recordId];
                    return next;
                });
            }
        }

        if (action === "retry") {
            setReportActionBusy((prev) => ({ ...prev, [recordId]: action }));
            try {
                const assetCount = Array.isArray(report.asset_data)
                    ? report.asset_data.length
                    : 0;
                const tabsForAssets = resolveTabsForAssets(assetCount);
                await executeWithAuth(
                    async (params) => {
                        const { token: authToken, recordId } = params;
                        const result = await window.electronAPI.retryCreateReportById(recordId, tabsForAssets);
                        if (!result?.success) {
                            await loadReports();
                            throw new Error(result?.message || "Failed to retry report.");
                        }
                        setActionStatus({ type: "success", message: "Report retried." });
                        await loadReports();
                        return { success: true };
                    },
                    { token, recordId },
                    {
                        requiredPoints: 0,
                        showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
                        onViewChange,
                        onAuthSuccess: () => {
                            console.log("[ReportsTable] Authentication successful for retry");
                        },
                        onAuthFailure: (reason) => {
                            console.warn("[ReportsTable] Authentication failed for retry:", reason);
                        }
                    }
                );
            } catch (err) {
                setActionStatus({
                    type: "error",
                    message:
                        err?.response?.data?.message || err?.message || "Action failed.",
                });
            } finally {
                setReportActionBusy((prev) => {
                    const next = { ...prev };
                    delete next[recordId];
                    return next;
                });
            }
        }
    };

    const handleAssetAction = async (report, assetIndex, action) => {
        if (!action) return;
        const recordId = getReportRecordId(report);
        if (!recordId) return;

        if (action === "edit") {
            const asset = report?.asset_data?.[assetIndex];
            openAssetEdit(recordId, assetIndex, asset);
            return;
        }

        if (action === "retry") {
            setAssetActionBusy((prev) => ({
                ...prev,
                [`${recordId}:${assetIndex}`]: action,
            }));

            try {
                const assetCount = Array.isArray(report.asset_data)
                    ? report.asset_data.length
                    : 0;
                const tabsForAssets = resolveTabsForAssets(assetCount);
                await submitToTaqeem(recordId, tabsForAssets, { withLoading: false });
                await loadReports();
            } catch (err) {
                setActionStatus({
                    type: "error",
                    message:
                        err?.response?.data?.message ||
                        err?.message ||
                        "Asset action failed.",
                });
            } finally {
                setAssetActionBusy((prev) => {
                    const next = { ...prev };
                    delete next[`${recordId}:${assetIndex}`];
                    return next;
                });
            }
        }
    };

    const handleBulkAssetAction = async (report, action) => {
        if (!action) return;
        const reportId = getReportRecordId(report);
        if (!reportId) return;
        const selectedAssets = selectedAssetsByReport[reportId] || [];
        if (!selectedAssets.length) {
            setActionStatus({
                type: "warning",
                message: "Select at least one asset first.",
            });
            return;
        }

        try {
            if (action === "retry") {
                const assetCount = Array.isArray(report.asset_data)
                    ? report.asset_data.length
                    : 0;
                const tabsForAssets = resolveTabsForAssets(assetCount);
                await submitToTaqeem(reportId, tabsForAssets, { withLoading: false });
                await loadReports();
                return;
            }

        } catch (err) {
            setActionStatus({
                type: "error",
                message:
                    err?.response?.data?.message ||
                    err?.message ||
                    "Bulk asset action failed.",
            });
        }
    };

    const assetEditBusy = assetEdit
        ? assetActionBusy[`${assetEdit.reportId}:${assetEdit.assetIndex}`]
        : false;

    const actionAlert = actionStatus ? (
        <div
            className={`mb-2 rounded-lg border px-3 py-2 flex items-start gap-2 text-xs ${actionStatus.type === "error"
                ? "border-rose-300 bg-rose-50 text-rose-700"
                : actionStatus.type === "warning"
                    ? "border-amber-300 bg-amber-50 text-amber-700"
                    : actionStatus.type === "info"
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-emerald-300 bg-emerald-50 text-emerald-700"
                }`}
        >
            {actionStatus.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
            ) : actionStatus.type === "info" ? (
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
            ) : actionStatus.type === "warning" ? (
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            ) : (
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            )}
            <div className="font-semibold">{actionStatus.message}</div>
        </div>
    ) : null;


    const validationConsole = (
<div className="space-y-2">
                <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden card-animate">
                    <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-blue-600 px-3 py-2.5 text-white">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="space-y-0.5">
                                <p className="text-xs font-semibold">Validation Console</p>
                                <p className="text-[10px] text-blue-100">Review and validate your Excel files before upload</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => runValidation(excelFiles, pdfMatchInfo.pdfMap)}
                                disabled={validating || !excelFiles.length}
                                className="inline-flex items-center gap-1.5 rounded-md bg-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {validating ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <RefreshCw className="w-3.5 h-3.5" />
                                )}
                                {validating ? "Validating..." : "Re-validate"}
                            </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium">
                            <div className="inline-flex rounded-md bg-white/15 p-0.5 gap-0.5">
                                <button
                                    type="button"
                                    onClick={() => setValidationTableTab("report-info")}
                                    className={`px-3 py-1 rounded-md transition-all ${validationTableTab === "report-info"
                                        ? "bg-white text-blue-900 shadow-sm"
                                        : "text-blue-100 hover:text-white hover:bg-white/10"
                                        }`}
                                >
                                    Report Info
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setValidationTableTab("pdf-assets")}
                                    className={`px-3 py-1 rounded-md transition-all ${validationTableTab === "pdf-assets"
                                        ? "bg-white text-blue-900 shadow-sm"
                                        : "text-blue-100 hover:text-white hover:bg-white/10"
                                        }`}
                                >
                                    PDFs &amp; Assets
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsValidationTableCollapsed((prev) => !prev)}
                                className="inline-flex items-center gap-1 rounded-md border border-white/30 bg-white/15 px-2.5 py-1 text-xs font-medium text-white shadow-sm backdrop-blur transition hover:bg-white/25 hover:text-white"
                            >
                                {isValidationTableCollapsed ? (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                )}
                                {isValidationTableCollapsed ? "Show" : "Hide"}
                            </button>
                        </div>
                    </div>
                    <div className="p-2 space-y-2">
                        {validationMessage && (
                            <div
                                className={`rounded-md border px-3 py-2 inline-flex items-start gap-2 text-xs ${validationMessage.type === "error"
                                    ? "bg-rose-50 text-rose-700 border-rose-300"
                                    : validationMessage.type === "success"
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                                        : "bg-blue-50 text-blue-700 border-blue-300"
                                    }`}
                            >
                                {validationMessage.type === "error" ? (
                                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                ) : validationMessage.type === "success" ? (
                                    <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                ) : (
                                    <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                )}
                                <div className="text-xs font-medium">{validationMessage.text}</div>
                            </div>
                        )}

                        {validationTableTab === "report-info" ? (
                            validationItems.length ? (
                                <div className="space-y-2">
                                    {validationItems.map((item) => {
                                        const reportIssues = (item.issues || []).filter(isReportInfoIssue);
                                        const reportInfoIssuesByField = reportIssues.reduce((acc, issue) => {
                                            const key = issue.field || "Issue";
                                            if (!acc[key]) acc[key] = [];
                                            acc[key].push(issue);
                                            return acc;
                                        }, {});
                                        const reportFields = [
                                            { label: "Purpose of Valuation", value: item.snapshot?.purpose },
                                            { label: "Value Attributes", value: item.snapshot?.valueAttributes },
                                            { label: "Report", value: item.snapshot?.reportType },
                                            { label: "Client Name", value: item.snapshot?.clientName },
                                            { label: "Client Telephone", value: item.snapshot?.telephone },
                                            { label: "Client Email", value: item.snapshot?.email },
                                            { label: "Valuers", value: valuerSummary },
                                            { label: "Date of Valuation", value: item.snapshot?.valuedAt ? formatDateForDisplay(item.snapshot.valuedAt) : "" },
                                            { label: "Report Issuing Date", value: item.snapshot?.submittedAt ? formatDateForDisplay(item.snapshot.submittedAt) : "" },
                                        ];
                                        const fieldLabels = new Set(reportFields.map((field) => field.label));
                                        const extraIssues = reportIssues.filter((issue) => !fieldLabels.has(issue.field));
                                        return (
                                            <div key={item.fileName} className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
                                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                    <div className="text-xs font-semibold text-slate-800">{item.fileName}</div>
                                                    <span
                                                        className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${reportIssues.length
                                                            ? "bg-rose-50 text-rose-700 border-rose-300"
                                                            : "bg-emerald-50 text-emerald-700 border-emerald-300"
                                                            }`}
                                                    >
                                                        {reportIssues.length ? `${reportIssues.length} issue(s)` : "All fields OK"}
                                                    </span>
                                                </div>
                                                {isValidationTableCollapsed ? (
                                                    <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-1">
                                                        <ChevronDown className="w-3.5 h-3.5" />
                                                        Table hidden.
                                                    </div>
                                                ) : (
                                                    <div className="overflow-x-auto max-h-[200px] overflow-y-auto mt-2">
                                                        <table className="min-w-full text-xs border-collapse">
                                                            <thead className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                                                                <tr>
                                                                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider rounded-tl-md">Field</th>
                                                                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Value</th>
                                                                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Status</th>
                                                                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider rounded-tr-md">Notes</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {reportFields.map((field) => {
                                                                    const fieldIssues = reportInfoIssuesByField[field.label] || [];
                                                                    const hasIssue = fieldIssues.length > 0;
                                                                    const hasFieldValue = hasValue(field.value);
                                                                    const statusLabel = hasIssue ? "Issue" : hasFieldValue ? "OK" : "Missing";
                                                                    const statusTone = hasIssue
                                                                        ? "bg-rose-50 text-rose-700 border-rose-300"
                                                                        : hasFieldValue
                                                                            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                                                                            : "bg-amber-50 text-amber-700 border-amber-300";
                                                                    const notesText = hasIssue
                                                                        ? fieldIssues.map((issue) => issue.message).join(" / ")
                                                                        : hasFieldValue
                                                                            ? "Looks good"
                                                                            : "Missing in Excel";
                                                                    return (
                                                                        <tr key={field.label} className="border-b border-slate-200 hover:bg-slate-50/50">
                                                                            <td className="px-2 py-1.5 bg-white font-semibold text-slate-800">
                                                                                {field.label}
                                                                            </td>
                                                                            <td className="px-2 py-1.5 bg-white text-slate-700">
                                                                                {hasFieldValue ? field.value : "N/A"}
                                                                            </td>
                                                                            <td className="px-2 py-1.5 bg-white">
                                                                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone}`}>
                                                                                    {statusLabel}
                                                                                </span>
                                                                            </td>
                                                                            <td className="px-2 py-1.5 bg-white text-slate-600 text-[10px]">
                                                                                {notesText}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                                {extraIssues.map((issue, idx) => (
                                                                    <tr key={`issue-extra-${idx}`} className="border-b border-slate-200 hover:bg-slate-50/50">
                                                                        <td className="px-2 py-1.5 bg-white font-semibold text-slate-800">
                                                                            {issue.field || "Issue"}
                                                                        </td>
                                                                        <td className="px-2 py-1.5 bg-white text-slate-700">
                                                                            {issue.location || "Report Info"}
                                                                        </td>
                                                                        <td className="px-2 py-1.5 bg-white">
                                                                            <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                                                                                Issue
                                                                            </span>
                                                                        </td>
                                                                        <td className="px-2 py-1.5 bg-white text-slate-600 text-[10px]">
                                                                            {issue.message || "Issue detected"}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="p-4 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 text-sm text-slate-600 flex items-center justify-center font-medium">
                                    Validation results will appear here after reading the Excel.
                                </div>
                            )
                        ) : (
                            <div className="space-y-2">
                                {wantsPdfUpload && (pdfMatchInfo.excelsMissingPdf.length || pdfMatchInfo.unmatchedPdfs.length) && (
                                    <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                                        <div className="font-semibold mb-1">File matching issues</div>
                                        <div className="mt-1 space-y-1">
                                            {pdfMatchInfo.excelsMissingPdf.length > 0 && (
                                                <div className="font-medium">
                                                    Excel files missing PDF: {pdfMatchInfo.excelsMissingPdf.join(", ")}
                                                </div>
                                            )}
                                            {pdfMatchInfo.unmatchedPdfs.length > 0 && (
                                                <div className="font-medium">
                                                    Unmatched PDFs: {pdfMatchInfo.unmatchedPdfs.join(", ")}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {validationItems.length ? (
                                    <div className="space-y-2">
                                        <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
                                            <div className="text-xs font-semibold text-slate-800 mb-2">Assets &amp; PDF summary</div>
                                            {isValidationTableCollapsed ? (
                                                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                                    <ChevronDown className="w-3.5 h-3.5" />
                                                    Table hidden.
                                                </div>
                                            ) : (
                                                <div className="overflow-x-auto max-h-[180px] overflow-y-auto">
                                                    <table className="min-w-full text-xs text-slate-700">
                                                        <thead className="bg-gradient-to-r from-blue-600 to-blue-700 text-white sticky top-0">
                                                            <tr>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Excel</th>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">PDF</th>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Market</th>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Cost</th>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Market total</th>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Cost total</th>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Assets total</th>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Report total</th>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Issues</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {validationItems.map((item) => {
                                                                const assetIssues = (item.issues || []).filter((issue) => !isReportInfoIssue(issue));
                                                                return (
                                                                    <tr key={`summary-${item.fileName}`} className="border-b border-slate-200 hover:bg-slate-50/50">
                                                                        <td className="px-2 py-1.5 text-slate-800 font-medium">{item.fileName}</td>
                                                                        <td className="px-2 py-1.5">
                                                                            {item.pdfMatched ? (
                                                                                <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Matched</span>
                                                                            ) : (
                                                                                <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Missing</span>
                                                                            )}
                                                                        </td>
                                                                        <td className="px-2 py-1.5 text-slate-700">{item.counts?.marketAssets ?? "-"}</td>
                                                                        <td className="px-2 py-1.5 text-slate-700">{item.counts?.costAssets ?? "-"}</td>
                                                                        <td className="px-2 py-1.5 text-slate-700">{item.totals?.marketTotal ?? "-"}</td>
                                                                        <td className="px-2 py-1.5 text-slate-700">{item.totals?.costTotal ?? "-"}</td>
                                                                        <td className="px-2 py-1.5 text-slate-700">{item.totals?.assetsTotalValue ?? "-"}</td>
                                                                        <td className="px-2 py-1.5 text-slate-700">{item.totals?.reportTotalValue ?? "-"}</td>
                                                                        <td className="px-2 py-1.5 text-slate-700 font-medium">{assetIssues.length}</td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                        {!isValidationTableCollapsed && (
                                            <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
                                                <div className="text-xs font-semibold text-slate-800 mb-2">Issues</div>
                                                <div className="overflow-x-auto max-h-[180px] overflow-y-auto">
                                                    <table className="min-w-full text-xs text-slate-700">
                                                        <thead className="bg-gradient-to-r from-blue-600 to-blue-700 text-white sticky top-0">
                                                            <tr>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Excel</th>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Field</th>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Location</th>
                                                                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Details</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {validationItems.flatMap((item) => {
                                                                const assetIssues = (item.issues || []).filter((issue) => !isReportInfoIssue(issue));
                                                                if (!assetIssues.length) {
                                                                    return [
                                                                        <tr key={`issue-none-${item.fileName}`} className="border-b border-slate-200">
                                                                            <td className="px-2 py-1.5 text-slate-800 font-medium">{item.fileName}</td>
                                                                            <td className="px-2 py-1.5 text-slate-600" colSpan={3}>
                                                                                No issues
                                                                            </td>
                                                                        </tr>,
                                                                    ];
                                                                }
                                                                return assetIssues.map((issue, idx) => (
                                                                    <tr key={`issue-${item.fileName}-${idx}`} className="border-b border-slate-200 hover:bg-slate-50/50">
                                                                        <td className="px-2 py-1.5 text-slate-800 font-medium">{item.fileName}</td>
                                                                        <td className="px-2 py-1.5 font-semibold text-slate-800">{issue.field}</td>
                                                                        <td className="px-2 py-1.5 text-slate-700">{issue.location || "-"}</td>
                                                                        <td className="px-2 py-1.5 text-slate-700">{issue.message}</td>
                                                                    </tr>
                                                                ));
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="p-3 border border-dashed border-slate-300 rounded-lg bg-slate-50 text-xs text-slate-600 flex items-center justify-center font-medium">
                                        Validation results will appear here after reading the Excel.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
    );

    const draftValuerTotal = sumValuerPercentages(draftValuers);
    const draftValuerValid = draftValuers.length > 0 && Math.abs(draftValuerTotal - 100) < 0.001;


   
    const valuerModal = (
        <Modal
            open={valuerModalOpen}
            onClose={closeValuerModal}
            title="Select valuers"
            maxWidth="max-w-3xl"
        >
            <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-xs font-semibold text-slate-800">
                        Choose valuers and set contribution percentages (total 100%).
                    </div>
                </div>
                {!selectedCompany && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        Select a company to load valuers.
                    </div>
                )}
                {fetchingCompanyValuers && (
                    <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Retrieving valuers from Taqeem...
                    </div>
                )}
                {!fetchingCompanyValuers && selectedCompany && !displayCompanyValuers.length && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        No valuers found for the selected company.
                    </div>
                )}
                <div className="max-h-[320px] overflow-y-auto rounded-xl border border-slate-200">
                    {fetchingCompanyValuers ? (
                        <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-600">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Fetching valuers from Taqeem...
                        </div>
                    ) : displayCompanyValuers.length ? (
                        displayCompanyValuers.map((valuer) => {
                            const key = valuer.valuerId || valuer.valuerName;
                            const selected = draftValuers.find(
                                (v) => (v.valuerId || v.valuerName) === key
                            );
                            return (
                                <div key={key} className="flex items-center justify-between gap-3 px-3 py-2 border-b last:border-b-0">
                                    <label className="flex items-center gap-2 text-xs text-slate-800">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4"
                                            checked={!!selected}
                                            onChange={(e) => toggleDraftValuer(valuer, e.target.checked)}
                                        />
                                        <div className="flex flex-col">
                                            <span className="font-semibold">{valuer.valuerName || "Valuer"}</span>
                                            {valuer.valuerId ? (
                                                <span className="text-[10px] text-slate-500">ID: {valuer.valuerId}</span>
                                            ) : null}
                                        </div>
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-slate-600">Contribution</span>
                                        <select
                                            className="rounded-md border border-slate-300 px-2 py-1 text-[10px] text-slate-800"
                                            disabled={!selected}
                                            value={selected?.percentage || ""}
                                            onChange={(e) => updateDraftPercentage(valuer, e.target.value)}
                                        >
                                            <option value="">Select</option>
                                            {CONTRIBUTION_OPTIONS.map((pct) => (
                                                <option key={pct} value={pct}>
                                                    {pct}%
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="px-3 py-4 text-xs text-slate-600">
                            {fetchingCompanyValuers
                                ? "Fetching valuers from Taqeem..."
                                : "No valuers found for the selected company."}
                        </div>
                    )}
                </div>
                {valuerModalError && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                        {valuerModalError}
                    </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <div className="text-xs text-slate-600 font-semibold">
                        Selected: {draftValuers.length || 0} | Total: {draftValuerTotal}%
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={skipValuerSelection}
                            className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            Skip (use Taqeem default)
                        </button>
                        <button
                            type="button"
                            onClick={autoSplitDraft}
                            disabled={draftValuers.length < 2}
                            className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                            Auto split
                        </button>
                        <button
                            type="button"
                            onClick={applyValuerDraft}
                            disabled={!draftValuerValid}
                            className="px-4 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                        >
                            Save valuers
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );

    const validationModal = (
        <Modal
            open={showValidationModal}
            onClose={() => setShowValidationModal(false)}
            title="Validation Console"
            maxWidth="max-w-6xl"
        >
            {validationConsole}
        </Modal>
    );


    return (
        <div className="relative p-3 space-y-3 page-animate overflow-x-hidden">
            {showInsufficientPointsModal && (
                <div className="fixed inset-0 z-[9999]">
                    <div className="absolute top-20 left-1/2 transform -translate-x-1/2 w-full max-w-sm">
                        <InsufficientPointsModal
                            viewChange={onViewChange}
                            onClose={() => setShowInsufficientPointsModal(false)}
                        />
                    </div>
                </div>
            )}
            {valuerModal}
            {validationModal}

            <div className="space-y-2">
                <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border-2 border-dashed border-slate-300 bg-slate-50 cursor-pointer hover:bg-blue-50 hover:border-blue-400 transition-all min-w-[180px] flex-[0.85] group">
                            <div className="flex items-center gap-2 text-xs text-slate-700">
                                <FileSpreadsheet className="w-4 h-4 text-blue-600 group-hover:text-blue-700" />
                                <span className="font-semibold">
                                    {excelFiles.length
                                        ? excelFiles.length === 1
                                            ? <span className="truncate max-w-[150px]" title={excelFiles[0].name}>{excelFiles[0].name}</span>
                                            : `${excelFiles.length} file(s) selected`
                                        : "Choose Excel file"}
                                </span>
                            </div>
                            <input
                                type="file"
                                multiple
                                accept=".xlsx,.xls"
                                className="hidden"
                                onChange={handleExcelChange}
                                ref={excelInputRef}
                            />
                            <span className="text-xs font-semibold text-blue-600 group-hover:text-blue-700 whitespace-nowrap">Browse</span>
                        </label>

                        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border-2 border-dashed border-slate-300 bg-slate-50 transition-all hover:bg-blue-50 hover:border-blue-400 min-w-[220px] flex-[1.35] group">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                                <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                                    checked={wantsPdfUpload}
                                    onChange={(e) => handlePdfToggle(e.target.checked)}
                                />
                                <Files className="w-4 h-4 text-blue-600" />
                                <span className="font-semibold">Upload PDFs</span>
                                <span className="text-xs text-slate-600">
                                    {pdfFiles.length
                                        ? `${pdfFiles.length} file(s) selected`
                                        : "Choose PDF files"}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (pdfInputRef?.current) {
                                        pdfInputRef.current.value = null;
                                        pdfInputRef.current.click();
                                    }
                                }}
                                className="text-xs font-semibold text-blue-600 hover:text-blue-700 whitespace-nowrap"
                            >
                                Browse
                            </button>
                            <input
                                ref={pdfInputRef}
                                type="file"
                                multiple
                                accept=".pdf"
                                className="hidden"
                                onChange={handlePdfChange}
                            />
                        </div>

                        <button
                            type="button"
                            onClick={downloadExcelTemplate}
                            disabled={downloadingTemplate}
                            className="inline-flex items-center gap-1.5 rounded-md border border-blue-600 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 hover:border-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {downloadingTemplate ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Download className="w-3.5 h-3.5" />
                            )}
                            {downloadingTemplate ? "Downloading..." : "Export Excel Template"}
                        </button>

                        <button
                            type="button"
                            onClick={resetAll}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors"
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Reset
                        </button>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                        type="button"
                        onClick={handleUploadAndCreate}
                        disabled={loading || creatingReports || !isReadyToUpload}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md
                                bg-green-600 hover:bg-green-700
                                text-white text-xs font-semibold
                                shadow-md hover:shadow-lg hover:scale-[1.01]
                                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                                transition-all"
                    >
                        {(loading || creatingReports) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Send className="w-4 h-4" />
                        )}
                        {creatingReports ? "Creating Reports..." : loading ? "Uploading..." : "Upload & Send To Taqeem"}
                    </button>

                    <button
                        type="button"
                        onClick={handleStoreOnly}
                        disabled={loading || !isReadyToUpload}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md
                                bg-blue-600 hover:bg-blue-700
                                text-white text-xs font-semibold
                                shadow-md hover:shadow-lg hover:scale-[1.01]
                                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                                transition-all"
                    >
                        {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <FileIcon className="w-4 h-4" />
                        )}
                        {loading ? "Storing..." : "Store and Send Later"}
                    </button>
                </div>
            </div>

            {(error || success) && (
                <div
                    className={`rounded-lg border px-3 py-2 flex items-start gap-2 shadow-sm card-animate ${error
                        ? "bg-rose-50 text-rose-700 border-rose-300"
                        : "bg-emerald-50 text-emerald-700 border-emerald-300"
                        }`}
                >
                    {error ? (
                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    ) : (
                        <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="text-xs font-medium">{error || success}</div>
                </div>
            )}

            {showTemporarySection && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 shadow-sm p-3 mb-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-slate-800">Temporary Reports</h3>
                            <p className="text-[10px] text-slate-500">Reports without company assignment.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowTemporaryModal(true)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            <Table className="w-3 h-3" />
                            Show Temporary Reports
                        </button>
                    </div>
                </div>
            )}

            {showTemporaryModal && (
                <div
                    className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 py-6 overflow-auto"
                    onClick={() => setShowTemporaryModal(false)}
                >
                    <div
                        className="w-full max-w-5xl rounded-lg bg-white shadow-lg border border-slate-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                            <div>
                                <h3 className="text-base font-semibold text-slate-800">Temporary Reports</h3>
                                <p className="text-[11px] text-slate-500">Reports without company assignment.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowTemporaryModal(false)}
                                className="text-slate-600 hover:text-slate-900 text-sm font-semibold"
                            >
                                Close
                            </button>
                        </div>
                        <div className="px-4 py-3 flex items-center justify-between">
                            <div className="text-[11px] text-slate-600">
                                {isGuestUser ? "Guest session reports." : "Unassigned reports."}
                            </div>
                            <button
                                type="button"
                                onClick={() => (isGuestUser ? loadReports(false) : loadUnassignedReports())}
                                disabled={temporaryLoading}
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                                <RefreshCw className={`w-3 h-3 ${temporaryLoading ? "animate-spin" : ""}`} />
                                {temporaryLoading ? "Refreshing..." : "Refresh"}
                            </button>
                        </div>
                        <div className="px-4 pb-4">
                            {temporaryLoading ? (
                                <div className="text-xs text-slate-600">Loading temporary reports...</div>
                            ) : temporaryReports.length === 0 ? (
                                <div className="text-xs text-slate-600">No temporary reports found.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-xs text-slate-700">
                                        <thead className="bg-slate-100 text-slate-600 uppercase">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-semibold">Report ID</th>
                                                <th className="px-3 py-2 text-left font-semibold">Client</th>
                                                <th className="px-3 py-2 text-left font-semibold">Assets</th>
                                                <th className="px-3 py-2 text-left font-semibold">Status</th>
                                                <th className="px-3 py-2 text-left font-semibold">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200">
                                            {temporaryReports.map((report) => {
                                                const recordId = getReportRecordId(report);
                                                const assetCount = Array.isArray(report?.asset_data) ? report.asset_data.length : 0;
                                                const statusKey = getReportStatus(report);
                                                const statusLabel = reportStatusLabels[statusKey] || statusKey || "New";
                                                const statusClass = reportStatusClasses[statusKey] || "border-slate-200 bg-slate-50 text-slate-700";
                                                return (
                                                    <tr key={recordId || report._id} className="hover:bg-slate-50">
                                                        <td className="px-3 py-2 text-[11px] text-slate-800">
                                                            {report.report_id || "Not Submitted"}
                                                        </td>
                                                        <td className="px-3 py-2 text-[11px] text-slate-700">
                                                            {report.client_name || report.title || "???"}
                                                        </td>
                                                        <td className="px-3 py-2 text-[11px] text-slate-700">{assetCount}</td>
                                                        <td className="px-3 py-2 text-[11px]">
                                                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass}`}>
                                                                {statusLabel}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-[11px]">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const tabsForAssets = resolveTabsForAssets(assetCount);
                                                                    submitToTaqeem(recordId, tabsForAssets, { withLoading: false });
                                                                }}
                                                                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700"
                                                            >
                                                                Assign & Submit
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {isGuestUser && (
                                <div className="mt-3 flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-700">
                                    <span>Register your account to keep these reports linked to your phone.</span>
                                    <button
                                        type="button"
                                        onClick={() => onViewChange?.("registration")}
                                        className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-slate-900"
                                    >
                                        Register
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}


            <Section title="Reports">
                <div className="space-y-2 mb-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => loadReports(false)}
                            disabled={reportsLoading}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${reportsLoading ? 'animate-spin' : ''}`} />
                            {reportsLoading ? 'Refreshing...' : 'Refresh'}
                        </button>

                        <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                            Filter:
                            <select
                                value={reportSelectFilter}
                                onChange={(e) => setReportSelectFilter(e.target.value)}
                                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer"
                            >
                                <option value="all">All statuses</option>
                                <option value="complete">Complete</option>
                                <option value="incomplete">Incomplete</option>
                                <option value="sent">Sent</option>
                                <option value="approved">Approved</option>
                            </select>
                        </label>

                        {/* ADD SEARCH INPUT HERE */}
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search reports..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-64 rounded-md border border-slate-300 bg-white px-3 py-1.5 pl-9 text-xs font-medium text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                            />
                            <div className="absolute left-2.5 top-1/2 transform -translate-y-1/2">
                                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                                </svg>
                            </div>
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery("")}
                                    className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                    </svg>
                                </button>
                            )}
                        </div>
                        {/* END SEARCH INPUT */}

                        <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                            Items per page:
                            <select
                                value={itemsPerPage}
                                onChange={(e) => {
                                    setCurrentPage(1);
                                    setItemsPerPage(Number(e.target.value));
                                }}
                                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer"
                            >
                                <option value="5">5</option>
                                <option value="10">10</option>
                                <option value="25">25</option>
                                <option value="50">50</option>
                                <option value="100">100</option>
                            </select>
                        </label>

                        <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5 ml-auto">
                            Page:
                            <input
                                type="number"
                                min="1"
                                max={reportsPagination.totalPages || 1}
                                value={currentPage}
                                onChange={(e) => {
                                    const page = parseInt(e.target.value) || 1;
                                    if (page >= 1 && page <= (reportsPagination.totalPages || 1)) {
                                        handlePageChange(page);
                                    }
                                }}
                                className="w-16 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                            />
                            <span className="text-xs text-slate-600">of {reportsPagination.totalPages || 1}</span>
                        </label>
                        {searchQuery.trim() && (
                            <div className="text-xs text-slate-600">
                                Found {visibleReports.length} report{visibleReports.length !== 1 ? 's' : ''} matching "{searchQuery}" on this page
                            </div>
                        )}
                    </div>

                </div>

                {actionAlert}

                {reportsLoading && reports.length === 0 && (
                    <div className="flex items-center gap-2 text-xs text-slate-600 py-2">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        Loading reports...
                    </div>
                )}

                {reportsError && (
                    <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 font-medium">
                        {reportsError}
                    </div>
                )}

                {!reportsLoading && !reports.length && (
                    <div className="text-xs text-slate-600 py-2 text-center">
                        No multi-approach reports found yet.
                    </div>
                )}

                {!reportsLoading && reports.length > 0 && !filteredReports.length && (
                    <div className="text-xs text-slate-600 py-2 text-center">
                        No reports match the selected status.
                    </div>
                )}

                {!reportsLoading && reports.length > 0 && (
                    <div className="w-full overflow-x-auto">
                        <div className="min-w-full">
                            <table className="w-full text-xs text-slate-700">
                                <thead className="bg-gradient-to-r from-blue-50 to-indigo-50 text-slate-800 border-b-2 border-blue-200">
                                    <tr>
                                        <th className="px-2 py-2 text-left w-12 text-[10px] font-semibold uppercase tracking-wider">#</th>
                                        <th className="px-2 py-2 text-left w-10 text-[10px] font-semibold uppercase tracking-wider"></th>
                                        <th className="px-2 py-2 text-left w-32 text-[10px] font-semibold uppercase tracking-wider">Report ID</th>
                                        <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Client</th>
                                        <th className="px-2 py-2 text-left w-24 text-[10px] font-semibold uppercase tracking-wider">Final value</th>
                                        <th className="px-2 py-2 text-left w-28 text-[10px] font-semibold uppercase tracking-wider">Status</th>
                                        <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Action</th>
                                        <th className="px-2 py-2 text-left w-16 text-[10px] font-semibold uppercase tracking-wider">Select</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredReports.map((report, idx) => {
                                        const reportIndex = ((currentPage - 1) * itemsPerPage) + idx + 1;
                                        const recordId = getReportRecordId(report);
                                        const statusKey = getReportStatus(report);
                                        const reportBatchId = report.batch_id || report.batchId;
                                        const batchProg = reportBatchId ? batchProgress[reportBatchId] : null;
                                        const assetList = Array.isArray(report.asset_data) ? report.asset_data : [];
                                        const isExpanded = recordId ? expandedReports.includes(recordId) : false;
                                        const reportBusy = recordId ? reportActionBusy[recordId] : null;
                                        const selectedAssets = selectedAssetsByReport[recordId] || [];
                                        const selectedAssetSet = new Set(selectedAssets);
                                        const assetFilter = assetSelectFilters[recordId] || "all";
                                        const visibleAssets = assetList
                                            .map((asset, assetIndex) => ({ asset, assetIndex }))
                                            .filter(({ asset }) =>
                                                assetFilter === "all"
                                                    ? true
                                                    : getAssetStatus(asset, report) === assetFilter
                                            );

                                        return (
                                            <React.Fragment key={recordId || `report-${idx}`}>
                                                <tr className="border-t border-slate-200 bg-white hover:bg-blue-50/30 transition-colors">
                                                    <td className="px-2 py-2 text-slate-600 text-xs font-medium">
                                                        {reportIndex}
                                                    </td>
                                                    <td className="px-2 py-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => recordId && toggleReportExpansion(recordId)}
                                                            disabled={!recordId}
                                                            className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-slate-300 text-slate-700 hover:bg-blue-50 hover:border-blue-400 disabled:opacity-50 transition-colors"
                                                            aria-label={isExpanded ? "Hide assets" : "Show assets"}
                                                        >
                                                            {isExpanded ? (
                                                                <ChevronDown className="w-3.5 h-3.5" />
                                                            ) : (
                                                                <ChevronRight className="w-3.5 h-3.5" />
                                                            )}
                                                        </button>
                                                    </td>
                                                    <td className="px-2 py-2">
                                                        <div className="text-xs font-semibold text-slate-900 truncate" title={report.report_id || "Not sent"}>
                                                            {report.report_id || "Not sent"}
                                                        </div>
                                                        <div className="text-[10px] text-slate-500 truncate" title={recordId || "-"}>
                                                            {recordId || "-"}
                                                        </div>
                                                    </td>
                                                    <td className="px-2 py-2 truncate" title={report.client_name || "-"}>
                                                        <span className="text-xs text-slate-700">{report.client_name || "-"}</span>
                                                    </td>
                                                    <td className="px-2 py-2 text-xs font-medium text-slate-700">
                                                        {report.value || report.final_value || "-"}
                                                    </td>
                                                    <td className="px-2 py-2">
                                                        <span
                                                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${reportStatusClasses[statusKey] || "border-blue-200 bg-blue-50 text-blue-700"
                                                                }`}
                                                        >
                                                            {reportStatusLabels[statusKey] || statusKey}
                                                        </span>
                                                    </td>
                                                    <td className="px-2 py-2">
                                                        <div className="flex items-center gap-1">
                                                            <select
                                                                value={selectedReportActions[recordId] || ""}
                                                                disabled={!recordId || submitting || !!reportBusy}
                                                                onChange={(e) => {
                                                                    const action = e.target.value;
                                                                    setSelectedReportActions((prev) => ({
                                                                        ...prev,
                                                                        [recordId]: action,
                                                                    }));
                                                                }}
                                                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer flex-1"
                                                            >
                                                                <option value="">Actions</option>
                                                                <option value="submit-taqeem">Submit to Taqeem</option>
                                                                <option value="retry">Retry submit</option>
                                                                <option value="edit">Edit</option>
                                                                <option value="send-approver">Send to approver</option>
                                                                <option value="approve">Approve</option>
                                                                <option value="download">Download certificate</option>
                                                                <option value="delete">Delete</option>
                                                            </select>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const action = selectedReportActions[recordId];
                                                                    if (action) {
                                                                        handleReportAction(report, action);
                                                                        setSelectedReportActions((prev) => {
                                                                            const next = { ...prev };
                                                                            delete next[recordId];
                                                                            return next;
                                                                        });
                                                                    }
                                                                }}
                                                                disabled={!recordId || !selectedReportActions[recordId] || submitting || !!reportBusy}
                                                                className="inline-flex items-center justify-center px-3 py-1 rounded-md bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                            >
                                                                Go
                                                            </button>
                                                        </div>
                                                        {reportBusy && (
                                                            <div className="text-[10px] text-blue-600 mt-0.5 font-medium">
                                                                Working...
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-2 py-2 text-center">
                                                        <input
                                                            type="checkbox"
                                                            disabled={!recordId}
                                                            checked={!!recordId && selectedReportSet.has(recordId)}
                                                            onChange={() => recordId && toggleReportSelection(recordId)}
                                                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                                        />
                                                    </td>
                                                </tr>
                                                {batchProg && (
                                                    <tr>
                                                        <td colSpan={8} className="px-4 py-3 bg-blue-50/30"> {/* Increased padding */}
                                                            <div className="px-4"> {/* Increased padding */}
                                                                <BatchProgressBar
                                                                    current={batchProg.current}
                                                                    total={batchProg.total}
                                                                    percentage={batchProg.percentage}
                                                                    message={batchProg.message}
                                                                    status={batchProg.status}
                                                                    currentRecordId={batchProg.currentRecordId}
                                                                />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                                {reportProgress[recordId] && (
                                                    <tr>
                                                        <td colSpan={8} className="px-4 py-3 border-b border-blue-200">
                                                            <BatchProgressBar
                                                                current={reportProgress[recordId].current}
                                                                total={reportProgress[recordId].total}
                                                                percentage={reportProgress[recordId].percentage}
                                                                message={reportProgress[recordId].message}
                                                                status={reportProgress[recordId].status}
                                                            />
                                                        </td>
                                                    </tr>
                                                )}
                                                {isExpanded && (
                                                    <tr>
                                                        <td colSpan={8} className="bg-blue-50/20 border-t border-blue-200">
                                                            <div className="p-2 space-y-2">
                                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                                    <div className="text-xs text-slate-700 font-medium">
                                                                        Assets: <span className="text-blue-600 font-semibold">{assetList.length}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="flex items-center gap-1">
                                                                            <select
                                                                                value={selectedAssetBulkActions[recordId] || ""}
                                                                                onChange={(e) => {
                                                                                    const action = e.target.value;
                                                                                    setSelectedAssetBulkActions((prev) => ({
                                                                                        ...prev,
                                                                                        [recordId]: action,
                                                                                    }));
                                                                                }}
                                                                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer"
                                                                            >
                                                                                <option value="">Asset actions</option>
                                                                                <option value="retry">Retry submission</option>
                                                                            </select>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    const action = selectedAssetBulkActions[recordId];
                                                                                    if (action) {
                                                                                        handleBulkAssetAction(report, action);
                                                                                        setSelectedAssetBulkActions((prev) => {
                                                                                            const next = { ...prev };
                                                                                            delete next[recordId];
                                                                                            return next;
                                                                                        });
                                                                                    }
                                                                                }}
                                                                                disabled={!selectedAssetBulkActions[recordId]}
                                                                                className="inline-flex items-center justify-center px-3 py-1 rounded-md bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                                            >
                                                                                Go
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="rounded-md border border-slate-200 overflow-hidden bg-white shadow-sm">
                                                                    <div className="max-h-48 overflow-y-auto">
                                                                        <table className="w-full text-xs text-slate-700">
                                                                            <thead className="bg-slate-50 text-slate-800 border-b border-slate-200 sticky top-0">
                                                                                <tr>
                                                                                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Macro ID</th>
                                                                                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Asset name</th>
                                                                                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Final value</th>
                                                                                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Approach</th>
                                                                                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Status</th>
                                                                                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">Actions</th>
                                                                                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">
                                                                                        <select
                                                                                            value={assetFilter}
                                                                                            onChange={(e) => {
                                                                                                const nextFilter = e.target.value;
                                                                                                setAssetSelectFilters((prev) => ({
                                                                                                    ...prev,
                                                                                                    [recordId]: nextFilter,
                                                                                                }));
                                                                                                if (nextFilter === "all") {
                                                                                                    setSelectedAssetsByReport((prev) => ({
                                                                                                        ...prev,
                                                                                                        [recordId]: [],
                                                                                                    }));
                                                                                                    return;
                                                                                                } else {
                                                                                                    const nextSelection = assetList
                                                                                                        .map((asset, assetIndex) => ({ asset, assetIndex }))
                                                                                                        .filter(({ asset }) =>
                                                                                                            getAssetStatus(asset, report) === nextFilter
                                                                                                        )
                                                                                                        .map(({ assetIndex }) => assetIndex);
                                                                                                    setSelectedAssetsByReport((prev) => ({
                                                                                                        ...prev,
                                                                                                        [recordId]: nextSelection,
                                                                                                    }));
                                                                                                }
                                                                                            }}
                                                                                            className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer"
                                                                                        >
                                                                                            <option value="all">All assets</option>
                                                                                            <option value="complete">Complete</option>
                                                                                            <option value="incomplete">Incomplete</option>
                                                                                        </select>
                                                                                    </th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {visibleAssets.length === 0 && (
                                                                                    <tr>
                                                                                        <td colSpan={7} className="px-2 py-2 text-center text-slate-500 text-xs">
                                                                                            {assetList.length
                                                                                                ? "No assets match the selected status."
                                                                                                : "No assets available for this report."}
                                                                                        </td>
                                                                                    </tr>
                                                                                )}
                                                                                {visibleAssets.map(({ asset, assetIndex }) => {
                                                                                    const assetStatus = getAssetStatus(asset, report);
                                                                                    const assetBusy = assetActionBusy[`${recordId}:${assetIndex}`];
                                                                                    const macroId = getAssetMacroId(asset, report);
                                                                                    return (
                                                                                        <tr key={`${recordId}-${assetIndex}`} className="border-t border-slate-200 hover:bg-slate-50/50">
                                                                                            <td className="px-2 py-1.5 text-slate-600 text-xs">
                                                                                                {macroId || "Not created"}
                                                                                            </td>
                                                                                            <td className="px-2 py-1.5 text-slate-700 text-xs font-medium">
                                                                                                {asset.asset_name || "-"}
                                                                                            </td>
                                                                                            <td className="px-2 py-1.5 text-slate-700 text-xs">
                                                                                                {asset.final_value || "-"}
                                                                                            </td>
                                                                                            <td className="px-2 py-1.5 text-slate-600 text-xs">
                                                                                                {getAssetApproach(asset)}
                                                                                            </td>
                                                                                            <td className="px-2 py-1.5">
                                                                                                <span
                                                                                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${assetStatusClasses[assetStatus] || "border-blue-200 bg-blue-50 text-blue-700"
                                                                                                        }`}
                                                                                                >
                                                                                                    {assetStatusLabels[assetStatus] || assetStatus}
                                                                                                </span>
                                                                                            </td>
                                                                                            <td className="px-2 py-1.5">
                                                                                                <div className="flex items-center gap-1">
                                                                                                    <select
                                                                                                        value={selectedAssetActions[`${recordId}:${assetIndex}`] || ""}
                                                                                                        disabled={!!assetBusy}
                                                                                                        onChange={(e) => {
                                                                                                            const action = e.target.value;
                                                                                                            setSelectedAssetActions((prev) => ({
                                                                                                                ...prev,
                                                                                                                [`${recordId}:${assetIndex}`]: action,
                                                                                                            }));
                                                                                                        }}
                                                                                                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer flex-1"
                                                                                                    >
                                                                                                        <option value="">Actions</option>
                                                                                                        <option value="edit">Edit</option>
                                                                                                    </select>
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        onClick={() => {
                                                                                                            const action = selectedAssetActions[`${recordId}:${assetIndex}`];
                                                                                                            if (action) {
                                                                                                                handleAssetAction(report, assetIndex, action);
                                                                                                                setSelectedAssetActions((prev) => {
                                                                                                                    const next = { ...prev };
                                                                                                                    delete next[`${recordId}:${assetIndex}`];
                                                                                                                    return next;
                                                                                                                });
                                                                                                            }
                                                                                                        }}
                                                                                                        disabled={!!assetBusy || !selectedAssetActions[`${recordId}:${assetIndex}`]}
                                                                                                        className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                                                                    >
                                                                                                        Go
                                                                                                    </button>
                                                                                                </div>
                                                                                            </td>
                                                                                            <td className="px-2 py-1.5">
                                                                                                <input
                                                                                                    type="checkbox"
                                                                                                    checked={selectedAssetSet.has(assetIndex)}
                                                                                                    onChange={() => toggleAssetSelection(recordId, assetIndex)}
                                                                                                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                                                                                />
                                                                                            </td>
                                                                                        </tr>
                                                                                    );
                                                                                })}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Controls */}
                        {reportsPagination.totalPages > 1 && (() => {
                            const getPageNumbers = () => {
                                const pages = [];
                                const totalPages = reportsPagination.totalPages || 1;

                                if (totalPages <= 6) {
                                    for (let i = 1; i <= totalPages; i++) {
                                        pages.push(i);
                                    }
                                    return pages;
                                }

                                pages.push(1, 2, 3);

                                const lastThree = [totalPages - 2, totalPages - 1, totalPages];
                                const lastThreeStart = totalPages - 2;

                                if (currentPage <= 3) {
                                    if (4 < lastThreeStart) {
                                        pages.push(4, 5);
                                        pages.push('ellipsis');
                                    }
                                } else if (currentPage >= lastThreeStart) {
                                    if (3 < lastThreeStart - 1) {
                                        pages.push('ellipsis');
                                    }
                                } else {
                                    const showBefore = currentPage - 1;
                                    const showAfter = currentPage + 1;

                                    if (showBefore > 4) {
                                        pages.push('ellipsis');
                                        pages.push(showBefore);
                                    } else if (showBefore > 3) {
                                        pages.push(showBefore);
                                    }

                                    pages.push(currentPage);

                                    if (showAfter < lastThreeStart - 1) {
                                        pages.push(showAfter);
                                        if (showAfter < lastThreeStart - 2) {
                                            pages.push('ellipsis');
                                        }
                                    }
                                }

                                lastThree.forEach(page => {
                                    if (!pages.includes(page)) {
                                        pages.push(page);
                                    }
                                });

                                const cleaned = [];
                                let prevNum = 0;

                                for (let i = 0; i < pages.length; i++) {
                                    const item = pages[i];
                                    if (item === 'ellipsis') {
                                        if (cleaned[cleaned.length - 1] !== 'ellipsis') {
                                            cleaned.push('ellipsis');
                                        }
                                    } else if (typeof item === 'number') {
                                        if (item > prevNum) {
                                            if (item > prevNum + 1 && prevNum > 0 && cleaned[cleaned.length - 1] !== 'ellipsis') {
                                                cleaned.push('ellipsis');
                                            }
                                            cleaned.push(item);
                                            prevNum = item;
                                        }
                                    }
                                }

                                return cleaned;
                            };

                            const pageNumbers = getPageNumbers();
                            const totalPages = reportsPagination.totalPages || 1;
                            const startItem = ((currentPage - 1) * itemsPerPage) + 1;
                            const endItem = Math.min(currentPage * itemsPerPage, reportsPagination.total || 0);

                            return (
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
                                    <div className="text-xs text-slate-600 font-medium">
                                        Showing <span className="font-semibold text-slate-800">{Math.min(startItem, reportsPagination.total || 0)}</span> to <span className="font-semibold text-slate-800">{Math.min(endItem, reportsPagination.total || 0)}</span> of <span className="font-semibold text-slate-800">{reportsPagination.total || 0}</span> total reports
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => handlePageChange(currentPage - 1)}
                                            disabled={currentPage === 1 || reportsLoading}
                                            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            Previous
                                        </button>
                                        <div className="flex items-center gap-1">
                                            {pageNumbers.map((page, idx) => {
                                                if (page === 'ellipsis') {
                                                    return (
                                                        <span key={`ellipsis-${idx}`} className="px-1.5 text-xs text-slate-600">
                                                            ...
                                                        </span>
                                                    );
                                                }
                                                return (
                                                    <button
                                                        key={page}
                                                        type="button"
                                                        onClick={() => handlePageChange(page)}
                                                        disabled={reportsLoading}
                                                        className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all ${currentPage === page
                                                            ? "bg-blue-600 text-white shadow-sm"
                                                            : "text-slate-700 bg-white border border-slate-300 hover:bg-blue-50 hover:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                                            }`}
                                                    >
                                                        {page}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handlePageChange(currentPage + 1)}
                                            disabled={currentPage === totalPages || reportsLoading}
                                            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                )}
            </Section>

            <Modal
                open={isEditing}
                onClose={closeReportEdit}
                title="Edit report"
            >
                {actionAlert}
                <div className="space-y-3">
                    <Section title="Report information">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                            <InputField
                                label="Report title"
                                required
                                value={formData.title}
                                onChange={(e) => handleFieldChange("title", e.target.value)}
                                error={errors.title}
                            />
                            <InputField
                                label="Report type"
                                required
                                value={formData.report_type}
                                onChange={(e) => handleFieldChange("report_type", e.target.value)}
                                error={errors.report_type}
                            />
                            <SelectField
                                label="Valuation purpose"
                                required
                                value={formData.purpose_id}
                                onChange={(e) => handleFieldChange("purpose_id", e.target.value)}
                                options={[
                                    { value: "to set", label: "Select" },
                                    { value: "1", label: "Selling" },
                                    { value: "2", label: "Buying" },
                                    { value: "5", label: "Rent value" },
                                    { value: "6", label: "Insurance" },
                                    { value: "8", label: "Accounting" },
                                    { value: "9", label: "Financing" },
                                    { value: "10", label: "Disputes" },
                                    { value: "12", label: "Tax" },
                                    { value: "14", label: "Other" },
                                ]}
                                error={errors.purpose_id}
                            />
                            <SelectField
                                label="Value premise"
                                required
                                value={formData.value_premise_id}
                                onChange={(e) => handleFieldChange("value_premise_id", e.target.value)}
                                options={[
                                    { value: "to set", label: "Select" },
                                    { value: "1", label: "Highest and Best Use" },
                                    { value: "2", label: "Current Use" },
                                    { value: "3", label: "Orderly Liquidation" },
                                    { value: "4", label: "Forced Sale" },
                                    { value: "5", label: "Other" },
                                ]}
                                error={errors.value_premise_id}
                            />
                            <InputField
                                label="Valued at"
                                required
                                type="date"
                                value={formData.valued_at}
                                onChange={(e) => handleFieldChange("valued_at", e.target.value)}
                                error={errors.valued_at}
                            />
                            <InputField
                                label="Submitted at"
                                required
                                type="date"
                                value={formData.submitted_at}
                                onChange={(e) => handleFieldChange("submitted_at", e.target.value)}
                                error={errors.submitted_at}
                            />
                            <InputField
                                label="Inspection date"
                                required
                                type="date"
                                value={formData.inspection_date}
                                onChange={(e) => handleFieldChange("inspection_date", e.target.value)}
                                error={errors.inspection_date}
                            />
                            <InputField
                                label="Report value"
                                required
                                value={formData.value}
                                onChange={(e) => handleFieldChange("value", e.target.value)}
                                error={errors.value}
                            />
                            <InputField
                                label="Final value"
                                value={formData.final_value}
                                onChange={(e) => handleFieldChange("final_value", e.target.value)}
                                error={errors.final_value}
                            />
                            <InputField
                                label="Valuation currency"
                                value={formData.valuation_currency}
                                onChange={(e) => handleFieldChange("valuation_currency", e.target.value)}
                            />
                        </div>
                    </Section>

                    <Section title="PDF">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-[11px] text-slate-700">
                                <FileText className="w-4 h-4 text-slate-500" />
                                <span className="truncate text-slate-600">
                                    {formData.pdf_path
                                        ? `Stored: ${formData.pdf_path}`
                                        : "No PDF stored for this report"}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <label
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-md cursor-pointer hover:bg-blue-100 transition-colors"
                                >
                                    <FileUp className="w-4 h-4" />
                                    Choose PDF
                                    <input
                                        ref={editPdfInputRef}
                                        type="file"
                                        accept="application/pdf"
                                        className="hidden"
                                        onChange={(e) => handleSelectEditPdfFile(e.target.files?.[0] || null)}
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={handleUseTemporaryPdfPath}
                                    className="text-xs font-semibold text-slate-600 px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-100 transition-colors"
                                >
                                    Use temporary PDF
                                </button>
                            </div>
                            {pdfEditFile && (
                                <p className="text-[11px] text-slate-500">
                                    Selected: {pdfEditFile.name}
                                </p>
                            )}
                            {usePlaceholderPdf && (
                                <p className="text-[11px] text-amber-600">
                                    Temporary placeholder PDF will be used when saving.
                                </p>
                            )}
                            <InputField
                                label="Saved PDF path"
                                value={formData.pdf_path || ""}
                                readOnly
                                disabled
                                placeholder="Path saved in database"
                                className="text-[11px]"
                            />
                        </div>
                    </Section>

                    <Section title="Client & contact">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                            <InputField
                                label="Client name"
                                required
                                value={formData.client_name}
                                onChange={(e) => handleFieldChange("client_name", e.target.value)}
                                error={errors.client_name}
                            />
                            <InputField
                                label="Owner name"
                                value={formData.owner_name}
                                onChange={(e) => handleFieldChange("owner_name", e.target.value)}
                            />
                            <InputField
                                label="Telephone"
                                required
                                value={formData.telephone}
                                onChange={(e) => handleFieldChange("telephone", e.target.value)}
                                error={errors.telephone}
                            />
                            <InputField
                                label="Email"
                                required
                                value={formData.email}
                                onChange={(e) => handleFieldChange("email", e.target.value)}
                                error={errors.email}
                            />
                            <InputField
                                label="Region"
                                value={formData.region}
                                onChange={(e) => handleFieldChange("region", e.target.value)}
                            />
                            <InputField
                                label="City"
                                value={formData.city}
                                onChange={(e) => handleFieldChange("city", e.target.value)}
                            />
                        </div>
                    </Section>

                    <Section title="Notes">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <TextAreaField
                                label="Assumptions"
                                rows={3}
                                value={formData.assumptions}
                                onChange={(e) => handleFieldChange("assumptions", e.target.value)}
                            />
                            <TextAreaField
                                label="Special assumptions"
                                rows={3}
                                value={formData.special_assumptions}
                                onChange={(e) => handleFieldChange("special_assumptions", e.target.value)}
                            />
                        </div>
                    </Section>

                    <Section title="Other users">
                        <div className="flex items-center gap-2 mb-2">
                            <input
                                type="checkbox"
                                checked={formData.has_other_users}
                                onChange={(e) => handleFieldChange("has_other_users", e.target.checked)}
                                className="h-4 w-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                            />
                            <span className="text-xs text-slate-700 font-medium">Has other users</span>
                        </div>
                        {formData.has_other_users && (
                            <div className="space-y-2">
                                {reportUsers.map((userName, idx) => (
                                    <div key={`user-${idx}`} className="flex items-end gap-2">
                                        <div className="flex-1">
                                            <InputField
                                                label={`User ${idx + 1}`}
                                                value={userName}
                                                onChange={(e) => handleReportUserChange(idx, e.target.value)}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveReportUser(idx)}
                                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={handleAddReportUser}
                                    className="rounded-md border border-blue-600 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                                >
                                    Add user
                                </button>
                            </div>
                        )}
                    </Section>

                    <Section title="Valuers">
                        <div className="space-y-2">
                            {!selectedCompany && (
                                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-700">
                                    Select a company to load valuers.
                                </div>
                            )}
                            {selectedCompany && !displayCompanyValuers.length && (
                                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] text-slate-600">
                                    {fetchingCompanyValuers
                                        ? "Loading valuers for the selected company..."
                                        : "No valuers found for the selected company."}
                                </div>
                            )}
                            {valuers.map((valuer, idx) => (
                                <div key={`valuer-${idx}`} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                                    <SelectField
                                        label="Valuer name"
                                        value={valuer.valuer_name}
                                        options={valuerNameOptions}
                                        onChange={(e) => handleValuerChange(idx, "valuer_name", e.target.value)}
                                        disabled={fetchingCompanyValuers || !displayCompanyValuers.length}
                                    />
                                    <SelectField
                                        label="Contribution %"
                                        value={valuer.contribution_percentage}
                                        options={[
                                            { value: "", label: "Select %" },
                                            ...CONTRIBUTION_OPTIONS.map((pct) => ({ value: pct, label: `${pct}%` })),
                                        ]}
                                        onChange={(e) => handleValuerChange(idx, "contribution_percentage", e.target.value)}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveValuer(idx)}
                                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={handleAddValuer}
                                disabled={fetchingCompanyValuers || !displayCompanyValuers.length}
                                className="rounded-md border border-blue-600 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Add valuer
                            </button>
                        </div>
                    </Section>

                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={closeReportEdit}
                            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveReportEdit}
                            disabled={updatingReport}
                            className={`rounded-md px-4 py-2 text-xs font-semibold text-white transition-all ${updatingReport ? "bg-blue-500/50 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow-md"
                                }`}
                        >
                            {updatingReport ? "Saving..." : "Save changes"}
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal
                open={!!assetEdit}
                onClose={closeAssetEdit}
                title="Edit asset"
                maxWidth="max-w-3xl"
            >
                <div className="space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <InputField
                            label="Asset name"
                            value={assetDraft.asset_name}
                            onChange={(e) =>
                                setAssetDraft((prev) => ({ ...prev, asset_name: e.target.value }))
                            }
                        />
                        <InputField
                            label="Asset usage id"
                            value={assetDraft.asset_usage_id}
                            onChange={(e) =>
                                setAssetDraft((prev) => ({
                                    ...prev,
                                    asset_usage_id: e.target.value,
                                }))
                            }
                        />
                        <InputField
                            label="Final value"
                            value={assetDraft.final_value}
                            onChange={(e) =>
                                setAssetDraft((prev) => ({
                                    ...prev,
                                    final_value: e.target.value,
                                }))
                            }
                        />
                        <InputField
                            label="Region"
                            value={assetDraft.region}
                            onChange={(e) =>
                                setAssetDraft((prev) => ({ ...prev, region: e.target.value }))
                            }
                        />
                        <InputField
                            label="City"
                            value={assetDraft.city}
                            onChange={(e) =>
                                setAssetDraft((prev) => ({ ...prev, city: e.target.value }))
                            }
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={closeAssetEdit}
                            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveAssetEdit}
                            disabled={assetEditBusy}
                            className={`rounded-md px-4 py-2 text-xs font-semibold text-white transition-all ${assetEditBusy ? "bg-blue-500/50 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow-md"
                                }`}
                        >
                            {assetEditBusy ? "Saving..." : "Save"}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default MultiExcelUpload;
