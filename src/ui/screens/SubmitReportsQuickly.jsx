import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavStatus } from "../context/NavStatusContext";
import { useRam } from "../context/RAMContext";
import usePersistentState from "../hooks/usePersistentState";
import { useSession } from "../context/SessionContext";
import { useSystemControl } from "../context/SystemControlContext";
import { useAuthAction } from "../hooks/useAuthAction";
import InsufficientPointsModal from "../components/InsufficientPointsModal";
import DeductionNotification from "../components/DeductionNotification";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import {
  FileSpreadsheet,
  Files,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Send,
  Trash2,
  Edit,
  RefreshCw,
  Table,
  Download,
  FileIcon,
  X,
} from "lucide-react";
import {
  submitReportsQuicklyUpload,
  fetchSubmitReportsQuickly,
  updateSubmitReportsQuickly,
  deleteSubmitReportsQuickly,
} from "../../api/report";
import { ensureTaqeemAuthorized } from "../../shared/helper/taqeemAuthWrap";
import { deductPoints } from "../utils/points";
import { downloadTemplateFile } from "../utils/templateDownload";
import { useValueNav } from "../context/ValueNavContext";

const DUMMY_PDF_NAME = "dummy_placeholder.pdf";

const getReportRecordId = (report) =>
  report?._id || report?.id || report?.recordId || "";

const isAssetComplete = (asset) => {
  const value = asset?.submitState ?? asset?.submit_state;
  return value === 1 || value === "1" || value === true;
};

const getReportStatus = (report) => {
  const assetList = Array.isArray(report?.asset_data) ? report.asset_data : [];
  const hasAssets = assetList.length > 0;
  const anyIncomplete = hasAssets
    ? assetList.some((asset) => !isAssetComplete(asset))
    : false;
  const allComplete = hasAssets
    ? assetList.every((asset) => isAssetComplete(asset))
    : false;
  const rawStatus = (report?.report_status || "").toString().toLowerCase();

  if (anyIncomplete) return "incomplete";
  if (report?.checked || rawStatus === "approved") return "approved";
  if (rawStatus === "sent") return "sent";
  if (allComplete) return "complete";
  if (report?.endSubmitTime) return "complete";
  if (rawStatus) return rawStatus;
  if (report?.report_id) return "incomplete";
  return "new";
};

const reportStatusLabels = {
  approved: "Approved",
  complete: "Complete",
  incomplete: "Incomplete",
  sent: "Sent",
  new: "New",
};

const reportStatusClasses = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  complete: "border-blue-200 bg-blue-50 text-blue-700",
  incomplete: "border-amber-200 bg-amber-50 text-amber-700",
  sent: "border-purple-200 bg-purple-50 text-purple-700",
  new: "border-slate-200 bg-slate-50 text-slate-700",
};
const QUICK_PAGE_NAME = "Submit Reports Quickly";
const QUICK_PAGE_SOURCE = "submit-reports-quickly";

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

const ASSET_USAGE_TEXT_TO_ID = {
  زراعي: 38,
  بحري: 39,
  المواصلات: 40,
  طيران: 41,
  "الخدمات اللوجستية": 42,
  طباعة: 43,
  بناء: 44,
  "الغزل والنسيج": 45,
  ضيافة: 46,
  التعدين: 47,
  "الدباغة والتغليف": 48,
  الاتصالات: 49,
  "النفط والغاز": 50,
  المستشفيات: 51,
  الأدوية: 52,
  "مأكولات ومشروبات": 53,
  مياه: 54,
  "مياه الصرف الصحي": 55,
  الكهرباء: 56,
};

const normalizeAssetUsageText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[ـ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

const NORMALIZED_ASSET_USAGE_TEXT_TO_ID = Object.entries(
  ASSET_USAGE_TEXT_TO_ID,
).reduce((acc, [label, id]) => {
  acc[normalizeAssetUsageText(label)] = id;
  return acc;
}, {});

const VALID_ASSET_USAGE_IDS = new Set(Object.values(ASSET_USAGE_TEXT_TO_ID));
const VALID_ASSET_USAGE_LABELS = Object.keys(ASSET_USAGE_TEXT_TO_ID);

const normalizeOfficeId = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

const getReportCompanyOfficeId = (report) =>
  normalizeOfficeId(
    report?.company_office_id ??
      report?.companyOfficeId ??
      report?.officeId ??
      report?.office_id,
  );

const resolveAssetUsageId = (rawValue) => {
  if (!hasValue(rawValue)) return null;
  if (typeof rawValue === "number" && Number.isInteger(rawValue)) {
    return rawValue;
  }
  const rawText = String(rawValue || "").trim();
  if (!rawText) return null;
  if (isStrictInteger(rawText)) {
    return Number(rawText);
  }
  const normalized = normalizeAssetUsageText(rawText);
  return NORMALIZED_ASSET_USAGE_TEXT_TO_ID[normalized] || null;
};

// Helper functions for validation
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

const hasValue = (val) =>
  val !== undefined &&
  val !== null &&
  (typeof val === "number" || String(val).toString().trim() !== "");

const isStrictInteger = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") {
    return Number.isInteger(value);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  if (/[.,]/.test(trimmed)) return false;
  return /^\d+$/.test(trimmed);
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

const OPTIONAL_COLUMN_KEYS = new Set(["id"]);
const REQUIRED_COLUMN_RANGE = { start: 2, end: 7 };
const REQUIRED_COLUMN_FALLBACKS = {
  asset_name: 2,
  asset_usage_id: 3,
  final_value: 4,
  inspection_date: 5,
  region: 6,
  city: 7,
};

const REQUIRED_ASSET_FIELDS = [
  {
    key: "asset_name",
    label: "asset_name",
    candidates: [
      "asset_name",
      "asset name",
      "assetname",
      "asset_name\n",
      "Asset Name",
    ],
  },
  {
    key: "asset_usage_id",
    label: "asset_usage_id",
    candidates: [
      "asset_usage_id",
      "asset usage id",
      "asset usage",
      "asset_usage_id\n",
      "Asset Usage ID",
    ],
  },
  {
    key: "final_value",
    label: "final_value",
    candidates: [
      "final_value",
      "final value",
      "value",
      "Final Value",
      "Value",
      "final_value\n",
    ],
  },
  {
    key: "inspection_date",
    label: "inspection_date",
    candidates: [
      "inspection_date",
      "inspection date",
      "inspectiondate",
      "inspection_date\n",
      "Inspection Date",
    ],
  },
  {
    key: "region",
    label: "region",
    candidates: ["region", "region name", "Region"],
  },
  {
    key: "city",
    label: "city",
    candidates: ["city", "City"],
  },
];

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

const worksheetToObjects = (worksheet) => {
  const headerRow = worksheet.getRow(1);
  const headerMap = [];
  const maxCol = worksheet.columnCount || headerRow.values.length - 1;
  const headerCounts = {};

  const nextHeaderName = (rawHeader, fallback) => {
    const base = String(rawHeader || fallback || "").trim() || fallback;
    const count = (headerCounts[base] || 0) + 1;
    headerCounts[base] = count;
    return count === 1 ? base : `${base}_${count}`;
  };

  for (let col = 1; col <= maxCol; col++) {
    const header =
      String(
        normalizeCellValue(headerRow.getCell(col).value) || `col_${col}`,
      ).trim() || `col_${col}`;
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

const validateRequiredAssetFields = (
  sheetName,
  rows = [],
  localize = (key, defaultValue, opts = {}) => defaultValue,
) => {
  const issues = [];
  const addIssue = (field, location, message) =>
    issues.push({ field, location, message });
  const requiredKeySet = new Set(
    REQUIRED_ASSET_FIELDS.flatMap((field) =>
      field.candidates.map((name) => normalizeKey(name)),
    ),
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const getAllowedKeys = (rowKeys) =>
    rowKeys.slice(
      Math.max(REQUIRED_COLUMN_RANGE.start - 1, 0),
      REQUIRED_COLUMN_RANGE.end,
    );

  const pickFieldValueWithinKeys = (row, candidates, allowedKeysSet) => {
    if (!row) return undefined;
    const normalizedMap = Object.keys(row).reduce((acc, key) => {
      const normalized = normalizeKey(key);
      if (allowedKeysSet.has(normalized)) {
        acc[normalized] = key;
      }
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

  rows.forEach((row, idx) => {
    if (!row) return;
    const hasAnyValue = Object.values(row).some((value) => hasValue(value));
    if (!hasAnyValue) return;

    const location = `${sheetName} row ${idx + 2}`;
    const rowKeys = Object.keys(row);
    const allowedKeys = getAllowedKeys(rowKeys);
    const allowedKeySet = new Set(allowedKeys.map((key) => normalizeKey(key)));

    allowedKeys.forEach((key) => {
      const normalizedKey = normalizeKey(key);
      if (OPTIONAL_COLUMN_KEYS.has(normalizedKey)) {
        return;
      }
      if (requiredKeySet.has(normalizedKey)) {
        return;
      }
      if (!hasValue(row[key])) {
        addIssue(
          key,
          location,
          localize("missingColumn", `Missing value for column "${key}".`, {
            column: key,
          }),
        );
      }
    });

    const assetName =
      pickFieldValueWithinKeys(
        row,
        REQUIRED_ASSET_FIELDS[0].candidates,
        allowedKeySet,
      ) ?? row[rowKeys[REQUIRED_COLUMN_FALLBACKS.asset_name - 1]];
    if (!hasValue(assetName)) {
      addIssue(
        "asset_name",
        location,
        localize("missingAssetName", "Missing asset_name."),
      );
    }

    const assetUsageRaw =
      pickFieldValueWithinKeys(
        row,
        REQUIRED_ASSET_FIELDS[1].candidates,
        allowedKeySet,
      ) ?? row[rowKeys[REQUIRED_COLUMN_FALLBACKS.asset_usage_id - 1]];
    if (!hasValue(assetUsageRaw)) {
      addIssue(
        "asset_usage_id",
        location,
        localize("missingAssetUsageId", "Missing asset_usage_id."),
      );
    } else {
      const usageId = resolveAssetUsageId(assetUsageRaw);
      if (!usageId || !VALID_ASSET_USAGE_IDS.has(usageId)) {
        addIssue(
          "asset_usage_id",
          location,
          localize(
            "invalidAssetUsageId",
            `asset_usage_id must be one of: ${VALID_ASSET_USAGE_LABELS.join(", ")}`,
            { allowed: VALID_ASSET_USAGE_LABELS.join(", ") },
          ),
        );
      }
    }

    const finalValue =
      pickFieldValueWithinKeys(
        row,
        REQUIRED_ASSET_FIELDS[2].candidates,
        allowedKeySet,
      ) ?? row[rowKeys[REQUIRED_COLUMN_FALLBACKS.final_value - 1]];
    if (!hasValue(finalValue)) {
      addIssue(
        "final_value",
        location,
        localize("missingFinalValue", "Missing final_value."),
      );
    } else {
      if (!isStrictInteger(finalValue)) {
        addIssue(
          "final_value",
          location,
          localize(
            "finalValueWholeNumber",
            "final_value must be a whole number (no decimals).",
          ),
        );
      } else if (Number(finalValue) <= 0) {
        addIssue(
          "final_value",
          location,
          localize("finalValuePositive", "final_value must be greater than 0."),
        );
      }
    }

    const inspectionRaw =
      pickFieldValueWithinKeys(
        row,
        REQUIRED_ASSET_FIELDS[3].candidates,
        allowedKeySet,
      ) ?? row[rowKeys[REQUIRED_COLUMN_FALLBACKS.inspection_date - 1]];
    if (!hasValue(inspectionRaw)) {
      addIssue(
        "inspection_date",
        location,
        localize("missingInspectionDate", "Missing inspection_date."),
      );
    } else {
      const inspectionDate = parseExcelDateValue(inspectionRaw);
      if (!inspectionDate || Number.isNaN(inspectionDate.getTime())) {
        addIssue(
          "inspection_date",
          location,
          localize(
            "invalidInspectionDate",
            "inspection_date is not a valid date.",
          ),
        );
      } else if (inspectionDate > today) {
        addIssue(
          "inspection_date",
          location,
          localize(
            "inspectionDateFuture",
            "inspection_date cannot be in the future.",
          ),
        );
      }
    }

    const region =
      pickFieldValueWithinKeys(
        row,
        REQUIRED_ASSET_FIELDS[4].candidates,
        allowedKeySet,
      ) ?? row[rowKeys[REQUIRED_COLUMN_FALLBACKS.region - 1]];
    if (!hasValue(region)) {
      addIssue(
        "region",
        location,
        localize("missingRegion", "Missing region."),
      );
    }

    const city =
      pickFieldValueWithinKeys(
        row,
        REQUIRED_ASSET_FIELDS[5].candidates,
        allowedKeySet,
      ) ?? row[rowKeys[REQUIRED_COLUMN_FALLBACKS.city - 1]];
    if (!hasValue(city)) {
      addIssue("city", location, localize("missingCity", "Missing city."));
    }
  });

  return issues;
};

const validateAssetUsageId = (
  sheetName,
  rows = [],
  localize = (key, defaultValue, opts = {}) => defaultValue,
) => {
  const issues = [];
  const addIssue = (field, location, message) =>
    issues.push({ field, location, message });

  rows.forEach((row, idx) => {
    const assetName =
      row.asset_name ||
      row.assetName ||
      row["asset_name\n"] ||
      row["Asset Name"] ||
      "";
    if (!hasValue(assetName)) return;
    const assetUsageId = pickFieldValue(row, [
      "asset_usage_id",
      "asset usage id",
      "asset usage",
      "asset_usage_id\n",
      "Asset Usage ID",
    ]);
    if (!hasValue(assetUsageId)) {
      addIssue(
        "asset_usage_id",
        `${sheetName} row ${idx + 2}`,
        localize(
          "missingAssetUsageForAsset",
          `Missing asset_usage_id for asset "${assetName}"`,
          { asset: assetName },
        ),
      );
    } else {
      const usageId = resolveAssetUsageId(assetUsageId);
      if (!usageId || !VALID_ASSET_USAGE_IDS.has(usageId)) {
        addIssue(
          "asset_usage_id",
          `${sheetName} row ${idx + 2}`,
          localize(
            "invalidAssetUsageForAsset",
            `asset_usage_id must be one of: ${VALID_ASSET_USAGE_LABELS.join(", ")} for asset "${assetName}"`,
            { allowed: VALID_ASSET_USAGE_LABELS.join(", "), asset: assetName },
          ),
        );
      }
    }
  });

  return issues;
};

const validateCostSheetIntegers = (
  rows = [],
  localize = (key, defaultValue, opts = {}) => defaultValue,
) => {
  const issues = [];
  const addIssue = (field, location, message) =>
    issues.push({ field, location, message });

  rows.forEach((row, idx) => {
    const assetName =
      row.asset_name ||
      row.assetName ||
      row["asset_name\n"] ||
      row["Asset Name"] ||
      "";
    if (!hasValue(assetName)) return;
    const rawFinal = pickFieldValue(row, [
      "final_value",
      "final value",
      "value",
      "Final Value",
      "Value",
      "final_value\n",
    ]);
    if (!hasValue(rawFinal)) {
      addIssue(
        "final_value",
        `cost row ${idx + 2}`,
        localize(
          "costMissingFinalValue",
          `Missing final_value for asset "${assetName}"`,
          { asset: assetName },
        ),
      );
      return;
    }

    if (!isStrictInteger(rawFinal)) {
      addIssue(
        "final_value",
        `cost row ${idx + 2}`,
        localize(
          "costFinalValueInteger",
          `final_value must be a whole number (no decimals) for asset "${assetName}"`,
          { asset: assetName },
        ),
      );
      return;
    }

    const num = Number(rawFinal);
    if (num <= 0) {
      addIssue(
        "final_value",
        `cost row ${idx + 2}`,
        localize(
          "costFinalValuePositive",
          `final_value must be greater than 0 for asset "${assetName}"`,
          { asset: assetName },
        ),
      );
    }
  });

  return issues;
};

const validateMarketSheet = (
  rows = [],
  localize = (key, defaultValue, opts = {}) => defaultValue,
) => {
  const issues = [];
  const addIssue = (field, location, message) =>
    issues.push({ field, location, message });

  rows.forEach((row, idx) => {
    const assetName =
      row.asset_name ||
      row.assetName ||
      row["asset_name\n"] ||
      row["Asset Name"] ||
      "";
    if (!hasValue(assetName)) return;
    const rawFinal = pickFieldValue(row, [
      "final_value",
      "final value",
      "value",
      "Final Value",
      "Value",
      "final_value\n",
    ]);
    if (!hasValue(rawFinal)) {
      addIssue(
        "final_value",
        `market row ${idx + 2}`,
        localize(
          "marketMissingFinalValue",
          `Missing final_value for asset "${assetName}"`,
          { asset: assetName },
        ),
      );
      return;
    }

    if (!isStrictInteger(rawFinal)) {
      addIssue(
        "final_value",
        `market row ${idx + 2}`,
        localize(
          "marketFinalValueInteger",
          `final_value must be a whole number (no decimals) for asset "${assetName}"`,
          { asset: assetName },
        ),
      );
      return;
    }

    const num = Number(rawFinal);
    if (num <= 0) {
      addIssue(
        "final_value",
        `market row ${idx + 2}`,
        localize(
          "marketFinalValuePositive",
          `final_value must be greater than 0 for asset "${assetName}"`,
          { asset: assetName },
        ),
      );
    }
  });

  return issues;
};

// PDF size validation (20 MB = 20 * 1024 * 1024 bytes)
const MAX_PDF_SIZE = 20 * 1024 * 1024; // 20 MB in bytes

const SubmitReportsQuickly = ({ onViewChange }) => {
  const { token, login, user, isGuest } = useSession();
  const { t } = useTranslation();
  const translate = useCallback(
    (key, defaultValue, options = {}) =>
      t(`submitReportsQuickly.${key}`, { defaultValue, ...options }),
    [t],
  );
  const { systemState } = useSystemControl();
  const { executeWithAuth } = useAuthAction();
  const { taqeemStatus, setTaqeemStatus, setCompanyStatus } = useNavStatus();
  const {
    companies,
    selectedCompany,
    preferredCompany,
    replaceCompanies,
    ensureCompaniesLoaded,
    setSelectedCompany,
  } = useValueNav();
  const isGuestUser = isGuest || !user?.phone;
  const selectedCompanyOfficeId = useMemo(() => {
    const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
    return officeId ? String(officeId) : "";
  }, [selectedCompany]);
  const { ramInfo } = useRam();
  const recommendedTabs = ramInfo?.recommendedTabs || 3;
  const guestAccessEnabled = systemState?.guestAccessEnabled ?? true;
  const guestSession = isGuest || !token;
  const authOptions = useMemo(
    () => ({
      isGuest: guestSession,
      guestAccessEnabled,
      cachedUser: user || null,
      selectedCompanyOfficeId: selectedCompanyOfficeId || null,
    }),
    [guestSession, guestAccessEnabled, selectedCompanyOfficeId, user],
  );
  const [excelFiles, setExcelFiles] = useState([]);
  const [pdfFiles, setPdfFiles] = useState([]);
  const [wantsPdfUpload, setWantsPdfUpload] = useState(false);
  const [storeAndSubmitLoading, setStoreAndSubmitLoading] = useState(false);
  const [storeOnlyLoading, setStoreOnlyLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [pdfPathMap, setPdfPathMap] = useState({});
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [reportsPagination, setReportsPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [validationItems, setValidationItems] = useState([]);
  const [validationMessage, setValidationMessage] = useState(null);
  const [validationTableTab, setValidationTableTab] = useState("assets");
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [showTemporaryModal, setShowTemporaryModal] = useState(false);
  const [showInsufficientPointsModal, setShowInsufficientPointsModal] =
    useState(false);
  const [insufficientPointsMeta, setInsufficientPointsMeta] = useState(null);
  const [reports, setReports, resetReports] = usePersistentState(
    "submitReportsQuickly:reports",
    [],
    { storage: "session" },
  );
  const [pendingSubmit, setPendingSubmit, resetPendingSubmit] =
    usePersistentState("submitReportsQuickly:pendingSubmit", null, {
      storage: "session",
    });
  const [, setReturnView, resetReturnView] = usePersistentState(
    "taqeem:returnView",
    null,
    { storage: "session" },
  );
  const [reportsLoading, setReportsLoading] = useState(false);
  const [unassignedReports, setUnassignedReports] = useState([]);
  const [unassignedLoading, setUnassignedLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [expandedReports, setExpandedReports] = useState([]);
  const [selectedReportIds, setSelectedReportIds] = useState([]);
  const [reportSelectFilter, setReportSelectFilter] = useState("all");
  const [reportActionBusy, setReportActionBusy] = useState({});
  const [actionDropdown, setActionDropdown] = useState({});
  const [bulkAction, setBulkAction] = useState("");
  const [editingReportId, setEditingReportId] = useState(null);
  const [reportProgress, setReportProgress] = useState({}); // { recordId: { percentage: 0, status: 'idle', message: '' } }
  const [formData, setFormData] = useState({
    title: "",
    client_name: "",
    purpose_id: "1",
    value_premise_id: "1",
    report_type: "تقرير مفصل",
    telephone: "999999999",
    email: "a@a.com",
  });

  const excelInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const reportCreationWaitersRef = useRef(new Map());
  const reportCreatedCacheRef = useRef(new Map());
  const pendingCompanySelectionRef = useRef(null);
  const isTaqeemLoggedIn = taqeemStatus?.state === "success";

  const handleExcelChange = (e) => {
    const files = Array.from(e.target.files || []);
    setExcelFiles(files);
    resetMessages();
    if (excelInputRef?.current) {
      excelInputRef.current.value = null;
    }
  };

  const handlePdfChange = async (e) => {
    const files = Array.from(e.target.files || []);

    // Check for oversized files
    const oversizedFiles = files.filter((file) => file.size > MAX_PDF_SIZE);
    if (oversizedFiles.length > 0) {
      const oversizedNames = oversizedFiles.map((f) => f.name).join(", ");
      setError(
        translate(
          "messages.error.pdfSizeLimit",
          "PDF file(s) exceed 20 MB limit: {{files}}",
          { files: oversizedNames },
        ),
      );
      return;
    }

    setPdfFiles(files);

    // Get absolute paths for the selected PDFs
    if (files.length > 0) {
      const paths = await getAbsolutePaths(files);
      setPdfPathMap(paths);
    } else {
      setPdfPathMap({});
    }

    resetMessages();
  };

  // Add this function after the existing helper functions (around line 300)
  const getAbsolutePaths = async (
    files,
    skipPdfUpload = false,
    excelFilesList = [],
  ) => {
    const paths = {};

    // If skipping PDF upload, use the bundled dummy PDF for each Excel file
    if (skipPdfUpload && excelFilesList.length > 0) {
      const dummyPath = await window.electronAPI?.getDummyPdfPath?.();
      if (dummyPath) {
        excelFilesList.forEach((file) => {
          const baseName = normalizeKey(stripExtension(file.name));
          paths[baseName] = dummyPath;
        });
        console.log("Using dummy PDF paths:", paths);
        return paths;
      }
    }

    // Normal flow - get absolute paths for uploaded PDFs
    for (const file of files) {
      const absolutePath = window.electronAPI?.getFileAbsolutePath?.(file);
      if (absolutePath) {
        const baseName = normalizeKey(stripExtension(file.name));
        paths[baseName] = absolutePath;
      }
    }
    console.log("PDF paths", paths);
    return paths;
  };

  const ensureGuestSession = async () => {
    if (token) return token;
    if (!window?.electronAPI?.apiRequest) {
      throw new Error("Desktop integration unavailable. Restart the app.");
    }

    const tokenObj = await window.electronAPI.getToken?.();
    const bearer = tokenObj?.refreshToken || tokenObj?.token;
    const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {};

    const result = await window.electronAPI.apiRequest(
      "POST",
      "/api/users/guest",
      {},
      headers,
    );
    if (!result?.token || !result?.userId) {
      throw new Error(
        result?.message || result?.error || "Failed to create guest session.",
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

    const guestUser = { _id: result.userId, id: result.userId, guest: true };
    login(guestUser, result.token);
    return result.token;
  };

  const mergeReports = useCallback((existing = [], incoming = []) => {
    const list = Array.isArray(existing) ? [...existing] : [];
    const seen = new Set(list.map((report) => getReportRecordId(report)));
    (incoming || []).forEach((report) => {
      const id = getReportRecordId(report);
      if (!id) return;
      if (!seen.has(id)) {
        seen.add(id);
        list.unshift(report);
      }
    });
    return list;
  }, []);

  const handleStoreAndSubmit = async () => {
    try {
      setStoreAndSubmitLoading(true);
      resetMessages();
      resetPendingSubmit();
      resetReturnView();

      if (excelFiles.length === 0) {
        throw new Error(
          translate(
            "messages.error.selectExcelFile",
            "Please select at least one Excel file",
          ),
        );
      }
      if (wantsPdfUpload && pdfFiles.length === 0) {
        throw new Error(
          translate(
            "messages.error.selectPdfFile",
            "Please select at least one PDF file or disable PDF upload.",
          ),
        );
      }
      if (
        wantsPdfUpload &&
        (pdfMatchInfo.excelsMissingPdf.length ||
          pdfMatchInfo.unmatchedPdfs.length)
      ) {
        throw new Error(
          translate(
            "messages.error.pdfNamesMismatch",
            "PDF filenames must match the Excel filenames.",
          ),
        );
      }
      if (!isReadyToUpload) {
        throw new Error(
          translate(
            "messages.error.validationIssues",
            "Please fix validation issues before uploading.",
          ),
        );
      }

      const activeToken = await ensureGuestSession();

      setSuccess(
        translate(
          "messages.success.uploadingFiles",
          "Uploading files to server...",
        ),
      );

      // Inside handleStoreAndSubmit, replace the PDF path handling section:

      let pdfPaths = {};
      if (wantsPdfUpload && pdfFiles.length > 0) {
        pdfPaths = await getAbsolutePaths(pdfFiles, false);
      } else {
        // No PDF upload - use dummy PDFs for all Excel files
        pdfPaths = await getAbsolutePaths([], true, excelFiles);
      }

      // Pass pdfPathMap to the API function
      const data = await submitReportsQuicklyUpload(
        excelFiles,
        wantsPdfUpload ? pdfFiles : [],
        !wantsPdfUpload, // skipPdfUpload flag
        selectedCompanyOfficeId || null,
        pdfPaths, // Pass the pdfPaths object
      );

      if (data.status !== "success") {
        throw new Error(
          data.error ||
            translate("messages.error.uploadFailed", "Upload failed"),
        );
      }

      const createdReports = Array.isArray(data.reports) ? data.reports : [];
      if (createdReports.length) {
        setReports((prev) => mergeReports(prev, createdReports));
      }

      const insertedCount = data.created || 0;
      setSuccess(
        translate(
          "messages.success.filesUploadedSubmitting",
          "Files uploaded successfully. Inserted {{count}} report(s). Now submitting to Taqeem...",
          { count: insertedCount },
        ),
      );
      setExcelFiles([]);
      setPdfFiles([]);
      setWantsPdfUpload(false);

      // Refresh reports to get the newly uploaded ones
      const refreshedReports = await loadReports(activeToken);
      const uploadedReports = Array.isArray(data.reports) ? data.reports : [];
      const candidateReports = uploadedReports.length
        ? uploadedReports
        : refreshedReports;

      // Get the newly uploaded reports (assuming they're the most recent)
      const recentReports = [...candidateReports]
        .sort(
          (a, b) =>
            new Date(b.createdAt || b.submitted_at || 0) -
            new Date(a.createdAt || a.submitted_at || 0),
        )
        .slice(0, insertedCount);

      if (insertedCount > 0 && recentReports.length === 0) {
        throw new Error("Could not find the newly uploaded reports.");
      }

      const reportIds = recentReports
        .map((report) => getReportRecordId(report))
        .filter(Boolean);
      if (!reportIds.length) {
        throw new Error(
          "Could not resolve uploaded report IDs for submission.",
        );
      }

      const tabsNum = Math.max(1, Number(recommendedTabs) || 3);
      const queuePayload = {
        source: QUICK_PAGE_SOURCE,
        reportIds,
        tabsNum,
        currentIndex: 0,
        resumeOnLoad: false,
        updatedAt: Date.now(),
      };
      setPendingSubmit(queuePayload);

      const queueResult = await runPendingSubmitQueue(queuePayload);
      if (queueResult?.paused) {
        setSuccess(
          translate(
            "messages.success.reportsStoredResumeAfterLogin",
            "Reports were stored successfully. Login to Value Tech with your phone and submission will continue automatically.",
          ),
        );
        return;
      }

      const successCount = Number(queueResult?.completedCount) || 0;
      if (successCount <= 0) {
        throw new Error("All report submissions failed. Please try again.");
      }

      setSuccess(
        translate(
          "messages.success.successfulUploads",
          "{{count}} report(s) uploaded and submitted to Taqeem successfully.",
          { count: successCount },
        ),
      );
    } catch (err) {
      console.error("Store and Submit failed", err);
      const status = err?.response?.status;
      const apiError =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to upload and submit files";

      if (status === 400) {
        setError(
          apiError ||
            translate(
              "messages.error.badRequest",
              "Bad request. Please check the selected files and try again.",
            ),
        );
      } else if (status === 500) {
        setError(
          apiError ||
            translate(
              "messages.error.serverProcessing",
              "Server error while processing your files. Please try again or contact support.",
            ),
        );
      } else if (err?.code === "ERR_NETWORK") {
        setError(
          translate(
            "messages.error.network",
            "Network error. Make sure the backend server is running and reachable.",
          ),
        );
      } else {
        setError(apiError);
      }
    } finally {
      setStoreAndSubmitLoading(false);
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
  };

  const resetMessages = () => {
    setError("");
    setSuccess("");
  };

  const handleDownloadTemplate = async () => {
    if (downloadingTemplate) return;
    resetMessages();
    setDownloadingTemplate(true);
    try {
      await downloadTemplateFile("quick submittion-template.xlsx");
      setSuccess(
        translate(
          "messages.success.templateDownloaded",
          "Excel template downloaded successfully.",
        ),
      );
    } catch (err) {
      const message =
        err?.message ||
        translate(
          "messages.error.templateDownload",
          "Failed to download Excel template. Please try again.",
        );
      setError(
        message.includes("not found")
          ? translate(
              "messages.error.templateNotFound",
              "Template file not found. Please contact administrator to ensure the template file exists in the public folder.",
            )
          : message,
      );
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const resetValidation = () => {
    setValidationItems([]);
    setValidationMessage(null);
    setShowValidationModal(false);
  };

  const loadReports = useCallback(
    async (overrideToken) => {
      try {
        const activeToken = overrideToken || token;
        if (!activeToken) {
          setReports([]);
          setReportsPagination({
            page: 1,
            limit: itemsPerPage,
            total: 0,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false,
          });
          setError("");
          return [];
        }
        setReportsLoading(true);

        // Build query parameters for backend pagination
        const params = new URLSearchParams({
          page: currentPage.toString(),
          limit: itemsPerPage.toString(),
        });
        if (selectedCompanyOfficeId) {
          params.append("companyOfficeId", selectedCompanyOfficeId);
        }

        // REMOVED: Status filter parameter - we'll filter on frontend instead

        const result = await window.electronAPI.apiRequest(
          "GET",
          `/api/submit-reports-quickly/user?${params.toString()}`,
          {},
          {
            Authorization: `Bearer ${activeToken}`,
          },
        );

        if (!result?.success) {
          throw new Error(
            result?.message ||
              translate(
                "messages.error.loadReports",
                "Failed to load reports.",
              ),
          );
        }

        const reportList = Array.isArray(result.reports) ? result.reports : [];
        const paginationInfo = result.pagination || {};

        setReports(reportList);
        setReportsPagination(paginationInfo);
        return reportList;
      } catch (err) {
        setError(
          err?.message ||
            translate("messages.error.loadReports", "Failed to load reports."),
        );
        return [];
      } finally {
        setReportsLoading(false);
      }
    },
    [
      token,
      currentPage,
      itemsPerPage,
      selectedCompanyOfficeId,
      isGuestUser,
      setReports,
      setReportsPagination,
      setError,
    ],
  );

  const loadUnassignedReports = useCallback(
    async (overrideToken) => {
      try {
        const activeToken = overrideToken || token;
        if (!activeToken) {
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
          `/api/submit-reports-quickly/user?${params.toString()}`,
          {},
          {
            Authorization: `Bearer ${activeToken}`,
          },
        );

        if (!result?.success) {
          throw new Error(
            result?.message || "Failed to load unassigned reports.",
          );
        }

        const reportList = Array.isArray(result.reports) ? result.reports : [];
        setUnassignedReports(reportList);
        return reportList;
      } catch (err) {
        console.warn(
          "[SubmitReportsQuickly] Failed to load unassigned reports:",
          err,
        );
        setUnassignedReports([]);
        return [];
      } finally {
        setUnassignedLoading(false);
      }
    },
    [token, itemsPerPage, isGuestUser],
  );

  const clearReportCreatedCache = useCallback((recordId) => {
    reportCreatedCacheRef.current.delete(recordId);
  }, []);

  const resolveReportCreated = useCallback((recordId, createdReportId) => {
    if (!recordId || !createdReportId) return;
    reportCreatedCacheRef.current.set(recordId, createdReportId);
    const waiter = reportCreationWaitersRef.current.get(recordId);
    if (waiter) {
      clearTimeout(waiter.timeoutId);
      reportCreationWaitersRef.current.delete(recordId);
      waiter.resolve(createdReportId);
    }
  }, []);

  const waitForReportCreated = useCallback((recordId, timeoutMs = 300000) => {
    if (!recordId) {
      return Promise.reject(new Error("Missing report record id."));
    }
    const cached = reportCreatedCacheRef.current.get(recordId);
    if (cached) {
      reportCreatedCacheRef.current.delete(recordId);
      return Promise.resolve(cached);
    }
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reportCreationWaitersRef.current.delete(recordId);
        reject(new Error("Timed out waiting for report id."));
      }, timeoutMs);
      reportCreationWaitersRef.current.set(recordId, {
        resolve,
        reject,
        timeoutId,
      });
    });
  }, []);

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

  const handleReportCreatedUpdate = useCallback(
    (recordId, createdReportId) => {
      if (!recordId || !createdReportId) return;
      setReports((prevReports) =>
        prevReports.map((report) => {
          const rId = report?._id || report?.id || report?.recordId;
          if (rId === recordId) {
            return { ...report, report_id: createdReportId };
          }
          return report;
        }),
      );
      resolveReportCreated(recordId, createdReportId);
    },
    [resolveReportCreated, setReports],
  );

  // Load reports when page, filter, or page size changes
  useEffect(() => {
    loadReports();
  }, [currentPage, itemsPerPage, token, loadReports]);

  useEffect(() => {
    if (!isGuestUser) {
      loadUnassignedReports();
    }
  }, [token, loadUnassignedReports, isGuestUser]);

  useEffect(() => {
    return () => {
      reportCreationWaitersRef.current.forEach((waiter) => {
        clearTimeout(waiter.timeoutId);
      });
      reportCreationWaitersRef.current.clear();
    };
  }, []);

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
        },
      };

      return promise;
    },
    [selectedCompany],
  );

  const waitForTaqeemCompanies = useCallback(async (options = {}) => {
    const { timeoutMs = 120000, pollMs = 2500 } = options;
    if (!window?.electronAPI?.getCompanies) return [];

    const start = Date.now();
    let lastError = null;

    while (Date.now() - start < timeoutMs) {
      try {
        const data = await window.electronAPI.getCompanies();
        const fetched = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.companies)
            ? data.companies
            : [];

        if (fetched.length > 0) {
          return fetched.map((company) => ({
            ...company,
            type: company?.type || "equipment",
          }));
        }
      } catch (err) {
        lastError = err;
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    if (lastError) {
      console.warn("Timed out waiting for Taqeem companies:", lastError);
    }
    return [];
  }, []);

  // Set up real-time progress listener via IPC
  useEffect(() => {
    if (
      !window.electronAPI ||
      !window.electronAPI.onSubmitReportsQuicklyProgress
    ) {
      console.warn("Electron API or progress listener not available");
      return;
    }

    // Set up the progress listener for real-time updates
    const cleanup = window.electronAPI.onSubmitReportsQuicklyProgress(
      (progressData) => {
        console.log("[RENDERER] Progress update received:", progressData);

        if (progressData && (progressData.processId || progressData.reportId)) {
          const recordId = progressData.processId || progressData.reportId;
          if (!recordId) return;

          // Extract progress information
          const percentage = progressData.percentage || 0;
          const message =
            progressData.message || progressData.currentItem || "";
          const createdReportId = progressData.createdReportId;

          // Determine status from progress data - prioritize paused/stopped flags
          let status = "processing";
          // Check paused/stopped flags first (these come from process control system)
          if (
            progressData.paused === true ||
            progressData.paused === "true" ||
            String(progressData.paused).toLowerCase() === "true"
          ) {
            status = "paused";
          } else if (
            progressData.stopped === true ||
            progressData.stopped === "true" ||
            String(progressData.stopped).toLowerCase() === "true"
          ) {
            status = "stopped";
          } else if (progressData.status) {
            // Map status values
            const statusMap = {
              paused: "paused",
              stopped: "stopped",
              processing: "processing",
              starting: "starting",
              completed: "completed",
              error: "error",
            };
            status =
              statusMap[progressData.status.toLowerCase()] ||
              progressData.status;
          } else if (percentage >= 100) {
            status = "completed";
          } else if (percentage > 0) {
            status = "processing";
          } else {
            status = "starting";
          }

          // Update progress state in real-time - preserve existing state if status is same
          setReportProgress((prev) => {
            const existing = prev[recordId] || {};
            return {
              ...prev,
              [recordId]: {
                percentage: Math.min(
                  100,
                  Math.max(0, percentage || existing.percentage || 0),
                ),
                status: status,
                message:
                  message ||
                  existing.message ||
                  `Processing: ${progressData.completed || 0}/${progressData.total || 0}`,
              },
            };
          });

          if (createdReportId) {
            handleReportCreatedUpdate(recordId, createdReportId);
          } else if (message && message.includes("Report created:")) {
            const reportIdMatch = message.match(/Report created:\s*(\S+)/);
            if (reportIdMatch && reportIdMatch[1]) {
              handleReportCreatedUpdate(recordId, reportIdMatch[1]);
            }
          }
        }
      },
    );

    return cleanup;
  }, [handleReportCreatedUpdate]);

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail;
      if (!detail || detail.source !== "submit-reports-quickly") return;
      const chapter = Array.isArray(detail.reportSummaries)
        ? detail.reportSummaries
            .map((summary) => summary.reportId)
            .filter(Boolean)
        : [];
      const reportIds = chapter.length
        ? Array.from(new Set(chapter))
        : Array.isArray(detail.reportIds)
          ? detail.reportIds
          : detail.reportId
            ? [detail.reportId]
            : [];
      if (reportIds.length === 0) return;
      const idLabel =
        reportIds.length === 1 ? reportIds[0] : reportIds.join(", ");
      setSuccess(
        `Deducted ${detail.deducted || 0} point${(detail.deducted || 0) === 1 ? "" : "s"} for report${reportIds.length > 1 ? "s" : ""} ${idLabel}.`,
      );
    };
    window.addEventListener("points-updated", handler);
    return () => window.removeEventListener("points-updated", handler);
  }, [setSuccess]);

  const openInsufficientPointsModal = (meta = {}) => {
    setInsufficientPointsMeta(meta);
    setShowInsufficientPointsModal(true);
  };
  const closeInsufficientPointsModal = () => {
    setShowInsufficientPointsModal(false);
    setInsufficientPointsMeta(null);
  };

  const pdfMatchInfo = useMemo(() => {
    if (!wantsPdfUpload) {
      return { unmatchedPdfs: [], excelsMissingPdf: [], pdfMap: {} };
    }
    const excelBaseNames = new Set(
      excelFiles.map((f) => normalizeKey(stripExtension(f.name))),
    );
    const pdfBaseNames = new Set(
      pdfFiles.map((f) => normalizeKey(stripExtension(f.name))),
    );

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

  const validationIssueRows = useMemo(
    () =>
      validationItems.flatMap((item) =>
        (item.issues || []).map((issue) => ({
          ...issue,
          fileName: item.fileName,
        })),
      ),
    [validationItems],
  );
  const reportInfoIssues = useMemo(
    () =>
      validationIssueRows.filter((issue) =>
        String(issue.location || "")
          .toLowerCase()
          .includes("report info"),
      ),
    [validationIssueRows],
  );
  const assetIssues = useMemo(
    () =>
      validationIssueRows.filter(
        (issue) =>
          !String(issue.location || "")
            .toLowerCase()
            .includes("report info"),
      ),
    [validationIssueRows],
  );
  const pdfIssueCount = wantsPdfUpload
    ? pdfMatchInfo.excelsMissingPdf.length + pdfMatchInfo.unmatchedPdfs.length
    : 0;
  const totalValidationIssues = validationIssueRows.length + pdfIssueCount;
  const hasValidationIssues = totalValidationIssues > 0;
  const validationStatus = useMemo(() => {
    if (validating) {
      return {
        text: translate("validation.status.validating", "Validating..."),
        tone: "info",
      };
    }
    if (excelFiles.length === 0) {
      return {
        text: translate(
          "validation.status.uploadPrompt",
          "Upload an Excel file to validate.",
        ),
        tone: "neutral",
      };
    }
    if (hasValidationIssues || validationMessage?.type === "error") {
      return {
        text: translate(
          "validation.status.hasIssues",
          "You have issues in excel sheet.",
        ),
        tone: "error",
      };
    }
    if (validationItems.length > 0) {
      return {
        text: translate(
          "validation.status.clean",
          "No issues, you can upload it now.",
        ),
        tone: "success",
      };
    }
    return {
      text: translate("validation.status.pending", "Validation pending."),
      tone: "neutral",
    };
  }, [
    validating,
    excelFiles.length,
    hasValidationIssues,
    validationItems.length,
    validationMessage?.type,
    translate,
  ]);
  const canOpenValidation =
    validationItems.length > 0 || Boolean(validationMessage);

  const localizeIssue = useCallback(
    (key, defaultValue, options = {}) =>
      translate(`validation.issues.${key}`, defaultValue, options),
    [translate],
  );

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

    const shouldValidatePdf = wantsPdfUpload;

    const performValidation = async () => {
      const results = [];

      for (const file of excelList) {
        const buffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        const marketSheet = workbook.getWorksheet("market");
        const costSheet = workbook.getWorksheet("cost");

        const issues = [];
        const addIssue = (field, location, message) =>
          issues.push({ field, location, message });

        if (!marketSheet && !costSheet) {
          addIssue(
            "Workbook",
            "Sheets",
            localizeIssue(
              "missingSheets",
              "Excel must contain at least one of 'market' or 'cost' sheets.",
            ),
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

        const marketRows = marketSheet ? worksheetToObjects(marketSheet) : [];
        const costRows = costSheet ? worksheetToObjects(costSheet) : [];

        // Validate market sheet
        if (marketSheet) {
          issues.push(
            ...validateRequiredAssetFields("market", marketRows, localizeIssue),
          );
          issues.push(...validateMarketSheet(marketRows, localizeIssue));
        }

        // Validate cost sheet
        if (costSheet) {
          issues.push(
            ...validateRequiredAssetFields("cost", costRows, localizeIssue),
          );
          issues.push(...validateCostSheetIntegers(costRows, localizeIssue));
        }

        const marketAssetCount = marketRows.filter((r) =>
          hasValue(
            r.asset_name || r.assetName || r["asset_name\n"] || r["Asset Name"],
          ),
        ).length;
        const costAssetCount = costRows.filter((r) =>
          hasValue(
            r.asset_name || r.assetName || r["asset_name\n"] || r["Asset Name"],
          ),
        ).length;

        if (marketAssetCount === 0 && costAssetCount === 0) {
          addIssue(
            "Assets",
            "Sheets",
            localizeIssue(
              "noAssetsFound",
              "No assets found in market or cost sheets.",
            ),
          );
        }

        const sumSheet = (rows, sheetName) =>
          rows.reduce((acc, row, idx) => {
            const assetName =
              row.asset_name ||
              row.assetName ||
              row["asset_name\n"] ||
              row["Asset Name"] ||
              "";
            if (!hasValue(assetName)) return acc;
            const rawFinal = pickFieldValue(row, [
              "final_value",
              "final value",
              "value",
              "Final Value",
              "Value",
              "final_value\n",
            ]);
            const num = Number(rawFinal);
            if (Number.isNaN(num)) {
              return acc;
            }
            return acc + num;
          }, 0);

        const marketTotal = sumSheet(marketRows, "market");
        const costTotal = sumSheet(costRows, "cost");
        const assetsTotal = marketTotal + costTotal;

        // Calculate report data (will be auto-generated)
        const number_of_macros = marketAssetCount + costAssetCount;
        const title = `عدد الأصول (${number_of_macros}) + القيمة النهائية (${assetsTotal})`;
        const client_name = `عدد الأصول (${number_of_macros}) + القيمة النهائية (${assetsTotal})`;

        const baseName = normalizeKey(stripExtension(file.name));
        const matchedPdf = shouldValidatePdf
          ? pdfMap[baseName]
          : { name: DUMMY_PDF_NAME };
        if (shouldValidatePdf && !matchedPdf) {
          addIssue(
            "PDF Match",
            "Files",
            localizeIssue(
              "noMatchingPdf",
              `No matching PDF found for Excel ${file.name} (match by filename).`,
              { file: file.name },
            ),
          );
        }

        const pdfMatched = shouldValidatePdf ? Boolean(matchedPdf) : true;
        const pdfName = shouldValidatePdf
          ? matchedPdf?.name || ""
          : DUMMY_PDF_NAME;
        const today = new Date();
        const todayDate = today.toISOString().split("T")[0];

        results.push({
          fileName: file.name,
          baseName,
          pdfMatched,
          pdfName,
          issues,
          snapshot: {
            title,
            client_name,
            purpose_id: "1",
            value_premise_id: "1",
            report_type: "تقرير مفصل",
            telephone: "999999999",
            email: "a@a.com",
            number_of_macros,
            final_value: assetsTotal,
            value: assetsTotal,
            valued_at: todayDate,
            submitted_at: todayDate,
          },
          totals: {
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

      // Add PDF size validation for all PDFs (check all files in pdfFiles array)
      if (shouldValidatePdf && pdfFiles.length > 0) {
        pdfFiles.forEach((pdfFile) => {
          if (pdfFile.size > MAX_PDF_SIZE) {
            const sizeMB = (pdfFile.size / (1024 * 1024)).toFixed(2);
            const baseName = normalizeKey(stripExtension(pdfFile.name));
            const matchingResult = results.find((r) => r.baseName === baseName);
            if (matchingResult) {
              matchingResult.issues.push({
                field: "PDF Size",
                location: "Files",
                message: localizeIssue(
                  "pdfSizeExceed",
                  `PDF "${pdfFile.name}" exceeds 20 MB limit (${sizeMB} MB).`,
                  { file: pdfFile.name, size: sizeMB },
                ),
              });
            } else if (results.length > 0) {
              // Add to first result if no match found
              results[0].issues.push({
                field: "PDF Size",
                location: "Files",
                message: localizeIssue(
                  "pdfSizeExceed",
                  `PDF "${pdfFile.name}" exceeds 20 MB limit (${sizeMB} MB).`,
                  { file: pdfFile.name, size: sizeMB },
                ),
              });
            }
          }
        });
      }

      return results;
    };

    return performValidation()
      .then((results) => {
        setValidationItems(results);

        const totalIssues = results.reduce(
          (acc, r) => acc + (r.issues?.length || 0),
          0,
        );
        const hasPdfMismatch = shouldValidatePdf
          ? pdfMatchInfo.excelsMissingPdf.length ||
            pdfMatchInfo.unmatchedPdfs.length
          : false;
        if (totalIssues === 0 && !hasPdfMismatch) {
          setValidationMessage({
            type: "success",
            text: shouldValidatePdf
              ? translate(
                  "validation.message.validWithPdfs",
                  "All Excel files look valid and PDFs are matched. You can Upload & Create Reports.",
                )
              : translate(
                  "validation.message.validWithoutPdfs",
                  `All Excel files look valid. PDFs will use ${DUMMY_PDF_NAME}. You can Upload & Create Reports.`,
                  { placeholder: DUMMY_PDF_NAME },
                ),
          });
        } else {
          setValidationMessage({
            type: "error",
            text: translate(
              "validation.message.issuesFound",
              "Validation found issues. Fix them to enable Upload & Create Reports.",
            ),
          });
        }
        setValidationTableTab("assets");
        setShowValidationModal(true);
      })
      .catch((err) => {
        console.error("Validation failed", err);
        setValidationMessage({
          type: "error",
          text:
            err?.message ||
            translate(
              "validation.message.validationFailed",
              "Failed to validate Excel files.",
            ),
        });
        setShowValidationModal(true);
      })
      .finally(() => {
        setValidating(false);
      });
  };

  useEffect(() => {
    if (excelFiles.length > 0) {
      runValidation(excelFiles, pdfMatchInfo.pdfMap);
    } else {
      resetValidation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excelFiles, pdfFiles, wantsPdfUpload]);

  const isReadyToUpload = useMemo(() => {
    if (excelFiles.length === 0) return false;
    if (wantsPdfUpload && pdfFiles.length === 0) return false;
    if (
      wantsPdfUpload &&
      (pdfMatchInfo.excelsMissingPdf.length ||
        pdfMatchInfo.unmatchedPdfs.length)
    ) {
      return false;
    }
    if (validating) return false;
    if (!validationItems.length) return false;
    const anyIssues = validationItems.some(
      (item) => (item.issues || []).length > 0,
    );
    if (anyIssues) return false;
    return true;
  }, [
    excelFiles.length,
    pdfFiles.length,
    wantsPdfUpload,
    validating,
    validationItems,
    pdfMatchInfo,
  ]);

  const handleUpload = async () => {
    try {
      setStoreOnlyLoading(true);
      resetMessages();

      if (excelFiles.length === 0) {
        throw new Error(
          translate(
            "messages.error.selectExcelFile",
            "Please select at least one Excel file",
          ),
        );
      }
      if (wantsPdfUpload && pdfFiles.length === 0) {
        throw new Error(
          translate(
            "messages.error.selectPdfFile",
            "Please select at least one PDF file or disable PDF upload.",
          ),
        );
      }
      if (
        wantsPdfUpload &&
        (pdfMatchInfo.excelsMissingPdf.length ||
          pdfMatchInfo.unmatchedPdfs.length)
      ) {
        throw new Error(
          translate(
            "messages.error.pdfNamesMismatch",
            "PDF filenames must match the Excel filenames.",
          ),
        );
      }
      if (!isReadyToUpload) {
        throw new Error(
          translate(
            "messages.error.validationIssues",
            "Please fix validation issues before uploading.",
          ),
        );
      }

      const activeToken = await ensureGuestSession();

      setSuccess(
        translate(
          "messages.success.uploadingFiles",
          "Uploading files to server...",
        ),
      );

      // Inside handleUpload, replace the PDF path handling section:

      let pdfPaths = {};
      if (wantsPdfUpload && pdfFiles.length > 0) {
        pdfPaths = await getAbsolutePaths(pdfFiles, false);
      } else {
        // No PDF upload - use dummy PDFs for all Excel files
        pdfPaths = await getAbsolutePaths([], true, excelFiles);
      }

      // Pass pdfPathMap to the API function
      const data = await submitReportsQuicklyUpload(
        excelFiles,
        wantsPdfUpload ? pdfFiles : [],
        !wantsPdfUpload, // skipPdfUpload flag
        selectedCompanyOfficeId || null,
        pdfPaths, // Pass the pdfPaths object
      );

      if (data.status !== "success") {
        throw new Error(
          data.error ||
            translate("messages.error.uploadFailed", "Upload failed"),
        );
      }

      const createdReports = Array.isArray(data.reports) ? data.reports : [];
      if (createdReports.length) {
        setReports((prev) => mergeReports(prev, createdReports));
      }

      const insertedCount = data.created || 0;
      setSuccess(
        translate(
          "messages.success.filesUploaded",
          "Files uploaded successfully. Inserted {{count}} report(s).",
          { count: insertedCount },
        ),
      );
      await loadReports(activeToken);
      await loadUnassignedReports(activeToken);
      setExcelFiles([]);
      setPdfFiles([]);
      setPdfPathMap({}); // Reset path map
      setWantsPdfUpload(false);
    } catch (err) {
      console.error("Upload failed", err);
      const status = err?.response?.status;
      const apiError =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to upload files";

      if (status === 400) {
        setError(
          apiError ||
            translate(
              "messages.error.badRequest",
              "Bad request. Please check the selected files and try again.",
            ),
        );
      } else if (status === 500) {
        setError(
          apiError ||
            translate(
              "messages.error.serverProcessing",
              "Server error while processing your files. Please try again or contact support.",
            ),
        );
      } else if (err?.code === "ERR_NETWORK") {
        setError(
          translate(
            "messages.error.network",
            "Network error. Make sure the backend server is running and reachable.",
          ),
        );
      } else {
        setError(apiError);
      }
    } finally {
      setStoreOnlyLoading(false);
    }
  };

  const resolveTabsForAssets = useCallback(
    (assetCount) => {
      const fallbackTabs = Math.max(1, Number(recommendedTabs) || 3);
      if (!assetCount || assetCount < 1) return fallbackTabs;
      return Math.max(1, Math.min(fallbackTabs, assetCount));
    },
    [recommendedTabs],
  );

  // Pause/Resume/Stop helpers for long-running macro fill processes (per report)
  // These control the browser processes directly via process control system
  const pauseReportProcess = useCallback(async (recordId) => {
    if (!recordId) {
      setError(
        translate(
          "messages.error.missingReportId",
          "Missing report record id.",
        ),
      );
      return;
    }

    if (!window?.electronAPI?.pauseMacroFill) {
      setError(
        translate(
          "messages.error.desktopIntegration",
          "Desktop integration unavailable. Restart the app.",
        ),
      );
      return;
    }

    try {
      // Optimistically update UI immediately
      setReportProgress((prev) => {
        const current = prev[recordId] || {
          percentage: 0,
          status: "processing",
          message: "",
        };
        return {
          ...prev,
          [recordId]: {
            ...current,
            status: "paused",
            message: current.message || "Pausing...",
          },
        };
      });

      setSuccess(
        translate(
          "messages.success.pausingSubmission",
          "Pausing report submission...",
        ),
      );

      // Pause the macro fill process (which controls the browser)
      const result = await window.electronAPI.pauseMacroFill(recordId);

      if (result?.status === "SUCCESS") {
        // Status is already updated optimistically, real-time listener will confirm
        setSuccess(
          translate(
            "messages.success.reportPaused",
            "Report submission paused.",
          ),
        );
      } else {
        // Revert optimistic update on failure
        setReportProgress((prev) => {
          const current = prev[recordId] || {
            percentage: 0,
            status: "processing",
            message: "",
          };
          return {
            ...prev,
            [recordId]: {
              ...current,
              status: "processing",
            },
          };
        });
        throw new Error(result?.error || "Failed to pause process.");
      }
    } catch (err) {
      // Revert optimistic update on error
      setReportProgress((prev) => {
        const current = prev[recordId] || {
          percentage: 0,
          status: "processing",
          message: "",
        };
        return {
          ...prev,
          [recordId]: {
            ...current,
            status: "processing",
          },
        };
      });
      setError(
        err?.message ||
          translate("messages.error.pauseProcess", "Failed to pause process."),
      );
    }
  }, []);

  const resumeReportProcess = useCallback(async (recordId) => {
    if (!recordId) {
      setError(
        translate(
          "messages.error.missingReportId",
          "Missing report record id.",
        ),
      );
      return;
    }

    if (!window?.electronAPI?.resumeMacroFill) {
      setError(
        translate(
          "messages.error.desktopIntegration",
          "Desktop integration unavailable. Restart the app.",
        ),
      );
      return;
    }

    try {
      // Optimistically update UI immediately
      setReportProgress((prev) => {
        const current = prev[recordId] || {
          percentage: 0,
          status: "paused",
          message: "",
        };
        return {
          ...prev,
          [recordId]: {
            ...current,
            status: "processing",
            message: current.message || "Resuming...",
          },
        };
      });

      setSuccess(
        translate(
          "messages.success.resumingSubmission",
          "Resuming report submission...",
        ),
      );

      // Resume the macro fill process (which controls the browser)
      const result = await window.electronAPI.resumeMacroFill(recordId);

      if (result?.status === "SUCCESS") {
        // Status is already updated optimistically, real-time listener will confirm
        setSuccess(
          translate(
            "messages.success.reportResumed",
            "Report submission resumed.",
          ),
        );
      } else {
        // Revert optimistic update on failure
        setReportProgress((prev) => {
          const current = prev[recordId] || {
            percentage: 0,
            status: "paused",
            message: "",
          };
          return {
            ...prev,
            [recordId]: {
              ...current,
              status: "paused",
            },
          };
        });
        throw new Error(result?.error || "Failed to resume process.");
      }
    } catch (err) {
      // Revert optimistic update on error
      setReportProgress((prev) => {
        const current = prev[recordId] || {
          percentage: 0,
          status: "paused",
          message: "",
        };
        return {
          ...prev,
          [recordId]: {
            ...current,
            status: "paused",
          },
        };
      });
      setError(
        err?.message ||
          translate(
            "messages.error.resumeProcess",
            "Failed to resume process.",
          ),
      );
    }
  }, []);

  const stopReportProcess = useCallback(async (recordId) => {
    if (!recordId) {
      setError(
        translate(
          "messages.error.missingReportId",
          "Missing report record id.",
        ),
      );
      return;
    }

    if (!window?.electronAPI?.stopMacroFill) {
      setError(
        translate(
          "messages.error.desktopIntegration",
          "Desktop integration unavailable. Restart the app.",
        ),
      );
      return;
    }

    if (
      !window.confirm(
        translate(
          "confirm.stopSubmission",
          "Are you sure you want to stop this report submission? Progress will be lost.",
        ),
      )
    ) {
      return;
    }

    try {
      setSuccess(
        translate(
          "messages.success.stoppingSubmission",
          "Stopping report submission...",
        ),
      );

      // Stop the macro fill process (which controls the browser)
      const result = await window.electronAPI.stopMacroFill(recordId);

      if (result?.status === "SUCCESS") {
        // Status will be updated via real-time progress listener
        // Preserve current percentage for visibility
        setReportProgress((prev) => ({
          ...prev,
          [recordId]: {
            ...(prev[recordId] || { percentage: 0 }),
            status: "stopped",
            message: "Stopped by user",
          },
        }));
        setSuccess(
          translate(
            "messages.success.reportStopped",
            "Report submission stopped.",
          ),
        );
      } else {
        throw new Error(result?.error || "Failed to stop process.");
      }
    } catch (err) {
      setError(
        err?.message ||
          translate("messages.error.stopProcess", "Failed to stop process."),
      );
    }
  }, []);

  const ensureCompanySelected = useCallback(
    async (options = {}) => {
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
        if ((!list || list.length === 0) && window?.electronAPI?.getCompanies) {
          setCompanyStatus?.(
            "info",
            translate(
              "messages.success.waitingCompanies",
              "Waiting for Taqeem login to finish and load companies...",
            ),
          );
          const fetched = await waitForTaqeemCompanies();
          if (fetched.length > 0 && replaceCompanies) {
            list = await replaceCompanies(fetched, {
              autoSelect: false,
              skipNavigation: true,
              quiet: true,
            });
          }
        }
      } catch (err) {
        console.warn("Failed to fetch companies for submission", err);
      }

      if (!list || list.length === 0) {
        throw new Error(
          "No companies available. Login to Taqeem and try again.",
        );
      }

      if (preferredCompany && !ignorePreferred) {
        const chosen = await setSelectedCompany(preferredCompany, {
          skipNavigation: false,
          quiet: true,
        });
        setCompanyStatus?.("success", `Company: ${chosen?.name || "Selected"}`);
        return chosen;
      }

      if (list.length === 1) {
        const chosen = list[0];
        await setSelectedCompany(chosen, {
          skipNavigation: false,
          quiet: true,
        });
        setCompanyStatus?.("success", `Company: ${chosen.name || "Selected"}`);
        return chosen;
      }

      setCompanyStatus?.("info", "Select a company to continue.");
      setSuccess(
        translate(
          "messages.success.selectCompany",
          "Select a company to continue.",
        ),
      );
      return waitForCompanySelection();
    },
    [
      companies,
      ensureCompaniesLoaded,
      preferredCompany,
      replaceCompanies,
      selectedCompany,
      setCompanyStatus,
      setSelectedCompany,
      setSuccess,
      waitForCompanySelection,
      waitForTaqeemCompanies,
    ],
  );

  const submitToTaqeem = useCallback(
    async (recordId, tabsNum, options = {}) => {
      const {
        withLoading = true,
        resume = false,
        skipAuth = false,
        skipCompanySelect = false,
      } = options;

      if (!recordId) {
        setError(
          translate(
            "messages.error.missingReportId",
            "Missing report record id.",
          ),
        );
        return {
          success: false,
          reason: "INVALID_INPUT",
          error: "Missing report record id.",
        };
      }

      // Use global recommendedTabs if tabsNum not provided, otherwise use the provided value
      const resolvedTabs = tabsNum || Math.max(1, Number(recommendedTabs) || 3);
      const report =
        reports.find((item) => getReportRecordId(item) === recordId) ||
        unassignedReports.find((item) => getReportRecordId(item) === recordId);
      const assetList = Array.isArray(report?.asset_data)
        ? report.asset_data
        : [];
      const assetCount = assetList.length;
      let assignedOfficeId = report?.company_office_id
        ? String(report.company_office_id)
        : "";

      // Initialize progress for this report
      setReportProgress((prev) => ({
        ...prev,
        [recordId]: {
          percentage: 0,
          status: "starting",
          message: "Initializing...",
        },
      }));

      setReportActionBusy((prev) => ({ ...prev, [recordId]: true }));

      try {
        let authStatus = true;
        if (!skipAuth) {
          authStatus = await ensureTaqeemAuthorized(
            token,
            onViewChange,
            isTaqeemLoggedIn,
            assetCount,
            login,
            setTaqeemStatus,
            authOptions,
          );
        }
        if (authStatus?.status === "INSUFFICIENT_POINTS") {
          openInsufficientPointsModal({
            requiredPoints: authStatus.required ?? assetCount,
            availablePoints: authStatus.available,
            assetCount,
            customMessage:
              authStatus.message ||
              authStatus.reason ||
              "You don't have enough points to submit this report.",
          });
          return { success: false, reason: "INSUFFICIENT_POINTS", authStatus };
        }
        if (authStatus?.status === "LOGIN_REQUIRED") {
          const message = translate(
            "messages.error.taqeemLoginRequired",
            "Taqeem login required. Finish login and choose a company to continue.",
          );
          setReportProgress((prev) => ({
            ...prev,
            [recordId]: { percentage: 0, status: "error", message },
          }));
          setError(message);
          return {
            success: false,
            reason: "AUTH_REQUIRED",
            authStatus,
            error: message,
          };
        }
        if (!isTaqeemAuthSuccess(authStatus)) {
          const message = getTaqeemAuthErrorMessage(
            authStatus,
            translate(
              "messages.error.taqeemLoginRequired",
              "Taqeem login required. Finish login and choose a company to continue.",
            ),
          );
          setReportProgress((prev) => ({
            ...prev,
            [recordId]: { percentage: 0, status: "error", message },
          }));
          setError(message);
          return {
            success: false,
            reason: "AUTH_REQUIRED",
            authStatus,
            error: message,
          };
        }

        if (!skipCompanySelect) {
          const requiresManualCompany = !report?.company_office_id;
          const chosen = await ensureCompanySelected({
            forceSelection: requiresManualCompany,
            ignorePreferred: requiresManualCompany,
          });
          const officeId =
            chosen?.officeId || chosen?.office_id || selectedCompanyOfficeId;
          if (requiresManualCompany && officeId) {
            try {
              const nextOfficeId = String(officeId);
              assignedOfficeId = nextOfficeId;
              await updateSubmitReportsQuickly(recordId, {
                company_office_id: nextOfficeId,
              });
              if (report) {
                report.company_office_id = nextOfficeId;
              }
              setUnassignedReports((prev) =>
                prev.filter((item) => getReportRecordId(item) !== recordId),
              );
              await loadReports();
              await loadUnassignedReports();
            } catch (err) {
              console.warn("Failed to update report company office id", err);
            }
          }
        }

        setSuccess(
          resume
            ? translate(
                "messages.success.resumingTaqeem",
                "Resuming Taqeem submission...",
              )
            : translate(
                "messages.success.submittingTaqeem",
                "Submitting report to Taqeem...",
              ),
        );

        if (!window?.electronAPI?.createReportById) {
          throw new Error("Desktop integration unavailable. Restart the app.");
        }

        const result = await window.electronAPI.createReportById(
          recordId,
          resolvedTabs,
        );

        if (result?.status === "SUCCESS") {
          setReportProgress((prev) => ({
            ...prev,
            [recordId]: {
              percentage: 100,
              status: "completed",
              message: "Report submitted successfully",
            },
          }));
          setSuccess(
            translate(
              "messages.success.reportSubmitted",
              "Report submitted to Taqeem successfully.",
            ),
          );
          const activeToken = authStatus?.token || token;
          const createdReportId =
            result?.reportId ||
            result?.report_id ||
            report?.report_id ||
            recordId;
          if (createdReportId && report) {
            report.report_id = createdReportId;
          }
          if (createdReportId) {
            try {
              await updateSubmitReportsQuickly(recordId, {
                report_id: createdReportId,
                ...(assignedOfficeId
                  ? { company_office_id: assignedOfficeId }
                  : {}),
              });
            } catch (err) {
              console.warn("Failed to update report_id after submission", err);
            }
          }
          try {
            if (assetCount > 0 && activeToken) {
              const reportIds = createdReportId
                ? [createdReportId]
                : [recordId];
              await deductPoints(activeToken, assetCount, {
                reportIds,
                reportId: createdReportId || recordId,
                recordId,
                source: "submit-reports-quickly",
                pageName: QUICK_PAGE_NAME,
                pageSource: QUICK_PAGE_SOURCE,
                assetCount,
                batchId: report?.batch_id,
              });
            }
          } catch (deductErr) {
            console.error(
              "[SubmitReportsQuickly] Failed to deduct points:",
              deductErr,
            );
          }
          await loadReports();
          await loadUnassignedReports();
          return {
            success: true,
            reportId: createdReportId || recordId,
            recordId,
          };
        }

        const errMsg =
          result?.error ||
          "Upload to Taqeem failed. Make sure you selected a company.";
        setError(errMsg);
        return { success: false, reason: "SUBMIT_FAILED", error: errMsg };
      } catch (err) {
        const errorMessage =
          err?.message ||
          translate(
            "messages.error.submitTaqeem",
            "Failed to submit report to Taqeem.",
          );
        setError(errorMessage);
        return { success: false, reason: "ERROR", error: errorMessage };
      } finally {
        setReportActionBusy((prev) => ({ ...prev, [recordId]: false }));
      }
    },
    [
      authOptions,
      ensureCompanySelected,
      isTaqeemLoggedIn,
      login,
      loadReports,
      onViewChange,
      reports,
      selectedCompanyOfficeId,
      token,
      unassignedReports,
      recommendedTabs,
      setTaqeemStatus,
      setUnassignedReports,
      taqeemStatus?.state,
    ],
  );

  const runPendingSubmitQueue = useCallback(
    async (queuePayload, options = {}) => {
      const { resume = false } = options;
      const reportIds = Array.isArray(queuePayload?.reportIds)
        ? queuePayload.reportIds
            .map((id) => String(id || "").trim())
            .filter(Boolean)
        : [];

      if (!reportIds.length) {
        resetPendingSubmit();
        resetReturnView();
        return { success: false, completedCount: 0, total: 0 };
      }

      const resolvedTabs = Math.max(
        1,
        Number(queuePayload?.tabsNum) ||
          Math.max(1, Number(recommendedTabs) || 3),
      );
      const startIndex = Math.max(0, Number(queuePayload?.currentIndex) || 0);
      const basePayload = {
        source: queuePayload?.source || QUICK_PAGE_SOURCE,
        reportIds,
        tabsNum: resolvedTabs,
      };

      let completedCount = 0;
      let paused = false;

      setSubmitting(true);
      try {
        for (let index = startIndex; index < reportIds.length; index += 1) {
          const recordId = reportIds[index];
          const result = await submitToTaqeem(recordId, resolvedTabs, {
            withLoading: false,
            resume: resume || index > startIndex,
          });

          if (result?.success) {
            completedCount += 1;
            setPendingSubmit({
              ...basePayload,
              currentIndex: index + 1,
              resumeOnLoad: false,
              updatedAt: Date.now(),
            });
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }

          const reason = String(result?.reason || "").toUpperCase();
          if (reason === "AUTH_REQUIRED") {
            setPendingSubmit({
              ...basePayload,
              currentIndex: index,
              resumeOnLoad: true,
              updatedAt: Date.now(),
            });
            setReturnView(QUICK_PAGE_SOURCE);
            paused = true;
            break;
          }
        }

        if (!paused) {
          resetPendingSubmit();
          resetReturnView();
        }

        return {
          success: !paused,
          paused,
          completedCount,
          total: reportIds.length,
        };
      } finally {
        setSubmitting(false);
      }
    },
    [
      recommendedTabs,
      resetPendingSubmit,
      resetReturnView,
      setPendingSubmit,
      setReturnView,
      submitToTaqeem,
    ],
  );

  useEffect(() => {
    if (storeAndSubmitLoading || submitting) return;
    if (!pendingSubmit?.resumeOnLoad) return;
    if (!token) return;
    if (taqeemStatus?.state !== "success") return;

    setPendingSubmit((prev) =>
      prev ? { ...prev, resumeOnLoad: false, updatedAt: Date.now() } : prev,
    );
    runPendingSubmitQueue(pendingSubmit, { resume: true });
  }, [
    pendingSubmit,
    runPendingSubmitQueue,
    setPendingSubmit,
    storeAndSubmitLoading,
    submitting,
    taqeemStatus?.state,
    token,
  ]);

  const userId = useMemo(
    () => user?._id || user?.id || user?.userId || user?.user?._id || null,
    [user],
  );
  const temporaryReports = isGuestUser ? reports : unassignedReports;
  const temporaryLoading = isGuestUser ? reportsLoading : unassignedLoading;
  const showTemporarySection =
    isGuestUser || unassignedLoading || unassignedReports.length > 0;

  const getReportByRecordId = useCallback(
    (recordId) =>
      reports.find((report) => getReportRecordId(report) === recordId) ||
      unassignedReports.find(
        (report) => getReportRecordId(report) === recordId,
      ),
    [reports, unassignedReports],
  );

  const handleDeleteReport = async (reportOrId, options = {}) => {
    const { confirm = true } = options;
    const report =
      typeof reportOrId === "string"
        ? getReportByRecordId(reportOrId)
        : reportOrId;
    const recordId = getReportRecordId(report);
    const taqeemReportId = report?.report_id;

    if (!report || !recordId) {
      setError(translate("messages.error.reportNotFound", "Report not found."));
      return;
    }

    if (!taqeemReportId) {
      setError(
        translate(
          "messages.error.reportMustBeSubmitted",
          "Report must be submitted to Taqeem first (must have a report_id).",
        ),
      );
      return;
    }

    if (
      confirm &&
      !window.confirm(
        translate(
          "confirm.deleteReport",
          "Are you sure you want to delete this report?",
        ),
      )
    )
      return;

    setReportActionBusy((prev) => ({ ...prev, [recordId]: true }));

    try {
      if (window?.electronAPI?.checkStatus) {
        const browserStatus = await window.electronAPI.checkStatus();
        if (browserStatus?.browserOpen && browserStatus?.status === "SUCCESS") {
          setTaqeemStatus?.("success", "Taqeem login: On");
        } else {
          setTaqeemStatus?.("info", "Taqeem login: Off");
          setSuccess(
            translate(
              "messages.success.taqeemLoginOff",
              "Taqeem login is off. Complete login in the opened browser window to continue.",
            ),
          );
        }
      }

      await ensureCompanySelected();

      if (!window?.electronAPI?.deleteReport) {
        throw new Error("Desktop integration unavailable. Restart the app.");
      }

      setSuccess(
        translate(
          "messages.success.deletingReport",
          "Deleting report {{reportId}}...",
          { reportId: taqeemReportId },
        ),
      );
      const result = await window.electronAPI.deleteReport(
        taqeemReportId,
        10,
        userId,
      );
      const status = result?.status;

      if (status !== "SUCCESS") {
        throw new Error(
          result?.message || result?.error || "Failed to delete report.",
        );
      }

      const deleteResult = await deleteSubmitReportsQuickly(recordId);
      if (!deleteResult?.success) {
        throw new Error(
          deleteResult?.message ||
            "Report deleted in Taqeem, but failed to remove it locally.",
        );
      }

      setSuccess(
        result?.message ||
          translate(
            "messages.success.reportDeleted",
            "Report deleted successfully.",
          ),
      );
      await loadReports();
    } catch (err) {
      setError(
        err?.message ||
          translate("messages.error.deleteReport", "Failed to delete report."),
      );
    } finally {
      setReportActionBusy((prev) => ({ ...prev, [recordId]: false }));
    }
  };

  const handleEditReport = (report) => {
    const recordId = getReportRecordId(report);
    if (!recordId) return;
    setFormData({
      title: report.title || "",
      client_name: report.client_name || "",
      purpose_id: String(report.purpose_id || "1"),
      value_premise_id: String(report.value_premise_id || "1"),
      report_type: report.report_type || "تقرير مفصل",
      telephone: report.telephone || "999999999",
      email: report.email || "a@a.com",
    });
    setEditingReportId(recordId);
  };

  const handleUpdateReport = async () => {
    if (!editingReportId) return;

    setSubmitting(true);
    try {
      const result = await updateSubmitReportsQuickly(
        editingReportId,
        formData,
      );
      if (result?.success) {
        setSuccess(
          translate(
            "messages.success.reportUpdated",
            "Report updated successfully.",
          ),
        );
        setEditingReportId(null);
        await loadReports();
      } else {
        setError(result?.message || "Failed to update report.");
      }
    } catch (err) {
      setError(
        err?.message ||
          translate("messages.error.updateReport", "Failed to update report."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkAction = async () => {
    if (!bulkAction) return;

    const selectedIds = selectedReportIds.filter(Boolean);
    if (selectedIds.length === 0) {
      setError(
        translate(
          "messages.error.selectReport",
          "Please select at least one report.",
        ),
      );
      return;
    }

    if (bulkAction === "delete") {
      if (
        !window.confirm(
          translate(
            "confirm.deleteMultipleReports",
            "Are you sure you want to delete {{count}} report(s)?",
            { count: selectedIds.length },
          ),
        )
      )
        return;
      const selectedReports = selectedIds
        .map((id) => getReportByRecordId(id))
        .filter(Boolean);

      for (const report of selectedReports) {
        await handleDeleteReport(report, { confirm: false });
      }
      setSelectedReportIds([]);
      setBulkAction("");
      return;
    }

    if (bulkAction === "upload-submit" || bulkAction === "retry-submit") {
      // Ensure login and company selection before any submission/retry
      const authStatus = await ensureTaqeemAuthorized(
        token,
        onViewChange,
        taqeemStatus?.state === "success",
        0,
        login,
        setTaqeemStatus,
        authOptions,
      );
      if (authStatus?.status === "INSUFFICIENT_POINTS") {
        setError(
          getTaqeemAuthErrorMessage(
            authStatus,
            translate(
              "messages.error.insufficientPoints",
              "You don't have enough points to submit reports.",
            ),
          ),
        );
        return;
      }
      if (
        authStatus?.status === "LOGIN_REQUIRED" ||
        !isTaqeemAuthSuccess(authStatus)
      ) {
        setError(
          getTaqeemAuthErrorMessage(
            authStatus,
            translate(
              "messages.error.taqeemLoginRequired",
              "Taqeem login required. Finish login and choose a company to continue.",
            ),
          ),
        );
        return;
      }
      const selectedReports = selectedIds
        .map((id) => getReportByRecordId(id))
        .filter(Boolean);
      const requiresManualCompany = selectedReports.some(
        (report) => !report?.company_office_id,
      );
      const chosen = await ensureCompanySelected({
        forceSelection: requiresManualCompany,
        ignorePreferred: requiresManualCompany,
      });
      const officeId =
        chosen?.officeId || chosen?.office_id || selectedCompanyOfficeId;
      if (requiresManualCompany && officeId) {
        try {
          const nextOfficeId = String(officeId);
          await Promise.all(
            selectedReports.map((report) => {
              if (report?.company_office_id) return Promise.resolve();
              const id = getReportRecordId(report);
              if (!id) return Promise.resolve();
              report.company_office_id = nextOfficeId;
              return updateSubmitReportsQuickly(id, {
                company_office_id: nextOfficeId,
              });
            }),
          );
          await loadReports();
          await loadUnassignedReports();
        } catch (err) {
          console.warn(
            "Failed to update company office id for bulk reports",
            err,
          );
        }
      }

      // Calculate initial tabs per browser (distribute evenly)
      const totalTabs = Math.max(1, Number(recommendedTabs) || 3);
      const numReports = selectedIds.length;
      const initialTabsPerBrowser = Math.floor(totalTabs / numReports);
      const remainderTabs = totalTabs % numReports;

      // Initialize progress for all reports
      const initialProgress = {};
      selectedIds.forEach((id) => {
        initialProgress[id] = {
          percentage: 0,
          status: "pending",
          message: "Waiting to start...",
        };
      });
      setReportProgress(initialProgress);

      const submissionPromises = [];
      let queueError = null;

      for (let index = 0; index < selectedIds.length; index += 1) {
        const id = selectedIds[index];

        // Calculate tabs for this browser (distribute evenly, remainder goes to first browsers)
        let tabsNum = initialTabsPerBrowser;
        if (index < remainderTabs) {
          tabsNum += 1; // Give remainder tabs to first browsers
        }
        tabsNum = Math.max(1, tabsNum); // Ensure at least 1 tab

        // Update progress to starting
        setReportProgress((prev) => ({
          ...prev,
          [id]: {
            percentage: 0,
            status: "starting",
            message: "Opening browser...",
          },
        }));

        if (bulkAction === "upload-submit") {
          clearReportCreatedCache(id);
          const reportCreatedPromise = waitForReportCreated(id);

          const submissionPromise = submitToTaqeem(id, tabsNum, {
            withLoading: false,
          }).catch((err) => {
            setReportProgress((prev) => ({
              ...prev,
              [id]: {
                percentage: 0,
                status: "error",
                message: err.message || "Submission failed",
              },
            }));
            throw err;
          });
          submissionPromises.push(submissionPromise);

          try {
            await reportCreatedPromise;
          } catch (err) {
            queueError = err;
            setReportProgress((prev) => ({
              ...prev,
              [id]: {
                percentage: 0,
                status: "error",
                message: err.message || "Failed to create report id",
              },
            }));
            break;
          }
        } else if (bulkAction === "retry-submit") {
          const retryPromise = window.electronAPI
            ?.retryCreateReportById?.(id, tabsNum)
            .then((result) => {
              const isSuccess = result?.success || result?.status === "SUCCESS";
              if (!isSuccess) {
                throw new Error(
                  result?.message || result?.error || "Retry failed",
                );
              }
              setReportProgress((prev) => ({
                ...prev,
                [id]: {
                  percentage: 100,
                  status: "completed",
                  message: result?.message || "Retry completed",
                },
              }));
            })
            .catch((err) => {
              setReportProgress((prev) => ({
                ...prev,
                [id]: {
                  percentage: 0,
                  status: "error",
                  message: err.message || "Retry failed",
                },
              }));
              throw err;
            });
          submissionPromises.push(retryPromise);
        }
      }

      await Promise.allSettled(submissionPromises);

      setSelectedReportIds([]);
      setBulkAction("");
      if (queueError) {
        setError(
          queueError.message ||
            translate(
              "messages.error.queueStopped",
              "Stopped queue: report id was not created.",
            ),
        );
      } else {
        setSuccess(
          translate(
            "messages.success.reportsSubmittedStatus",
            "All {{count}} report(s) submitted. Check progress bars for status.",
            { count: selectedIds.length },
          ),
        );
      }
      return;
    }

    if (bulkAction === "send-approver") {
      try {
        setSuccess(
          translate(
            "messages.success.sendingToApprover",
            "Sending {{count}} report(s) to approver...",
            { count: selectedIds.length },
          ),
        );

        // Get reports with report_id (Taqeem report IDs)
        const reportsToSend = selectedIds
          .map((id) => reports.find((r) => getReportRecordId(r) === id))
          .filter((r) => r && r.report_id);

        if (reportsToSend.length === 0) {
          setError(
            translate(
              "messages.error.noReportsWithTaqeemId",
              "No reports with Taqeem report IDs found. Reports must be submitted to Taqeem first.",
            ),
          );
          return;
        }
        const reportIds = useMemo(
          () => reports.map(getReportRecordId).filter(Boolean),
          [reports],
        );

        if (!window.electronAPI?.finalizeMultipleReports) {
          throw new Error("Desktop integration unavailable. Restart the app.");
        }

        const result =
          await window.electronAPI.finalizeMultipleReports(reportIds);

        if (result?.status !== "SUCCESS") {
          throw new Error(
            result?.error || "Failed to send reports to approver.",
          );
        }

        // Update report status to "sent" for all selected reports
        for (const id of selectedIds) {
          try {
            await updateSubmitReportsQuickly(id, { report_status: "sent" });
          } catch (err) {
            console.error(`Failed to update report ${id}:`, err);
          }
        }

        await loadReports();
        setSelectedReportIds([]);
        setBulkAction("");
        setSuccess(
          translate(
            "messages.success.sentToApprover",
            "Successfully sent {{count}} report(s) to approver.",
            { count: reportsToSend.length },
          ),
        );
      } catch (err) {
        setError(
          err?.message ||
            translate(
              "messages.error.sendToApprover",
              "Failed to send reports to approver.",
            ),
        );
      }
      return;
    }

    if (bulkAction === "approve") {
      try {
        setSuccess(
          translate(
            "messages.success.approvingReports",
            "Approving {{count}} report(s)...",
            { count: selectedIds.length },
          ),
        );

        for (const id of selectedIds) {
          try {
            await updateSubmitReportsQuickly(id, { checked: true });
          } catch (err) {
            console.error(`Failed to approve report ${id}:`, err);
          }
        }

        await loadReports();
        setSelectedReportIds([]);
        setBulkAction("");
        setSuccess(
          translate(
            "messages.success.approvedReports",
            "Successfully approved {{count}} report(s).",
            { count: selectedIds.length },
          ),
        );
      } catch (err) {
        setError(
          err?.message ||
            translate(
              "messages.error.approveReports",
              "Failed to approve reports.",
            ),
        );
      }
      return;
    }
  };

  const handleReportAction = async (report, action) => {
    const recordId = getReportRecordId(report);
    if (!recordId) return;
    const assetList = report?.asset_data || [];

    if (action === "submit-taqeem") {
      const assetCount = Array.isArray(assetList) ? assetList.length : 0;
      const tabsNum = resolveTabsForAssets(assetCount);
      try {
        await submitToTaqeem(recordId, tabsNum, { withLoading: false });
      } catch (err) {
        setError(
          err?.message ||
            translate(
              "messages.error.submitTaqeem",
              "Failed to submit report to Taqeem.",
            ),
        );
      }
    } else if (action === "check-status") {
      const taqeemReportId = report.report_id;
      if (!taqeemReportId) {
        setError(
          translate(
            "messages.error.reportNeedsTaqeemId",
            "Report must have a Taqeem report_id to check status.",
          ),
        );
        return;
      }
      const tabsNum = Math.max(1, Number(recommendedTabs) || 1);
      setReportActionBusy((prev) => ({ ...prev, [recordId]: true }));
      try {
        await executeWithAuth(
          async (params) => {
            const { reportId: id, tabsNum: tabs } = params;
            await window.electronAPI?.fullCheck?.(id, tabs);
            setTimeout(() => {
              loadReports();
            }, 1000);
            return { success: true };
          },
          { token, reportId: taqeemReportId, tabsNum },
          {
            requiredPoints: 1,
            showInsufficientPointsModal: () =>
              setShowInsufficientPointsModal(true),
            onViewChange,
            onAuthFailure: (reason) => {
              if (
                reason !== "INSUFFICIENT_POINTS" &&
                reason !== "LOGIN_REQUIRED"
              ) {
                setError(
                  reason?.message ||
                    translate(
                      "messages.error.authFailed",
                      "Authentication failed for full check",
                    ),
                );
              }
            },
          },
        );
      } catch (err) {
        setError(
          err?.message ||
            translate(
              "messages.error.fullCheck",
              "Failed to perform full check",
            ),
        );
      } finally {
        setReportActionBusy((prev) => ({ ...prev, [recordId]: false }));
      }
    } else if (action === "retry") {
      const assetCount = Array.isArray(assetList) ? assetList.length : 0;
      const tabsNum = resolveTabsForAssets(assetCount);
      setReportActionBusy((prev) => ({ ...prev, [recordId]: true }));
      try {
        const authStatus = await ensureTaqeemAuthorized(
          token,
          onViewChange,
          taqeemStatus?.state === "success",
          0,
          login,
          setTaqeemStatus,
          authOptions,
        );
        if (authStatus?.status === "INSUFFICIENT_POINTS") {
          setError(
            getTaqeemAuthErrorMessage(
              authStatus,
              translate(
                "messages.error.insufficientPoints",
                "You don't have enough points to submit reports.",
              ),
            ),
          );
          return;
        }
        if (
          authStatus?.status === "LOGIN_REQUIRED" ||
          !isTaqeemAuthSuccess(authStatus)
        ) {
          setError(
            getTaqeemAuthErrorMessage(
              authStatus,
              translate(
                "messages.error.taqeemLoginRequired",
                "Taqeem login required. Finish login and choose a company to continue.",
              ),
            ),
          );
          return;
        }
        const requiresManualCompany = !report?.company_office_id;
        const chosen = await ensureCompanySelected({
          forceSelection: requiresManualCompany,
          ignorePreferred: requiresManualCompany,
        });
        const officeId =
          chosen?.officeId || chosen?.office_id || selectedCompanyOfficeId;
        const assignedOfficeId = officeId ? String(officeId) : "";
        if (requiresManualCompany && assignedOfficeId) {
          try {
            await updateSubmitReportsQuickly(recordId, {
              company_office_id: assignedOfficeId,
            });
            if (report) {
              report.company_office_id = assignedOfficeId;
            }
            await loadReports();
            await loadUnassignedReports();
          } catch (err) {
            console.warn("Failed to update report company office id", err);
          }
        }
        const result = await window.electronAPI?.retryCreateReportById?.(
          recordId,
          tabsNum,
        );
        const isSuccess = result?.success || result?.status === "SUCCESS";
        if (!isSuccess) {
          throw new Error(result?.message || result?.error || "Retry failed");
        }
        const createdReportId =
          result?.reportId || result?.report_id || report?.report_id;
        if (createdReportId) {
          try {
            await updateSubmitReportsQuickly(recordId, {
              report_id: createdReportId,
              ...(assignedOfficeId
                ? { company_office_id: assignedOfficeId }
                : {}),
            });
            if (report) {
              report.report_id = createdReportId;
            }
          } catch (err) {
            console.warn("Failed to update report_id after retry", err);
          }
        }
        setSuccess(
          result?.message ||
            translate("messages.success.retryCompleted", "Retry completed."),
        );
        await loadReports();
      } catch (err) {
        setError(
          err?.message ||
            translate(
              "messages.error.retryAssetSubmission",
              "Failed to retry asset submission.",
            ),
        );
      } finally {
        setReportActionBusy((prev) => ({ ...prev, [recordId]: false }));
      }
    } else if (action === "delete") {
      handleDeleteReport(report);
    } else if (action === "edit") {
      handleEditReport(report);
    } else if (action === "send-approver") {
      setReportActionBusy((prev) => ({ ...prev, [recordId]: true }));
      try {
        if (!report.report_id) {
          setError(
            translate(
              "messages.error.reportMustBeSubmitted",
              "Report must be submitted to Taqeem first (must have a report_id).",
            ),
          );
          return;
        }

        setSuccess(
          translate(
            "messages.success.sendingReportToApprover",
            "Sending report to approver...",
          ),
        );

        if (!window.electronAPI?.finalizeMultipleReports) {
          throw new Error("Desktop integration unavailable. Restart the app.");
        }

        const result = await window.electronAPI.finalizeMultipleReports([
          report.report_id,
        ]);

        if (result?.status !== "SUCCESS") {
          throw new Error(
            result?.error || "Failed to send report to approver.",
          );
        }

        // Update report status to "sent"
        await updateSubmitReportsQuickly(recordId, { report_status: "sent" });

        await loadReports();
        setSuccess(
          translate(
            "messages.success.reportSentToApprover",
            "Report sent to approver successfully.",
          ),
        );
      } catch (err) {
        setError(
          err?.message ||
            translate(
              "messages.error.sendReportToApprover",
              "Failed to send report to approver.",
            ),
        );
      } finally {
        setReportActionBusy((prev) => ({ ...prev, [recordId]: false }));
      }
    } else if (action === "approve") {
      setReportActionBusy((prev) => ({ ...prev, [recordId]: true }));
      try {
        setSuccess(
          translate("messages.success.approvingReport", "Approving report..."),
        );

        await updateSubmitReportsQuickly(recordId, { checked: true });

        await loadReports();
        setSuccess(
          translate(
            "messages.success.reportApproved",
            "Report approved successfully.",
          ),
        );
      } catch (err) {
        setError(
          err?.message ||
            translate(
              "messages.error.approveReport",
              "Failed to approve report.",
            ),
        );
      } finally {
        setReportActionBusy((prev) => ({ ...prev, [recordId]: false }));
      }
    }
  };

  const toggleReportExpansion = (reportId) => {
    setExpandedReports((prev) =>
      prev.includes(reportId)
        ? prev.filter((id) => id !== reportId)
        : [...prev, reportId],
    );
  };

  const toggleReportSelection = (reportId) => {
    setSelectedReportIds((prev) =>
      prev.includes(reportId)
        ? prev.filter((id) => id !== reportId)
        : [...prev, reportId],
    );
  };

  const filteredReports = useMemo(() => {
    let filtered = reports;
    const selectedOfficeId = normalizeOfficeId(selectedCompanyOfficeId);

    if (selectedOfficeId) {
      filtered = filtered.filter(
        (report) => getReportCompanyOfficeId(report) === selectedOfficeId,
      );
    }

    // Apply status filter
    if (reportSelectFilter !== "all") {
      filtered = filtered.filter(
        (report) => getReportStatus(report) === reportSelectFilter,
      );
    }

    // Apply search filter if there's a search term
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      filtered = filtered.filter((report) => {
        // Search in client_name
        if (
          report.client_name &&
          report.client_name.toLowerCase().includes(term)
        ) {
          return true;
        }
        // Search in report_id
        if (report.report_id && report.report_id.toLowerCase().includes(term)) {
          return true;
        }
        // Search in final_value (convert to string for comparison)
        if (
          report.final_value &&
          String(report.final_value).toLowerCase().includes(term)
        ) {
          return true;
        }
        // Search in title
        if (report.title && report.title.toLowerCase().includes(term)) {
          return true;
        }
        return false;
      });
    }

    return filtered;
  }, [reports, reportSelectFilter, searchTerm, selectedCompanyOfficeId]);

  // Use backend pagination info
  const totalPages = reportsPagination.totalPages || 1;

  useEffect(() => {
    if (currentPage > 0) {
      loadReports();
    }
  }, [currentPage]);

  const handlePageChange = useCallback(
    (newPage) => {
      if (
        newPage >= 1 &&
        newPage <= reportsPagination.totalPages &&
        !reportsLoading
      ) {
        setCurrentPage(newPage);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [reportsPagination.totalPages, reportsLoading],
  );

  const selectedReportSet = useMemo(
    () => new Set(selectedReportIds),
    [selectedReportIds],
  );
  const filteredReportIds = useMemo(
    () => filteredReports.map(getReportRecordId).filter(Boolean),
    [filteredReports],
  );
  const allFilteredSelected =
    filteredReportIds.length > 0 &&
    filteredReportIds.every((id) => selectedReportSet.has(id));

  const handleToggleSelectAll = () => {
    setSelectedReportIds((prev) => {
      if (filteredReportIds.length === 0) return prev;
      const next = new Set(prev);
      const allSelected = filteredReportIds.every((id) => next.has(id));

      if (allSelected) {
        filteredReportIds.forEach((id) => next.delete(id));
      } else {
        filteredReportIds.forEach((id) => next.add(id));
      }

      return Array.from(next);
    });
  };

  return (
    <div className="relative p-2 space-y-2 page-animate overflow-x-hidden">
      {showInsufficientPointsModal && (
        <div className="fixed inset-0 z-[9999]">
          <div className="absolute top-20 left-1/2 transform -translate-x-1/2 w-full max-w-sm">
            <InsufficientPointsModal
              viewChange={onViewChange}
              onClose={closeInsufficientPointsModal}
              details={insufficientPointsMeta}
            />
          </div>
        </div>
      )}
      <DeductionNotification
        source="submit-reports-quickly"
        defaultPageName={QUICK_PAGE_NAME}
        defaultPageSource={QUICK_PAGE_SOURCE}
        onViewChange={onViewChange}
      />
      <div className="space-y-1.5">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-dashed border-slate-300 bg-slate-50 cursor-pointer hover:bg-blue-50 hover:border-blue-400 transition-all min-w-[180px] flex-[0.85] group">
              <div className="flex items-center gap-2 text-[10px] text-slate-700">
                <FileSpreadsheet className="w-4 h-4 text-blue-600 group-hover:text-blue-700" />
                <span className="font-semibold">
                  {excelFiles.length ? (
                    excelFiles.length === 1 ? (
                      <span
                        className="truncate max-w-[150px]"
                        title={excelFiles[0].name}
                      >
                        {excelFiles[0].name}
                      </span>
                    ) : (
                      translate(
                        "filePicker.selectedFiles",
                        "{{count}} file(s) selected",
                        { count: excelFiles.length },
                      )
                    )
                  ) : (
                    translate("filePicker.chooseExcel", "Choose Excel file")
                  )}
                </span>
              </div>
              <input
                ref={excelInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleExcelChange}
                onClick={(e) => {
                  e.currentTarget.value = null;
                }}
              />
              <span className="text-[10px] font-semibold text-blue-600 group-hover:text-blue-700 whitespace-nowrap">
                {translate("filePicker.browse", "Browse")}
              </span>
            </label>
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-dashed border-slate-300 bg-slate-50 transition-all hover:bg-blue-50 hover:border-blue-400 min-w-[220px] flex-[1.35] group">
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-700">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  checked={wantsPdfUpload}
                  onChange={(e) => handlePdfToggle(e.target.checked)}
                />
                <Files className="w-4 h-4 text-blue-600" />
                <span className="font-semibold">
                  {translate("filePicker.uploadPdfs", "Upload PDFs")}
                </span>
                <span className="text-[10px] text-slate-600">
                  {pdfFiles.length
                    ? translate(
                        "filePicker.selectedPdfs",
                        "{{count}} file(s) selected",
                        { count: pdfFiles.length },
                      )
                    : wantsPdfUpload
                      ? translate(
                          "filePicker.choosePdfFiles",
                          "Choose PDF files",
                        )
                      : translate(
                          "filePicker.willUseDummyPdf",
                          "Will use {{placeholder}}",
                          { placeholder: DUMMY_PDF_NAME },
                        )}
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
                className="text-[10px] font-semibold text-blue-600 hover:text-blue-700 whitespace-nowrap"
              >
                {translate("filePicker.browse", "Browse")}
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                disabled={downloadingTemplate}
                className="inline-flex items-center gap-1.5 rounded-md border border-blue-600 bg-blue-50 px-2.5 py-1.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 hover:border-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {downloadingTemplate ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                {downloadingTemplate
                  ? translate("filePicker.downloading", "Downloading...")
                  : translate(
                      "filePicker.exportTemplate",
                      "Export Excel Template",
                    )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExcelFiles([]);
                  setPdfFiles([]);
                  setWantsPdfUpload(false);
                  resetValidation();
                  resetMessages();
                  if (excelInputRef?.current) {
                    excelInputRef.current.value = null;
                  }
                  if (pdfInputRef?.current) {
                    pdfInputRef.current.value = null;
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {translate("filePicker.reset", "Reset")}
              </button>
            </div>
          </div>
        </div>
        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleStoreAndSubmit}
            disabled={storeAndSubmitLoading || !isReadyToUpload}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md
                                bg-green-600 hover:bg-green-700
                                text-white text-xs font-semibold
                                shadow-md hover:shadow-lg hover:scale-[1.01]
                                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                                transition-all"
          >
            {storeAndSubmitLoading || submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {storeAndSubmitLoading
              ? translate("actions.uploading", "Uploading...")
              : submitting
                ? translate("actions.submitting", "Submitting...")
                : translate(
                    "actions.storeAndSubmitNow",
                    "Store and Submit Now",
                  )}
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={storeOnlyLoading || !isReadyToUpload}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md
                                bg-blue-600 hover:bg-blue-700
                                text-white text-xs font-semibold
                                shadow-md hover:shadow-lg hover:scale-[1.01]
                                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                                transition-all"
          >
            {storeOnlyLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileIcon className="w-4 h-4" />
            )}
            {storeOnlyLoading
              ? translate("actions.uploading", "Uploading...")
              : translate(
                  "actions.storeAndSubmitLater",
                  "Store and Submit Later",
                )}
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {(error || success) && (
        <div
          className={`rounded-lg border px-2.5 py-1.5 flex items-start gap-2 shadow-sm card-animate ${
            error
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

      {/* Validation Console */}
      <button
        type="button"
        onClick={() => {
          if (canOpenValidation) {
            setShowValidationModal(true);
          }
        }}
        disabled={!canOpenValidation}
        className={`w-full rounded-lg border border-blue-200/60 bg-gradient-to-r from-blue-50/70 via-white to-blue-50/70 px-3 py-2 text-left shadow-sm card-animate flex flex-wrap items-center justify-between gap-2 ${canOpenValidation ? "hover:border-blue-300/70" : "cursor-default"} disabled:opacity-80`}
      >
        <span className="text-xs font-semibold text-slate-700">
          {translate("validation.panelHeader", "Validation on Excel sheet")}
        </span>
        <span
          className={`text-xs font-semibold ${
            validationStatus.tone === "error"
              ? "text-rose-600"
              : validationStatus.tone === "success"
                ? "text-emerald-600"
                : validationStatus.tone === "info"
                  ? "text-blue-600"
                  : "text-slate-500"
          }`}
        >
          {validationStatus.text}
        </span>
      </button>

      {showTemporarySection && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 shadow-sm p-3 mb-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-amber-900">
                Temporary Reports
              </h3>
              <p className="text-[10px] text-amber-700">
                Reports without company assignment.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowTemporaryModal(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-50"
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
            className="w-full max-w-5xl rounded-lg bg-white shadow-lg border border-amber-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-amber-100">
              <div>
                <h3 className="text-base font-semibold text-amber-900">
                  Temporary Reports
                </h3>
                <p className="text-[11px] text-amber-700">
                  Reports without company assignment.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTemporaryModal(false)}
                className="text-amber-700 hover:text-amber-900 text-sm font-semibold"
              >
                Close
              </button>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="text-[11px] text-amber-700">
                {isGuestUser ? "Guest session reports." : "Unassigned reports."}
              </div>
              <button
                type="button"
                onClick={() =>
                  isGuestUser ? loadReports() : loadUnassignedReports()
                }
                disabled={temporaryLoading}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
              >
                <RefreshCw
                  className={`w-3 h-3 ${temporaryLoading ? "animate-spin" : ""}`}
                />
                {temporaryLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="px-4 pb-4">
              {temporaryLoading ? (
                <div className="text-[11px] text-amber-700">
                  Loading temporary reports...
                </div>
              ) : temporaryReports.length === 0 ? (
                <div className="text-[11px] text-amber-700">
                  No temporary reports found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-slate-700">
                    <thead className="bg-amber-100/70 text-amber-900">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Report ID</th>
                        <th className="px-2 py-1.5 text-left">Client</th>
                        <th className="px-2 py-1.5 text-left">Assets</th>
                        <th className="px-2 py-1.5 text-left">Status</th>
                        <th className="px-2 py-1.5 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {temporaryReports.map((report) => {
                        const recordId = getReportRecordId(report);
                        const assetCount = Array.isArray(report?.asset_data)
                          ? report.asset_data.length
                          : 0;
                        const statusKey = getReportStatus(report);
                        const statusLabel =
                          reportStatusLabels[statusKey] || statusKey || "New";
                        const statusClass =
                          reportStatusClasses[statusKey] ||
                          "border-slate-200 bg-slate-50 text-slate-700";
                        return (
                          <tr
                            key={recordId || report._id}
                            className="hover:bg-amber-50/60"
                          >
                            <td className="px-2 py-1.5 text-[11px] text-slate-800">
                              {report.report_id || "Not Submitted"}
                            </td>
                            <td className="px-2 py-1.5 text-[11px] text-slate-700">
                              {report.client_name || report.title || "???"}
                            </td>
                            <td className="px-2 py-1.5 text-[11px] text-slate-700">
                              {assetCount}
                            </td>
                            <td className="px-2 py-1.5 text-[11px]">
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass}`}
                              >
                                {statusLabel}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-[11px]">
                              <button
                                type="button"
                                onClick={() => {
                                  const tabs = resolveTabsForAssets(assetCount);
                                  submitToTaqeem(recordId, tabs);
                                }}
                                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-700"
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
                <div className="mt-3 flex items-center justify-between rounded-md border border-amber-200 bg-amber-100/60 px-2 py-1 text-[10px] text-amber-900">
                  <span>
                    Register your account to keep these reports linked to your
                    phone.
                  </span>
                  <button
                    type="button"
                    onClick={() => onViewChange?.("registration")}
                    className="rounded-md bg-amber-700 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-amber-800"
                  >
                    Register
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-800">
            {translate("reports.title", "Reports")}
          </h3>
        </div>
        <div className="space-y-">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <select
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value)}
              className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer truncate"
            >
              <option value="">
                {translate("reports.bulkActions", "Bulk Actions")}
              </option>
              <option value="upload-submit">
                {translate("reports.bulk.uploadAndSubmit", "Submit to Taqeem")}
              </option>
              <option value="delete">
                {translate("reports.bulk.delete", "Delete")}
              </option>
              <option value="send-approver">
                {translate("reports.bulk.sendToApprover", "Send to Approver")}
              </option>
              <option value="approve">
                {translate("reports.bulk.approve", "Approve")}
              </option>
            </select>
            <button
              type="button"
              onClick={handleBulkAction}
              disabled={!bulkAction || selectedReportIds.length === 0}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold"
            >
              {translate("reports.goButton", "Go")}
            </button>

            <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
              {translate("reports.filter.label", "Filter:")}
              <select
                value={reportSelectFilter}
                onChange={(e) => {
                  setReportSelectFilter(e.target.value);
                  setCurrentPage(1); // Reset to page 1 when filter changes
                }}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer"
              >
                <option value="all">
                  {translate("reports.filter.all", "All statuses")}
                </option>
                <option value="new">
                  {translate("reports.filter.new", "New")}
                </option>
                <option value="incomplete">
                  {translate("reports.filter.incomplete", "Incomplete")}
                </option>
                <option value="sent">
                  {translate("reports.filter.sent", "Sent")}
                </option>
                <option value="complete">
                  {translate("reports.filter.complete", "Complete")}
                </option>
                <option value="approved">
                  {translate("reports.filter.approved", "Approved")}
                </option>
              </select>
            </label>

            <div className="relative">
              <input
                type="text"
                placeholder={translate(
                  "reports.searchPlaceholder",
                  "Search by client, report ID, or value...",
                )}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1); // Reset to page 1 when searching
                }}
                className="rounded-md border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 w-52"
              />
              <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                <svg
                  className="w-3.5 h-3.5 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  ></path>
                </svg>
              </div>
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M6 18L18 6M6 6l12 12"
                    ></path>
                  </svg>
                </button>
              )}
            </div>

            <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
              {translate("reports.itemsPerPageLabel", "Items per page:")}
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
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
            <button
              type="button"
              onClick={() => loadReports()}
              disabled={reportsLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${reportsLoading ? "animate-spin" : ""}`}
              />
              {reportsLoading
                ? translate("reports.refresh.refreshing", "Refreshing...")
                : translate("reports.refresh.refresh", "Refresh")}
            </button>

            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-700">
              <span className="text-slate-600">
                {translate("reports.totalCount", "Total: {{count}} report(s)", {
                  count: filteredReports.length,
                })}
              </span>
              {filteredReports.length > 0 && (
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  {allFilteredSelected
                    ? translate("reports.clearAll", "Clear all")
                    : translate("reports.selectAll", "Select all")}
                </button>
              )}
            </div>
          </div>
        </div>

        {reportsLoading && reports.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-600 py-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            {translate("reports.loading", "Loading reports...")}
          </div>
        )}

        {!reportsLoading && !reports.length && (
          <div className="text-xs text-slate-600 py-2 text-center">
            {translate(
              "reports.empty",
              "No reports found. Upload Excel files to create reports.",
            )}
          </div>
        )}

        {!reportsLoading && reports.length > 0 && !filteredReports.length && (
          <div className="text-xs text-slate-600 py-2 text-center">
            {translate(
              "reports.noMatch",
              "No reports match the selected filters.",
            )}
          </div>
        )}

        {filteredReports.length > 0 && (
          <>
            <div className="w-full overflow-x-auto">
              <div className="min-w-full">
                <table className="w-full text-xs text-slate-700">
                  <thead className="bg-gradient-to-r from-blue-50 to-indigo-50 text-slate-800 border-b-2 border-blue-200">
                    <tr>
                      <th className="px-2 py-2 text-left w-12 text-[10px] font-semibold uppercase tracking-wider">
                        {translate("reports.table.index", "#")}
                      </th>
                      <th className="px-2 py-2 text-left w-10 text-[10px] font-semibold uppercase tracking-wider"></th>
                      <th className="px-2 py-2 text-left w-32 text-[10px] font-semibold uppercase tracking-wider">
                        {translate("reports.table.reportId", "Report ID")}
                      </th>
                      <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                        {translate("reports.table.client", "Client")}
                      </th>
                      <th className="px-2 py-2 text-left w-24 text-[10px] font-semibold uppercase tracking-wider">
                        {translate("reports.table.finalValue", "Final value")}
                      </th>
                      <th className="px-2 py-2 text-left w-28 text-[10px] font-semibold uppercase tracking-wider">
                        {translate("reports.table.status", "Status")}
                      </th>
                      <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                        {translate("reports.table.action", "Action")}
                      </th>
                      <th className="px-2 py-2 text-left w-16 text-[10px] font-semibold uppercase tracking-wider">
                        {translate("reports.table.select", "Select")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReports.map((report, idx) => {
                      const recordId = getReportRecordId(report);
                      const statusKey = getReportStatus(report);
                      const assetList = Array.isArray(report.asset_data)
                        ? report.asset_data
                        : [];
                      const rawStatusLabel =
                        reportStatusLabels[statusKey] || statusKey;
                      const localizedStatusLabel = translate(
                        `reports.status.${statusKey}`,
                        rawStatusLabel,
                      );
                      const isExpanded = recordId
                        ? expandedReports.includes(recordId)
                        : false;
                      const reportBusy = recordId
                        ? reportActionBusy[recordId]
                        : null;

                      return (
                        <React.Fragment key={recordId || `report-${idx}`}>
                          <tr className="border-t border-slate-200 bg-white hover:bg-blue-50/30 transition-colors">
                            <td className="px-2 py-2 text-slate-600 text-xs font-medium">
                              {idx + 1}
                            </td>
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                onClick={() =>
                                  recordId && toggleReportExpansion(recordId)
                                }
                                disabled={!recordId}
                                className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-slate-300 text-slate-700 hover:bg-blue-50 hover:border-blue-400 disabled:opacity-50 transition-colors"
                                aria-label={
                                  isExpanded
                                    ? translate(
                                        "reports.actions.hideAssets",
                                        "Hide assets",
                                      )
                                    : translate(
                                        "reports.actions.showAssets",
                                        "Show assets",
                                      )
                                }
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </td>
                            <td className="px-2 py-2">
                              <div
                                className="text-xs font-semibold text-slate-900 truncate"
                                title={
                                  report.report_id ||
                                  translate(
                                    "reports.notSubmitted",
                                    "Not submit",
                                  )
                                }
                              >
                                {report.report_id ||
                                  translate(
                                    "reports.notSubmitted",
                                    "Not submit",
                                  )}
                              </div>
                              <div
                                className="text-[10px] text-slate-500 truncate"
                                title={recordId || "-"}
                              >
                                {recordId || "-"}
                              </div>
                            </td>
                            <td
                              className="px-2 py-2 truncate"
                              title={report.client_name || "-"}
                            >
                              <span className="text-xs text-slate-700">
                                {report.client_name || "-"}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-xs font-medium text-slate-700">
                              {report.final_value || "-"}
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex flex-col gap-1">
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                    reportStatusClasses[statusKey] ||
                                    "border-blue-200 bg-blue-50 text-blue-700"
                                  }`}
                                >
                                  {localizedStatusLabel}
                                </span>
                                {reportProgress[recordId] && (
                                  <div className="w-full space-y-1">
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[9px] text-slate-600 font-medium">
                                        {Math.round(
                                          reportProgress[recordId].percentage,
                                        )}
                                        %
                                      </span>
                                      <span
                                        className="text-[9px] text-slate-500 truncate max-w-[120px]"
                                        title={reportProgress[recordId].message}
                                      >
                                        {reportProgress[recordId].message}
                                      </span>
                                    </div>
                                    <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className={`h-full transition-all duration-300 ${
                                          reportProgress[recordId].status ===
                                          "error"
                                            ? "bg-red-500"
                                            : reportProgress[recordId]
                                                  .status === "paused"
                                              ? "bg-yellow-500"
                                              : reportProgress[recordId]
                                                    .status === "stopped"
                                                ? "bg-slate-500"
                                                : "bg-blue-600"
                                        }`}
                                        style={{
                                          width: `${Math.min(100, Math.max(0, reportProgress[recordId].percentage))}%`,
                                        }}
                                      />
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {(() => {
                                        const currentStatus =
                                          reportProgress[recordId]?.status;
                                        const isProcessing =
                                          currentStatus === "processing" ||
                                          currentStatus === "starting";
                                        const isPaused =
                                          currentStatus === "paused";
                                        const canStop = [
                                          "processing",
                                          "starting",
                                          "paused",
                                        ].includes(currentStatus);

                                        return (
                                          <>
                                            {isProcessing && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  pauseReportProcess(recordId)
                                                }
                                                className="px-1.5 py-0.5 text-[9px] rounded border border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors"
                                              >
                                                Pause
                                              </button>
                                            )}
                                            {isPaused && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  resumeReportProcess(recordId)
                                                }
                                                className="px-1.5 py-0.5 text-[9px] rounded border border-emerald-400 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                                              >
                                                Resume
                                              </button>
                                            )}
                                            {canStop && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  stopReportProcess(recordId)
                                                }
                                                className="px-1.5 py-0.5 text-[9px] rounded border border-rose-400 text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors"
                                              >
                                                Stop
                                              </button>
                                            )}
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1">
                                  <select
                                    value={actionDropdown[recordId] || ""}
                                    disabled={
                                      !recordId || submitting || !!reportBusy
                                    }
                                    onChange={(e) => {
                                      const action = e.target.value;
                                      setActionDropdown((prev) => ({
                                        ...prev,
                                        [recordId]: action,
                                      }));
                                    }}
                                    className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer"
                                  >
                                    <option value="">
                                      {translate(
                                        "reports.row.actions",
                                        "Actions",
                                      )}
                                    </option>
                                    <option value="submit-taqeem">
                                      {translate(
                                        "reports.row.submitToTaqeem",
                                        "Submit to Taqeem",
                                      )}
                                    </option>
                                    <option value="check-status">
                                      {translate(
                                        "reports.row.checkStatus",
                                        "Check status",
                                      )}
                                    </option>
                                    <option value="retry">
                                      {translate(
                                        "reports.row.retryIncomplete",
                                        "retry incomplete assets",
                                      )}
                                    </option>
                                    <option value="delete">
                                      {translate(
                                        "reports.row.delete",
                                        "Delete",
                                      )}
                                    </option>
                                    <option value="edit">
                                      {translate("reports.row.edit", "Edit")}
                                    </option>
                                    <option value="send-approver">
                                      {translate(
                                        "reports.row.sendToApprover",
                                        "Send to Approver",
                                      )}
                                    </option>
                                    <option value="approve">
                                      {translate(
                                        "reports.row.approve",
                                        "Approve",
                                      )}
                                    </option>
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const action = actionDropdown[recordId];
                                      if (action) {
                                        handleReportAction(report, action);
                                        setActionDropdown((prev) => {
                                          const next = { ...prev };
                                          delete next[recordId];
                                          return next;
                                        });
                                      }
                                    }}
                                    disabled={
                                      !recordId ||
                                      submitting ||
                                      !!reportBusy ||
                                      !actionDropdown[recordId]
                                    }
                                    className="px-2 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-[10px] font-semibold transition-colors"
                                  >
                                    {translate("reports.row.go", "Go")}
                                  </button>
                                </div>
                              </div>
                              {reportBusy && (
                                <div className="text-[10px] text-blue-600 mt-0.5 font-medium">
                                  {translate(
                                    "reports.row.working",
                                    "Working...",
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                disabled={!recordId}
                                checked={
                                  !!recordId && selectedReportSet.has(recordId)
                                }
                                onChange={() =>
                                  recordId && toggleReportSelection(recordId)
                                }
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                              />
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td
                                colSpan={8}
                                className="bg-blue-50/20 border-t border-blue-200"
                              >
                                <div className="p-2 space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="text-xs text-slate-700 font-medium">
                                      {translate(
                                        "reports.assets.label",
                                        "Assets",
                                      )}
                                      :{" "}
                                      <span className="text-blue-600 font-semibold">
                                        {assetList.length}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="rounded-md border border-slate-200 overflow-hidden bg-white shadow-sm">
                                    <div className="max-h-48 overflow-y-auto">
                                      <table className="w-full text-xs text-slate-700">
                                        <thead className="bg-slate-50 text-slate-800 border-b border-slate-200 sticky top-0">
                                          <tr>
                                            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">
                                              {translate(
                                                "reports.assets.table.macroId",
                                                "Macro ID",
                                              )}
                                            </th>
                                            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">
                                              {translate(
                                                "reports.assets.table.assetName",
                                                "Asset name",
                                              )}
                                            </th>
                                            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">
                                              {translate(
                                                "reports.assets.table.finalValue",
                                                "Final value",
                                              )}
                                            </th>
                                            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">
                                              {translate(
                                                "reports.assets.table.sheet",
                                                "Sheet",
                                              )}
                                            </th>
                                            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider">
                                              {translate(
                                                "reports.assets.table.status",
                                                "Status",
                                              )}
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {assetList.length === 0 ? (
                                            <tr>
                                              <td
                                                colSpan={4}
                                                className="px-2 py-2 text-center text-slate-500 text-xs"
                                              >
                                                {translate(
                                                  "reports.assets.none",
                                                  "No assets available for this report.",
                                                )}
                                              </td>
                                            </tr>
                                          ) : (
                                            assetList.map((asset, assetIdx) => {
                                              const assetStatus =
                                                isAssetComplete(asset)
                                                  ? "complete"
                                                  : "incomplete";
                                              const statusLabel =
                                                assetStatus === "complete"
                                                  ? "Complete"
                                                  : "Incomplete";
                                              const localizedAssetStatusLabel =
                                                translate(
                                                  `reports.assetStatus.${assetStatus}`,
                                                  statusLabel,
                                                );
                                              const statusClass =
                                                assetStatus === "complete"
                                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                  : "border-amber-200 bg-amber-50 text-amber-700";

                                              return (
                                                <tr
                                                  key={`${recordId}-${assetIdx}`}
                                                  className="border-t border-slate-200 hover:bg-slate-50/50"
                                                >
                                                  <td className="px-2 py-1.5 text-slate-700 text-xs font-mono">
                                                    {asset.id ||
                                                      asset.macro_id ||
                                                      "-"}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-slate-700 text-xs font-medium">
                                                    {asset.asset_name || "-"}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-slate-700 text-xs">
                                                    {asset.final_value || "-"}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-slate-600 text-xs">
                                                    {asset.source_sheet || "-"}
                                                  </td>
                                                  <td className="px-2 py-1.5">
                                                    <span
                                                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold ${statusClass}`}
                                                    >
                                                      {
                                                        localizedAssetStatusLabel
                                                      }
                                                    </span>
                                                  </td>
                                                </tr>
                                              );
                                            })
                                          )}
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
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 &&
              (() => {
                const getPageNumbers = () => {
                  const pages = [];

                  if (totalPages <= 6) {
                    // Show all pages if 6 or fewer
                    for (let i = 1; i <= totalPages; i++) {
                      pages.push(i);
                    }
                    return pages;
                  }

                  // Always show first 3 pages
                  pages.push(1, 2, 3);

                  const lastThree = [
                    totalPages - 2,
                    totalPages - 1,
                    totalPages,
                  ];
                  const lastThreeStart = totalPages - 2;

                  // If current page is in first 3 or overlaps with last 3
                  if (currentPage <= 3) {
                    // Show: 1, 2, 3, 4, 5, ..., last 3
                    if (4 < lastThreeStart) {
                      pages.push(4, 5);
                      pages.push("ellipsis");
                    }
                  } else if (currentPage >= lastThreeStart) {
                    // Show: 1, 2, 3, ..., last 3
                    if (3 < lastThreeStart - 1) {
                      pages.push("ellipsis");
                    }
                  } else {
                    // In the middle: show 1, 2, 3, ..., current-1, current, current+1, ..., last 3
                    const showBefore = currentPage - 1;
                    const showAfter = currentPage + 1;

                    // Check if we need ellipsis before current page
                    if (showBefore > 4) {
                      pages.push("ellipsis");
                      pages.push(showBefore);
                    } else if (showBefore > 3) {
                      pages.push(showBefore);
                    }

                    pages.push(currentPage);

                    // Check if we need ellipsis after current page
                    if (showAfter < lastThreeStart - 1) {
                      pages.push(showAfter);
                      if (showAfter < lastThreeStart - 2) {
                        pages.push("ellipsis");
                      }
                    }
                  }

                  // Always show last 3 pages (avoid duplicates)
                  lastThree.forEach((page) => {
                    if (!pages.includes(page)) {
                      pages.push(page);
                    }
                  });

                  // Clean up and ensure proper order
                  const cleaned = [];
                  let prevNum = 0;

                  for (let i = 0; i < pages.length; i++) {
                    const item = pages[i];
                    if (item === "ellipsis") {
                      if (cleaned[cleaned.length - 1] !== "ellipsis") {
                        cleaned.push("ellipsis");
                      }
                    } else if (typeof item === "number") {
                      if (item > prevNum) {
                        if (
                          item > prevNum + 1 &&
                          prevNum > 0 &&
                          cleaned[cleaned.length - 1] !== "ellipsis"
                        ) {
                          cleaned.push("ellipsis");
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
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
                    <div className="text-xs text-slate-600 font-medium">
                      {translate(
                        "reports.pagination.summary",
                        "Showing {{from}} to {{to}} of {{total}} reports",
                        {
                          from: (currentPage - 1) * itemsPerPage + 1,
                          to: Math.min(
                            currentPage * itemsPerPage,
                            filteredReports.length,
                          ),
                          total: filteredReports.length,
                        },
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {translate("reports.pagination.previous", "Previous")}
                      </button>
                      <div className="flex items-center gap-1">
                        {pageNumbers.map((page, idx) => {
                          if (page === "ellipsis") {
                            return (
                              <span
                                key={`ellipsis-${idx}`}
                                className="px-1.5 text-xs text-slate-600"
                              >
                                ...
                              </span>
                            );
                          }
                          return (
                            <button
                              key={page}
                              type="button"
                              onClick={() => handlePageChange(page)}
                              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all ${
                                currentPage === page
                                  ? "bg-blue-600 text-white shadow-sm"
                                  : "text-slate-700 bg-white border border-slate-300 hover:bg-blue-50 hover:border-blue-400"
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
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {translate("reports.pagination.next", "Next")}
                      </button>
                    </div>
                  </div>
                );
              })()}
          </>
        )}
      </div>

      {/* Edit Modal */}
      {editingReportId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-800">
                {translate("editModal.title", "Edit Report")}
              </h3>
              <button
                type="button"
                onClick={() => setEditingReportId(null)}
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                {translate("editModal.close", "Close")}
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  {translate("editModal.field.title", "Title")}
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  {translate("editModal.field.clientName", "Client Name")}
                </label>
                <input
                  type="text"
                  value={formData.client_name}
                  onChange={(e) =>
                    setFormData({ ...formData, client_name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {translate("editModal.field.telephone", "Telephone")}
                  </label>
                  <input
                    type="text"
                    value={formData.telephone}
                    onChange={(e) =>
                      setFormData({ ...formData, telephone: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {translate("editModal.field.email", "Email")}
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setEditingReportId(null)}
                  className="px-4 py-2 border border-slate-300 rounded-md text-sm text-slate-700 hover:bg-slate-50"
                >
                  {translate("editModal.cancel", "Cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleUpdateReport}
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  {submitting
                    ? translate("editModal.updating", "Updating...")
                    : translate("editModal.update", "Update")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showValidationModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto px-4 py-6"
          onClick={() => setShowValidationModal(false)}
        >
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-5xl max-h-[70vh]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pointer-events-none absolute -top-12 right-6 h-28 w-28 rounded-full bg-cyan-400/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-10 left-4 h-32 w-32 rounded-full bg-blue-500/20 blur-3xl" />
            <div className="relative rounded-[32px] bg-gradient-to-br from-cyan-200/70 via-white to-blue-200/70 p-[1px] shadow-[0_40px_120px_rgba(15,23,42,0.35)]">
              <div className="relative flex max-h-[70vh] flex-col overflow-hidden rounded-[32px] bg-white/95 backdrop-blur-xl">
                <div className="relative sticky top-0 z-10 overflow-hidden bg-gradient-to-r from-slate-950 via-blue-900 to-slate-900 px-5 py-4 text-white">
                  <div className="pointer-events-none absolute -right-10 top-0 h-20 w-20 rounded-full bg-cyan-400/25 blur-2xl" />
                  <div className="pointer-events-none absolute left-6 top-6 h-16 w-16 rounded-full bg-indigo-500/20 blur-2xl" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 border border-white/15 shadow-[0_10px_24px_rgba(2,6,23,0.4)]">
                        <FileSpreadsheet className="h-4 w-4 text-cyan-200" />
                      </span>
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-white/90 min-w-0">
                        <span className="uppercase tracking-[0.3em] text-cyan-200 text-[9px]">
                          {translate(
                            "validationModal.title",
                            "Excel Validation",
                          )}
                        </span>
                        <span className="h-1 w-1 rounded-full bg-white/40" />
                        <span className="text-white">
                          {translate(
                            "validationModal.subtitle",
                            "Validation Results",
                          )}
                        </span>
                        <span className="h-1 w-1 rounded-full bg-white/30" />
                        <span className="text-blue-100 font-normal truncate">
                          {translate(
                            "validationModal.description",
                            "Review issues before uploading to ensure smooth submission.",
                          )}
                        </span>
                      </div>
                      <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-1 text-[10px] font-semibold text-white">
                        {translate(
                          "validationModal.filesLabel",
                          "Files: {{count}}",
                          { count: validationItems.length },
                        )}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold ${
                          hasValidationIssues
                            ? "border-rose-300/40 bg-rose-500/20 text-rose-100"
                            : "border-emerald-300/40 bg-emerald-500/20 text-emerald-100"
                        }`}
                      >
                        {translate(
                          "validationModal.issuesLabel",
                          "Issues: {{count}}",
                          { count: totalValidationIssues },
                        )}
                      </span>
                      {wantsPdfUpload && (
                        <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-1 text-[10px] font-semibold text-white">
                          {translate(
                            "validationModal.pdfsLabel",
                            "PDFs: {{count}}",
                            {
                              count:
                                pdfMatchInfo.unmatchedPdfs.length +
                                pdfMatchInfo.excelsMissingPdf.length,
                            },
                          )}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowValidationModal(false)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-[10px] font-semibold text-white hover:bg-white/20 whitespace-nowrap"
                    >
                      <X className="w-3.5 h-3.5" />
                      {translate("validationModal.closeButton", "Close")}
                    </button>
                  </div>
                </div>

                <div className="relative flex-1 overflow-y-auto px-5 py-4">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_55%),radial-gradient(circle_at_bottom,rgba(14,165,233,0.08),transparent_50%)]" />
                  <div className="relative z-10 space-y-4">
                    {!validationItems.length && !validationMessage && (
                      <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-xs text-slate-600">
                        {translate(
                          "validationModal.emptyMessage",
                          "Upload Excel files to generate validation results.",
                        )}
                      </div>
                    )}

                    {!hasValidationIssues && validationItems.length > 0 && (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-4 text-emerald-700 shadow-[0_10px_30px_rgba(16,185,129,0.12)]">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-6 h-6" />
                          <div>
                            <div className="text-sm font-semibold">
                              {translate(
                                "validationModal.noIssues",
                                "No issues detected",
                              )}
                            </div>
                            <p className="text-xs text-emerald-700/90">
                              {translate(
                                "validationModal.noIssuesDetails",
                                "Your Excel files look clean. You can proceed with uploading and submission.",
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {hasValidationIssues && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-rose-700 shadow-[0_10px_30px_rgba(248,113,113,0.12)]">
                          <div className="text-sm font-semibold">
                            {translate(
                              "validationModal.actionRequired",
                              "Action required",
                            )}
                          </div>
                          <p className="text-xs text-rose-700/90">
                            {translate(
                              "validationModal.actionHint",
                              "Fix the items below and re-validate before uploading. Ensure required fields are filled, inspection dates are valid, and asset usage IDs match the allowed list.",
                            )}
                          </p>
                        </div>

                        <div className="inline-flex rounded-full bg-slate-100/80 p-1 text-xs font-semibold text-slate-600 shadow-sm">
                          <button
                            type="button"
                            onClick={() => setValidationTableTab("report-info")}
                            className={`px-4 py-1.5 rounded-full transition ${
                              validationTableTab === "report-info"
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                            }`}
                          >
                            {translate(
                              "validationModal.tabs.reportInfo",
                              "Report Info",
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setValidationTableTab("assets")}
                            className={`px-4 py-1.5 rounded-full transition ${
                              validationTableTab === "assets"
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                            }`}
                          >
                            {translate(
                              "validationModal.tabs.assetsAndPdfs",
                              "Assets & PDFs",
                            )}
                          </button>
                        </div>

                        {validationTableTab === "report-info" ? (
                          reportInfoIssues.length > 0 ? (
                            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                              <div className="max-h-[260px] overflow-y-auto">
                                <table className="min-w-full text-xs text-slate-700">
                                  <thead className="bg-slate-900 text-slate-100 sticky top-0">
                                    <tr>
                                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                                        {translate(
                                          "validationModal.table.headers.excel",
                                          "Excel",
                                        )}
                                      </th>
                                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                                        {translate(
                                          "validationModal.table.headers.field",
                                          "Field",
                                        )}
                                      </th>
                                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                                        {translate(
                                          "validationModal.table.headers.location",
                                          "Location",
                                        )}
                                      </th>
                                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                                        {translate(
                                          "validationModal.table.headers.details",
                                          "Details",
                                        )}
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {reportInfoIssues.map((issue, idx) => (
                                      <tr
                                        key={`report-info-${idx}`}
                                        className="border-b border-slate-200"
                                      >
                                        <td className="px-3 py-2 font-medium text-slate-800">
                                          {issue.fileName}
                                        </td>
                                        <td className="px-3 py-2 font-semibold text-slate-800">
                                          {issue.field}
                                        </td>
                                        <td className="px-3 py-2 text-slate-600">
                                          {issue.location || "-"}
                                        </td>
                                        <td className="px-3 py-2 text-slate-700">
                                          {issue.message}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
                              {translate(
                                "validationModal.reportInfo.noIssues",
                                "No report info issues detected.",
                              )}
                            </div>
                          )
                        ) : (
                          <div className="space-y-3">
                            {wantsPdfUpload &&
                              (pdfMatchInfo.excelsMissingPdf.length ||
                                pdfMatchInfo.unmatchedPdfs.length) && (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-amber-700 text-xs">
                                  <div className="font-semibold">
                                    {translate(
                                      "validationModal.pdfMatchingIssues.title",
                                      "PDF matching issues",
                                    )}
                                  </div>
                                  <div className="mt-1 space-y-1">
                                    {pdfMatchInfo.excelsMissingPdf.length >
                                      0 && (
                                      <div>
                                        {translate(
                                          "validationModal.pdfMatchingIssues.missing",
                                          "Excel files missing PDF: {{files}}",
                                          {
                                            files:
                                              pdfMatchInfo.excelsMissingPdf.join(
                                                ", ",
                                              ),
                                          },
                                        )}
                                      </div>
                                    )}
                                    {pdfMatchInfo.unmatchedPdfs.length > 0 && (
                                      <div>
                                        {translate(
                                          "validationModal.pdfMatchingIssues.unmatched",
                                          "Unmatched PDFs: {{files}}",
                                          {
                                            files:
                                              pdfMatchInfo.unmatchedPdfs.join(
                                                ", ",
                                              ),
                                          },
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                            {assetIssues.length > 0 ? (
                              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                                <div className="max-h-[260px] overflow-y-auto">
                                  <table className="min-w-full text-xs text-slate-700">
                                    <thead className="bg-slate-900 text-slate-100 sticky top-0">
                                      <tr>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                                          {translate(
                                            "validationModal.table.headers.excel",
                                            "Excel",
                                          )}
                                        </th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                                          {translate(
                                            "validationModal.table.headers.field",
                                            "Field",
                                          )}
                                        </th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                                          {translate(
                                            "validationModal.table.headers.location",
                                            "Location",
                                          )}
                                        </th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                                          {translate(
                                            "validationModal.table.headers.details",
                                            "Details",
                                          )}
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {assetIssues.map((issue, idx) => (
                                        <tr
                                          key={`asset-issue-${idx}`}
                                          className="border-b border-slate-200"
                                        >
                                          <td className="px-3 py-2 font-medium text-slate-800">
                                            {issue.fileName}
                                          </td>
                                          <td className="px-3 py-2 font-semibold text-slate-800">
                                            {issue.field}
                                          </td>
                                          <td className="px-3 py-2 text-slate-600">
                                            {issue.location || "-"}
                                          </td>
                                          <td className="px-3 py-2 text-slate-700">
                                            {issue.message}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
                                {translate(
                                  "validationModal.assetIssues.noIssues",
                                  "No asset issues detected.",
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 bg-white/90 px-5 py-3 text-[10px] text-slate-500">
                  <span>
                    {translate(
                      "validationModal.footerHint",
                      "Close this panel after reviewing the issues.",
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowValidationModal(false)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400"
                  >
                    <X className="w-3.5 h-3.5" />
                    {translate("validationModal.closeButton", "Close")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubmitReportsQuickly;
