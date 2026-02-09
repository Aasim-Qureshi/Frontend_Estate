import React, { use, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { uploadElrajhiBatch, fetchElrajhiBatches, fetchElrajhiBatchReports, updateUrgentReport } from "../../api/report";
import httpClient from "../../api/httpClient";
import { useElrajhiUpload } from "../context/ElrajhiUploadContext";
import EditReportModal from "../components/EditReportModal";
import { useRam } from "../context/RAMContext";
import { useSession } from "../context/SessionContext";
import { useValueNav } from "../context/ValueNavContext";
import { downloadTemplateFile } from "../utils/templateDownload";
import { useAuthAction } from "../hooks/useAuthAction";
import InsufficientPointsModal from "../components/InsufficientPointsModal";

import {
    FileSpreadsheet,
    Files,
    Loader2,
    Edit2,
    CheckCircle2,
    AlertTriangle,
    Table,
    File as FileIcon,
    RefreshCw,
    FolderOpen,
    Info,
    Send,
    Download,
    ChevronDown,
    ChevronUp,
    ChevronRight,
    Trash2,
    RotateCw,
    Pause,
    Play,
    Square,
    FileUp,
} from "lucide-react";

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

const convertArabicDigits = (value) => {
    if (typeof value !== "string") return value;
    const map = {
        "٠": "0",
        "١": "1",
        "٢": "2",
        "٣": "3",
        "٤": "4",
        "٥": "5",
        "٦": "6",
        "٧": "7",
        "٨": "8",
        "٩": "9",
    };
    return value.replace(/[٠-٩]/g, (d) => map[d] ?? d);
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
            // Try dd/mm/yyyy then yyyy-mm-dd
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

const normalizeValuerOption = (valuer = {}) => {
    const valuerId = (valuer.valuerId || valuer.valuer_id || valuer.id || valuer.value || "").toString().trim();
    const valuerName = (valuer.valuerName || valuer.valuer_name || valuer.name || valuer.label || valuer.text || "").toString().trim();
    return {
        valuerId,
        valuerName
    };
};

const normalizeValuerList = (list = []) =>
    (Array.isArray(list) ? list : [])
        .map((valuer) => normalizeValuerOption(valuer))
        .filter((valuer) => valuer.valuerId || valuer.valuerName);

const sumValuerPercentages = (list = []) => {
    const total = (Array.isArray(list) ? list : []).reduce(
        (sum, valuer) => sum + (Number(valuer.percentage) || 0),
        0
    );
    return Math.round(total * 100) / 100;
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
    const valuedAt = parseExcelDateValue(valuedAtRaw);
    const submittedAt = parseExcelDateValue(submittedAtRaw);

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

    if (!valuedAt) addIssue("Date of Valuation", "Report Info", "Field Date of Valuation is required");
    if (!submittedAt) addIssue("Report Issuing Date", "Report Info", "Field Report Issuing Date is required");
    if (valuedAt && submittedAt && valuedAt > submittedAt) {
        addIssue("Date of Valuation", "Report Info", "Date of Valuation must be on or before Report Issuing Date");
    }

    if (!marketRows.length) {
        addIssue("Final Value", "market sheet", "No assets found in market sheet to validate final values");
    } else {
        marketRows.forEach((row, idx) => {
            const finalVal = pickFieldValue(row, ["final_value", "final value", "value"]);
            if (!hasValue(finalVal) || Number.isNaN(Number(finalVal))) {
                const rowNumber = idx + 2; // account for header row
                const assetName = row.asset_name || row.assetName || `Row ${rowNumber}`;
                addIssue(
                    "Final Value",
                    `market row ${rowNumber}`,
                    `Final Value is required for asset "${assetName}"`
                );
            }
        });
    }

    const snapshot = {
        purpose,
        valueAttributes,
        reportType,
        clientName,
        telephone,
        email,
        valuedAt,
        submittedAt,
    };

    return { issues, snapshot };
};

const detectValuerColumns = (exampleRow) => {
    const keys = Object.keys(exampleRow || {});
    const idKeys = [];
    const nameKeys = [];
    const pctKeys = [];

    const pushIfUnique = (arr, key) => {
        if (!arr.includes(key)) arr.push(key);
    };

    const extractIndex = (normalizedKey, base) => {
        const num = normalizedKey.slice(base.length).match(/^(\d+)/);
        return num ? Number(num[1]) : 0;
    };

    keys.forEach((originalKey) => {
        const normalized = normalizeKey(originalKey);

        const isIdKey =
            normalized.startsWith("valuerid") ||
            /^valuer\d+id/.test(normalized);
        const isNameKey =
            normalized.startsWith("valuername") ||
            /^valuer\d+name/.test(normalized);
        const isPctKey =
            normalized.startsWith("percentage") ||
            normalized.startsWith("percent") ||
            /^valuer\d+(percentage|percent)/.test(normalized);

        if (isIdKey) {
            pushIfUnique(idKeys, originalKey);
        } else if (isNameKey) {
            pushIfUnique(nameKeys, originalKey);
        } else if (isPctKey) {
            pushIfUnique(pctKeys, originalKey);
        }
    });

    const sortValuerKeys = (arr, base) =>
        arr.sort((a, b) => {
            const aIdx = extractIndex(normalizeKey(a), base);
            const bIdx = extractIndex(normalizeKey(b), base);
            return aIdx - bIdx || a.localeCompare(b);
        });

    sortValuerKeys(idKeys, "valuerid");
    sortValuerKeys(nameKeys, "valuername");
    sortValuerKeys(pctKeys, "percentage");

    const hasAnyValuerCols = idKeys.length > 0 || nameKeys.length > 0 || pctKeys.length > 0;

    if (!hasAnyValuerCols) {
        return {
            idKeys: [],
            nameKeys: [],
            pctKeys: [],
            allKeys: [],
            hasValuerColumns: false,
        };
    }

    const hasBaseName = nameKeys.length > 0;
    const hasBasePct = pctKeys.length > 0;

    if (!hasBaseName || !hasBasePct) {
        throw new Error(
            "Market sheet must contain headers 'valuerName' and 'percentage' (with optional 1, 2, etc.)."
        );
    }

    const allKeys = Array.from(new Set([...idKeys, ...nameKeys, ...pctKeys]));
    return { idKeys, nameKeys, pctKeys, allKeys, hasValuerColumns: true };
};

const buildValuersForAsset = (assetRow, valuerCols) => {
    const { idKeys, nameKeys, pctKeys } = valuerCols;
    const maxLen = Math.max(idKeys.length, nameKeys.length, pctKeys.length);
    const valuers = [];

    for (let i = 0; i < maxLen; i++) {
        const idKey = idKeys[i];
        const nameKey = nameKeys[i];
        const pctKey = pctKeys[i];

        const rawId = idKey ? assetRow[idKey] : null;
        const rawName = nameKey ? assetRow[nameKey] : null;
        const rawPct = pctKey ? assetRow[pctKey] : null;

        const allEmpty =
            (rawId === null || rawId === "" || rawId === undefined) &&
            (rawName === null || rawName === "" || rawName === undefined) &&
            (rawPct === null || rawPct === "" || rawPct === undefined);

        if (allEmpty) continue;

        let pctValue = normalizeCellValue(rawPct);
        if (typeof pctValue === "string") {
            pctValue = convertArabicDigits(pctValue)
                .replace(/[%٪]/g, "")
                .replace(/,/g, ".")
                .trim();
        }

        const hasPct =
            rawPct !== null &&
            rawPct !== undefined &&
            String(rawPct).toString().trim() !== "";

        if (!hasPct) {
            continue;
        }

        const pctNum = Number(pctValue);
        let percentage = 0;

        if (!Number.isNaN(pctNum)) {
            percentage = pctNum >= 0 && pctNum <= 1 ? pctNum * 100 : pctNum;
        } else {
            continue;
        }

        valuers.push({
            valuerId: rawId != null && rawId !== "" ? String(rawId) : "",
            valuerName: rawName != null ? String(rawName) : "",
            percentage,
        });
    }

    return valuers;
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

const UploadReportElrajhi = ({ onViewChange }) => {
    const {
        excelFile,
        setExcelFile,
        pdfFiles,
        setPdfFiles,
        validationExcelFile,
        setValidationExcelFile,
        validationPdfFiles,
        setValidationPdfFiles,
        resetAllFiles,
        batchId,
        setBatchId,
        excelResult,
        setExcelResult,
        downloadPath,
        setDownloadPath,
        error,
        setError,
        success,
        setSuccess,
        validationReports,
        setValidationReports,
        marketAssets,
        setMarketAssets,
        validationMessage,
        setValidationMessage,
        validationDownloadPath,
        setValidationDownloadPath,
        rememberedFiles,
        setRememberedFiles,
        resetMainFlow,
        resetValidationFlow,
        sendingTaqeem,
        setSendingTaqeem,
        sendingValidation,
        setSendingValidation,
        pdfOnlySending,
        setPdfOnlySending,
        loadingValuers,
        setLoadingValuers,
    } = useElrajhiUpload();

    const [showInsufficientPointsModal, setShowInsufficientPointsModal] = useState(false);
    const [batchActionDropdown, setBatchActionDropdown] = useState({});
    const [batchActionLoading, setBatchActionLoading] = useState({});
    const [selectedBulkActions, setSelectedBulkActions] = useState({});
    const { executeWithAuth } = useAuthAction();
    const { selectedCompany } = useValueNav();
    const selectedCompanyOfficeId = useMemo(() => {
        const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
        return officeId ? String(officeId) : "";
    }, [selectedCompany]);
    const [showValidationModal, setShowValidationModal] = useState(false);

    const refreshAfterEdit = async (batchId) => {
        if (batchId) {
            await loadBatchReports(batchId);
            await loadBatchList();

            setBatchMessage({
                type: "success",
                text: "Report updated successfully!"
            });
        }
    };

    const [downloadingExcel, setDownloadingExcel] = useState(false);
    const [savingValidation, setSavingValidation] = useState(false);
    const [editingReport, setEditingReport] = useState(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [downloadingValidationExcel, setDownloadingValidationExcel] = useState(false);
    const [downloadingTemplate, setDownloadingTemplate] = useState(false);
    const [sendToConfirmerMain, setSendToConfirmerMain] = useState(false);
    const [sendToConfirmerValidation, setSendToConfirmerValidation] = useState(false);
    const [wantsPdfUpload, setWantsPdfUpload] = useState(false);
    const validationExcelInputRef = useRef(null);
    const validationPdfInputRef = useRef(null);
    const mainExcelInputRef = useRef(null);
    const mainPdfInputRef = useRef(null);
    const [batchList, setBatchList] = useState([]);
    const [batchReports, setBatchReports] = useState({});
    const [expandedBatch, setExpandedBatch] = useState(null);
    const [checkingBatchId, setCheckingBatchId] = useState(null);
    const [retryingBatchId, setRetryingBatchId] = useState(null);
    const [downloadingCertificatesBatchId, setDownloadingCertificatesBatchId] = useState(null);
    const [checkingAllBatches, setCheckingAllBatches] = useState(false);
    const [batchLoading, setBatchLoading] = useState(false);
    const [batchMessage, setBatchMessage] = useState(null);
    const [certificateStatusByReport, setCertificateStatusByReport] = useState({});
    const [selectedReports, setSelectedReports] = useState(new Set());
    const [bulkActionBusy, setBulkActionBusy] = useState(null);
    const [activeBulkActionBatchId, setActiveBulkActionBatchId] = useState(null);
    const [actionMenuBatch, setActionMenuBatch] = useState(null);
    const [actionMenuOpen, setActionMenuOpen] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 10;
    const [mainReportIssues, setMainReportIssues] = useState([]);
    const [mainReportSnapshot, setMainReportSnapshot] = useState(null);
    const [validationReportIssues, setValidationReportIssues] = useState([]);
    const [validationReportSnapshot, setValidationReportSnapshot] = useState(null);
    const [validationTableTab, setValidationTableTab] = useState("report-info");
    const [isValidationTableCollapsed, setIsValidationTableCollapsed] = useState(false);
    const [statusFilterByBatch, setStatusFilterByBatch] = useState({});
    const [pdfUploadBusy, setPdfUploadBusy] = useState({});
    const [batchPaused, setBatchPaused] = useState({});
    const [pdfUploadedThisSession, setPdfUploadedThisSession] = useState({});
    const [reportProgressDisplay, setReportProgressDisplay] = useState({});
    const reportProgressDisplayRef = useRef({});

    useEffect(() => {
        reportProgressDisplayRef.current = reportProgressDisplay;
    }, [reportProgressDisplay]);

    const resetMainValidationState = () => {
        setMainReportIssues([]);
        setMainReportSnapshot(null);
    };

    const resetValidationCardState = () => {
        setValidationReportIssues([]);
        setValidationReportSnapshot(null);
    };

    const deriveProgressFromFields = (report = {}) => {
        const clamp = (val) => Math.max(0, Math.min(100, Math.round(val)));
        const hasId = Boolean(report?.report_id || report?.reportId);
        const rawStatus = (report.report_status || report.reportStatus || report.status || "").toString().toUpperCase();

        const normalizeProgress = (val) => {
            const num = Number(val);
            if (Number.isNaN(num)) return null;
            const pct = num <= 1 ? num * 100 : num;
            return clamp(pct);
        };

        const progressCandidates = [
            report.progress_percentage,
            report.progressPercent,
            report.progress_percent,
            report.progress,
            report.percentage,
            report.progressValue,
        ]
            .map(normalizeProgress)
            .filter((v) => v !== null);

        const assetsDoneRaw =
            report.assets_saved ??
            report.assetsSaved ??
            report.saved_assets ??
            report.savedAssets ??
            report.assets_done ??
            report.assetsDone ??
            report.assets_created ??
            report.assetsCreated ??
            report.assetsCount ??
            0;
        const assetsTotalRaw =
            report.assets_total ??
            report.assetsTotal ??
            report.total_assets ??
            report.totalAssets ??
            0;
        const assetsDone = Number(assetsDoneRaw);
        const assetsTotal = Number(assetsTotalRaw);
        const assetsComplete =
            (assetsTotal > 0 && assetsDone >= assetsTotal) ||
            assetsDone >= 1 && assetsTotal === 0 ||
            report.assets_saved === true ||
            report.assetsSaved === true ||
            report.assets_filled === true ||
            report.assetsFilled === true ||
            report.assets_data_saved === true ||
            report.assetsDataSaved === true;

        // Stage baseline: 0 before creation, 50 right after creation, 50->100 during assets.
        if (!hasId) {
            const fallback = progressCandidates.length ? progressCandidates[progressCandidates.length - 1] : 0;
            return { progress: clamp(fallback), hasId, assetsComplete };
        }

        const baseAfterCreation = 50;
        if (assetsComplete || rawStatus.includes("COMPLETE")) {
            return { progress: 100, hasId, assetsComplete: true };
        }

        if (assetsTotal > 0) {
            const assetsPortion = Math.max(0, Math.min(1, assetsDone / assetsTotal));
            const pct = clamp(baseAfterCreation + assetsPortion * 50);
            const candidateMax = progressCandidates.length ? Math.max(...progressCandidates) : baseAfterCreation;
            return { progress: Math.max(pct, candidateMax, baseAfterCreation), hasId, assetsComplete };
        }

        const candidateMax = progressCandidates.length ? Math.max(...progressCandidates) : 0;
        return { progress: Math.max(candidateMax, baseAfterCreation), hasId, assetsComplete };
    };

    const computeReportStatus = (report) => {
        const reportId = report.report_id || report.reportId || "";
        const submitState = report.submit_state ?? report.submitState;
        const rawStatus = (report.report_status || report.reportStatus || report.status || "").toString().toUpperCase();
        const sentFlag =
            rawStatus === "SENT" ||
            submitState === 2 ||
            report.sent_to_confirmer ||
            report.sentToConfirmer ||
            report.sent === true ||
            report.submitted === true ||
            report.submit_status === "sent" ||
            report.submitStatus === "sent";

        const { progress, assetsComplete } = deriveProgressFromFields(report);

        if (submitState === -1) return "DELETED";
        if (!reportId) return "MISSING_ID";
        if (rawStatus === "CONFIRMED") return "CONFIRMED";
        if (rawStatus.includes("COMPLETE")) return "COMPLETE";
        if (sentFlag) return "SENT";
        if (assetsComplete || progress >= 100) return "COMPLETE";
        if (rawStatus === "SENT") return "SENT";
        if (submitState === 1) return "COMPLETE";
        return "INCOMPLETE";
    };

    const hasPdfPath = (report) => {
        return Boolean(report?.pdf_path || report?.path_pdf);
    };

    const computeProgress = (report = {}) => deriveProgressFromFields(report).progress;

    const getReportKey = (report) =>
        report?.report_id ||
        report?.reportId ||
        report?._id ||
        report?.id ||
        report?.asset_name ||
        report?.assetName ||
        'unknown';

    const getDisplayProgress = (report) => {
        const key = getReportKey(report);
        const target = computeProgress(report);
        const current = reportProgressDisplay[key] ?? 0;
        return Math.max(current, target);
    };

    // Animate towards target progress for each report to give a dynamic feel
    useEffect(() => {
        const animations = [];
        Object.values(batchReports || {}).forEach((reports) => {
            reports.forEach((report) => {
                const key = getReportKey(report);
                const target = computeProgress(report);
                const current = reportProgressDisplayRef.current[key] ?? 0;
                if (target > current) {
                    const step = Math.max(1, Math.floor((target - current) / 5));
                    const animate = () => {
                        setReportProgressDisplay((prev) => {
                            const prevVal = prev[key] ?? 0;
                            if (target <= prevVal) return prev;
                            const nextVal = Math.min(target, prevVal + step);
                            return { ...prev, [key]: nextVal };
                        });
                        const latest = reportProgressDisplayRef.current[key] ?? 0;
                        if (latest < target) {
                            requestAnimationFrame(animate);
                        }
                    };
                    animations.push(animate);
                }
            });
        });

        animations.forEach((fn) => requestAnimationFrame(fn));
    }, [batchReports]);

    const computeBatchProgress = (reports = []) => {
        if (!reports.length) return 0;
        const totalProgress = reports.reduce((sum, r) => sum + computeProgress(r), 0);
        return Math.round(totalProgress / reports.length);
    };

    const requirePdfMessage = "Upload PDF first for missing-ID reports.";

    const shouldBlockActionsForMissingId = (report) => {
        const status = computeReportStatus(report);
        const reportKey = report.report_id || report.reportId || report._id || report.id;
        if (status !== "MISSING_ID") return false;
        return !pdfUploadedThisSession[reportKey];
    };

    // Pause/Resume/Stop state management
    const [isPausedMain, setIsPausedMain] = useState(false);
    const [isPausedValidation, setIsPausedValidation] = useState(false);
    const [isPausedPdfOnly, setIsPausedPdfOnly] = useState(false);
    const [isPausedBatchCheck, setIsPausedBatchCheck] = useState(false);
    const [isPausedBatchRetry, setIsPausedBatchRetry] = useState(false);
    const [currentOperationBatchId, setCurrentOperationBatchId] = useState(null);

    const handleBatchAction = async (batchId, action) => {
        const batch = batchList.find(b => b.batchId === batchId);
        if (!batch) return;

        setBatchActionLoading(prev => ({ ...prev, [batchId]: true }));

        try {
            switch (action) {
                case 'check-status':
                    await runBatchCheck(batchId);
                    break;

                case 'approve-reports':
                    if (!window?.electronAPI?.openTaqeemLogin) {
                        throw new Error("Desktop integration unavailable. Restart the app.");
                    }

                    setBatchMessage({
                        type: "info",
                        text: `Opening secondary Taqeem login for batch ${batchId}...`
                    });

                    {
                        const result = await window.electronAPI.openTaqeemLogin({
                            batchId,
                            preferChrome: false,
                            waitForLogin: true
                        });

                        if (result?.status !== "SUCCESS") {
                            throw new Error(result?.error || "Failed to open Taqeem login");
                        }

                        const summary = result?.batch;
                        const summaryText = summary
                            ? `Processed reports: ${summary.succeeded}/${summary.total} succeeded, ${summary.failed} failed.`
                            : "";

                        setBatchMessage({
                            type: summary?.failed ? "info" : "success",
                            text: [
                                result?.message || "Opened Taqeem login in a separate browser window.",
                                summaryText,
                                "Refreshing status..."
                            ].filter(Boolean).join(" ")
                        });

                        await runBatchCheck(batchId);
                    }
                    break;

                case 'download-certificates':
                    await handleBatchDownloadCertificates(batchId);
                    break;

                case 'retry-batch':
                    if (!window?.electronAPI?.retryElrajhiReport) {
                        throw new Error("Desktop integration unavailable. Restart the app.");
                    }

                    await executeWithAuth(
                        async (params) => {
                            const { token: authToken } = params;

                            setRetryingBatchId(batchId);
                            setCurrentOperationBatchId(batchId);
                            setIsPausedBatchRetry(false);
                            setBatchMessage({
                                type: "info",
                                text: `Retrying batch ${batchId}...`
                            });

                            try {
                                const result = await window.electronAPI.retryElrajhiReport(batchId, recommendedTabs);
                                if (result?.status !== "SUCCESS") {
                                    throw new Error(result?.error || "Retry failed");
                                }
                                setBatchMessage({
                                    type: "success",
                                    text: `Retry completed for batch ${batchId}`
                                });
                                await loadBatchReports(batchId);
                                await loadBatchList();
                            } catch (err) {
                                setBatchMessage({
                                    type: "error",
                                    text: err.message || "Failed to retry batch"
                                });
                                throw err;
                            } finally {
                                setRetryingBatchId(null);
                                setCurrentOperationBatchId(null);
                            }
                        },
                        { token },
                        {
                            requiredPoints: 1,
                            showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
                            onViewChange,
                            onAuthSuccess: () => {
                                console.log('Batch retry authentication successful');
                            },
                            onAuthFailure: (reason) => {
                                console.warn('Batch retry authentication failed:', reason);
                                if (reason !== "INSUFFICIENT_POINTS" && reason !== "LOGIN_REQUIRED") {
                                    setBatchMessage({
                                        type: "error",
                                        text: reason?.message || "Authentication failed for batch retry"
                                    });
                                }
                            }
                        }
                    );
                    break;

                default:
                    console.warn(`Unknown batch action: ${action}`);
            }
        } catch (err) {
            console.error(`Batch action ${action} failed:`, err);
            if (!err?.message?.includes("INSUFFICIENT_POINTS") && !err?.message?.includes("LOGIN_REQUIRED")) {
                setBatchMessage({
                    type: "error",
                    text: err?.message || `Failed to execute ${action} for batch ${batchId}`
                });
            }
        } finally {
            setBatchActionLoading(prev => ({ ...prev, [batchId]: false }));
            // Clear the dropdown selection
            setBatchActionDropdown(prev => {
                const next = { ...prev };
                delete next[batchId];
                return next;
            });
        }
    };

    const { ramInfo } = useRam();

    // Use recommendedTabs from ramInfo
    const recommendedTabs = ramInfo?.recommendedTabs || 1;

    // Pause/Resume/Stop handlers for Main flow (No Validation)
    const handlePauseMain = async () => {
        if (!batchId) return;
        try {
            await window.electronAPI.pauseElrajiBatch(batchId);
            setIsPausedMain(true);
            setSuccess("Operation paused");
        } catch (err) {
            setError("Failed to pause operation");
        }
    };

    const handleResumeMain = async () => {
        if (!batchId) return;
        try {
            await window.electronAPI.resumeElrajiBatch(batchId);
            setIsPausedMain(false);
            setSuccess("Operation resumed");
        } catch (err) {
            setError("Failed to resume operation");
        }
    };

    const handleStopMain = async () => {
        if (!batchId) return;
        try {
            await window.electronAPI.stopElrajiBatch(batchId);
            setIsPausedMain(false);
            setSendingTaqeem(false);
            setSuccess("Operation stopped");
        } catch (err) {
            setError("Failed to stop operation");
        }
    };

    // Pause/Resume/Stop handlers for Validation flow
    const handlePauseValidation = async () => {
        if (!validationReports.length) return;
        const reportBatchId = validationReports[0]?.batchId || batchId;
        if (!reportBatchId) return;
        try {
            await window.electronAPI.pauseElrajiBatch(reportBatchId);
            setIsPausedValidation(true);
            setValidationMessage({ type: "info", text: "Operation paused" });
        } catch (err) {
            setValidationMessage({ type: "error", text: "Failed to pause operation" });
        }
    };

    const handleResumeValidation = async () => {
        if (!validationReports.length) return;
        const reportBatchId = validationReports[0]?.batchId || batchId;
        if (!reportBatchId) return;
        try {
            await window.electronAPI.resumeElrajiBatch(reportBatchId);
            setIsPausedValidation(false);
            setValidationMessage({ type: "info", text: "Operation resumed" });
        } catch (err) {
            setValidationMessage({ type: "error", text: "Failed to resume operation" });
        }
    };

    const handleStopValidation = async () => {
        if (!validationReports.length) return;
        const reportBatchId = validationReports[0]?.batchId || batchId;
        if (!reportBatchId) return;
        try {
            await window.electronAPI.stopElrajiBatch(reportBatchId);
            setIsPausedValidation(false);
            setSendingValidation(false);
            setValidationMessage({ type: "info", text: "Operation stopped" });
        } catch (err) {
            setValidationMessage({ type: "error", text: "Failed to stop operation" });
        }
    };

    // Pause/Resume/Stop handlers for PDF Only flow
    const handlePausePdfOnly = async () => {
        if (!validationReports.length) return;
        const reportBatchId = validationReports[0]?.batchId || batchId;
        if (!reportBatchId) return;
        try {
            await window.electronAPI.pauseElrajiBatch(reportBatchId);
            setIsPausedPdfOnly(true);
            setValidationMessage({ type: "info", text: "PDF operation paused" });
        } catch (err) {
            setValidationMessage({ type: "error", text: "Failed to pause PDF operation" });
        }
    };

    const handleResumePdfOnly = async () => {
        if (!validationReports.length) return;
        const reportBatchId = validationReports[0]?.batchId || batchId;
        if (!reportBatchId) return;
        try {
            await window.electronAPI.resumeElrajiBatch(reportBatchId);
            setIsPausedPdfOnly(false);
            setValidationMessage({ type: "info", text: "PDF operation resumed" });
        } catch (err) {
            setValidationMessage({ type: "error", text: "Failed to resume PDF operation" });
        }
    };

    const handleStopPdfOnly = async () => {
        if (!validationReports.length) return;
        const reportBatchId = validationReports[0]?.batchId || batchId;
        if (!reportBatchId) return;
        try {
            await window.electronAPI.stopElrajiBatch(reportBatchId);
            setIsPausedPdfOnly(false);
            setPdfOnlySending(false);
            setValidationMessage({ type: "info", text: "PDF operation stopped" });
        } catch (err) {
            setValidationMessage({ type: "error", text: "Failed to stop PDF operation" });
        }
    };

    const handleEditReport = async (updatedData) => {
        // Implement your API call to update the report
        console.log("Updating report:", editingReport, "with data:", updatedData);

        // Example API call:
        try {
            // await updateReportApi(editingReport.report_id, updatedData);
            // Refresh the reports
            await loadBatchReports(editingReport.batchId);
            await loadBatchList();
        } catch (error) {
            throw new Error("Failed to update report");
        }
    };

    // Pause/Resume/Stop handlers for Batch Check
    const handlePauseBatchCheck = async (targetBatchId) => {
        const bId = targetBatchId || currentOperationBatchId;
        if (!bId) return;
        try {
            await window.electronAPI.pauseElrajiBatch(bId);
            setIsPausedBatchCheck(true);
            setBatchMessage({ type: "info", text: `Batch check paused for ${bId}` });
        } catch (err) {
            setBatchMessage({ type: "error", text: "Failed to pause batch check" });
        }
    };

    const handleResumeBatchCheck = async (targetBatchId) => {
        const bId = targetBatchId || currentOperationBatchId;
        if (!bId) return;
        try {
            await window.electronAPI.resumeElrajiBatch(bId);
            setIsPausedBatchCheck(false);
            setBatchMessage({ type: "info", text: `Batch check resumed for ${bId}` });
        } catch (err) {
            setBatchMessage({ type: "error", text: "Failed to resume batch check" });
        }
    };

    const handleStopBatchCheck = async (targetBatchId) => {
        const bId = targetBatchId || currentOperationBatchId;
        if (!bId) return;
        try {
            await window.electronAPI.stopElrajiBatch(bId);
            setIsPausedBatchCheck(false);
            setCheckingBatchId(null);
            setCheckingAllBatches(false);
            setBatchMessage({ type: "info", text: `Batch check stopped for ${bId}` });
        } catch (err) {
            setBatchMessage({ type: "error", text: "Failed to stop batch check" });
        }
    };

    // Pause/Resume/Stop handlers for Batch Retry
    const handlePauseBatchRetry = async (targetBatchId) => {
        const bId = targetBatchId || currentOperationBatchId;
        if (!bId) return;
        try {
            await window.electronAPI.pauseElrajiBatch(bId);
            setIsPausedBatchRetry(true);
            setBatchMessage({ type: "info", text: `Batch retry paused for ${bId}` });
        } catch (err) {
            setBatchMessage({ type: "error", text: "Failed to pause batch retry" });
        }
    };

    const handleResumeBatchRetry = async (targetBatchId) => {
        const bId = targetBatchId || currentOperationBatchId;
        if (!bId) return;
        try {
            await window.electronAPI.resumeElrajiBatch(bId);
            setIsPausedBatchRetry(false);
            setBatchMessage({ type: "info", text: `Batch retry resumed for ${bId}` });
        } catch (err) {
            setBatchMessage({ type: "error", text: "Failed to resume batch retry" });
        }
    };

    const handleStopBatchRetry = async (targetBatchId) => {
        const bId = targetBatchId || currentOperationBatchId;
        if (!bId) return;
        try {
            await window.electronAPI.stopElrajiBatch(bId);
            setIsPausedBatchRetry(false);
            setCheckingBatchId(null);
            setBatchMessage({ type: "info", text: `Batch retry stopped for ${bId}` });
        } catch (err) {
            setBatchMessage({ type: "error", text: "Failed to stop batch retry" });
        }
    };

    const uploadExcelOnly = async () => {
        throw new Error("uploadExcelOnly is deprecated in this flow.");
    };

    const { token, isGuest } = useSession();

    console.log("TOKEN:", token);


    const handleSubmitElrajhi = async () => {
        await executeWithAuth(
            async (params) => {
                try {
                    const { token: authToken } = params;
                    if (!validationExcelFile) {
                        throw new Error("Select an Excel file before sending.");
                    }

                    if (validationReportIssues.length) {
                        throw new Error("Resolve the report info validation issues before sending.");
                    }
                    if (wantsPdfUpload && !validationPdfFiles.length) {
                        throw new Error("Add PDF files or turn off PDF upload to use temporary PDFs.");
                    }
                    setSendingValidation(true);
                    setIsPausedValidation(false);
                    setValidationMessage({
                        type: "info",
                        text: "Saving reports to database..."
                    });
                    // Upload to backend
                    const data = await uploadElrajhiBatch(
                        validationExcelFile,
                        wantsPdfUpload ? validationPdfFiles : [],
                        null,
                        selectedCompanyOfficeId || null
                    );

                    console.log("ELRAJHI BATCH:", data);

                    const batchIdFromData = data.batchId;
                    setCurrentOperationBatchId(batchIdFromData);
                    const insertedCount = data.inserted || 0;
                    const reportsFromApi = Array.isArray(data.reports) ? data.reports : [];
                    if (reportsFromApi.length) {
                        setValidationReports((prev) => {
                            const byAsset = new Map();
                            reportsFromApi.forEach((r) => {
                                const key = (r.asset_name || "").toLowerCase();
                                if (!byAsset.has(key)) byAsset.set(key, []);
                                byAsset.get(key).push(r);
                            });
                            return prev.map((r) => {
                                const list = byAsset.get((r.asset_name || "").toLowerCase()) || [];
                                const next = list.shift();
                                if (next) {
                                    return {
                                        ...r,
                                        record_id: next._id || next.id || next.record_id,
                                        report_id: next.report_id || r.report_id,
                                        batchId: batchIdFromData,
                                    };
                                }
                                return r;
                            });
                        });
                    }
                    setValidationDownloadPath(`/elrajhi-upload/export/${batchIdFromData}`);

                    setValidationMessage({
                        type: "success",
                        text: `Reports saved (${insertedCount} assets). ${sendToConfirmerValidation ? "Sending to Taqeem..." : "Final submission skipped."}`
                    });

                    const electronResult = await window.electronAPI.elrajhiUploadReport(batchIdFromData, recommendedTabs, false, sendToConfirmerValidation);

                    if (electronResult?.status === "SUCCESS") {
                        const resultMap = (electronResult.results || []).reduce((acc, res) => {
                            const key = res.record_id || res.recordId;
                            const reportId = res.report_id || res.reportId;
                            if (key && reportId) acc[key] = reportId;
                            return acc;
                        }, {});

                        if (Object.keys(resultMap).length || (electronResult.results || []).length) {
                            setValidationReports((prev) =>
                                prev.map((r, idx) => {
                                    const key = r.record_id || r.recordId || r._id;
                                    const fallback = (electronResult.results || [])[idx]?.report_id
                                        || (electronResult.results || [])[idx]?.reportId;
                                    const reportId = resultMap[key] || r.report_id || fallback;
                                    return { ...r, report_id: reportId };
                                })
                            );
                        }

                        setValidationMessage({
                            type: "success",
                            text: `Upload succeeded. ${insertedCount} assets saved and sent to Taqeem browser.`
                        });

                        await loadBatchList();
                    } else {
                        throw new Error(electronResult?.error || "Upload to Taqeem failed. Make sure you selected a company.");
                    }
                } catch (err) {
                    console.error("Upload failed", err);
                    setValidationMessage({
                        type: "error",
                        text: err.message || "Failed to upload reports"
                    });
                    throw err;
                } finally {
                    setSendingValidation(false);
                    setCurrentOperationBatchId(null);
                }
            },
            { token, validationExcelFile, validationPdfFiles, wantsPdfUpload, validationReportIssues, sendToConfirmerValidation },
            {
                requiredPoints: validationReports.length || 0,
                showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
                onViewChange,
                onAuthSuccess: () => {
                    console.log('Upload authentication successful');
                },
                onAuthFailure: (reason) => {
                    console.warn('Upload authentication failed:', reason);
                    if (reason !== "INSUFFICIENT_POINTS" && reason !== "LOGIN_REQUIRED") {
                        setValidationMessage({
                            type: "error",
                            text: reason?.message || "Authentication failed"
                        });
                    }
                }
            }
        );
    };

    const handleSubmitPdfOnly = async () => {
        try {
            if (!validationExcelFile) {
                throw new Error("Select an Excel file before sending.");
            }

            if (validationReportIssues.length) {
                throw new Error("Resolve the report info validation issues before sending.");
            }
            setPdfOnlySending(true);
            setIsPausedPdfOnly(false);
            setValidationMessage({
                type: "info",
                text: "Saving PDF reports to database..."
            });
            // Upload to backend
            const data = await uploadElrajhiBatch(
                validationExcelFile,
                validationPdfFiles,
                null,
                selectedCompanyOfficeId || null
            );

            console.log("ELRAJHI BATCH (PDF Only):", data);

            const batchIdFromData = data.batchId;
            setCurrentOperationBatchId(batchIdFromData);
            const insertedCount = data.inserted || 0;
            const reportsFromApi = Array.isArray(data.reports) ? data.reports : [];
            if (reportsFromApi.length) {
                setValidationReports((prev) => {
                    const byAsset = new Map();
                    reportsFromApi.forEach((r) => {
                        const key = (r.asset_name || "").toLowerCase();
                        if (!byAsset.has(key)) byAsset.set(key, []);
                        byAsset.get(key).push(r);
                    });
                    return prev.map((r) => {
                        const list = byAsset.get((r.asset_name || "").toLowerCase()) || [];
                        const next = list.shift();
                        if (next) {
                            return {
                                ...r,
                                record_id: next._id || next.id || next.record_id,
                                report_id: next.report_id || r.report_id,
                                batchId: batchIdFromData,
                            };
                        }
                        return r;
                    });
                });
            }
            setValidationDownloadPath(`/elrajhi-upload/export/${batchIdFromData}`);

            const pdfReports = validationReports.filter(report => report.pdf_name);
            const pdfCount = pdfReports.length;

            setValidationMessage({
                type: "success",
                text: `PDF reports saved (${pdfCount} assets with PDFs). ${sendToConfirmerValidation ? "Sending to Taqeem..." : "Final submission skipped."}`
            });

            const electronResult = await window.electronAPI.elrajhiUploadReport(batchIdFromData, recommendedTabs, true, sendToConfirmerValidation);

            if (electronResult?.status === "SUCCESS") {
                const resultMap = (electronResult.results || []).reduce((acc, res) => {
                    const key = res.record_id || res.recordId;
                    const reportId = res.report_id || res.reportId;
                    if (key && reportId) acc[key] = reportId;
                    return acc;
                }, {});

                if (Object.keys(resultMap).length || (electronResult.results || []).length) {
                    setValidationReports((prev) =>
                        prev.map((r, idx) => {
                            const key = r.record_id || r.recordId || r._id;
                            const fallback = (electronResult.results || [])[idx]?.report_id
                                || (electronResult.results || [])[idx]?.reportId;
                            const reportId = resultMap[key] || r.report_id || fallback;
                            return { ...r, report_id: reportId };
                        })
                    );
                }

                setValidationMessage({
                    type: "success",
                    text: `PDF-only upload succeeded. ${pdfCount} assets with PDFs sent to Taqeem browser.`
                });
            } else {
                setValidationMessage({
                    type: "error",
                    text: electronResult?.error || "PDF-only upload to Taqeem failed. Make sure you selected a company."
                });
            }
        } catch (err) {
            console.error("PDF-only upload failed", err);
            setValidationMessage({
                type: "error",
                text: err.message || "Failed to upload PDF reports"
            });
        } finally {
            setPdfOnlySending(false);
            setCurrentOperationBatchId(null);
        }
    };


    const loadBatchList = async () => {
        try {
            setBatchLoading(true);
            setBatchMessage(null);
            const data = await fetchElrajhiBatches(selectedCompanyOfficeId || null);
            setBatchList(Array.isArray(data?.batches) ? data.batches : []);
            setCurrentPage(1);
        } catch (err) {
            setBatchMessage({
                type: "error",
                text: err?.response?.data?.error || err.message || "Failed to load batches",
            });
        } finally {
            setBatchLoading(false);
        }
    };

    const loadBatchReports = async (batchId) => {
        if (!batchId) return;
        try {
            setBatchLoading(true);
            const data = await fetchElrajhiBatchReports(batchId, selectedCompanyOfficeId || null);
            setBatchReports((prev) => ({
                ...prev,
                [batchId]: Array.isArray(data?.reports) ? data.reports : [],
            }));
        } catch (err) {
            setBatchMessage({
                type: "error",
                text: err?.response?.data?.error || err.message || "Failed to load batch reports",
            });
        } finally {
            setBatchLoading(false);
        }
    };

    const ensureBatchReportsLoaded = async (batchId) => {
        if (!batchId) return [];
        if (batchReports[batchId]?.length) return batchReports[batchId];
        const data = await fetchElrajhiBatchReports(batchId, selectedCompanyOfficeId || null);
        const reports = Array.isArray(data?.reports) ? data.reports : [];
        setBatchReports((prev) => ({
            ...prev,
            [batchId]: reports,
        }));
        return reports;
    };

    const buildCertificateTargets = (reports = []) =>
        reports
            .map((report) => ({
                reportId: report.report_id || report.reportId || "",
                assetName: report.asset_name || report.assetName || report.asset || "",
            }))
            .filter((report) => report.reportId);

    const applyCertificateResults = (results = []) => {
        setCertificateStatusByReport((prev) => {
            const next = { ...prev };
            results.forEach((item) => {
                if (item?.status === "DOWNLOADED" && item?.reportId) {
                    next[item.reportId] = "downloaded";
                }
            });
            return next;
        });
    };

    const waitForTaqeemLogin = async (timeoutMs = 180000, intervalMs = 2000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (!window?.electronAPI?.checkStatus) return true;
            const status = await window.electronAPI.checkStatus();
            const ok =
                status?.browserOpen &&
                String(status?.status || "").toUpperCase().includes("SUCCESS");
            if (ok) return true;
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
        throw new Error("Timed out waiting for Taqeem login.");
    };

    const ensureTaqeemAutomationReady = async () => {
        if (!window?.electronAPI?.checkStatus) return true;

        let status = null;
        try {
            status = await window.electronAPI.checkStatus();
        } catch (err) {
            status = null;
        }

        const statusCode = String(status?.status || "").toUpperCase();
        const isLoggedIn = status?.browserOpen && statusCode.includes("SUCCESS");
        if (isLoggedIn) return true;

        if (!window?.electronAPI?.openTaqeemLogin) {
            throw new Error("Taqeem login handler unavailable.");
        }

        setBatchMessage({
            type: "info",
            text: "Taqeem login required. Opening login window...",
        });

        const loginResult = await window.electronAPI.openTaqeemLogin({
            automationOnly: true,
            onlyIfClosed: false,
            navigateIfOpen: true,
        });

        if (loginResult?.status !== "SUCCESS") {
            throw new Error(loginResult?.error || "Failed to open Taqeem login.");
        }

        await waitForTaqeemLogin();
        return true;
    };

    const attachPdfToReport = async (batchId, report, file) => {
        if (!file) return;
        const targetId = report.report_id || report.reportId || report._id || report.id;
        const reportKey = targetId || report._id || report.id;
        if (!targetId) {
            setBatchMessage({
                type: "error",
                text: "Unable to attach PDF: report identifier is missing.",
            });
            return;
        }

        setPdfUploadBusy((prev) => ({ ...prev, [targetId]: true }));
        setBatchMessage({
            type: "info",
            text: "Uploading PDF...",
        });

        try {
            await updateUrgentReport(targetId, { pdf_path: file.name }, { pdfFile: file });
            await loadBatchReports(batchId);
            setPdfUploadedThisSession((prev) => ({ ...prev, [reportKey]: true }));
            setBatchMessage({
                type: "success",
                text: "PDF attached. You can proceed with actions.",
            });
        } catch (err) {
            setBatchMessage({
                type: "error",
                text: err?.response?.data?.error || err.message || "Failed to attach PDF.",
            });
        } finally {
            setPdfUploadBusy((prev) => {
                const next = { ...prev };
                delete next[targetId];
                return next;
            });
        }
    };

    const pauseBatchActions = async (batchId) => {
        if (!batchId || !window?.electronAPI?.pauseElrajiBatch) return;
        try {
            await window.electronAPI.pauseElrajiBatch(batchId);
            setBatchPaused((prev) => ({ ...prev, [batchId]: true }));
            setBatchMessage({ type: "info", text: `Batch ${batchId} paused.` });
        } catch (err) {
            setBatchMessage({ type: "error", text: err?.message || "Failed to pause batch." });
        }
    };

    const resumeBatchActions = async (batchId) => {
        if (!batchId || !window?.electronAPI?.resumeElrajiBatch) return;
        try {
            await window.electronAPI.resumeElrajiBatch(batchId);
            setBatchPaused((prev) => ({ ...prev, [batchId]: false }));
            setBatchMessage({ type: "info", text: `Batch ${batchId} resumed.` });
        } catch (err) {
            setBatchMessage({ type: "error", text: err?.message || "Failed to resume batch." });
        }
    };

    const stopBatchActions = async (batchId) => {
        if (!batchId || !window?.electronAPI?.stopElrajiBatch) return;
        const confirmed = window.confirm("Stop will terminate the current action and close the browser. Continue?");
        if (!confirmed) return;
        try {
            await window.electronAPI.stopElrajiBatch(batchId);
            setBulkActionBusy(null);
            setActiveBulkActionBatchId((current) => (current === batchId ? null : current));
            setBatchPaused((prev) => ({ ...prev, [batchId]: false }));
            setBatchMessage({ type: "info", text: `Batch ${batchId} stopped.` });
        } catch (err) {
            setBatchMessage({ type: "error", text: err?.message || "Failed to stop batch." });
        }
    };

    const downloadCertificatesForReports = async (batchId, reports, label) => {
        if (!window?.electronAPI?.downloadRegistrationCertificates) {
            setBatchMessage({
                type: "error",
                text: "Desktop integration unavailable. Restart the app.",
            });
            return;
        }

        const targets = buildCertificateTargets(reports);
        if (!targets.length) {
            setBatchMessage({
                type: "info",
                text: "No reports with IDs found to download certificates.",
            });
            return;
        }

        try {
            await ensureTaqeemAutomationReady();
        } catch (err) {
            setBatchMessage({
                type: "error",
                text: err?.message || "Please login to Taqeem in the opened browser.",
            });
            return;
        }

        const folderResult = await window.electronAPI.selectFolder();
        if (!folderResult?.folderPath) {
            setBatchMessage({
                type: "info",
                text: "Folder selection canceled.",
            });
            return;
        }

        const tabsNumValue = Number(recommendedTabs || 1);
        setDownloadingCertificatesBatchId(batchId);
        setBatchMessage({
            type: "info",
            text: `Downloading ${targets.length} certificate(s)${label ? ` for ${label}` : ""}...`,
        });

        try {
            const result = await window.electronAPI.downloadRegistrationCertificates({
                downloadPath: folderResult.folderPath,
                reports: targets,
                tabsNum: tabsNumValue,
            });
            if (result?.status !== "SUCCESS") {
                throw new Error(result?.error || "Certificate download failed");
            }

            if (Array.isArray(result?.results)) {
                applyCertificateResults(result.results);
            }

            const summary = result?.summary || {};
            const downloaded = summary.downloaded ?? 0;
            const failed = summary.failed ?? 0;
            const skipped = summary.skipped ?? 0;

            setBatchMessage({
                type: failed > 0 ? "info" : "success",
                text: `Certificates downloaded: ${downloaded}. Skipped: ${skipped}. Failed: ${failed}.`,
            });
        } catch (err) {
            setBatchMessage({
                type: "error",
                text: err.message || "Failed to download certificates.",
            });
        } finally {
            setDownloadingCertificatesBatchId(null);
        }
    };

    const handleBatchDownloadCertificates = async (batchId) => {
        try {
            const reports = await ensureBatchReportsLoaded(batchId);
            await downloadCertificatesForReports(batchId, reports, `batch ${batchId}`);
        } catch (err) {
            setBatchMessage({
                type: "error",
                text: err?.message || "Failed to prepare batch reports for download.",
            });
        }
    };

    useEffect(() => {
        loadBatchList();
    }, [selectedCompanyOfficeId]);

    const toggleBatchExpand = async (batchId) => {
        if (expandedBatch === batchId) {
            setExpandedBatch(null);
            return;
        }
        setExpandedBatch(batchId);
        if (!batchReports[batchId]) {
            await loadBatchReports(batchId);
        }
    };

    const mergeBatchCheckReports = (reports = [], checkReports = []) => {
        if (!Array.isArray(checkReports) || !checkReports.length) return reports;
        const statusByReportId = new Map();

        checkReports.forEach((item) => {
            const reportId = item?.reportId || item?.report_id || "";
            if (!reportId) return;
            statusByReportId.set(String(reportId), item);
        });

        return reports.map((report) => {
            const reportId = report?.report_id || report?.reportId || "";
            if (!reportId) return report;
            const checkItem = statusByReportId.get(String(reportId));
            if (!checkItem) return report;

            const nextStatus = (checkItem.status || checkItem.reportStatus || checkItem.report_status || "")
                .toString()
                .toUpperCase();
            if (!nextStatus) return report;

            let nextSubmitState = report.submit_state ?? report.submitState;
            if (nextStatus === "INCOMPLETE") {
                nextSubmitState = 0;
            } else if (nextStatus === "NOT_FOUND") {
                nextSubmitState = -1;
            } else {
                nextSubmitState = 1;
            }

            return {
                ...report,
                report_status: nextStatus,
                reportStatus: nextStatus,
                status: nextStatus,
                submit_state: nextSubmitState,
                last_checked_at: checkItem.checkedAt || report.last_checked_at,
            };
        });
    };

    const applyBatchCheckResults = (batches = []) => {
        if (!Array.isArray(batches) || !batches.length) return;

        setBatchReports((prev) => {
            const next = { ...prev };
            batches.forEach((batch) => {
                const batchKey = batch?.batchId || batch?.batch_id;
                if (!batchKey || !next[batchKey]) return;
                const checkReports = Array.isArray(batch?.reports) ? batch.reports : [];
                if (!checkReports.length) return;
                next[batchKey] = mergeBatchCheckReports(next[batchKey], checkReports);
            });
            return next;
        });

        setBatchList((prev) =>
            prev.map((batch) => {
                const checkBatch = batches.find((item) => item?.batchId === batch?.batchId);
                if (!checkBatch) return batch;
                return {
                    ...batch,
                    totalReports: checkBatch.total ?? batch.totalReports,
                    completedReports: checkBatch.complete ?? batch.completedReports,
                    sentReports: checkBatch.sent ?? batch.sentReports,
                    confirmedReports: checkBatch.confirmed ?? batch.confirmedReports,
                };
            })
        );
    };

    const runBatchCheck = async (batchId = null) => {
        await executeWithAuth(
            async (params) => {
                const { token: authToken } = params;

                if (!window?.electronAPI?.checkElrajhiBatches) {
                    throw new Error("Desktop integration unavailable. Restart the app.");
                }
                if (batchId) {
                    setCheckingBatchId(batchId);
                    setCurrentOperationBatchId(batchId);
                } else {
                    setCheckingAllBatches(true);
                }
                setIsPausedBatchCheck(false);
                setBatchMessage({
                    type: "info",
                    text: batchId ? `Checking batch ${batchId}...` : "Checking all batches...",
                });

                try {
                    const result = await window.electronAPI.checkElrajhiBatches(batchId || null, recommendedTabs);
                    if (result?.status !== "SUCCESS") {
                        throw new Error(result?.error || "Check failed");
                    }

                    setBatchMessage({
                        type: "success",
                        text: batchId ? `Check finished for ${batchId}` : "Completed check for all batches",
                    });

                    await loadBatchList();
                    if (batchId) {
                        await loadBatchReports(batchId);
                    } else if (expandedBatch) {
                        await loadBatchReports(expandedBatch);
                    }
                    applyBatchCheckResults(result?.batches);
                } catch (err) {
                    setBatchMessage({
                        type: "error",
                        text: err.message || "Failed to check reports",
                    });
                    throw err;
                } finally {
                    setCheckingBatchId(null);
                    setCheckingAllBatches(false);
                    setCurrentOperationBatchId(null);
                }
            },
            { token },
            {
                requiredPoints: 0, // Check doesn't cost points
                showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
                onViewChange,
                onAuthSuccess: () => {
                    console.log('Batch check authentication successful');
                },
                onAuthFailure: (reason) => {
                    console.warn('Batch check authentication failed:', reason);
                    if (reason !== "INSUFFICIENT_POINTS" && reason !== "LOGIN_REQUIRED") {
                        setBatchMessage({
                            type: "error",
                            text: reason?.message || "Authentication failed for batch check"
                        });
                    }
                }
            }
        );
    };


    const resetMessages = () => {
        setError("");
        setSuccess("");
    };

    const runReportValidationForFile = async (file, target = "main") => {
        if (!file) {
            if (target === "validation") {
                resetValidationCardState();
            } else {
                resetMainValidationState();
            }
            return { issues: [], snapshot: null };
        }

        try {
            const buffer = await file.arrayBuffer();
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);

            const reportSheet = workbook.getWorksheet("Report Info");
            const marketSheet = workbook.getWorksheet("market");

            if (!reportSheet || !marketSheet) {
                const issues = [
                    {
                        field: "Workbook",
                        location: "Sheets",
                        message: "Excel must contain sheets named 'Report Info' and 'market'.",
                    },
                ];
                if (target === "validation") {
                    setValidationReportIssues(issues);
                    setValidationReportSnapshot(null);
                } else {
                    setMainReportIssues(issues);
                    setMainReportSnapshot(null);
                }
                return { issues, snapshot: null };
            }

            const reportRows = worksheetToObjects(reportSheet);
            const marketRows = worksheetToObjects(marketSheet);
            const result = validateReportInfoAndMarket(reportRows[0] || {}, marketRows);

            if (target === "validation") {
                setValidationReportIssues(result.issues);
                setValidationReportSnapshot(result.snapshot);
            } else {
                setMainReportIssues(result.issues);
                setMainReportSnapshot(result.snapshot);
            }
            return result;
        } catch (err) {
            const fallback = [
                {
                    field: "Excel",
                    location: file?.name || "Workbook",
                    message: err?.message || "Failed to read Excel file",
                },
            ];
            if (target === "validation") {
                setValidationReportIssues(fallback);
                setValidationReportSnapshot(null);
            } else {
                setMainReportIssues(fallback);
                setMainReportSnapshot(null);
            }
            return { issues: fallback, snapshot: null };
        }
    };

    const downloadExcelFile = async (path, setBusy, setMessage) => {
        if (!path) return;
        try {
            setBusy(true);
            const response = await httpClient.get(path, { responseType: "blob" });
            const disposition = response.headers["content-disposition"] || "";
            const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
            const filename = match && match[1] ? match[1] : "updated.xlsx";
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", filename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Failed to download Excel", err);
            if (setMessage) {
                setMessage({
                    type: "error",
                    text: "Failed to download updated Excel. Please try again.",
                });
            } else {
                setError("Failed to download updated Excel");
            }
        } finally {
            setBusy(false);
        }
    };

    const handleDownloadTemplate = async () => {
        if (downloadingTemplate) return;
        setError("");
        setSuccess("");
        setDownloadingTemplate(true);
        try {
            await downloadTemplateFile("AlrajhiBank-template.xlsx");
            setSuccess("Excel template downloaded successfully.");
        } catch (err) {
            const message = err?.message || "Failed to download Excel template. Please try again.";
            setError(
                message.includes("not found")
                    ? "Template file not found. Please contact administrator to ensure the template file exists in the public folder."
                    : message
            );
        } finally {
            setDownloadingTemplate(false);
        }
    };

    const clearFileInput = (inputRef) => {
        if (inputRef?.current) {
            inputRef.current.value = null;
        }
    };

    const handleExcelChange = async (e) => {
        resetMessages();
        resetMainValidationState();
        setBatchId("");
        setExcelResult(null);
        setDownloadPath(null);
        const file = e.target.files?.[0];
        setExcelFile(file || null);
        setRememberedFiles((prev) => ({
            ...prev,
            mainExcel: file ? file.name : null,
        }));
        if (file) {
            await runReportValidationForFile(file, "main");
        }
        clearFileInput(mainExcelInputRef);
    };

    const handlePdfsChange = (e) => {
        resetMessages();
        const files = Array.from(e.target.files || []);
        setPdfFiles(files);
        setRememberedFiles((prev) => ({
            ...prev,
            mainPdfs: files.map((f) => f.name),
        }));
        clearFileInput(mainPdfInputRef);
    };

    const resetValidationBanner = () => setValidationMessage(null);

    const parseExcelForValidation = async (excel, pdfList = [], options = {}) => {
        const { silent = false } = options;

        if (!excel) {
            setMarketAssets([]);
            setValidationReports([]);
            if (!silent) {
                setValidationMessage({
                    type: "error",
                    text: "Select an Excel file before saving.",
                });
            }
            return null;
        }

        if (!silent) resetValidationBanner();
        setLoadingValuers(true);
        try {
            const buffer = await excel.arrayBuffer();
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);

            const reportSheet = workbook.getWorksheet("Report Info");
            const marketSheet = workbook.getWorksheet("market");
            if (!marketSheet || !reportSheet) {
                throw new Error("Excel must include sheets named 'Report Info' and 'market'.");
            }

            const marketRows = worksheetToObjects(marketSheet);
            if (!marketRows.length) {
                throw new Error("Sheet 'market' has no rows.");
            }

            const reportRows = worksheetToObjects(reportSheet);
            const reportValidation = validateReportInfoAndMarket(reportRows[0] || {}, marketRows);
            setValidationReportIssues(reportValidation.issues);
            setValidationReportSnapshot(reportValidation.snapshot);

            const pdfMap = {};
            pdfList.forEach((file) => {
                const base = file.name.replace(/\.pdf$/i, "");
                pdfMap[normalizeKey(base)] = file.name;
            });

            const valuerColumns = detectValuerColumns(marketRows[0] || {});
            const hasValuerColumns = valuerColumns.hasValuerColumns;
            const assets = [];
            const invalidTotals = [];

            for (let i = 0; i < marketRows.length; i++) {
                const row = marketRows[i];
                if (!row.asset_name) continue;

                const valuers = hasValuerColumns ? buildValuersForAsset(row, valuerColumns) : [];
                const hasValuerData = valuers.length > 0;
                const totalPct = hasValuerData ? sumValuerPercentages(valuers) : null;

                if (hasValuerData && Math.abs((totalPct || 0) - 100) > 0.001) {
                    invalidTotals.push({
                        assetName: row.asset_name,
                        rowNumber: i + 2,
                        total: totalPct,
                    });
                }

                const pdf_name = pdfMap[normalizeKey(row.asset_name)] || null;

                assets.push({
                    asset_name: row.asset_name,
                    client_name: row.client_name || row.owner_name || "",
                    pdf_name,
                    valuers,
                    hasValuerData,
                    totalPercentage: totalPct,
                });
            }

            if (!assets.length) {
                throw new Error("No assets with asset_name found in 'market' sheet.");
            }

            const reports = assets.map((asset, idx) => ({
                id: `${asset.asset_name}-${idx}`,
                asset_name: asset.asset_name,
                client_name: asset.client_name || "Pending client",
                pdf_name: asset.pdf_name,
                valuers: asset.valuers,
                hasValuerData: asset.hasValuerData,
                totalPercentage: asset.totalPercentage,
            }));

            setMarketAssets(assets);
            setValidationReports(reports);

            const matchedCount = reports.filter((r) => !!r.pdf_name).length;
            const hasAnyValuerData = assets.some((asset) => asset.hasValuerData);

            if (!silent) {
                if (reportValidation.issues.length) {
                    setValidationMessage({
                        type: "error",
                        text: `Found ${reportValidation.issues.length} validation issue(s). Review the table below.`,
                    });
                } else if (invalidTotals.length) {
                    const firstInvalid = invalidTotals[0];
                    setValidationMessage({
                        type: "error",
                        text: `Found ${invalidTotals.length} asset(s) with invalid totals. Example: Asset "${firstInvalid.assetName}" (row ${firstInvalid.rowNumber}) totals ${firstInvalid.total}%. Must be 100%.`,
                    });
                } else {
                    const valuerNote = hasAnyValuerData ? "" : " No valuer data found in Excel.";
                    setValidationMessage({
                        type: "success",
                        text: `Loaded ${assets.length} asset(s). Matched ${matchedCount} PDF(s) by asset name.${valuerNote} Report info looks valid.`,
                    });
                }
            }

            return {
                assets,
                matchedCount,
                invalidTotals,
                reportIssues: reportValidation.issues,
                reportSnapshot: reportValidation.snapshot,
            };
        } catch (err) {
            setMarketAssets([]);
            setValidationReports([]);
            resetValidationCardState();
            if (!silent) {
                setValidationMessage({
                    type: "error",
                    text: err.message || "Failed to read Excel.",
                });
            }
            return null;
        } finally {
            setLoadingValuers(false);
        }
    };

    const sendToTaqeem = async () => {
        await executeWithAuth(
            async (params) => {
                try {
                    const { token: authToken } = params;
                    resetMessages();
                    setSendingTaqeem(true);
                    setIsPausedMain(false);

                    if (!excelFile) {
                        throw new Error("Please select an Excel file before sending.");
                    }
                    if (!pdfFiles.length) {
                        throw new Error("Please select PDF files before sending.");
                    }

                    const mainValidation = await runReportValidationForFile(excelFile, "main");
                    if (mainValidation?.issues?.length) {
                        throw new Error(`Found ${mainValidation.issues.length} validation issue(s) in the Excel file. Review the table below.`);
                    }
                    // ---- Build multipart/form-data ----
                    const formData = new FormData();
                    formData.append("excel", excelFile);
                    pdfFiles.forEach((file) => {
                        formData.append("pdfs", file);
                    });

                    const response = await axios.post(
                        "http://localhost:3000/api/upload",
                        formData,
                        {
                            headers: {
                                "Content-Type": "multipart/form-data",
                            },
                        }
                    );

                    const payloadFromApi = response.data;

                    if (payloadFromApi.status !== "success") {
                        throw new Error(
                            payloadFromApi.error || "Upload API returned non-success status."
                        );
                    }

                    const insertedCount = payloadFromApi.inserted || 0;
                    const docs = payloadFromApi.data || [];
                    const batchIdFromApi = payloadFromApi.batchId || "urgent-upload";

                    setBatchId(batchIdFromApi);
                    setCurrentOperationBatchId(batchIdFromApi);
                    setExcelResult({
                        batchId: batchIdFromApi,
                        reports: docs.map((d) => ({
                            asset_name: d.asset_name,
                            client_name: d.client_name,
                            path_pdf: d.pdf_path,
                            record_id: d._id || d.id || d.record_id || null,
                        })),
                        source: "system",
                    });
                    setDownloadPath(`/elrajhi-upload/export/${batchIdFromApi}`);

                    setSuccess(
                        `Upload complete. Inserted ${insertedCount} urgent assets into DB. ${sendToConfirmerMain ? "Sending to Taqeem..." : "Final submission skipped."}`
                    );

                    const electronResult = await window.electronAPI.elrajhiUploadReport(batchIdFromApi, recommendedTabs, false, sendToConfirmerMain);

                    if (electronResult?.status === "SUCCESS") {
                        const resultMap = (electronResult.results || []).reduce((acc, res) => {
                            const key = res.record_id || res.recordId;
                            const reportId = res.report_id || res.reportId;
                            if (key && reportId) {
                                acc[key] = reportId;
                            }
                            return acc;
                        }, {});

                        if (Object.keys(resultMap).length || (electronResult.results || []).length) {
                            setExcelResult((prev) => {
                                if (!prev) return prev;
                                const reports = (prev.reports || []).map((r, idx) => {
                                    const key = r.record_id || r.recordId || r._id;
                                    const fallbackFromOrder = (electronResult.results || [])[idx]?.report_id
                                        || (electronResult.results || [])[idx]?.reportId;
                                    const reportId = resultMap[key] || r.report_id || fallbackFromOrder;
                                    return { ...r, report_id: reportId };
                                });
                                return { ...prev, reports };
                            });
                        }

                        setSuccess(
                            `Upload succeeded. ${insertedCount} assets saved and dispatched to Taqeem tabs${sendToConfirmerMain ? "" : " (final submit skipped)"}.`
                        );
                    } else {
                        const errMsg = electronResult?.error || "Upload to Taqeem failed. Make sure you selected a company.";
                        throw new Error(errMsg);
                    }

                } catch (err) {
                    const msg =
                        err?.response?.data?.message ||
                        err.message ||
                        "Failed to send to Taqeem";
                    setError(msg);
                    throw err;
                } finally {
                    setSendingTaqeem(false);
                    setCurrentOperationBatchId(null);
                }
            },
            { token, excelFile, pdfFiles, sendToConfirmerMain },
            {
                requiredPoints: pdfFiles.length || 0,
                showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
                onViewChange,
                onAuthSuccess: () => {
                    console.log('Taqeem upload authentication successful');
                },
                onAuthFailure: (reason) => {
                    console.warn('Taqeem upload authentication failed:', reason);
                    if (reason !== "INSUFFICIENT_POINTS" && reason !== "LOGIN_REQUIRED") {
                        setError(reason?.message || "Authentication failed");
                    }
                }
            }
        );
    };

    const handleValidationExcelChange = async (e) => {
        resetValidationBanner();
        resetValidationCardState();
        setValidationReports([]);
        setMarketAssets([]);
        setValidationDownloadPath(null);
        const files = Array.from(e.target.files || []);
        const excel = files[0] || null;
        setValidationExcelFile(excel);
        setRememberedFiles((prev) => ({
            ...prev,
            validationExcel: excel ? excel.name : null,
        }));
        if (excel) {
            await ensureCompanyValuersLoaded("validation");
            await openValuerModal("validation");
        }
        clearFileInput(validationExcelInputRef);
    };

    const openValidationPdfPicker = () => {
        if (!validationPdfInputRef.current) return;
        validationPdfInputRef.current.value = null;
        validationPdfInputRef.current.click();
    };

    const handleValidationPdfsChange = (e) => {
        resetValidationBanner();
        setValidationReports([]);
        setMarketAssets([]);
        setValidationDownloadPath(null);
        const files = Array.from(e.target.files || []);
        if (files.length) {
            setWantsPdfUpload(true);
        } else {
            setWantsPdfUpload(false);
        }
        setValidationPdfFiles(files);
        setRememberedFiles((prev) => ({
            ...prev,
            validationPdfs: files.map((file) => file.name),
        }));
        clearFileInput(validationPdfInputRef);
    };

    const handlePdfToggle = (checked) => {
        setWantsPdfUpload(checked);
        if (!checked) {
            setValidationPdfFiles([]);
            setRememberedFiles((prev) => ({
                ...prev,
                validationPdfs: [],
            }));
        } else {
            openValidationPdfPicker();
        }
    };

    const hasAnyValuerData = marketAssets.some((a) => a.hasValuerData);
    const allAssetsTotalsValid = marketAssets.every(
        (a) => !a.hasValuerData || Math.abs((a.totalPercentage || 0) - 100) < 0.001
    );
    const valuerTotalsLabel = hasAnyValuerData
        ? allAssetsTotalsValid
            ? "OK"
            : "Check"
        : "No valuer data";
    const canSendReports = marketAssets.length > 0
        && allAssetsTotalsValid
        && !loadingValuers
        && !validationReportIssues.length;
    const pdfReportCount = validationReports.filter((report) => report.pdf_name).length;
    const canSendPdfOnly = canSendReports && wantsPdfUpload && pdfReportCount > 0;

    const resetValidationSection = () => {
        resetValidationFlow();
        setValidationExcelFile(null);
        setValidationPdfFiles([]);
        setSendToConfirmerValidation(false);
        setIsPausedValidation(false);
        setIsPausedPdfOnly(false);
        setWantsPdfUpload(false);
        resetValidationCardState();
        resetValidationBanner();
        setShowValidationModal(false);
        clearFileInput(validationExcelInputRef);
        clearFileInput(validationPdfInputRef);
    };

    const registerValidationSelection = async () => {
        resetValidationBanner();

        if (!validationExcelFile) {
            setValidationReports([]);
            setMarketAssets([]);
            setValidationDownloadPath(null);
            setValidationMessage({
                type: "error",
                text: "Select an Excel file before validation.",
            });
            setShowValidationModal(true);
            return;
        }
        if (wantsPdfUpload && !validationPdfFiles.length) {
            setValidationReports([]);
            setMarketAssets([]);
            setValidationDownloadPath(null);
            setValidationMessage({
                type: "error",
                text: "Add at least one PDF file or disable PDF upload.",
            });
            setShowValidationModal(true);
            return;
        }

        setSavingValidation(true);
        try {
            const parseResult = await parseExcelForValidation(
                validationExcelFile,
                wantsPdfUpload ? validationPdfFiles : [],
                { silent: false }
            );

            if (!parseResult) return;

            const { assets, matchedCount, reportIssues = [], reportSnapshot = null } = parseResult;

            setValidationReportIssues(reportIssues);
            setValidationReportSnapshot(reportSnapshot);

            if (!assets.length) {
                setValidationMessage({
                    type: "error",
                    text: "No assets found in the Excel file.",
                });
                return;
            }

            if (reportIssues.length) {
                setValidationMessage({
                    type: "error",
                    text: `Found ${reportIssues.length} validation issue(s). Review the details below before sending.`,
                });
                return;
            }

            const hasInvalidTotals = assets.some(
                (asset) => asset.hasValuerData && Math.abs((asset.totalPercentage || 0) - 100) > 0.001
            );

            if (hasInvalidTotals) {
                setValidationMessage({
                    type: "error",
                    text: "Valuer percentages must total 100% for every asset with valuer data before saving.",
                });
                return;
            }

            const pdfCount = wantsPdfUpload ? validationPdfFiles.length : 0;
            const valuerNote = assets.some((asset) => asset.hasValuerData)
                ? ""
                : " No valuer data found in Excel.";
            const pdfNote = wantsPdfUpload ? ` and ${pdfCount} PDF(s)` : "";

            setValidationMessage({
                type: "success",
                text: `Files staged. Found ${assets.length} asset(s)${pdfNote}. Matched ${matchedCount} PDF(s) by asset name.${valuerNote} Report info is valid.`,
            });
        } finally {
            setSavingValidation(false);
            setShowValidationModal(true);
        }
    };

    useEffect(() => {
        if (!validationExcelFile) return;
        registerValidationSelection();
    }, [validationExcelFile, validationPdfFiles, wantsPdfUpload]);

    const clearAll = () => {
        resetAllFiles();
        resetMainFlow();
        setSendToConfirmerMain(false);
        setIsPausedMain(false);
        resetMessages();
        resetMainValidationState();
        clearFileInput(mainExcelInputRef);
        clearFileInput(mainPdfInputRef);
    };

    // Control button component for pause/resume/stop
    const ControlButtons = ({ isPaused, isRunning, onPause, onResume, onStop, disabled = false }) => (
        <div className="flex gap-2">
            {!isPaused && isRunning && (
                <button
                    type="button"
                    onClick={onPause}
                    disabled={disabled}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-50"
                >
                    <Pause className="w-4 h-4" />
                    Pause
                </button>
            )}
            {isPaused && (
                <button
                    type="button"
                    onClick={onResume}
                    disabled={disabled}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50"
                >
                    <Play className="w-4 h-4" />
                    Resume
                </button>
            )}
            {isRunning && (
                <button
                    type="button"
                    onClick={onStop}
                    disabled={disabled}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
                >
                    <Square className="w-4 h-4" />
                    Stop
                </button>
            )}
        </div>
    );

    const ValidationResultsCard = ({ title, issues = [], snapshot }) => {
        if (!snapshot && !issues.length) return null;

        const fields = [
            { label: "Purpose of Valuation", value: snapshot?.purpose },
            { label: "Value Attributes", value: snapshot?.valueAttributes },
            { label: "Report", value: snapshot?.reportType },
            { label: "Client Name", value: snapshot?.clientName },
            { label: "Client Telephone", value: snapshot?.telephone },
            { label: "Client Email", value: snapshot?.email },
            { label: "Date of Valuation", value: snapshot?.valuedAt ? formatDateForDisplay(snapshot.valuedAt) : "" },
            { label: "Report Issuing Date", value: snapshot?.submittedAt ? formatDateForDisplay(snapshot.submittedAt) : "" },
        ];

        return (
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
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
                <div className="px-4 py-3 border-b flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Table className="w-4 h-4 text-blue-600" />
                        <p className="text-sm font-semibold text-gray-900">{title}</p>
                    </div>
                    <span
                        className={`text-xs font-semibold px-2 py-1 rounded-full border ${issues.length
                            ? "bg-red-50 text-red-700 border-red-100"
                            : "bg-emerald-50 text-emerald-700 border-emerald-100"
                            }`}
                    >
                        {issues.length ? `${issues.length} issue(s)` : "No issues found"}
                    </span>
                </div>
                <div className="p-4 space-y-3">
                    {snapshot ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            {fields.map((field) => (
                                <div
                                    key={field.label}
                                    className="p-2 rounded-md bg-slate-50 border border-slate-100"
                                >
                                    <p className="font-semibold text-gray-800">{field.label}</p>
                                    <p className="text-gray-700 break-words">{field.value || "—"}</p>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {issues.length ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-xs">
                                <thead className="bg-red-50 text-red-700">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Field</th>
                                        <th className="px-3 py-2 text-left">Location</th>
                                        <th className="px-3 py-2 text-left">Details</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {issues.map((issue, idx) => (
                                        <tr key={`${issue.field}-${idx}`} className="border-t bg-red-50">
                                            <td className="px-3 py-2 font-semibold text-red-800">{issue.field}</td>
                                            <td className="px-3 py-2 text-red-700">{issue.location || "—"}</td>
                                            <td className="px-3 py-2 text-red-700">{issue.message}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-sm text-emerald-700">
                            <CheckCircle2 className="w-4 h-4" />
                            All required fields look good.
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const selectionKey = (batchId, report) => {
        const reportId = report?.report_id || report?.reportId || "";
        const recordId = report?.id || report?._id || report?.record_id || report?.recordId || "";
        const assetKey = report?.asset_name || report?.assetName || report?.asset_id || "";
        const keyCore = reportId || recordId || assetKey || "unknown";
        return `${batchId || "batch"}::${keyCore}`;
    };

    const isSelected = (batchId, report) => selectedReports.has(selectionKey(batchId, report));

    const toggleReportSelection = (batchId, report, checked) => {
        setSelectedReports((prev) => {
            const next = new Set(prev);
            const key = selectionKey(batchId, report);
            if (checked) {
                next.add(key);
            } else {
                next.delete(key);
            }
            return next;
        });
    };

    const toggleSelectAllForBatch = (batchId, reports = [], checked) => {
        setSelectedReports((prev) => {
            const next = new Set(prev);
            reports.forEach((r) => {
                const key = selectionKey(batchId, r);
                if (checked) {
                    next.add(key);
                } else {
                    next.delete(key);
                }
            });
            return next;
        });
    };

    const handleBulkAction = async (action, batchId, reports = []) => {
        const selected = reports.filter((r) => isSelected(batchId, r));
        if (!selected.length) {
            setBatchMessage({
                type: "info",
                text: "Select at least one report first.",
            });
            return;
        }

        const readableAction =
            action === "retry-submit"
                ? "Retry submit"
                : action === "delete"
                    ? "Delete"
                    : action === "retry"
                        ? "Retry"
                        : action === "send"
                            ? "Finalize"
                            : action === "approve"
                                ? "Approve"
                                : "Download certificates";

        // Common function for actions that require authentication
        const executeAuthenticatedAction = async (actionFunc, actionName, requiredPoints = 1) => {
            return await executeWithAuth(
                async (params) => {
                    const { token: authToken } = params;
                    return await actionFunc(authToken);
                },
                { token },
                {
                    requiredPoints: requiredPoints,
                    showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
                    onViewChange,
                    onAuthSuccess: () => {
                        console.log(`${actionName} authentication successful`);
                    },
                    onAuthFailure: (reason) => {
                        console.warn(`${actionName} authentication failed:`, reason);
                        if (reason !== "INSUFFICIENT_POINTS" && reason !== "LOGIN_REQUIRED") {
                            setBatchMessage({
                                type: "error",
                                text: reason?.message || `Authentication failed for ${actionName.toLowerCase()}`
                            });
                        }
                        throw reason;
                    }
                }
            );
        };

        setBulkActionBusy(action);
        setActiveBulkActionBatchId(batchId);
        setBatchPaused((prev) => ({ ...prev, [batchId]: false }));
        setBatchMessage({
            type: "info",
            text: `${readableAction} in progress for ${selected.length} report(s)...`,
        });

        try {
            if (action === "retry-submit") {
                await executeAuthenticatedAction(async (authToken) => {
                    if (!window?.electronAPI?.createReportById) {
                        throw new Error("Desktop integration unavailable. Restart the app.");
                    }

                    const recordIds = Array.from(
                        new Set(
                            selected
                                .map((report) => report.id || report._id || report.record_id || report.recordId)
                                .filter((id) => id && String(id).trim() !== "")
                        )
                    );

                    if (recordIds.length === 0) {
                        throw new Error("No valid report record IDs found in selected reports");
                    }

                    if (!window?.electronAPI?.retryElrajhiReportRecordIds) {
                        throw new Error("Desktop integration unavailable. Restart the app.");
                    }

                    const result = await window.electronAPI.retryElrajhiReportRecordIds(
                        recordIds,
                        recommendedTabs
                    );
                    if (result?.status !== "SUCCESS") {
                        throw new Error(result?.error || "Retry submit failed");
                    }

                    await loadBatchReports(batchId);
                    await loadBatchList();

                    return `Retry submit completed for ${recordIds.length} report(s).`;
                }, "Retry submit", selected.length);

                setBatchMessage({
                    type: "success",
                    text: `Retry submit completed for ${selected.length} report(s).`,
                });
            } else if (action === "delete") {
                // Extract report IDs for the selected reports
                const reportIds = selected
                    .map((report) => report.report_id || report.reportId)
                    .filter((id) => id && String(id).trim() !== "");

                if (reportIds.length === 0) {
                    throw new Error("No valid report IDs found in selected reports");
                }

                // Use the new deleteMultipleReports function
                const result = await window.electronAPI.deleteMultipleReports(reportIds, 10);
                if (result?.status !== "SUCCESS") {
                    throw new Error(result?.error || "Delete multiple reports failed");
                }

                // Refresh data
                await loadBatchReports(batchId);
                await loadBatchList();

                setBatchMessage({
                    type: "success",
                    text: `Deleted ${reportIds.length} report(s) successfully`,
                });

            } else if (action === "retry") {
                await executeAuthenticatedAction(async (authToken) => {
                    const reportIds = selected
                        .map((report) => report.report_id || report.reportId)
                        .filter((id) => id && String(id).trim() !== "");

                    if (reportIds.length === 0) {
                        throw new Error("No valid report IDs found in selected reports");
                    }

                    // Use the new retryElrajhiReportReportIds function
                    const result = await window.electronAPI.retryElrajhiReportReportIds(reportIds, recommendedTabs);
                    if (result?.status !== "SUCCESS") {
                        throw new Error(result?.error || "Retry multiple reports failed");
                    }

                    // Refresh data
                    await loadBatchReports(batchId);
                    await loadBatchList();

                    return `Retry completed for ${reportIds.length} report(s)`;
                }, "Retry", selected.length);

                setBatchMessage({
                    type: "success",
                    text: `Retry completed for ${selected.length} report(s)`,
                });

            } else if (action === "send") {
                await executeAuthenticatedAction(async (authToken) => {
                    const reportIds = selected
                        .map((report) => report.report_id || report.reportId)
                        .filter((id) => id && String(id).trim() !== "");

                    if (reportIds.length === 0) {
                        throw new Error("No valid report IDs found in selected reports");
                    }

                    // Use the new finalizeMultipleReports function
                    const result = await window.electronAPI.finalizeMultipleReports(reportIds);
                    if (result?.status !== "SUCCESS") {
                        throw new Error(result?.error || "Finalize multiple reports failed");
                    }

                    // Refresh data
                    await loadBatchReports(batchId);
                    await loadBatchList();

                    return `Finalized ${reportIds.length} report(s) successfully`;
                }, "Finalize", selected.length);

                setBatchMessage({
                    type: "success",
                    text: `Finalized ${selected.length} report(s) successfully`,
                });

            } else if (action === "approve") {
                // Approve requires authentication
                await executeAuthenticatedAction(async (authToken) => {
                    // Implement approve logic here
                    throw new Error("Approve via single-report automation is not wired to desktop integration yet.");
                }, "Approve", selected.length);

            } else if (action === "certificate") {
                // Certificate download doesn't require authentication, but we'll wrap it anyway
                const reportIds = selected
                    .map((report) => report.report_id || report.reportId)
                    .filter((id) => id && String(id).trim() !== "");

                if (reportIds.length === 0) {
                    throw new Error("No valid report IDs found in selected reports");
                }
                await downloadCertificatesForReports(batchId, selected, "selected reports");
            }
        } catch (err) {
            // Only show error if it's not an auth failure (those are handled in onAuthFailure)
            if (!err?.message?.includes("INSUFFICIENT_POINTS") && !err?.message?.includes("LOGIN_REQUIRED")) {
                setBatchMessage({
                    type: "error",
                    text: err?.message || `Failed to ${readableAction.toLowerCase()} selected report(s).`,
                });
            }
        } finally {
            setBulkActionBusy(null);
            setActiveBulkActionBatchId((current) => (current === batchId ? null : current));
            setActionMenuOpen(false);
            setActionMenuBatch(null);
            setBatchPaused((prev) => ({ ...prev, [batchId]: false }));

            // Clear selection after bulk action
            setSelectedReports(new Set());
        }
    };

    // pagination helpers
    const totalBatchPages = Math.max(1, Math.ceil((batchList.length || 0) / pageSize));
    const currentPageSafe = Math.min(Math.max(currentPage, 1), totalBatchPages);
    const batchPageStart = (currentPageSafe - 1) * pageSize;
    const displayedBatches = batchList.slice(batchPageStart, batchPageStart + pageSize);

    const reportInfoFields = [
        { label: "Purpose of Valuation", value: validationReportSnapshot?.purpose },
        { label: "Value Attributes", value: validationReportSnapshot?.valueAttributes },
        { label: "Report", value: validationReportSnapshot?.reportType },
        { label: "Client Name", value: validationReportSnapshot?.clientName },
        { label: "Client Telephone", value: validationReportSnapshot?.telephone },
        { label: "Client Email", value: validationReportSnapshot?.email },
        {
            label: "Date of Valuation",
            value: validationReportSnapshot?.valuedAt ? formatDateForDisplay(validationReportSnapshot.valuedAt) : "",
        },
        {
            label: "Report Issuing Date",
            value: validationReportSnapshot?.submittedAt ? formatDateForDisplay(validationReportSnapshot.submittedAt) : "",
        },
    ];

    const reportInfoFieldLabels = reportInfoFields.map((field) => field.label);
    const reportInfoIssuesByField = validationReportIssues.reduce((acc, issue) => {
        const key = issue.field || "General";
        if (!acc[key]) acc[key] = [];
        acc[key].push(issue);
        return acc;
    }, {});
    const extraReportInfoIssues = validationReportIssues.filter(
        (issue) => !reportInfoFieldLabels.includes(issue.field)
    );
    const hasReportInfoData = Boolean(validationReportSnapshot) || validationReportIssues.length > 0;

    const getValidationSummary = () => {
        if (!validationExcelFile) {
            return { type: "info", text: "Upload Excel file to validate." };
        }
        if (validationReportIssues.length) {
            return {
                type: "error",
                text: `Excel has ${validationReportIssues.length} issue(s). Fix them before upload.`,
            };
        }
        if (validationMessage?.type === "error") {
            return { type: "error", text: validationMessage.text };
        }
        if (validationMessage?.type === "success") {
            return { type: "success", text: validationMessage.text };
        }
        return { type: "success", text: "Excel validated. No issues found." };
    };

    const validationSummary = getValidationSummary();

    const validationSummarySection = (
        <div className="rounded-xl border border-blue-900/10 bg-white p-3 shadow-sm">
            <div className="text-[11px] font-semibold text-blue-900 mb-1">Validation on Excel</div>
            <div
                className={`rounded-lg border px-3 py-2 inline-flex items-start gap-2 text-[11px] ${validationSummary.type === "error"
                    ? "bg-rose-50 text-rose-700 border-rose-100"
                    : validationSummary.type === "success"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                        : "bg-blue-50 text-blue-700 border-blue-100"
                    }`}
            >
                {validationSummary.type === "error" ? (
                    <AlertTriangle className="w-4 h-4 mt-0.5" />
                ) : validationSummary.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 mt-0.5" />
                ) : (
                    <Info className="w-4 h-4 mt-0.5" />
                )}
                <div className="text-[11px]">{validationSummary.text}</div>
            </div>
        </div>
    );

    const validationConsole = (
        <div className="rounded-2xl border border-blue-900/15 bg-white shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-blue-900 via-slate-900 to-blue-900 px-2 py-2 text-white">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-1">
                        <p className="text-[11px] font-semibold">Validation console</p>
                    </div>
                    {validationDownloadPath && (
                        <button
                            type="button"
                            onClick={() => downloadExcelFile(validationDownloadPath, setDownloadingValidationExcel, setValidationMessage)}
                            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold text-white hover:bg-white/20 disabled:opacity-60"
                            disabled={downloadingValidationExcel}
                        >
                            {downloadingValidationExcel ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Download className="w-4 h-4" />
                            )}
                            {downloadingValidationExcel ? "Preparing..." : "Download updated Excel"}
                        </button>
                    )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold">
                    <div className="inline-flex rounded-full bg-white/10 p-0.5">
                        <button
                            type="button"
                            onClick={() => setValidationTableTab("report-info")}
                            className={`px-3 py-1 rounded-full transition ${validationTableTab === "report-info"
                                ? "bg-white text-blue-900 shadow-sm"
                                : "text-blue-100 hover:text-white"
                                }`}
                        >
                            Report Info validation
                        </button>
                        <button
                            type="button"
                            onClick={() => setValidationTableTab("pdf-assets")}
                            className={`px-3 py-1 rounded-full transition ${validationTableTab === "pdf-assets"
                                ? "bg-white text-blue-900 shadow-sm"
                                : "text-blue-100 hover:text-white"
                                }`}
                        >
                            Validate PDFs & assets data
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsValidationTableCollapsed((prev) => !prev)}
                        className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/15 px-2.5 py-1 text-[10px] font-semibold text-white/90 shadow-sm backdrop-blur transition hover:bg-white/25 hover:text-white"
                    >
                        {isValidationTableCollapsed ? (
                            <ChevronDown className="w-3 h-3" />
                        ) : (
                            <ChevronUp className="w-3 h-3" />
                        )}
                        {isValidationTableCollapsed ? "Show table" : "Hide table"}
                    </button>
                </div>
            </div>
            <div className="p-2 space-y-1">
                {validationMessage && (
                    <div
                        className={`rounded-lg border px-2 py-1 inline-flex items-start gap-1 text-[10px] ${validationMessage.type === "error"
                            ? "bg-rose-50 text-rose-700 border-rose-100"
                            : validationMessage.type === "success"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                : "bg-blue-50 text-blue-700 border-blue-100"
                            }`}
                    >
                        {validationMessage.type === "error" ? (
                            <AlertTriangle className="w-4 h-4 mt-0.5" />
                        ) : validationMessage.type === "success" ? (
                            <CheckCircle2 className="w-4 h-4 mt-0.5" />
                        ) : (
                            <Info className="w-4 h-4 mt-0.5" />
                        )}
                        <div className="text-[10px]">{validationMessage.text}</div>
                    </div>
                )}

                {validationTableTab === "report-info" ? (
                    <div className="space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                            <div className="text-[10px] font-semibold text-blue-900">Report Info status</div>
                            <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${validationReportIssues.length
                                    ? "bg-rose-50 text-rose-700 border-rose-100"
                                    : "bg-emerald-50 text-emerald-700 border-emerald-100"
                                    }`}
                            >
                                {validationReportIssues.length ? `${validationReportIssues.length} issue(s)` : "All fields OK"}
                            </span>
                        </div>
                        {hasReportInfoData ? (
                            isValidationTableCollapsed ? (
                                <div className="flex items-center gap-1 text-[10px] text-blue-900/70">
                                    <ChevronDown className="w-3 h-3" />
                                    Table hidden.
                                </div>
                            ) : (
                                <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
                                    <table className="min-w-full text-[10px] leading-tight border-separate border-spacing-0">
                                        <thead className="text-[10px] uppercase tracking-wide text-white/90">
                                            <tr>
                                                <th className="px-2 py-1 bg-blue-900/95 text-left rounded-l-lg">Field</th>
                                                <th className="px-2 py-1 bg-blue-900/95 text-left">Value</th>
                                                <th className="px-2 py-1 bg-blue-900/95 text-left">Status</th>
                                                <th className="px-2 py-1 bg-blue-900/95 text-left rounded-r-lg">Notes</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {reportInfoFields.map((field) => {
                                                const fieldIssues = reportInfoIssuesByField[field.label] || [];
                                                const hasIssue = fieldIssues.length > 0;
                                                const hasFieldValue = hasValue(field.value);
                                                const statusLabel = hasIssue ? "Issue" : hasFieldValue ? "OK" : "Missing";
                                                const statusTone = hasIssue
                                                    ? "bg-rose-50 text-rose-700 border-rose-200"
                                                    : hasFieldValue
                                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                                        : "bg-amber-50 text-amber-700 border-amber-200";
                                                const notesText = hasIssue
                                                    ? fieldIssues.map((issue) => issue.message).join(" / ")
                                                    : hasFieldValue
                                                        ? "Looks good"
                                                        : "Missing in Excel";
                                                return (
                                                    <tr key={field.label}>
                                                        <td className="px-2 py-1 bg-white border border-blue-900/10 rounded-l-lg font-semibold text-blue-900">
                                                            {field.label}
                                                        </td>
                                                        <td className="px-2 py-1 bg-white border border-blue-900/10 text-blue-900/90">
                                                            {hasFieldValue ? field.value : "N/A"}
                                                        </td>
                                                        <td className="px-2 py-1 bg-white border border-blue-900/10">
                                                            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${statusTone}`}>
                                                                {statusLabel}
                                                            </span>
                                                        </td>
                                                        <td className="px-2 py-1 bg-white border border-blue-900/10 rounded-r-lg text-blue-900/80">
                                                            {notesText}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {extraReportInfoIssues.map((issue, idx) => (
                                                <tr key={`issue-extra-${idx}`}>
                                                    <td className="px-2 py-1 bg-white border border-blue-900/10 rounded-l-lg font-semibold text-blue-900">
                                                        {issue.field || "Issue"}
                                                    </td>
                                                    <td className="px-2 py-1 bg-white border border-blue-900/10 text-blue-900/90">
                                                        {issue.location || "Report Info"}
                                                    </td>
                                                    <td className="px-2 py-1 bg-white border border-blue-900/10">
                                                        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                                                            Issue
                                                        </span>
                                                    </td>
                                                    <td className="px-2 py-1 bg-white border border-blue-900/10 rounded-r-lg text-blue-900/80">
                                                        {issue.message}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        ) : null}
                    </div>
                ) : (
                    <div className="space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                            <div className="text-[10px] font-semibold text-blue-900">PDFs & assets validation</div>
                            <div className="flex flex-wrap items-center gap-1 text-[10px] font-semibold">
                                <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-blue-900">
                                    Assets: {validationReports.length}
                                </span>
                                <span
                                    className={`rounded-full border px-2 py-0.5 ${validationReports.length
                                        ? "border-blue-100 bg-white text-blue-900"
                                        : "border-blue-100 bg-blue-50 text-blue-700"
                                        }`}
                                >
                                    PDF matches: {validationReports.length ? `${pdfReportCount}/${validationReports.length}` : "0"}
                                </span>
                                <span
                                    className={`rounded-full border px-2 py-0.5 ${hasAnyValuerData
                                        ? allAssetsTotalsValid
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                            : "border-rose-200 bg-rose-50 text-rose-700"
                                        : "border-blue-100 bg-blue-50 text-blue-700"
                                        }`}
                                >
                                    Valuer totals: {valuerTotalsLabel}
                                </span>
                            </div>
                        </div>
                        {loadingValuers && (
                            <div className="flex items-center gap-1 text-[10px] text-blue-900/70">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Reading valuers from Excel...
                            </div>
                        )}
                        {validationReports.length ? (
                            isValidationTableCollapsed ? (
                                <div className="flex items-center gap-1 text-[10px] text-blue-900/70">
                                    <ChevronDown className="w-3 h-3" />
                                    Table hidden.
                                </div>
                            ) : (
                                <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
                                    <table className="min-w-full text-[10px] leading-tight border-separate border-spacing-0">
                                        <thead className="text-[10px] uppercase tracking-wide text-white/90">
                                            <tr>
                                                <th className="px-2 py-1 bg-blue-900/95 text-left rounded-l-lg">#</th>
                                                <th className="px-2 py-1 bg-blue-900/95 text-left">Asset name</th>
                                                <th className="px-2 py-1 bg-blue-900/95 text-left">PDF match</th>
                                                <th className="px-2 py-1 bg-blue-900/95 text-left">Client name</th>
                                                <th className="px-2 py-1 bg-blue-900/95 text-left">Valuers (ID / Name / %)</th>
                                                <th className="px-2 py-1 bg-blue-900/95 text-left">Total %</th>
                                                <th className="px-2 py-1 bg-blue-900/95 text-left rounded-r-lg">Report ID</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {validationReports.map((report, idx) => {
                                                const hasValuerData = report.hasValuerData || (report.valuers || []).length > 0;
                                                const totalPct = hasValuerData ? Number(report.totalPercentage ?? 0) : null;
                                                const totalValid = !hasValuerData || Math.abs((totalPct || 0) - 100) < 0.001;
                                                const totalTone = hasValuerData
                                                    ? totalValid
                                                        ? "text-emerald-700"
                                                        : "text-rose-700"
                                                    : "text-slate-500";
                                                return (
                                                    <tr key={report.id || `${report.asset_name}-${idx}`}>
                                                        <td className="px-2 py-1 bg-white border border-blue-900/10 rounded-l-lg text-blue-900/80">
                                                            {idx + 1}
                                                        </td>
                                                        <td className="px-2 py-1 bg-white border border-blue-900/10 font-semibold text-blue-900">
                                                            {report.asset_name || `Asset ${idx + 1}`}
                                                        </td>
                                                        <td className="px-2 py-1 bg-white border border-blue-900/10">
                                                            {report.pdf_name ? (
                                                                <div className="inline-flex items-center gap-2 text-emerald-700">
                                                                    <FileIcon className="w-4 h-4" />
                                                                    <span className="font-semibold text-[10px]">{report.pdf_name}</span>
                                                                </div>
                                                            ) : (
                                                                <span className="text-[10px] text-slate-500">No matching PDF</span>
                                                            )}
                                                        </td>
                                                        <td className="px-2 py-1 bg-white border border-blue-900/10 text-blue-900/80">
                                                            {report.client_name || "Pending"}
                                                        </td>
                                                        <td className="px-2 py-1 bg-white border border-blue-900/10">
                                                            <div className="flex flex-wrap gap-1 text-[10px]">
                                                                {(report.valuers || []).length ? (
                                                                    (report.valuers || []).map((v, vIdx) => (
                                                                        <span
                                                                            key={`${report.id}-valuer-${vIdx}`}
                                                                            className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-blue-900"
                                                                        >
                                                                            <span className="font-semibold">{v.valuerId || "N/A"}</span>
                                                                            <span>{v.valuerName || "N/A"}</span>
                                                                            <span>({Number(v.percentage ?? 0)}%)</span>
                                                                        </span>
                                                                    ))
                                                                ) : (
                                                                    <span className="text-[10px] text-slate-400">N/A</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-2 py-1 bg-white border border-blue-900/10">
                                                            <span className={`font-semibold text-[10px] ${totalTone}`}>
                                                                {hasValuerData ? `${totalPct}%` : "N/A"}
                                                            </span>
                                                        </td>
                                                        <td className="px-2 py-1 bg-white border border-blue-900/10 rounded-r-lg">
                                                            {report.report_id ? (
                                                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                                                    <CheckCircle2 className="w-3 h-3" />
                                                                    {report.report_id}
                                                                </span>
                                                            ) : (
                                                                <span className="text-[10px] text-slate-400">Pending</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );

    const validationContent = (
        <div className="space-y-1.5">
            <div className="space-y-1">
                <div className="rounded-2xl border border-blue-900/15 bg-white shadow-sm p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border border-blue-900/15 bg-white/90 cursor-pointer hover:bg-blue-50 transition min-w-[170px] flex-[0.85]">
                            <div className="flex items-center gap-2 text-[10px] text-blue-900">
                                <FolderOpen className="w-4 h-4" />
                                <span className="font-semibold">
                                    {validationExcelFile
                                        ? validationExcelFile.name
                                        : rememberedFiles.validationExcel
                                            ? `Last: ${rememberedFiles.validationExcel}`
                                            : "Choose Excel file"}
                                </span>
                            </div>
                            <input
                                ref={validationExcelInputRef}
                                type="file"
                                accept=".xlsx,.xls"
                                className="hidden"
                                onChange={handleValidationExcelChange}
                                onClick={(e) => {
                                    e.currentTarget.value = null;
                                }}
                            />
                            <span className="text-[10px] font-semibold text-blue-900">Browse</span>
                        </label>
                        <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border border-blue-900/15 bg-white/90 transition hover:bg-blue-50 min-w-[230px] flex-[1.35]">
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-blue-900">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 text-blue-900 border-blue-500 focus:ring-blue-600"
                                    checked={wantsPdfUpload}
                                    onChange={(e) => handlePdfToggle(e.target.checked)}
                                />
                                <Files className="w-4 h-4" />
                                <span className="font-semibold">Upload PDFs</span>
                                <span dir="rtl" className="text-[9px] text-blue-800/70 leading-snug">
                                    هل تريد الحاق ملفات pdf ام تريد استخدام ملفات مؤقته
                                </span>
                                <span className="text-[10px] text-blue-800/80">
                                    {validationPdfFiles.length
                                        ? `${validationPdfFiles.length} file(s) selected`
                                        : rememberedFiles.validationPdfs.length
                                            ? `Last: ${rememberedFiles.validationPdfs.length} PDF(s)`
                                            : "Choose PDF files"}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => handlePdfToggle(true)}
                                className="text-[10px] font-semibold text-blue-900 hover:text-blue-800"
                            >
                                Browse
                            </button>
                            <input
                                ref={validationPdfInputRef}
                                type="file"
                                multiple
                                accept=".pdf"
                                className="hidden"
                                onChange={handleValidationPdfsChange}
                                onClick={(e) => {
                                    e.currentTarget.value = null;
                                }}
                            />
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={handleDownloadTemplate}
                                disabled={downloadingTemplate}
                                className="inline-flex items-center gap-1.5 rounded-md border border-blue-900/20 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {downloadingTemplate ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Download className="w-4 h-4" />
                                )}
                                {downloadingTemplate ? "Downloading..." : "Export Excel Template"}
                            </button>
                            <button
                                type="button"
                                onClick={resetValidationSection}
                                className="inline-flex items-center gap-2 rounded-md border border-blue-900/20 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-blue-900 hover:bg-blue-50"
                            >
                                <RefreshCw className="w-4 h-4" />
                                Reset
                            </button>
                        </div>
                    </div>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-blue-900/15 mb-2 bg-gradient-to-br from-blue-50/70 via-white to-blue-50/40 p-2 shadow-sm">
                    <div className="absolute -right-10 -top-8 h-24 w-24 rounded-full bg-blue-900/10 blur-2xl" />
                    <div className="relative flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={handleSubmitElrajhi}
                                disabled={sendingValidation || !canSendReports}
                                className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[10px] font-semibold hover:bg-emerald-700 disabled:opacity-50"
                            >
                                {sendingValidation ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Send className="w-4 h-4" />
                                )}
                                Send all reports
                            </button>
                            {sendingValidation && (
                                <ControlButtons
                                    isPaused={isPausedValidation}
                                    isRunning={sendingValidation}
                                    onPause={handlePauseValidation}
                                    onResume={handleResumeValidation}
                                    onStop={handleStopValidation}
                                />
                            )}
                            <button
                                type="button"
                                onClick={handleSubmitPdfOnly}
                                disabled={pdfOnlySending || !canSendPdfOnly}
                                className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-blue-900 text-white text-[10px] font-semibold hover:bg-blue-800 disabled:opacity-50"
                            >
                                {pdfOnlySending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Files className="w-4 h-4" />
                                )}
                                Send only reports with PDFs
                            </button>
                            {pdfOnlySending && (
                                <ControlButtons
                                    isPaused={isPausedPdfOnly}
                                    isRunning={pdfOnlySending}
                                    onPause={handlePausePdfOnly}
                                    onResume={handleResumePdfOnly}
                                    onStop={handleStopPdfOnly}
                                />
                            )}

                            <label className="inline-flex items-center gap-2 px-2 py-1 rounded-lg border border-blue-900/15 bg-white/80 text-[10px] font-semibold text-blue-900 flex min-w-[240px]">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 text-blue-900 border-blue-500 focus:ring-blue-600"
                                    checked={sendToConfirmerValidation}
                                    onChange={(e) => setSendToConfirmerValidation(e.target.checked)}
                                />
                                <span>
                                    Do you want to send the report to the confirmer? / هل تريد ارسال التقارير الي المعتمد مباشرة ؟
                                </span>
                            </label>
                        </div>
                        {validationReportIssues.length ? (
                            <div className="flex items-center gap-2 text-[10px] text-rose-600">
                                <AlertTriangle className="w-4 h-4" />
                                Resolve the report info issues above to enable sending.
                            </div>
                        ) : null}
                    </div>
                </div>

            </div>

        </div>
    );

    const validationModal = showValidationModal ? (
        <div
            className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto px-4 py-6"
            onClick={() => setShowValidationModal(false)}
        >
            <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />
            <div
                className="relative w-full max-w-5xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="rounded-2xl border border-blue-900/20 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.35)]">
                    <div className="flex items-center justify-between border-b border-blue-900/10 bg-slate-50 px-4 py-3">
                        <div className="text-sm font-semibold text-blue-900">Validation results</div>
                        <button
                            type="button"
                            onClick={() => setShowValidationModal(false)}
                            className="text-[10px] font-semibold text-blue-900 hover:text-blue-700"
                        >
                            Close
                        </button>
                    </div>
                    <div className="max-h-[70vh] overflow-y-auto p-3">
                        {validationConsole}
                    </div>
                </div>
            </div>
        </div>
    ) : null;

    const noValidationContent = (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 border border-slate-200 rounded-xl bg-white shadow-sm space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-1 text-[11px] font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-100">Step 1</span>
                        <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                        <h3 className="text-sm font-semibold text-gray-900">
                            Upload Excel (Report Info + market)
                        </h3>
                    </div>
                    <label className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition">
                        <div className="flex items-center gap-2 text-sm text-gray-800">
                            <FolderOpen className="w-4 h-4" />
                            <span>
                                {excelFile
                                    ? excelFile.name
                                    : rememberedFiles.mainExcel
                                        ? `Last: ${rememberedFiles.mainExcel}`
                                        : "Choose Excel file"}
                            </span>
                        </div>
                        <input
                            ref={mainExcelInputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            className="hidden"
                            onChange={handleExcelChange}
                            onClick={(e) => {
                                e.currentTarget.value = null;
                            }}
                        />
                        <span className="text-xs text-blue-600 font-semibold">Browse</span>
                    </label>
                    <div className="flex items-center justify-end text-xs">
                        <button
                            onClick={clearAll}
                            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-100 text-gray-700 text-xs font-semibold hover:bg-slate-200"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Reset
                        </button>
                    </div>
                </div>

                <div className="p-4 border border-slate-200 rounded-xl bg-white shadow-sm space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-1 text-[11px] font-semibold rounded-full bg-purple-50 text-purple-700 border border-purple-100">Step 2</span>
                        <Files className="w-5 h-5 text-purple-600" />
                        <h3 className="text-sm font-semibold text-gray-900">
                            Upload PDFs (match by asset_name)
                        </h3>
                    </div>
                    <label className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition">
                        <div className="flex items-center gap-2 text-sm text-gray-800">
                            <FolderOpen className="w-4 h-4" />
                            <span>
                                {pdfFiles.length
                                    ? `${pdfFiles.length} file(s) selected`
                                    : rememberedFiles.mainPdfs.length
                                        ? `Last: ${rememberedFiles.mainPdfs.length} PDF(s)`
                                        : "Choose PDF files"}
                            </span>
                        </div>
                        <input
                            ref={mainPdfInputRef}
                            type="file"
                            multiple
                            accept=".pdf"
                            className="hidden"
                            onChange={handlePdfsChange}
                            onClick={(e) => {
                                e.currentTarget.value = null;
                            }}
                        />
                        <span className="text-xs text-blue-600 font-semibold">Browse</span>
                    </label>
                    <div className="grid grid-cols-[auto,1fr] gap-y-2 gap-x-3 items-center">
                        <label className="text-xs font-semibold text-gray-700 col-span-2">
                            Tabs configuration:
                        </label>
                        <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-md border border-slate-200">
                            <Table className="w-4 h-4 text-blue-600" />
                            <span className="text-sm font-semibold text-gray-800">
                                {recommendedTabs} tab{recommendedTabs !== 1 ? 's' : ''}
                            </span>
                            <span className="text-xs text-gray-600 ml-2">
                                (auto-configured)
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                setPdfFiles([]);
                                resetMessages();
                            }}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-slate-100 text-gray-700 text-sm hover:bg-slate-200"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Clear PDFs
                        </button>
                    </div>
                </div>
            </div>

            {(error || success) && (
                <div
                    className={`rounded-xl p-3 flex items-start gap-2 border ${error
                        ? "bg-red-50 text-red-700 border-red-100"
                        : "bg-emerald-50 text-emerald-700 border-emerald-100"
                        }`}
                >
                    {error ? (
                        <AlertTriangle className="w-4 h-4 mt-0.5" />
                    ) : (
                        <CheckCircle2 className="w-4 h-4 mt-0.5" />
                    )}
                    <div className="text-sm">{error || success}</div>
                </div>
            )}

            {(mainReportSnapshot || mainReportIssues.length) ? (
                <ValidationResultsCard
                    title="Report Info validation"
                    issues={mainReportIssues}
                    snapshot={mainReportSnapshot}
                />
            ) : null}

            <div className="mt-3 space-y-3">
                <label className="inline-flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                    <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 text-amber-600 border-amber-400 focus:ring-amber-500"
                        checked={sendToConfirmerMain}
                        onChange={(e) => setSendToConfirmerMain(e.target.checked)}
                    />
                    <span className="text-sm text-gray-800 font-semibold leading-5">
                        Do you want to send the report to the confirmer? / هل تريد ارسال التقرير الي المعتمد ؟
                    </span>
                </label>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={sendToTaqeem}
                        disabled={sendingTaqeem || !excelFile || !pdfFiles.length || mainReportIssues.length > 0}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {sendingTaqeem ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Send className="w-4 h-4" />
                        )}
                        Send to Taqeem
                    </button>
                    {mainReportIssues.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-red-600">
                            <AlertTriangle className="w-4 h-4" />
                            Resolve the report info issues above to enable sending.
                        </div>
                    )}
                    {sendingTaqeem && (
                        <ControlButtons
                            isPaused={isPausedMain}
                            isRunning={sendingTaqeem}
                            onPause={handlePauseMain}
                            onResume={handleResumeMain}
                            onStop={handleStopMain}
                        />
                    )}
                </div>
            </div>

            {excelResult?.reports?.length ? (
                <div className="bg-white border rounded-lg shadow-sm">
                    <div className="px-4 py-3 border-b flex items-center gap-2 justify-between">
                        <div className="flex items-center gap-2">
                            <Info className="w-4 h-4 text-blue-600" />
                            <div>
                                <p className="text-sm font-semibold text-gray-800">
                                    Created Reports
                                </p>
                                <p className="text-xs text-gray-500">
                                    Batch: {excelResult.batchId}
                                </p>
                                {excelResult.source === "system" && (
                                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded">
                                        <CheckCircle2 className="w-3 h-3" />
                                        Reports created from system upload
                                    </p>
                                )}
                            </div>
                        </div>
                        {downloadPath && (
                            <button
                                type="button"
                                onClick={async () => {
                                    if (downloadingExcel) return;
                                    try {
                                        setDownloadingExcel(true);
                                        const response = await httpClient.get(downloadPath, {
                                            responseType: "blob",
                                        });

                                        const disposition = response.headers["content-disposition"] || "";
                                        const match = disposition.match(/filename="?([^"]+)"?/);
                                        const filename = match && match[1] ? match[1] : "updated.xlsx";

                                        const url = window.URL.createObjectURL(new Blob([response.data]));
                                        const link = document.createElement("a");
                                        link.href = url;
                                        link.setAttribute("download", filename);
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                        window.URL.revokeObjectURL(url);
                                    } catch (err) {
                                        console.error("Failed to download updated Excel", err);
                                        setError("Failed to download updated Excel");
                                    } finally {
                                        setDownloadingExcel(false);
                                    }
                                }}
                                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
                                disabled={downloadingExcel}
                            >
                                {downloadingExcel ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Download className="w-4 h-4" />
                                )}
                                {downloadingExcel ? "Preparing..." : "Download updated Excel"}
                            </button>
                        )}
                    </div>
                    <div className="mt-2 mb-1 text-sm font-semibold text-blue-900 flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                            {batchList.length || 0}
                        </span>
                        Batches
                    </div>
                    <div className="mb-2">
                        {validationSummarySection}
                    </div>
                    <div className="mb-1 text-xs text-blue-900/80 font-semibold">All batches</div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr className="text-left text-gray-600">
                                    <th className="px-4 py-2">#</th>
                                    <th className="px-4 py-2">Asset Name</th>
                                    <th className="px-4 py-2">Client Name</th>
                                    <th className="px-4 py-2">PDF Path</th>
                                    <th className="px-4 py-2">Report ID</th>
                                </tr>
                            </thead>
                            <tbody>
                                {excelResult.reports.map((r, idx) => (
                                    <tr key={`${r.asset_name}-${idx}`} className="border-t">
                                        <td className="px-4 py-2 text-gray-700">{idx + 1}</td>
                                        <td className="px-4 py-2 text-gray-900 font-medium">
                                            {r.asset_name}
                                        </td>
                                        <td className="px-4 py-2 text-gray-800">{r.client_name}</td>
                                        <td className="px-4 py-2 text-gray-600">
                                            {r.path_pdf ? (
                                                <span className="inline-flex items-center gap-1 text-green-700">
                                                    <FileIcon className="w-4 h-4" />
                                                    {r.pdf_path || r.path_pdf}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">Not uploaded</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2 text-gray-700">
                                            {r.report_id ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-800 border border-emerald-100">
                                                    <CheckCircle2 className="w-3 h-3" />
                                                    {r.report_id}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">Pending from Taqeem</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    No results yet.
                </div>
            )}
        </div>
    );

    const checkReportsContent = (
        <div className="space-y-1.5 text-[10px]">
            {batchMessage && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
                    <div
                        className={`w-full max-w-md rounded-xl border shadow-lg p-4 relative ${batchMessage.type === "error"
                            ? "bg-red-50 border-red-100 text-red-700"
                            : batchMessage.type === "success"
                                ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                                : "bg-blue-50 border-blue-100 text-blue-700"
                            }`}
                    >
                        <button
                            type="button"
                            className="absolute top-2 right-2 text-xs text-slate-500 hover:text-slate-700"
                            onClick={() => setBatchMessage(null)}
                            aria-label="Close alert"
                        >
                            ×
                        </button>
                        <div className="flex items-start gap-2">
                            {batchMessage.type === "error" ? (
                                <AlertTriangle className="w-4 h-4 mt-0.5" />
                            ) : batchMessage.type === "success" ? (
                                <CheckCircle2 className="w-4 h-4 mt-0.5" />
                            ) : (
                                <Info className="w-4 h-4 mt-0.5" />
                            )}
                            <div className="text-[11px] leading-relaxed">{batchMessage.text}</div>
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-white border border-blue-900/15 rounded-2xl shadow-sm overflow-hidden">
                {batchLoading && !batchList.length ? (
                    <div className="p-3 flex items-center gap-2 text-[10px] text-blue-900/70">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-900" />
                        Loading batches...
                    </div>
                ) : batchList.length ? (
                    <div className="overflow-x-auto">
                        <div className="mb-1 text-xs font-semibold text-blue-900 flex items-center gap-2">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
                                {batchList.length || 0}
                            </span>
                            All batches
                        </div>
                        <table className="min-w-full text-[10px] leading-tight">
                            <thead className="bg-blue-900/95 text-white/90">
                                <tr>
                                    <th className="px-1.5 py-0.5 text-left">Local</th>
                                    <th className="px-1.5 py-0.5 text-left">Batch ID</th>
                                    <th className="px-1.5 py-0.5 text-left">Reports</th>
                                    <th className="px-1.5 py-0.5 text-left">With report ID</th>
                                    <th className="px-1.5 py-0.5 text-left">Complete</th>
                                    <th className="px-1.5 py-0.5 text-left"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedBatches.map((batch, idx) => {
                                    const isExpanded = expandedBatch === batch.batchId;
                                    const sent = batch.sentReports || 0;
                                    const confirmed = batch.confirmedReports || 0;
                                    const completed = batch.completedReports || 0;
                                    const total = batch.totalReports || 0;
                                    const isCheckingThisBatch = checkingBatchId === batch.batchId;
                                    const isRetryingThisBatch = retryingBatchId === batch.batchId;
                                    const localNumber = batchList.length - (batchPageStart + idx);
                                    const hasReportsData = Object.prototype.hasOwnProperty.call(batchReports, batch.batchId);
                                    const reportsForBatch = batchReports[batch.batchId] || [];
                                    const filteredReports = statusFilterByBatch[batch.batchId]
                                        ? reportsForBatch.filter((r) => computeReportStatus(r) === statusFilterByBatch[batch.batchId])
                                        : reportsForBatch;
                                    const selectableReports = filteredReports.filter((r) => !shouldBlockActionsForMissingId(r));
                                    const hasSelection = selectableReports.some((r) => isSelected(batch.batchId, r));
                                    const isBulkActionRunning = activeBulkActionBatchId === batch.batchId && Boolean(bulkActionBusy);
                                    const showBulkActionControls = isBulkActionRunning || batchPaused[batch.batchId];
                                    const batchProgressValue = computeBatchProgress(reportsForBatch);
                                    const showHeaderProgress = isBulkActionRunning;
                                    return (
                                        <React.Fragment key={batch.batchId}>
                                            <tr className="border-b border-blue-900/10 last:border-0">
                                                <td className="px-1.5 py-0.5 text-blue-900/80">{localNumber}</td>
                                                <td className="px-1.5 py-0.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleBatchExpand(batch.batchId)}
                                                        className="inline-flex items-center gap-2 text-left text-[10px] font-semibold text-blue-900"
                                                    >
                                                        {isExpanded ? (
                                                            <ChevronDown className="w-4 h-4 text-blue-900/60" />
                                                        ) : (
                                                            <ChevronRight className="w-4 h-4 text-blue-900/60" />
                                                        )}
                                                        <span>{batch.batchId}</span>
                                                    </button>
                                                    {batch.excelName ? (
                                                        <p className="text-[10px] text-blue-900/60 ml-6">
                                                            {batch.excelName}
                                                        </p>
                                                    ) : null}
                                                </td>
                                                <td className="px-1.5 py-0.5 text-blue-900/80">
                                                    {total}
                                                </td>
                                                <td className="px-1.5 py-0.5 text-blue-900/80">
                                                    {batch.withReportId || 0}/{total || 0}
                                                </td>
                                                <td className="px-1.5 py-0.5 text-blue-900/80">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-900 border border-blue-100">
                                                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                                            {completed}/{total} done
                                                        </span>
                                                        {sent ? (
                                                            <span className="inline-flex items-center gap-2 rounded-full bg-white px-2 py-0.5 text-[10px] text-blue-700 border border-blue-100">
                                                                <Send className="w-3 h-3" />
                                                                {sent} sent
                                                            </span>
                                                        ) : null}
                                                        {confirmed ? (
                                                            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 border border-emerald-100">
                                                                <CheckCircle2 className="w-3 h-3" />
                                                                {confirmed} confirmed
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td className="px-1.5 py-0.5 text-right">
                                                    <div className="flex gap-1.5 justify-end items-center">
                                                        {/* Batch Actions Dropdown */}
                                                        <div className="relative">
                                                            <select
                                                                value={batchActionDropdown[batch.batchId] || ""}
                                                                onChange={(e) => {
                                                                    const action = e.target.value;
                                                                    setBatchActionDropdown(prev => ({
                                                                        ...prev,
                                                                        [batch.batchId]: action
                                                                    }));
                                                                }}
                                                                disabled={batchActionLoading[batch.batchId] || isCheckingThisBatch || isRetryingThisBatch}
                                                                className="px-2 py-1 border border-gray-300 rounded-md text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 cursor-pointer appearance-none bg-white min-w-[130px]"
                                                            >
                                                                <option value="">Select Action</option>
                                                                <option value="check-status">Check Status</option>
                                                                <option value="approve-reports">Approve Reports</option>
                                                                <option value="download-certificates">Download Certificates</option>
                                                                <option value="retry-batch">Retry Batch</option>
                                                            </select>

                                                            {/* Dropdown arrow */}
                                                            <div className="absolute inset-y-0 right-0 flex items-center pr-1 pointer-events-none">
                                                                <ChevronDown className="w-3 h-3 text-gray-400" />
                                                            </div>
                                                        </div>

                                                        {/* Go Button */}
                                                        <button
                                                            onClick={() => {
                                                                const action = batchActionDropdown[batch.batchId];
                                                                if (action) {
                                                                    handleBatchAction(batch.batchId, action);
                                                                }
                                                            }}
                                                            disabled={!batchActionDropdown[batch.batchId] || batchActionLoading[batch.batchId] || isCheckingThisBatch || isRetryingThisBatch}
                                                            className="px-2 py-1 bg-blue-600 text-white text-[10px] font-semibold rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed min-w-[40px]"
                                                        >
                                                            {batchActionLoading[batch.batchId] ? (
                                                                <Loader2 className="w-3 h-3 animate-spin mx-auto" />
                                                            ) : (
                                                                "Go"
                                                            )}
                                                        </button>

                                                        {/* Control buttons for retry action */}
                                                        {isRetryingThisBatch && (
                                                            <ControlButtons
                                                                isPaused={isPausedBatchRetry}
                                                                isRunning={isRetryingThisBatch}
                                                                onPause={() => handlePauseBatchRetry(batch.batchId)}
                                                                onResume={() => handleResumeBatchRetry(batch.batchId)}
                                                                onStop={() => handleStopBatchRetry(batch.batchId)}
                                                            />
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr className="border-b border-blue-900/10 last:border-0">
                                                    <td colSpan={6} className="bg-blue-50/40">
                                                        <div className="p-2">
                                                        {hasReportsData ? (
                                                            <div className="overflow-x-auto rounded-xl border border-blue-900/15 bg-white mt-[3px] mb-[3px]">
                                                                <div className="px-2 py-2 text-[11px] font-semibold text-blue-900 flex items-center gap-2">
                                                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
                                                                        {filteredReports.length}
                                                                    </span>
                                                                    Reports
                                                                </div>
                                                                    <table className="min-w-full text-[10px] leading-tight">
                                                                        <thead className="bg-blue-900/95 text-white/90">
                                                                            <tr>
                                                                                <th className="px-2 py-1 text-left">Report</th>
                                                                                <th className="px-2 py-1 text-left">Client</th>
                                                                                <th className="px-2 py-1 text-left">Asset</th>
                                                                                <th className="px-2 py-1 text-left">Status</th>
                                                                                <th className="px-2 py-1 text-left">Certificate</th>
                                                                                <th className="px-2 py-1 text-left">
                                                                                    <div className="flex items-center gap-2 flex-wrap justify-between w-full">
                                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                                            <div className="flex items-center gap-2 bg-white/10 rounded-md px-2 py-1">
                                                                                                <input
                                                                                                    type="checkbox"
                                                                                                    className="h-3.5 w-3.5"
                                                                                                    checked={
                                                                                                        selectableReports.length
                                                                                                            ? selectableReports.every((r) =>
                                                                                                                isSelected(batch.batchId, r)
                                                                                                            )
                                                                                                            : false
                                                                                                    }
                                                                                                    onChange={(e) => {
                                                                                                            if (!selectableReports.length) {
                                                                                                                setBatchMessage({ type: "info", text: requirePdfMessage });
                                                                                                                return;
                                                                                                            }
                                                                                                            toggleSelectAllForBatch(
                                                                                                                batch.batchId,
                                                                                                                selectableReports || [],
                                                                                                                e.target.checked
                                                                                                            );
                                                                                                    }}
                                                                                                />
                                                                                                <span className="text-[10px] font-semibold text-white/90">Select all</span>
                                                                                            </div>
                                                                                            <select
                                                                                                value={statusFilterByBatch[batch.batchId] || ""}
                                                                                                onChange={(e) => {
                                                                                                    const value = e.target.value || "";
                                                                                                    setStatusFilterByBatch((prev) => ({
                                                                                                        ...prev,
                                                                                                        [batch.batchId]: value || undefined,
                                                                                                    }));
                                                                                                }}
                                                                                                className="px-2 py-1 text-black border border-gray-200 rounded-md text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-200 focus:border-blue-200 cursor-pointer appearance-none bg-white min-w-[110px]"
                                                                                                >
                                                                                                    <option value="">All statuses</option>
                                                                                                    <option value="MISSING_ID">Missing ID</option>
                                                                                                    <option value="INCOMPLETE">Incomplete</option>
                                                                                                    <option value="COMPLETE">Complete</option>
                                                                                                    <option value="SENT">Sent</option>
                                                                                                    <option value="CONFIRMED">Confirmed</option>
                                                                                                    <option value="DELETED">Deleted</option>
                                                                                                </select>
                                                                                            <div className="flex items-center gap-1 bg-white/10 rounded-md px-2 py-1">
                                                                                                <div className="relative">
                                                                                                    <select
                                                                                                        value={selectedBulkActions[batch.batchId] || ""}
                                                                                                        onChange={(e) => {
                                                                                                            setSelectedBulkActions(prev => ({
                                                                                                                ...prev,
                                                                                                                [batch.batchId]: e.target.value
                                                                                                            }));
                                                                                                        }}
                                                                                                        disabled={bulkActionBusy}
                                                                                                        className="px-2 py-1 text-black border border-gray-200 rounded-md text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-200 focus:border-blue-200 cursor-pointer appearance-none bg-white min-w-[120px]"
                                                                                                    >
                                                                                                        <option value="">Select Bulk Action</option>
                                                                                                        <option value="retry-submit">Retry Submit</option>
                                                                                                        <option value="delete">Delete Reports</option>
                                                                                                        {/* <option value="retry">Retry</option> */}
                                                                                                        <option value="send">Send to Approver</option>
                                                                                                        <option value="approve">Approve</option>
                                                                                                        <option value="certificate">Download Certificate</option>
                                                                                                    </select>
                                                                                                    <div className="absolute inset-y-0 right-0 flex items-center pr-1 pointer-events-none">
                                                                                                        <ChevronDown className="w-3 h-3 text-gray-400" />
                                                                                                    </div>
                                                                                                </div>
                                                                                                <button
                                                                                                    onClick={() => {
                                                                                                        const selectedAction = selectedBulkActions[batch.batchId];
                                                                                                        if (selectedAction) {
                                                                                                            handleBulkAction(selectedAction, batch.batchId, batchReports[batch.batchId] || []);
                                                                                                            setSelectedBulkActions(prev => ({
                                                                                                                ...prev,
                                                                                                                [batch.batchId]: ""
                                                                                                            }));
                                                                                                        }
                                                                                                    }}
                                                                                                    disabled={!selectedBulkActions[batch.batchId] || bulkActionBusy || !hasSelection}
                                                                                                    title={!hasSelection ? "Select at least one report first." : undefined}
                                                                                                    className={`px-2 py-1 bg-white text-blue-700 border border-blue-200 text-[10px] font-semibold rounded-md hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed min-w-[38px] ${!hasSelection ? "opacity-50" : ""}`}
                                                                                                >
                                                                                                    {bulkActionBusy ? (
                                                                                                        <Loader2 className="w-3 h-3 animate-spin mx-auto" />
                                                                                                    ) : (
                                                                                                        "Go"
                                                                                                    )}
                                                                                                </button>
                                                                                                {showBulkActionControls && (
                                                                                                    <ControlButtons
                                                                                                        isPaused={!!batchPaused[batch.batchId]}
                                                                                                        isRunning={isBulkActionRunning || batchPaused[batch.batchId]}
                                                                                                        onPause={() => pauseBatchActions(batch.batchId)}
                                                                                                        onResume={() => resumeBatchActions(batch.batchId)}
                                                                                                        onStop={() => stopBatchActions(batch.batchId)}
                                                                                                    />
                                                                                                )}
                                                                                            </div>
                                                                                        </div>
                                                                                        {showHeaderProgress && (
                                                                                            <div className="flex items-center gap-2 ml-auto min-w-[160px]">
                                                                                                <div className="h-2 flex-1 bg-white/20 rounded-full overflow-hidden">
                                                                                                    <div
                                                                                                        className="h-full bg-emerald-300 transition-all duration-500"
                                                                                                        style={{ width: `${batchProgressValue}%` }}
                                                                                                    ></div>
                                                                                                </div>
                                                                                                <span className="text-[10px] font-semibold text-white/90">{batchProgressValue}%</span>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                </th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {filteredReports.map((report) => {
                                                                                const reportId = report.report_id || report.reportId || "";
                                                                                const reportKey = reportId || report._id || report.id;
                                                                                const status = computeReportStatus(report);
                                                                                const needsPdfBeforeActions = shouldBlockActionsForMissingId(report);
                                                                                const showUploadPdf = status === "MISSING_ID";
                                                                
                                                                                const certificateStatus =
                                                                                    certificateStatusByReport[reportId] === "downloaded"
                                                                                        ? "downloaded"
                                                                                        : "not_downloaded";

                                                                                return (
                                                                                    <tr key={report.id || reportId || report.asset_name} className="border-t last:border-0">
                                                                                        <td className="px-2.5 py-1.5 text-gray-900 font-semibold">
                                                                                            {reportId || <span className="text-gray-500">Not created</span>}
                                                                                        </td>
                                                                                        <td className="px-2.5 py-1.5 text-gray-800">{report.client_name || "—"}</td>
                                                                                        <td className="px-2.5 py-1.5 text-gray-800">{report.asset_name || "—"}</td>
                                                                                        <td className="px-2.5 py-1.5">
                                                                                            {/* Status display remains the same */}
                                                                                            <div className="flex flex-col gap-1">
                                                                                                {status === "COMPLETE" ? (
                                                                                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 border border-emerald-100 text-xs">
                                                                                                        <CheckCircle2 className="w-3 h-3" />
                                                                                                        Complete
                                                                                                    </span>
                                                                                                ) : status === "DELETED" ? (
                                                                                                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-red-700 border border-red-100 text-xs">
                                                                                                        <Trash2 className="w-3 h-3" />
                                                                                                        Deleted
                                                                                                    </span>)
                                                                                                    : status === "SENT" ? (
                                                                                                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-blue-700 border border-blue-100 text-xs">
                                                                                                            <Send className="w-3 h-3" />
                                                                                                            Sent
                                                                                                        </span>
                                                                                                    ) : status === "CONFIRMED" ? (
                                                                                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 border border-emerald-100 text-xs">
                                                                                                            <CheckCircle2 className="w-3 h-3" /> Confirmed

                                                                                                        </span>
                                                                                                    )
                                                                                                        : status === "CONFIRMED" ? (
                                                                                                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 border border-emerald-100 text-xs">
                                                                                                                <CheckCircle2 className="w-3 h-3" />
                                                                                                                Confirmed
                                                                                                            </span>
                                                                                                ) : status === "MISSING_ID" ? (
                                                                                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700 border border-amber-100 text-xs">
                                                                                                        <AlertTriangle className="w-3 h-3" />
                                                                                                        Missing report ID
                                                                                                    </span>
                                                                                                ) : (
                                                                                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700 border border-amber-100 text-xs">
                                                                                                        <AlertTriangle className="w-3 h-3" />
                                                                                                        Incomplete
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                        </td>
                                                                                        <td className="px-2.5 py-1.5">
                                                                                            {certificateStatus === "downloaded" ? (
                                                                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 border border-emerald-100 text-xs">
                                                                                                    <Download className="w-3 h-3" />
                                                                                                    Downloaded
                                                                                                </span>
                                                                                            ) : (
                                                                                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700 border border-amber-100 text-xs">
                                                                                                    <AlertTriangle className="w-3 h-3" />
                                                                                                    Not downloaded
                                                                                                </span>
                                                                                            )}
                                                                                        </td>
                                                                                        <td className="px-2.5 py-1.5">
                                                                                            <div className="flex items-center gap-2">
                                                                                                <input
                                                                                                    type="checkbox"
                                                                                                    className="h-4 w-4"
                                                                                                    checked={isSelected(batch.batchId, report)}
                                                                                                    onChange={(e) => {
                                                                                                        if (needsPdfBeforeActions) {
                                                                                                            setBatchMessage({ type: "info", text: requirePdfMessage });
                                                                                                            return;
                                                                                                        }
                                                                                                        toggleReportSelection(batch.batchId, report, e.target.checked);
                                                                                                    }}
                                                                                                    disabled={needsPdfBeforeActions}
                                                                                                    title={needsPdfBeforeActions ? "Upload PDF before selecting" : undefined}
                                                                                                />
                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={() => {
                                                                                                        setEditingReport({
                                                                                                            ...report,
                                                                                                            batchId: batch.batchId
                                                                                                        });
                                                                                                        setIsEditModalOpen(true);
                                                                                                    }}
                                                                                                    className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md border border-gray-300 transition-colors"
                                                                                                    title={needsPdfBeforeActions ? "Upload PDF first" : "Edit report"}
                                                                                                    disabled={needsPdfBeforeActions}
                                                                                                >
                                                                                                    <Edit2 className="w-3 h-3" />
                                                                                                    Edit
                                                                                                </button>
                                                                                                {showUploadPdf && (
                                                                                                    <>
                                                                                                        <label className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md cursor-pointer hover:bg-blue-100 transition-colors">
                                                                                                            <FileUp className="w-3 h-3" />
                                                                                                            {pdfUploadBusy[reportKey] ? "Uploading..." : needsPdfBeforeActions ? "Upload PDF" : "Replace PDF"}
                                                                                                            <input
                                                                                                                type="file"
                                                                                                                accept="application/pdf"
                                                                                                                className="hidden"
                                                                                                                disabled={pdfUploadBusy[reportKey]}
                                                                                                                onChange={(e) => {
                                                                                                                    const file = e.target.files?.[0] || null;
                                                                                                                    if (file) {
                                                                                                                        attachPdfToReport(batch.batchId, report, file);
                                                                                                                    }
                                                                                                                }}
                                                                                                            />
                                                                                                        </label>
                                                                                                        {needsPdfBeforeActions && (
                                                                                                            <span className="text-[10px] text-gray-600 whitespace-nowrap">
                                                                                                                upload pdf file to update path
                                                                                                            </span>
                                                                                                        )}
                                                                                                    </>
                                                                                                )}
                                                                                            </div>
                                                                                            <div className="mt-1 w-full min-w-[160px]">
                                                                                                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                                                                                    <div
                                                                                                        className="h-full bg-blue-500 transition-all duration-300"
                                                                                                        style={{ width: `${getDisplayProgress(report)}%` }}
                                                                                                    ></div>
                                                                                                </div>
                                                                                                <div className="text-[9px] text-slate-500 font-semibold text-right">{getDisplayProgress(report)}%</div>
                                                                                            </div>
                                                                                        </td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-2 text-xs text-gray-600">
                                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                                    Loading reports...
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div className="flex items-center justify-between px-2.5 py-1.5 border-t">
                            <div className="text-xs text-gray-600">
                                Page {currentPageSafe} of {totalBatchPages}
                            </div>
                            {totalBatchPages > 1 && (() => {
                                const getPageNumbers = () => {
                                    const pages = [];

                                    if (totalBatchPages <= 6) {
                                        // Show all pages if 6 or fewer
                                        for (let i = 1; i <= totalBatchPages; i++) {
                                            pages.push(i);
                                        }
                                        return pages;
                                    }

                                    // Always show first 3 pages
                                    pages.push(1, 2, 3);

                                    const lastThree = [totalBatchPages - 2, totalBatchPages - 1, totalBatchPages];
                                    const lastThreeStart = totalBatchPages - 2;

                                    // If current page is in first 3 or overlaps with last 3
                                    if (currentPageSafe <= 3) {
                                        // Show: 1, 2, 3, 4, 5, ..., last 3
                                        if (4 < lastThreeStart) {
                                            pages.push(4, 5);
                                            pages.push('ellipsis');
                                        }
                                    } else if (currentPageSafe >= lastThreeStart) {
                                        // Show: 1, 2, 3, ..., last 3
                                        if (3 < lastThreeStart - 1) {
                                            pages.push('ellipsis');
                                        }
                                    } else {
                                        // In the middle: show 1, 2, 3, ..., current-1, current, current+1, ..., last 3
                                        const showBefore = currentPageSafe - 1;
                                        const showAfter = currentPageSafe + 1;

                                        // Check if we need ellipsis before current page
                                        if (showBefore > 4) {
                                            pages.push('ellipsis');
                                            pages.push(showBefore);
                                        } else if (showBefore > 3) {
                                            pages.push(showBefore);
                                        }

                                        pages.push(currentPageSafe);

                                        // Check if we need ellipsis after current page
                                        if (showAfter < lastThreeStart - 1) {
                                            pages.push(showAfter);
                                            if (showAfter < lastThreeStart - 2) {
                                                pages.push('ellipsis');
                                            }
                                        }
                                    }

                                    // Always show last 3 pages (avoid duplicates)
                                    lastThree.forEach(page => {
                                        if (!pages.includes(page)) {
                                            pages.push(page);
                                        }
                                    });

                                    // Clean up and ensure proper order
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

                                return (
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                            disabled={currentPageSafe <= 1}
                                            className="px-3 py-1.5 text-xs rounded-md border border-slate-200 bg-white text-gray-700 disabled:opacity-50"
                                        >
                                            Prev
                                        </button>
                                        <div className="flex items-center gap-1">
                                            {pageNumbers.map((page, idx) => {
                                                if (page === 'ellipsis') {
                                                    return (
                                                        <span key={`ellipsis-${idx}`} className="px-1.5 text-xs text-gray-600">
                                                            ...
                                                        </span>
                                                    );
                                                }
                                                const isActive = page === currentPageSafe;
                                                return (
                                                    <button
                                                        key={page}
                                                        type="button"
                                                        onClick={() => setCurrentPage(page)}
                                                        className={`min-w-[34px] px-2 py-1.5 text-xs rounded-md border ${isActive
                                                            ? "bg-blue-600 text-white border-blue-600"
                                                            : "bg-white text-gray-700 border-slate-200 hover:bg-slate-100"
                                                            }`}
                                                    >
                                                        {page}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setCurrentPage((p) => Math.min(totalBatchPages, p + 1))}
                                            disabled={currentPageSafe >= totalBatchPages}
                                            className="px-3 py-1.5 text-xs rounded-md border border-slate-200 bg-white text-gray-700 disabled:opacity-50"
                                        >
                                            Next
                                        </button>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                ) : (
                    <div className="p-4 text-xs text-gray-600 flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        No batches yet.
                    </div>
                )}
            </div>
            <EditReportModal
                report={editingReport}
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                onSave={(updatedReport) => {
                    setEditingReport(null);
                    setIsEditModalOpen(false);
                    if (updatedReport.report_id) {
                        setSelectedReports(new Set([updatedReport.report_id]));
                    }
                }}
                refreshData={refreshAfterEdit}
            />
        </div>
    );

    return (
        <div className="p-2 space-y-2">
            {validationModal}
            {validationContent}
            {checkReportsContent}
        </div>
    );
};

export default UploadReportElrajhi;
