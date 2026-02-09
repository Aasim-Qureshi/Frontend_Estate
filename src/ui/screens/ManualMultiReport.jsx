
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  Table,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { createManualMultiApproachReport, updateMultiApproachReport } from "../../api/report";
import { deductPoints } from "../utils/points";
import { useSession } from "../context/SessionContext";
import { useValueNav } from "../context/ValueNavContext";
import { useNavStatus } from "../context/NavStatusContext";
const MANUAL_MULTI_PAGE_NAME = "Manual Multi Report";
const MANUAL_MULTI_PAGE_SOURCE = "manual-report";
const {
  contributionOptions,
  currencyOptions,
  purposeOptions,
  reportTypeOptions,
  valuerOptions,
  valuePremiseOptions,
  buildDefaultValuers,
} = require("../constants/reportFormOptions");

const defaultAssetRow = (source = "market") => ({
  asset_name: "",
  asset_usage_id: "",
  final_value: "",
  source_sheet: source,
});

const buildDefaultFormData = (totalValue = 0) => ({
  excel_name: "",
  batchId: "",
  title: "",
  purpose_id: "to set",
  value_premise_id: "1",
  report_type: reportTypeOptions[0]?.value || "",
  valued_at: "",
  submitted_at: "",
  inspection_date: "",
  assumptions: "",
  special_assumptions: "",
  value: totalValue ? String(totalValue) : "",
  final_value: totalValue ? String(totalValue) : "",
  valuation_currency: "1",
  client_name: "",
  owner_name: "",
  region: "",
  city: "",
  telephone: "",
  email: "",
  pdf_path: "",
  has_other_users: false,
});
const InputField = ({
  label,
  required = false,
  error,
  className = "",
  ...props
}) => (
  <div className={`mb-3 ${className}`}>
    <label className="block text-xs font-medium text-gray-700 mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    <input
      {...props}
      className={`w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all ${
        error ? "border-red-400 bg-red-50" : "border-gray-300"
      }`}
    />
    {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
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
  <div className={`mb-3 ${className}`}>
    <label className="block text-xs font-medium text-gray-700 mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    <select
      {...props}
      className={`w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all ${
        error ? "border-red-400 bg-red-50" : "border-gray-300"
      }`}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
    {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
  </div>
);

const TextAreaField = ({
  label,
  required = false,
  error,
  className = "",
  ...props
}) => (
  <div className={`mb-3 ${className}`}>
    <label className="block text-xs font-medium text-gray-700 mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    <textarea
      {...props}
      className={`w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none ${
        error ? "border-red-400 bg-red-50" : "border-gray-300"
      }`}
    />
    {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
  </div>
);

const Modal = ({ open, onClose, title, children, maxWidth = "max-w-5xl" }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-3 py-6 overflow-auto">
      <div className={`w-full ${maxWidth}`}>
        <div className="bg-white rounded-lg shadow-lg border border-gray-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition"
              aria-label="إغلاق"
            >
              ×
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
};

const Section = ({ title, children, className = "" }) => (
  <div
    className={`bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 ${className}`}
  >
    <h3 className="text-lg font-semibold text-gray-800 mb-3 pb-2 border-b border-gray-200">
      {title}
    </h3>
    {children}
  </div>
);

const InfoBanner = ({ tone = "info", message }) => {
  if (!message) return null;
  const toneClasses = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-red-200 bg-red-50 text-red-800",
    warning: "border-yellow-200 bg-yellow-50 text-yellow-800",
    info: "border-blue-200 bg-blue-50 text-blue-800",
  };
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "error"
      ? AlertTriangle
      : tone === "warning"
      ? AlertTriangle
      : Table;
  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-3 flex items-start gap-3 ${toneClasses[tone]}`}
    >
      <Icon className="w-4 h-4 mt-0.5" />
      <div className="text-sm">{message}</div>
    </div>
  );
};
const ManualMultiReport = ({ onViewChange }) => {
  const {
    selectedCompany,
    companies,
    preferredCompany,
    ensureCompaniesLoaded,
    replaceCompanies,
    setSelectedCompany,
  } = useValueNav();
  const { setCompanyStatus } = useNavStatus();
  const { token, isGuest, user } = useSession();
  const isGuestUser = isGuest || !user?.phone;
  const selectedCompanyOfficeId = useMemo(() => {
    const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
    return officeId ? String(officeId) : "";
  }, [selectedCompany]);
  const [showAssetsModal, setShowAssetsModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [assets, setAssets] = useState([defaultAssetRow()]);
  const [assetErrors, setAssetErrors] = useState({});
  const [pasteBuffer, setPasteBuffer] = useState("");
  const [columnHeaders, setColumnHeaders] = useState([
    "asset_name",
    "asset_usage_id",
    "final_value",
    "source_sheet",
  ]);
  const [defaultSourceSheet, setDefaultSourceSheet] = useState("market");
  const [formData, setFormData] = useState(buildDefaultFormData());
  const [errors, setErrors] = useState({});
  const [reportUsers, setReportUsers] = useState([]);
  const [valuers, setValuers] = useState(buildDefaultValuers());
  const [valuerError, setValuerError] = useState(null);
  const [status, setStatus] = useState(null);
  const [automationStatus, setAutomationStatus] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [tabsNum, setTabsNum] = useState(3);
  const reportsTitle = isGuestUser ? "التقارير المؤقتة (زائر)" : "جدول التقارير";
  const reportsHint = isGuestUser
    ? "تقارير جلسة الضيف مؤقتة. قم بالتسجيل لربطها برقم هاتفك."
    : "استعرض التقارير التي تم حفظها لإرسالها إلى تقييم لاحقاً.";
  const [createdBatchId, setCreatedBatchId] = useState("");
  const [createdReports, setCreatedReports] = useState([]);
  const [expandedReports, setExpandedReports] = useState([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const pendingCompanySelectionRef = useRef(null);

  const assetsTotal = useMemo(
    () =>
      assets.reduce((sum, row) => {
        const value = Number(row.final_value);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0),
    [assets]
  );

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

  const waitForCompanySelection = useCallback((timeoutMs = 120000) => {
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
  }, [selectedCompany]);

  const ensureCompanySelected = useCallback(
    async (options = {}) => {
      const { forceSelection = false, ignorePreferred = false } = options;

      if (forceSelection && selectedCompany) {
        await setSelectedCompany(null, { skipNavigation: true, quiet: true });
      }
      if (!forceSelection && selectedCompany) return selectedCompany;

      let list = companies;
      try {
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
        if ((!list || list.length === 0) && ensureCompaniesLoaded) {
          list = await ensureCompaniesLoaded("equipment");
        }
      } catch (err) {
        console.warn("Failed to fetch companies for submission", err);
      }

      if (!list || list.length === 0) {
        throw new Error("No companies available. Login to Taqeem and try again.");
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
        await setSelectedCompany(chosen, { skipNavigation: false, quiet: true });
        setCompanyStatus?.("success", `Company: ${chosen.name || "Selected"}`);
        return chosen;
      }

      setCompanyStatus?.("info", "Select a company to continue.");
      setStatus({
        type: "info",
        message: "Select a company to continue.",
      });
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
      waitForCompanySelection,
    ],
  );

  const getReportId = (report, index) =>
    report?._id ||
    report?.id ||
    report?.localId ||
    report?.reportInfo?.batchId ||
    report?.excel_name ||
    report?.title ||
    `report-${index}`;

  const handleSelectSavedReport = (reportId) => {
    setSelectedReportId(reportId);
    if (!reportId) {
      setAssets([defaultAssetRow(defaultSourceSheet)]);
      return;
    }
    const selected =
      createdReports.find((report, idx) => getReportId(report, idx) === reportId) ||
      null;
    if (selected?.reportInfo) {
      setFormData((prev) => ({
        ...prev,
        ...selected.reportInfo,
      }));
      setValuers(
        selected.reportInfo.valuers?.length
          ? selected.reportInfo.valuers
          : buildDefaultValuers()
      );
      setReportUsers(selected.reportInfo.report_users || []);
    }
    const reportAssets = selected?.asset_data || selected?.assets;
    if (reportAssets?.length) {
      const mappedAssets = reportAssets.map((asset) => ({
        asset_name: asset.asset_name || "",
        asset_usage_id: asset.asset_usage_id || "",
        final_value: asset.final_value || "",
        source_sheet: asset.source_sheet || "market",
      }));
      setDefaultSourceSheet(mappedAssets[0]?.source_sheet || "market");
      setAssets(mappedAssets);
    } else {
      setAssets([defaultAssetRow(defaultSourceSheet)]);
    }
  };

  const toggleReportExpansion = (reportId) => {
    setExpandedReports((prev) =>
      prev.includes(reportId)
        ? prev.filter((id) => id !== reportId)
        : [...prev, reportId]
    );
  };

  const resetWizard = () => {
    setDefaultSourceSheet("market");
    setAssets([defaultAssetRow("market")]);
    setAssetErrors({});
    setPasteBuffer("");
    setColumnHeaders([
      "asset_name",
      "asset_usage_id",
      "final_value",
      "source_sheet",
    ]);
    setFormData(buildDefaultFormData());
    setErrors({});
    setReportUsers([]);
    setValuers(buildDefaultValuers());
    setValuerError(null);
    setStatus(null);
    setAutomationStatus(null);
    setCreatedBatchId("");
    setCreatedReports([]);
    setTabsNum(3);
    setExpandedReports([]);
    setSelectedReportId("");
  };

  const handleAssetChange = (index, field, value) => {
    setAssets((prev) =>
      prev.map((row, idx) =>
        idx === index ? { ...row, [field]: value } : row
      )
    );
  };

  const addAssetRow = () =>
    setAssets((prev) => [...prev, defaultAssetRow(defaultSourceSheet)]);

  const removeAssetRow = (index) =>
    setAssets((prev) => prev.filter((_, idx) => idx !== index));
  const headerOptions = [
    { value: "asset_name", label: "اسم الأصل" },
    { value: "asset_usage_id", label: "معرف الاستخدام" },
    { value: "final_value", label: "القيمة النهائية" },
    { value: "source_sheet", label: "الورقة (market/cost)" },
  ];
  const updateColumnHeader = (index, value) => {
    setColumnHeaders((prev) => prev.map((h, idx) => (idx === index ? value : h)));
  };
  const handleDefaultSourceChange = (value) => {
    setDefaultSourceSheet(value);
    updateColumnHeader(3, "source_sheet");
    setAssets((prev) => prev.map((row) => ({ ...row, source_sheet: value })));
  };

  const parsePastedRows = () => {
    if (!pasteBuffer.trim()) {
      setStatus({
        type: "warning",
        message: "الصق أسطر الأصول أولاً.",
      });
      return;
    }
    const lines = pasteBuffer
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      setStatus({
        type: "warning",
        message: "الصق أسطر تتضمن asset_name | asset_usage_id | final_value",
      });
      return;
    }

    const nextAssets = [];
    lines.forEach((line) => {
      const cells = line.split(/\t|\|/).map((cell) => cell.trim());
      if (!cells[0]) return;

      const rowData = {
        asset_name: "",
        asset_usage_id: "",
        final_value: "",
        source_sheet: defaultSourceSheet,
      };

      columnHeaders.forEach((headerKey, idx) => {
        const value = cells[idx] || "";
        switch (headerKey) {
          case "asset_name":
            rowData.asset_name = value;
            break;
          case "asset_usage_id":
            rowData.asset_usage_id = value;
            break;
          case "final_value":
            rowData.final_value = value;
            break;
          case "source_sheet":
            if (value) {
              rowData.source_sheet = value.toLowerCase().includes("cost") ? "cost" : "market";
            }
            break;
          default:
            break;
        }
      });

      nextAssets.push(rowData);
    });

    if (!nextAssets.length) {
      setStatus({
        type: "warning",
        message: "لم يتم تحويل أي أسطر. تأكد من ترتيب الأعمدة بشكل صحيح.",
      });
      return;
    }

    setAssets(nextAssets);
    setPasteBuffer("");
    setStatus({
      type: "success",
      message: `تم لصق ${nextAssets.length} أصل بنجاح.`,
    });
  };

const validateAssets = (requireAssets = true) => {
    const nextErrors = {};
    const hasData = assets.some(
      (row) => row.asset_name || row.asset_usage_id || row.final_value
    );

    assets.forEach((row, index) => {
      const rowHasData =
        row.asset_name || row.asset_usage_id || row.final_value || row.source_sheet;
      if (!rowHasData && !requireAssets) {
        return;
      }

      const rowErrors = {};
      if (!row.asset_name || !row.asset_name.trim()) {
        rowErrors.asset_name = "اسم الأصل مطلوب.";
      }
      const usageId = Number(row.asset_usage_id);
      if (!Number.isInteger(usageId)) {
        rowErrors.asset_usage_id = "asset_usage_id يجب أن يكون رقمًا صحيحًا.";
      }
      const finalValue = Number(row.final_value);
      if (!Number.isInteger(finalValue) || finalValue < 0) {
        rowErrors.final_value = "final_value يجب أن يكون رقمًا صحيحًا وغير سالب.";
      }
      if (Object.keys(rowErrors).length) {
        nextErrors[index] = rowErrors;
      }
    });

    setAssetErrors(nextErrors);
    if (!assets.length || (!hasData && requireAssets)) {
      setStatus({
        type: "error",
        message: "لا يمكن حفظ الأصول بدون بيانات في الجدول.",
      });
      return false;
    }
    if (Object.keys(nextErrors).length) {
      setStatus({
        type: "error",
        message: "يرجى تصحيح أخطاء الأصول (راجع الحقول المظللة بالأحمر).",
      });
      return false;
    }
    if (!assetsTotal && requireAssets) {
      setStatus({
        type: "error",
        message: "يجب إدخال مجموع قيم الأصول.",
      });
      return false;
    }
    if (requireAssets && assetsTotal > 0) {
      const declaredValue = Number(formData.value || 0);
      if (declaredValue && declaredValue !== assetsTotal) {
        setStatus({
          type: "error",
          message: "الإجمالي يجب أن يساوي مجموع الأصول في الخطوة الأولى.",
        });
        return false;
      }
    }
    return true;
  };
  const handleAssetsContinue = () => {
    if (!validateAssets()) return;
    setStatus({
      type: "success",
      message: "تم حفظ بيانات الأصول مبدئيًا. يمكنك متابعة بيانات التقرير الآن.",
    });
    setShowAssetsModal(false);
  };
  const handleFieldChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const addReportUser = () => setReportUsers((prev) => [...prev, ""]);
  const deleteLastReportUser = () =>
    setReportUsers((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  const updateReportUser = (index, value) =>
    setReportUsers((prev) =>
      prev.map((user, idx) => (idx === index ? value : user))
    );

  const addValuer = () =>
    setValuers((prev) => [
      ...prev,
      { valuer_name: "", contribution_percentage: 0 },
    ]);
  const deleteLastValuer = () =>
    setValuers((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  const handleValuerChange = (index, field, value) =>
    setValuers((prev) =>
      prev.map((valuer, idx) =>
        idx === index ? { ...valuer, [field]: value } : valuer
      )
    );

  useEffect(() => {
    setFormData((prev) => {
      if (!assetsTotal) {
        return { ...prev, value: "", final_value: "" };
      }
      if (!prev.value) {
        return {
          ...prev,
          value: String(assetsTotal),
          final_value: String(assetsTotal),
        };
      }
      return prev;
    });
  }, [assetsTotal]);

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail;
      if (!detail || detail.source !== "manual-report") return;
      const ids = Array.isArray(detail.reportIds)
        ? detail.reportIds
        : detail.reportId
          ? [detail.reportId]
          : [];
      if (ids.length === 0) return;
      const idLabel = ids.length === 1 ? ids[0] : ids.join(", ");
      setStatus({
        type: "success",
        message: `Deducted ${detail.deducted || 0} point${(detail.deducted || 0) === 1 ? "" : "s"} for report${ids.length > 1 ? "s" : ""} ${idLabel}.`,
      });
    };
    window.addEventListener("points-updated", handler);
    return () => window.removeEventListener("points-updated", handler);
  }, [setStatus]);
  const validateReportDetails = () => {
    const nextErrors = {};
    const requiredFields = [
      { field: "title", message: "عنوان التقرير مطلوب." },
      { field: "purpose_id", message: "حدد Purpose of Valuation." },
      { field: "value_premise_id", message: "حدد Value Premise." },
      { field: "report_type", message: "حدد نوع التقرير." },
      { field: "valued_at", message: "تاريخ التقييم مطلوب." },
      { field: "submitted_at", message: "تاريخ التسليم مطلوب." },
      { field: "inspection_date", message: "تاريخ المعاينة مطلوب." },
      { field: "value", message: "القيمة الإجمالية مطلوبة." },
      { field: "client_name", message: "اسم العميل مطلوب." },
      { field: "telephone", message: "هاتف العميل مطلوب." },
      { field: "email", message: "البريد الإلكتروني مطلوب." },
    ];
    requiredFields.forEach(({ field, message }) => {
      const value = formData[field];
      if (!value || !String(value).trim()) {
        nextErrors[field] = message;
      }
    });

    if (formData.purpose_id === "to set") {
      nextErrors.purpose_id = "اختر Purpose واضح.";
    }
    if (formData.value_premise_id === "to set") {
      nextErrors.value_premise_id = "اختر Value Premise.";
    }
    if (formData.valuation_currency === "to set") {
      nextErrors.valuation_currency = "اختر عملة التقييم.";
    }

    const phone = (formData.telephone || "").replace(/\s+/g, "");
    if (phone.length < 8) {
      nextErrors.telephone = "رقم الهاتف يجب أن يتكون من 8 أرقام أو أكثر.";
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (formData.email && !emailRegex.test(formData.email)) {
      nextErrors.email = "صيغة البريد الإلكتروني غير صحيحة.";
    }

    if (reportUsers.length && reportUsers.some((user) => !user.trim())) {
      nextErrors.report_users = "أزل الحقول الفارغة أو أكمل أسماء المستخدمين.";
    }
    if (formData.has_other_users && !reportUsers.length) {
      nextErrors.report_users = "أضف مستخدمًا واحدًا على الأقل أو ألغ التحديد.";
    }

    const sanitizedValuers = valuers.filter(
      (valuer) =>
        valuer.valuer_name && valuer.contribution_percentage !== undefined
    );
    const totalPct = sanitizedValuers.reduce(
      (sum, valuer) => sum + Number(valuer.contribution_percentage || 0),
      0
    );
    if (!sanitizedValuers.length) {
      setValuerError("أضف مقيمًا واحدًا على الأقل.");
    } else if (totalPct !== 100) {
      setValuerError("يجب أن يكون مجموع نسب المقيمين 100% بالضبط.");
    } else {
      setValuerError(null);
    }

    if (assetsTotal > 0 && Number(formData.value || 0) !== assetsTotal) {
      nextErrors.value =
        "الإجمالي يجب أن يساوي مجموع الأصول عند حفظ الأصول المرتبطة.";
    }

    setErrors(nextErrors);
    return (
      Object.keys(nextErrors).length === 0 &&
      !valuerError &&
      sanitizedValuers.length > 0 &&
      totalPct === 100
    );
  };
  const buildPayload = () => {
    const normalizedAssets = assets
      .filter(
        (row) =>
          row.asset_name ||
          row.asset_usage_id ||
          row.final_value ||
          row.source_sheet
      )
      .map((row, index) => ({
        asset_id: index + 1,
        asset_name: (row.asset_name || "").trim(),
        asset_usage_id: Number(row.asset_usage_id || 0),
        final_value: Number(row.final_value || 0),
        source_sheet: row.source_sheet || "market",
      }));

    const filteredUsers = reportUsers
      .map((user) => user.trim())
      .filter(Boolean);
    const hasOtherUsers = formData.has_other_users && filteredUsers.length > 0;

    const sanitizedValuers = valuers
      .map((valuer) => ({
        valuer_name: valuer.valuer_name,
        contribution_percentage: Number(valuer.contribution_percentage || 0),
      }))
      .filter((valuer) => valuer.valuer_name);

    const declaredValue = Number(formData.value || assetsTotal || 0);

    return {
      assets: normalizedAssets,
      reportInfo: {
        ...formData,
        value: declaredValue,
        final_value: declaredValue,
        report_users: filteredUsers,
        has_other_users: hasOtherUsers,
        valuers: sanitizedValuers,
      },
    };
  };

  const handleSaveReport = async ({ allowEmptyAssets = false } = {}) => {
    const assetsValid = validateAssets(!allowEmptyAssets);
    const reportValid = validateReportDetails();
    if (!assetsValid || !reportValid) {
      setStatus({
        type: "error",
        message: "برجاء التأكد من صحة بيانات الأصول وبيانات التقرير قبل المتابعة.",
      });
      return false;
    }
    try {
      setIsSaving(true);
      setStatus(null);
      const payload = buildPayload();
      const response = await createManualMultiApproachReport(
        payload,
        isGuestUser ? null : (selectedCompanyOfficeId || null)
      );
      if (response?.status !== "success") {
        throw new Error(response?.error || "حدث خطأ غير متوقع أثناء حفظ البيانات.");
      }
      const responseReports = Array.isArray(response?.reports) ? response.reports : [];
      const normalizedReports = responseReports.length
        ? responseReports.map((report, idx) => ({
            ...report,
            reportInfo: report.reportInfo || payload.reportInfo,
            asset_data: report.asset_data || payload.assets,
            localId: report._id || report.id || `${response.batchId || "report"}-${idx}`,
          }))
        : [
            {
              _id: response?.batchId || payload.reportInfo?.batchId || `report-${Date.now()}`,
              reportInfo: payload.reportInfo,
              asset_data: payload.assets,
              title:
                payload.reportInfo?.title ||
                payload.reportInfo?.excel_name ||
                "Manual report",
              final_value:
                payload.reportInfo?.final_value || payload.reportInfo?.value || 0,
              batchId: response?.batchId || payload.reportInfo?.batchId || "",
              localId: response?.batchId || payload.reportInfo?.batchId || `report-${Date.now()}`,
            },
          ];
      setCreatedBatchId(response?.batchId || payload.reportInfo?.batchId || "");
      setCreatedReports((prev) => {
        const seen = new Set();
        const merged = [];
        [...normalizedReports, ...prev].forEach((report) => {
          const key =
            report._id ||
            report.id ||
            report.localId ||
            report.reportInfo?.batchId ||
            report.title;
          if (seen.has(key)) return;
          seen.add(key);
          merged.push(report);
        });
        return merged;
      });
      if (normalizedReports.length) {
        const newId =
          normalizedReports[0]._id ||
          normalizedReports[0].id ||
          normalizedReports[0].localId ||
          "";
        setSelectedReportId(newId);
      }
      setStatus({
        type: "success",
        message: "تم حفظ التقارير بنجاح. يمكنك مراجعتها في الجدول أدناه.",
      });
      return true;
    } catch (err) {
      setStatus({
        type: "error",
        message:
          err?.response?.data?.error ||
          err?.message ||
          "حدث خطأ غير متوقع.",
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendToTaqeem = async () => {
    if (!createdBatchId) {
      setAutomationStatus({
        type: "error",
        message: "Batch ID مفقود. احفظ التقرير أولًا.",
      });
      return;
    }
    if (!tabsNum || Number(tabsNum) < 1) {
      setAutomationStatus({
        type: "error",
        message: "عدد التابات يجب أن يكون 1 على الأقل.",
      });
      return;
    }

      try {
        setSending(true);
        setAutomationStatus(null);
        if (!window?.electronAPI?.createReportsByBatch) {
          throw new Error(
            "مكتبة Electron غير متاحة. تأكد أن التطبيق يعمل داخل الحاوية الصحيحة."
          );
        }

        const chosen = await ensureCompanySelected({
          forceSelection: true,
          ignorePreferred: true,
        });
        const officeId = chosen?.officeId || chosen?.office_id || "";

        if (officeId) {
          try {
            await Promise.all(
              createdReports.map((report) => {
                const recordId = report?._id || report?.id;
                if (!recordId) return Promise.resolve();
                if (report?.company_office_id) return Promise.resolve();
                return updateMultiApproachReport(recordId, {
                  company_office_id: String(officeId),
                });
              })
            );
            setCreatedReports((prev) =>
              prev.map((report) => ({
                ...report,
                company_office_id: report.company_office_id || String(officeId),
              }))
            );
          } catch (err) {
            console.warn(
              "[ManualMultiReport] Failed to update company office id",
              err
            );
          }
        }

        const result = await window.electronAPI.createReportsByBatch(
          createdBatchId,
          Number(tabsNum)
        );
        if (result?.status === "SUCCESS") {
          setAutomationStatus({
            type: "success",
            message:
              "تم إرسال التقرير إلى تقييم باستخدام نفس لوجيك Upload Report Elrajhi.",
          });
          try {
            const batchReportIds = Array.isArray(result?.reportIds)
              ? result.reportIds
              : Array.isArray(result?.report_ids)
              ? result.report_ids
              : [];
            const singleReportId = result?.reportId || result?.report_id || "";

            if (batchReportIds.length > 0) {
              await Promise.all(
                createdReports.map((report, idx) => {
                  const recordId = report?._id || report?.id;
                  const reportIdValue = batchReportIds[idx];
                  if (!recordId || !reportIdValue) return Promise.resolve();
                  return updateMultiApproachReport(recordId, {
                    report_id: reportIdValue,
                    ...(officeId ? { company_office_id: String(officeId) } : {}),
                  });
                })
              );
              setCreatedReports((prev) =>
                prev.map((report, idx) => ({
                  ...report,
                  report_id: batchReportIds[idx] || report.report_id,
                  company_office_id: report.company_office_id || String(officeId || ""),
                }))
              );
            } else if (singleReportId) {
              const selectedReport = createdReports.find(
                (report, idx) => getReportId(report, idx) === selectedReportId
              );
              const recordId = selectedReport?._id || selectedReport?.id;
              if (recordId) {
                await updateMultiApproachReport(recordId, {
                  report_id: singleReportId,
                  ...(officeId ? { company_office_id: String(officeId) } : {}),
                });
                setCreatedReports((prev) =>
                  prev.map((report, idx) =>
                    getReportId(report, idx) === selectedReportId
                      ? {
                          ...report,
                          report_id: singleReportId,
                          company_office_id:
                            report.company_office_id || String(officeId || ""),
                        }
                      : report
                  )
                );
              }
            }
          } catch (err) {
            console.warn(
              "[ManualMultiReport] Failed to update report_id after submission",
              err
            );
          }
          const reportIds = createdReports
            .map((report) => report.report_id)
            .filter(Boolean);
          const assetCountFromReports = createdReports.reduce(
            (sum, report) =>
              sum +
              (Array.isArray(report.asset_data) ? report.asset_data.length : 0),
            0
          );
          const deductionAmount = assetCountFromReports || assets.length;
                if (token && deductionAmount > 0) {
                  try {
                    await deductPoints(token, deductionAmount, {
                      reportIds,
                      reportId: reportIds[0] || null,
                      recordId: createdBatchId,
                      batchId: createdBatchId,
                      source: "manual-report",
                      pageName: MANUAL_MULTI_PAGE_NAME,
                      pageSource: MANUAL_MULTI_PAGE_SOURCE,
                      assetCount: deductionAmount,
                    });
            } catch (deductErr) {
              console.error("[ManualMultiReport] Failed to deduct points:", deductErr);
            }
          }
        } else {
          throw new Error(result?.error || "فشل رفع التقرير إلى تقييم.");
        }
    } catch (err) {
      setAutomationStatus({
        type: "error",
        message:
          err?.message ||
          "تعذر التواصل مع متصفح تقييم. حاول بعد التحقق من الإعدادات.",
      });
    } finally {
      setSending(false);
    }
  };
  const handleSaveReportAndClose = async () => {
    const ok = await handleSaveReport({ allowEmptyAssets: true });
    if (ok) {
      setShowReportModal(false);
    }
  };
  const handleSaveReportAndGoAssets = async () => {
    const ok = await handleSaveReport({ allowEmptyAssets: true });
    if (ok) {
      setShowReportModal(false);
      setShowAssetsModal(true);
    }
  };
  const renderAssetsPanel = () => (
    <>
      <Section title="لصق بيانات الأصول">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <p className="text-sm text-gray-700">اختر تقريراً من القائمة أو ألصق بيانات أصول جديدة.</p>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-700">التقارير المحفوظة</label>
            <select
              value={selectedReportId}
              onChange={(e) => handleSelectSavedReport(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">تقرير جديد</option>
              {createdReports.map((report, idx) => {
                const reportId = getReportId(report, idx);
                const label =
                  report.reportInfo?.title ||
                  report.title ||
                  report.excel_name ||
                  `Report #${idx + 1}`;
                return (
                  <option key={reportId} value={reportId}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
          <div className="lg:col-span-3 space-y-3">
            <div className="w-full h-56 border border-emerald-300 rounded-lg overflow-hidden shadow bg-white">
              <div className="grid grid-cols-4 text-xs bg-emerald-600 text-white border-b border-emerald-300">
                {[0, 1, 2].map((idx) => (
                  <div
                    key={`hdr-${idx}`}
                    className="px-3 py-2 font-semibold border-l last:border-l-0 border-emerald-500"
                  >
                    <select
                      value={columnHeaders[idx]}
                      onChange={(e) => updateColumnHeader(idx, e.target.value)}
                      className="w-full px-2 py-1 text-[11px] border rounded-md bg-white text-gray-800 shadow-sm"
                    >
                      {headerOptions
                        .filter((opt) => opt.value !== "source_sheet")
                        .map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
                <div className="px-3 py-2 font-semibold border-l border-emerald-500">
                  <select
                    value={defaultSourceSheet}
                    onChange={(e) => handleDefaultSourceChange(e.target.value)}
                    className="w-full px-2 py-1 text-[11px] border rounded-md bg-white text-gray-800 shadow-sm"
                  >
                    <option value="market">market</option>
                    <option value="cost">cost</option>
                  </select>
                </div>
              </div>
              <textarea
                className="w-full h-[calc(100%-48px)] font-mono text-sm p-3 bg-emerald-50 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, rgba(16,185,129,0.12), rgba(16,185,129,0.12) 1px, transparent 1px, transparent 32px), repeating-linear-gradient(90deg, rgba(16,185,129,0.12), rgba(16,185,129,0.12) 1px, transparent 1px, transparent 25%)",
                  backgroundSize: "100% 32px, 25% 100%",
                  backgroundPosition: "0 0, 0 0",
                  backgroundRepeat: "repeat, repeat",
                }}
                placeholder={"مثال:\nAsset 1\t101\t250000\tmarket\nAsset 2\t102\t180000\tcost"}
                value={pasteBuffer}
                onChange={(e) => setPasteBuffer(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={parsePastedRows}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white shadow hover:bg-blue-700"
              >
                <ClipboardPaste className="w-4 h-4" />
                لصق البيانات
              </button>
              <button
                type="button"
                onClick={() => setPasteBuffer("")}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                مسح الحقول
              </button>
            </div>
          </div>
          <div className="lg:col-span-1 bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm leading-relaxed shadow-inner">
            <p className="font-semibold text-emerald-800">ملاحظات سريعة:</p>
            <ul className="mt-2 list-disc pl-5 space-y-1 text-emerald-900">
              <li>اختر الترتيب المناسب للأعمدة من القوائم في الأعلى.</li>
              <li>يمكن الفصل بـ Tab أو |. كل سطر يمثل أصلًا واحدًا.</li>
              <li>اختر السوق أو التكلفة من العمود الرابع وسيتم تطبيقه على كل الصفوف تلقائيًا.</li>
            </ul>
            <div className="mt-3 text-xs text-emerald-700">
              عدد الأصول: {assets.length} - إجمالي القيم: {assetsTotal.toLocaleString()}
            </div>
          </div>
        </div>
      </Section>

      <Section title="جدول الأصول">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">اسم الأصل</th>
                <th className="px-3 py-2 text-left">Usage ID</th>
                <th className="px-3 py-2 text-left">القيمة النهائية</th>
                <th className="px-3 py-2 text-left">Sheet</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {assets.map((row, index) => {
                const rowError = assetErrors[index] || {};
                return (
                  <tr key={`asset-row-${index}`} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-500">{index + 1}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.asset_name}
                        onChange={(e) => handleAssetChange(index, "asset_name", e.target.value)}
                        className={`w-full rounded-md border px-2 py-1 text-sm ${
                          rowError.asset_name ? "border-red-300 bg-red-50" : "border-gray-300"
                        }`}
                        placeholder="اسم الأصل"
                      />
                      {rowError.asset_name && (
                        <p className="text-xs text-red-500 mt-1">{rowError.asset_name}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={row.asset_usage_id}
                        onChange={(e) => handleAssetChange(index, "asset_usage_id", e.target.value)}
                        className={`w-full rounded-md border px-2 py-1 text-sm ${
                          rowError.asset_usage_id ? "border-red-300 bg-red-50" : "border-gray-300"
                        }`}
                        placeholder="مثال: 101"
                      />
                      {rowError.asset_usage_id && (
                        <p className="text-xs text-red-500 mt-1">{rowError.asset_usage_id}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={row.final_value}
                        onChange={(e) => handleAssetChange(index, "final_value", e.target.value)}
                        className={`w-full rounded-md border px-2 py-1 text-sm ${
                          rowError.final_value ? "border-red-300 bg-red-50" : "border-gray-300"
                        }`}
                        placeholder="القيمة النهائية"
                      />
                      {rowError.final_value && (
                        <p className="text-xs text-red-500 mt-1">{rowError.final_value}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={row.source_sheet || "market"}
                        onChange={(e) => handleAssetChange(index, "source_sheet", e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                      >
                        <option value="market">market</option>
                        <option value="cost">cost</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeAssetRow(index)}
                        className="inline-flex items-center justify-center text-red-600 hover:text-red-800"
                        title="حذف الصف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
          <div className="text-sm text-gray-600">
            عدد الأصول: <span className="font-semibold text-gray-900">{assets.length}</span> - إجمالي القيم:
            <span className="font-semibold text-gray-900"> {assetsTotal.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addAssetRow}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50"
            >
              <Plus className="w-4 h-4" />
              إضافة صف
            </button>
            <button
              type="button"
              onClick={handleAssetsContinue}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white shadow hover:bg-blue-700"
            >
              <Save className="w-4 h-4" />
              حفظ بيانات الأصول
            </button>
          </div>
        </div>
      </Section>
    </>
  );
  const renderReportUsersSection = () =>
    formData.has_other_users && (
      <Section title="المستخدمون الآخرون للتقرير">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-800">المستخدمون الآخرون</h4>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addReportUser}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
            >
              اضافة مستخدم
            </button>
            <button
              type="button"
              onClick={deleteLastReportUser}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-blue-200 text-blue-700 text-xs font-semibold hover:bg-blue-50"
            >
              حذف المستخدم الأخير
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {reportUsers.map((value, idx) => (
            <div key={`report-user-${idx}`}>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                اسم مستخدم التقرير #{idx + 1}
              </label>
              <input
                type="text"
                value={value}
                onChange={(e) => updateReportUser(idx, e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="اكتب اسم المستخدم"
              />
            </div>
          ))}
          {errors.report_users && (
            <p className="text-xs text-red-500">{errors.report_users}</p>
          )}
        </div>
      </Section>
    );
  const renderValuersSection = () => (
    <Section title="بيانات المقيمين">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-base font-semibold text-gray-800">بيانات المقيمين</h4>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addValuer}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
          >
            إضافة مقيم
          </button>
          <button
            type="button"
            onClick={deleteLastValuer}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-blue-200 text-blue-700 text-xs font-semibold hover:bg-blue-50"
          >
            حذف آخر مقيم
          </button>
        </div>
      </div>
      {valuerError && <p className="text-xs text-red-500 mb-2">{valuerError}</p>}
      <div className="space-y-2">
        {valuers.map((valuer, idx) => (
          <div
            key={`valuer-${idx}`}
            className="grid grid-cols-1 md:grid-cols-2 gap-3 border border-gray-200 rounded-md p-3"
          >
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">اسم المقيم *</label>
              <select
                value={valuer.valuer_name}
                onChange={(e) => handleValuerChange(idx, "valuer_name", e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">تحديد</option>
                {valuerOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">نسبة المساهمة *</label>
              <select
                value={valuer.contribution_percentage}
                onChange={(e) =>
                  handleValuerChange(idx, "contribution_percentage", Number(e.target.value))
                }
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                {contributionOptions.map((pct) => (
                  <option key={pct} value={pct}>
                    {pct}%
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
  const renderReportPanel = () => (
    <div className="space-y-3 text-sm">
      <Section title="بيانات التقرير" className="p-3 text-sm [&>h3]:text-base [&>h3]:mb-2">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          <InputField
            label="عنوان التقرير"
            required
            value={formData.title}
            onChange={(e) => handleFieldChange("title", e.target.value)}
            error={errors.title}
            className="lg:col-span-3"
            placeholder="اكتب عنوانًا واضحًا للتقرير"
          />
          <SelectField
            label="الغرض من التقييم"
            required
            value={formData.purpose_id}
            onChange={(e) => handleFieldChange("purpose_id", e.target.value)}
            options={purposeOptions}
            error={errors.purpose_id}
          />
          <SelectField
            label="طبيعة القيمة"
            required
            value={formData.value_premise_id}
            onChange={(e) => handleFieldChange("value_premise_id", e.target.value)}
            options={valuePremiseOptions}
            error={errors.value_premise_id}
          />
          <SelectField
            label="نوع التقرير"
            required
            value={formData.report_type}
            onChange={(e) => handleFieldChange("report_type", e.target.value)}
            options={reportTypeOptions}
            error={errors.report_type}
          />
          <InputField
            label="تاريخ التقييم"
            required
            type="date"
            value={formData.valued_at}
            onChange={(e) => handleFieldChange("valued_at", e.target.value)}
            error={errors.valued_at}
          />
          <InputField
            label="تاريخ التسليم"
            required
            type="date"
            value={formData.submitted_at}
            onChange={(e) => handleFieldChange("submitted_at", e.target.value)}
            error={errors.submitted_at}
          />
          <InputField
            label="تاريخ المعاينة"
            required
            type="date"
            value={formData.inspection_date}
            onChange={(e) => handleFieldChange("inspection_date", e.target.value)}
            error={errors.inspection_date}
          />
          <InputField
            label="القيمة الإجمالية"
            required
            type="number"
            step="any"
            value={formData.value}
            onChange={(e) => {
              handleFieldChange("value", e.target.value);
              handleFieldChange("final_value", e.target.value);
            }}
            error={errors.value}
            placeholder={assetsTotal ? assetsTotal.toString() : "0"}
          />
          <SelectField
            label="عملة التقييم"
            required
            value={formData.valuation_currency}
            onChange={(e) => handleFieldChange("valuation_currency", e.target.value)}
            options={currencyOptions}
            error={errors.valuation_currency}
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <TextAreaField
            label="الافتراضات"
            rows={3}
            value={formData.assumptions}
            onChange={(e) => handleFieldChange("assumptions", e.target.value)}
          />
          <TextAreaField
            label="الافتراضات الخاصة"
            rows={3}
            value={formData.special_assumptions}
            onChange={(e) => handleFieldChange("special_assumptions", e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">ملف PDF</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                handleFieldChange("pdf_path", file ? file.path || file.name : "");
              }}
              className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            {formData.pdf_path && (
              <p className="text-xs text-gray-500 mt-1 break-all">المسار المختار: {formData.pdf_path}</p>
            )}
          </div>
        </div>
      </Section>

      <Section title="بيانات العميل" className="p-3 text-sm [&>h3]:text-base [&>h3]:mb-2">
        <InputField
          label="اسم العميل"
          required
          value={formData.client_name}
          onChange={(e) => {
            handleFieldChange("client_name", e.target.value);
            if (!formData.owner_name) {
              handleFieldChange("owner_name", e.target.value);
            }
          }}
          error={errors.client_name}
          placeholder="اسم العميل"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <InputField
            label="رقم الجوال"
            required
            value={formData.telephone}
            onChange={(e) => handleFieldChange("telephone", e.target.value)}
            error={errors.telephone}
            placeholder="+9665xxxxxxxx"
          />
          <InputField
            label="البريد الإلكتروني"
            required
            type="email"
            value={formData.email}
            onChange={(e) => handleFieldChange("email", e.target.value)}
            error={errors.email}
            placeholder="example@domain.com"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
          <InputField
            label="المنطقة"
            value={formData.region}
            onChange={(e) => handleFieldChange("region", e.target.value)}
          />
          <InputField
            label="المدينة"
            value={formData.city}
            onChange={(e) => handleFieldChange("city", e.target.value)}
          />
          <InputField
            label="اسم المالك"
            value={formData.owner_name}
            onChange={(e) => handleFieldChange("owner_name", e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3 mt-3">
          <input
            id="has-other-users"
            type="checkbox"
            checked={!!formData.has_other_users}
            onChange={(e) => {
              const checked = e.target.checked;
              handleFieldChange("has_other_users", checked);
              if (!checked) {
                setReportUsers([]);
              } else if (!reportUsers.length) {
                addReportUser();
              }
            }}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="has-other-users" className="text-sm font-medium text-gray-700">
            Has other users
          </label>
        </div>
        {renderReportUsersSection()}
      </Section>

      {renderValuersSection()}

      <div className="flex items-center justify-end mt-4 flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSaveReportAndClose}
          disabled={isSaving}
          className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50 ${
            isSaving ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          <Save className="w-4 h-4" />
          حفظ وإغلاق
        </button>
        <button
          type="button"
          onClick={handleSaveReportAndGoAssets}
          disabled={isSaving}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md shadow ${
            isSaving ? "bg-gray-300 text-gray-600 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              جاري الحفظ...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              حفظ والمتابعة للأصول
            </>
          )}
        </button>
      </div>
    </div>
  );
  const renderReportsTable = () => (
    <Section title={reportsTitle}>
      <div className="flex items-center gap-3 mb-2">
        <InputField
          label="عدد التبويبات (Tabs)"
          type="number"
          min={1}
          value={tabsNum}
          onChange={(e) => setTabsNum(e.target.value)}
          className="w-48"
        />
      </div>
      <div className="text-xs text-gray-600 mb-3">{reportsHint}</div>
      {!createdReports.length && (
        <p className="text-sm text-gray-600">لا توجد تقارير محفوظة بعد. قم بحفظ تقرير لإظهاره هنا.</p>
      )}
      {createdReports.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
              <tr>
                <th className="px-3 py-2 text-left w-10"></th>
                <th className="px-3 py-2 text-left">التقرير</th>
                <th className="px-3 py-2 text-left">عدد الأصول</th>
                <th className="px-3 py-2 text-left">القيمة النهائية</th>
                <th className="px-3 py-2 text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {createdReports.map((report, idx) => {
                const reportId = getReportId(report, idx);
                const isExpanded = expandedReports.includes(reportId);
                const assetList = report.asset_data || report.assets || [];
                const reportInfo = report.reportInfo || {};
                const title =
                  reportInfo.title ||
                  report.title ||
                  report.excel_name ||
                  `Report #${idx + 1}`;
                const finalValue =
                  report.final_value ??
                  reportInfo.final_value ??
                  reportInfo.value ??
                  0;
                return (
                  <React.Fragment key={reportId}>
                    <tr className="border-t border-gray-100 bg-white">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleReportExpansion(reportId)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50"
                          aria-label={isExpanded ? "إخفاء الأصول" : "عرض الأصول المرتبطة"}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-sm font-semibold text-gray-900">{title}</p>
                        <p className="text-xs text-gray-500">{reportInfo.excel_name || report.excel_name || ""}</p>
                      </td>
                      <td className="px-3 py-2 text-gray-700">{assetList.length}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {Number(finalValue || 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleSelectSavedReport(reportId)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-slate-100 text-gray-800 text-xs font-semibold hover:bg-slate-200 shadow-sm"
                          >
                            <Table className="w-4 h-4" />
                            عرض البيانات
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedReportId(reportId);
                              handleSendToTaqeem();
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-xs font-semibold shadow hover:from-emerald-400 hover:to-emerald-500"
                          >
                            <Send className="w-4 h-4" />
                            إرسال التقرير إلى تقييم
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} className="bg-slate-50 border-t border-gray-200">
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-xs">
                              <thead className="bg-white text-gray-500 uppercase">
                                <tr>
                                  <th className="px-3 py-2 text-left">Asset Name</th>
                                  <th className="px-3 py-2 text-left">Usage ID</th>
                                  <th className="px-3 py-2 text-left">Value</th>
                                  <th className="px-3 py-2 text-left">Sheet</th>
                                </tr>
                              </thead>
                              <tbody>
                                {assetList.map((asset, assetIdx) => (
                                  <tr key={`asset-${reportId}-${assetIdx}`} className="border-t">
                                    <td className="px-3 py-1.5 text-gray-800">{asset.asset_name}</td>
                                    <td className="px-3 py-1.5 text-gray-600">{asset.asset_usage_id}</td>
                                    <td className="px-3 py-1.5 text-gray-800">
                                      {Number(asset.final_value || 0).toLocaleString()}
                                    </td>
                                    <td className="px-3 py-1.5 text-gray-600">{asset.source_sheet}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
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
      )}
      {isGuestUser && (
        <div className="mt-3 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <span>قم بالتسجيل لحفظ هذه التقارير بشكل دائم وربطها برقم هاتفك.</span>
          <button
            type="button"
            onClick={() => onViewChange?.("registration")}
            className="rounded-md bg-amber-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-800"
          >
            تسجيل
          </button>
        </div>
      )}
    </Section>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-4 px-3">
      <div className="max-w-6xl mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">إدارة التقارير اليدوية متعددة المناهج</h1>
            <p className="text-sm text-gray-600">
              من هنا يمكنك إنشاء تقارير Multi-Approach وتكرارها وإرسالها في مكان واحد.
            </p>
          </div>
          <button
            type="button"
            onClick={resetWizard}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-gray-100 text-gray-800 text-sm font-semibold hover:bg-gray-200"
          >
            <RefreshCw className="w-4 h-4" />
            إعادة تعيين النموذج
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap items-center gap-3 shadow-sm">
          <button
            type="button"
            onClick={() => setShowReportModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg hover:from-blue-500 hover:to-indigo-500 transition"
          >
            <Table className="w-4 h-4" />
            بيانات التقرير
          </button>
          <button
            type="button"
            onClick={() => setShowAssetsModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-full border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 hover:border-blue-300 transition shadow-sm"
          >
            <ClipboardPaste className="w-4 h-4" />
            لصق بيانات الأصول
          </button>
        </div>

        <InfoBanner tone={status?.type || "info"} message={status?.message} />
        <InfoBanner tone={automationStatus?.type || "info"} message={automationStatus?.message} />

        {renderReportsTable()}

        <Modal
          open={showAssetsModal}
          onClose={() => setShowAssetsModal(false)}
          title="لصق بيانات الأصول"
          maxWidth="max-w-6xl"
        >
          <div className="space-y-4">
            {renderAssetsPanel()}
          </div>
        </Modal>

        <Modal
          open={showReportModal}
          onClose={() => setShowReportModal(false)}
          title="بيانات التقرير"
          maxWidth="max-w-5xl"
        >
          <div className="space-y-4">{renderReportPanel()}</div>
        </Modal>
      </div>
    </div>
  );
};
export default ManualMultiReport;
