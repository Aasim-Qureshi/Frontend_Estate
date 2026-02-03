import React, { useState, useEffect, useMemo } from "react";
import { useRam } from "../context/RAMContext";
import { useNavStatus } from "../context/NavStatusContext";
import { useSession } from "../context/SessionContext";
import { useValueNav } from "../context/ValueNavContext";
import { ensureTaqeemAuthorized } from "../../shared/helper/taqeemAuthWrap";
import { useAuthAction } from "../hooks/useAuthAction";
import InsufficientPointsModal from "../components/InsufficientPointsModal";
import {
  AlertTriangle,
  Table,
  FileText,
  Calendar,
  MapPin,
  User,
  CheckCircle2,
  Loader2,
  Download,
  RefreshCw,
  Send,
  FileIcon,
} from "lucide-react";
import ReportsTable from "../components/ReportsTable";
import DeductionNotification from "../components/DeductionNotification";
import { downloadTemplateFile } from "../utils/templateDownload";

const UPLOAD_ASSETS_PAGE_NAME = "Upload Assets";
const UPLOAD_ASSETS_PAGE_SOURCE = "upload-assets";

const UploadAssets = ({ onViewChange }) => {
  const [excelFileName, setExcelFileName] = useState(null);
  const [showInsufficientPointsModal, setShowInsufficientPointsModal] =
    useState(false);
  const [excelFilePath, setExcelFilePath] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploadLoading, setUploadLoading] = useState(false);
  const [reportId, setReportId] = useState("");
  const [flowPaused, setFlowPaused] = useState({});
  const [flowStopped, setFlowStopped] = useState({});
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const [submitProgress, setSubmitProgress] = useState({});
  const { selectedCompany } = useValueNav();
  const selectedCompanyOfficeId = useMemo(() => {
    const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
    return officeId ? String(officeId) : "";
  }, [selectedCompany]);

  // Add this useEffect to listen for progress updates
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSubmitReportsQuicklyProgress?.(
      (data) => {
        console.log("[UploadAssets] Progress update:", data);

        if (data.reportId || data.processId) {
          const reportId = data.reportId || data.processId;
          setSubmitProgress((prev) => ({
            ...prev,
            [reportId]: {
              current: data.completed || data.current || 0,
              total: data.total || 1,
              percentage: data.percentage || 0,
              message: data.message || "",
              status: data.status,
            },
          }));
        }
      },
    );

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const openFileDialogAndExtract = async () => {
    try {
      setError("");
      setSuccess("");
      setPreviewData(null);
      setReportId("");

      // Use electron's showOpenDialog
      const dlgResult = await window.electronAPI.showOpenDialog({
        properties: ["openFile"],
        filters: [
          { name: "Excel Files", extensions: ["xlsx", "xls", "xlsm"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      // Check if dialog was cancelled or no file selected
      if (
        !dlgResult ||
        dlgResult.canceled ||
        !dlgResult.filePaths ||
        dlgResult.filePaths.length === 0
      ) {
        return;
      }

      const filePath = dlgResult.filePaths[0];

      if (!filePath) {
        setError("No file selected");
        return;
      }

      setExcelFilePath(filePath);
      const name = filePath.split(/[\\/]/).pop();
      setExcelFileName(name);

      const extractedReportId = extractFileNameWithoutExtension(filePath);
      setReportId(extractedReportId);

      setPreviewLoading(true);
      console.log("[UploadAssets] calling extract-asset-data for", filePath);

      const result = await window.electronAPI.extractAssetData(filePath);

      console.log("[UploadAssets] extract-asset-data result:", result);

      if (result?.status === "FAILED" || result?.error) {
        throw new Error(
          result.error || "Failed to extract data from Excel file",
        );
      }

      const preview = result?.data ?? null;
      if (!preview) {
        setError("No preview data returned from extract-asset-data.");
        setPreviewData(null);
      } else {
        const processedData = processPreviewData(
          Array.isArray(preview) ? preview : [preview],
        );
        setPreviewData(processedData);
        const info = result?.info || {};
        setSuccess(
          `Successfully extracted ${processedData.length} records (${info.marketCount || 0} market approach, ${info.costCount || 0} cost approach)`,
        );
      }
    } catch (err) {
      console.error("[UploadAssets] error extracting preview:", err);
      setError(err?.message || "Failed to extract preview via IPC");
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const { executeWithAuth } = useAuthAction();
  const { token, login } = useSession();
  const { taqeemStatus, setTaqeemStatus } = useNavStatus();

  // Common fields state
  const [inspectionDate, setInspectionDate] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [availableCities, setAvailableCities] = useState([]);

  // Get RAM info from context
  const { ramInfo } = useRam();

  // Helper function to get tabs count from RAM info
  const getTabsCount = () => {
    return ramInfo?.recommendedTabs || 1;
  };

  // Updated table headings to match backend field names
  const tableHeadings = [
    "asset_name",
    "asset_usage_id",
    "market_approach",
    "market_approach_value",
    "cost_approach",
    "cost_approach_value",
    "region",
    "city",
    "inspection_date",
  ];

  // Saudi Arabia regions and cities data
  const saudiRegions = {
    "منطقة الرياض": [
      "الرياض",
      "الدرعية",
      "ضرما",
      "المزاحمية",
      "شقراء",
      "الدوادمي",
      "وادي الدواسر",
    ],
    "مكة المكرمة": ["مكة المكرمة", "جدة", "الطائف", "القنفذة", "الليث", "رابغ"],
    "المدينة المنورة": [
      "المدينة المنورة",
      "ينبع",
      "العلا",
      "المهد",
      "الحناكية",
    ],
    القصيم: ["بريدة", "عنيزة", "الرس", "المذنب", "البكيرية", "البدائع"],
    الشرقية: ["الدمام", "الخبر", "الأحساء", "الجبيل", "القطيف", "حفر الباطن"],
    عسير: ["أبها", "خميس مشيط", "بيشة", "النماص", "ظهران الجنوب"],
    تبوك: ["تبوك", "الوجه", "ضباء", "تيماء", "أملج"],
    حائل: ["حائل", "بقعاء", "الغزالة", "الشنان"],
    "الحدود الشمالية": ["عرعر", "رفحاء", "طريف", "العويقيلة"],
    جازان: ["جازان", "صبيا", "أبو عريش", "صامطة", "بيش", "الدرب"],
    نجران: ["نجران", "شرورة", "حبونا", "بدر الجنوب"],
    الباحة: ["الباحة", "بلجرشي", "المندق", "المخواة", "قلوة"],
    الجوف: ["سكاكا", "القريات", "دومة الجندل", "طبرجل"],
  };

  const extractFileNameWithoutExtension = (filePath) => {
    if (!filePath) return "";
    const fullFileName = filePath.split(/[\\/]/).pop();
    const lastDotIndex = fullFileName.lastIndexOf(".");
    if (lastDotIndex === -1) return fullFileName;
    return fullFileName.substring(0, lastDotIndex);
  };

  const handleRegionChange = (selectedRegion) => {
    setRegion(selectedRegion);
    setCity("");

    if (selectedRegion && saudiRegions[selectedRegion]) {
      setAvailableCities(saudiRegions[selectedRegion]);
    } else {
      setAvailableCities([]);
    }
  };

  const handleDownloadTemplate = async () => {
    if (downloadingTemplate) return;
    setError("");
    setSuccess("");
    setDownloadingTemplate(true);
    try {
      await downloadTemplateFile("upload-assets-template.xlsx");
      setSuccess("Excel template downloaded successfully.");
    } catch (err) {
      const message =
        err?.message || "Failed to download Excel template. Please try again.";
      setError(
        message.includes("not found")
          ? "Template file not found. Please contact administrator to ensure the template file exists in the public folder."
          : message,
      );
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const processPreviewData = (data) => {
    if (!data || !Array.isArray(data)) return [];

    return data.map((item) => {
      const processed = { ...item };

      if (processed.baseData !== undefined) {
        delete processed.baseData;
      }

      // Apply common fields if they're filled
      if (inspectionDate) {
        processed.inspection_date = inspectionDate;
      }
      if (region) {
        processed.region = region;
      }
      if (city) {
        processed.city = city;
      }
      if (ownerName) {
        processed.owner_name = ownerName;
      }

      const mappedData = {
        asset_name: processed.asset_name || processed.assetName,
        asset_usage_id: String(
          processed.asset_usage_id ?? processed.assetUsageId ?? "",
        ),
        market_approach:
          processed.market_approach ||
          processed.marketApproach ||
          (processed.approach_type === "market" ? "Market" : undefined),
        market_approach_value:
          processed.market_approach_value ||
          processed.marketApproachValue ||
          (processed.approach_type === "market"
            ? processed.final_value || processed.finalValue
            : undefined),
        cost_approach:
          processed.cost_approach ||
          processed.costApproach ||
          (processed.approach_type === "cost" ? "Cost" : undefined),
        cost_approach_value:
          processed.cost_approach_value ||
          processed.costApproachValue ||
          processed.cost_value ||
          processed.costValue ||
          (processed.approach_type === "cost"
            ? processed.final_value || processed.finalValue
            : undefined),
        region:
          processed.region || processed.Region || processed.location_region,
        city: processed.city || processed.City || processed.location_city,
        inspection_date:
          processed.inspection_date ||
          processed.inspectionDate ||
          processed.date,
        asset_type: processed.asset_type || processed.assetType || "0",
        production_capacity:
          processed.production_capacity || processed.productionCapacity || "0",
        production_capacity_measuring_unit:
          processed.production_capacity_measuring_unit ||
          processed.productionCapacityMeasuringUnit ||
          "0",
        product_type: processed.product_type || processed.productType || "0",
        country:
          processed.country || processed.Country || "المملكة العربية السعودية",
        submitState: processed.submitState || 0,
        final_value: processed.final_value || processed.finalValue,
        owner_name:
          processed.owner_name || processed.ownerName || ownerName || undefined,
      };

      Object.keys(mappedData).forEach((key) => {
        if (mappedData[key] === undefined || mappedData[key] === null) {
          delete mappedData[key];
        }
      });

      return mappedData;
    });
  };

  const updatePreviewWithCommonFields = () => {
    if (previewData) {
      const updatedData = processPreviewData(previewData);
      setPreviewData(updatedData);
    }
  };

  const handleCommonFieldChange = (field, value) => {
    switch (field) {
      case "inspectionDate":
        setInspectionDate(value);
        break;
      case "region":
        handleRegionChange(value);
        break;
      case "city":
        setCity(value);
        break;
      case "ownerName":
        setOwnerName(value);
        break;
    }

    setTimeout(() => {
      updatePreviewWithCommonFields();
    }, 0);
  };

  const handleUploadToDB = async () => {
    // Validation
    if (!reportId.trim()) {
      setError(
        "Report ID could not be extracted from file name. Please check the file name.",
      );
      return;
    }

    if (!previewData || previewData.length === 0) {
      setError("No data to upload");
      return;
    }

    setError("");
    setSuccess("");
    setUploadLoading(true);

    try {
      // Use auth wrapper
      const result = await executeWithAuth(
        // Action function
        async (params) => {
          // Initialize progress
          setSubmitProgress((prev) => ({
            ...prev,
            [reportId.trim()]: {
              current: 0,
              total: 1,
              percentage: 0,
              message: "Starting submission...",
              status: "RUNNING",
            },
          }));
          const {
            token: authToken,
            previewData,
            reportId,
            region,
            city,
            inspectionDate,
            ownerName,
          } = params;

          console.log(
            "[UploadAssets] Uploading to backend with token:",
            !!authToken,
          );

          // 1. Upload report to backend
          const uploadResult = await window.electronAPI.apiRequest(
            "POST",
            "/api/report/createReportWithCommonFields",
            {
              reportId: reportId.trim(),
              reportData: previewData,
              commonFields: {
                region: region || undefined,
                city: city || undefined,
                inspectionDate: inspectionDate || undefined,
                ownerName: ownerName || undefined,
              },
              companyOfficeId: selectedCompanyOfficeId || undefined,
            },
            {
              Authorization: `Bearer ${authToken}`,
            },
          );

          console.log("[UploadAssets] Upload response:", uploadResult);

          if (!uploadResult.success) {
            throw new Error(uploadResult.message || "Failed to create report");
          }
          window.dispatchEvent(
            new CustomEvent("refreshReportsTable", {
              detail: { reportId: reportId.trim() },
            }),
          );

          // 2. Complete the flow (automation)
          const tabsNum = getTabsCount();
          console.log(
            "[UploadAssets] Calling completeFlow for report:",
            reportId,
            "tabsNum:",
            tabsNum,
          );

          await new Promise((resolve) => setTimeout(resolve, 500));
          const flowResult = await window.electronAPI.completeFlow(
            reportId.trim(),
            tabsNum,
          );
          console.log("[UploadAssets] completeFlow result:", flowResult);

          if (flowResult?.status !== "SUCCESS") {
            throw new Error(
              `Flow completion failed: ${flowResult?.message || "Unknown error"}`,
            );
          }

          // 3. Deduct points if assets were completed
          const completedAssets = flowResult?.summary?.complete_macros;
          console.log("[UploadAssets] Completed assets:", completedAssets);

          // Build success message
          const successMessage = `Successfully created report "${reportId}" with ${previewData.length} assets`;

          // Add common fields info if any were set
          const commonFieldsInfo = [];
          if (inspectionDate)
            commonFieldsInfo.push(`Inspection Date: ${inspectionDate}`);
          if (region) commonFieldsInfo.push(`Region: ${region}`);
          if (city) commonFieldsInfo.push(`City: ${city}`);
          if (ownerName) commonFieldsInfo.push(`Owner: ${ownerName}`);

          let fullMessage = successMessage;
          if (commonFieldsInfo.length > 0) {
            fullMessage += `\n\nCommon fields applied:\n• ${commonFieldsInfo.join("\n• ")}`;
          }

          if (flowResult?.summary) {
            fullMessage += `\n\n✅ Flow completed: ${completedAssets || 0} assets processed`;
          }

          return {
            success: true,
            message: fullMessage,
            reportId: reportId.trim(),
            completedAssets: completedAssets || 0,
          };
        },
        // Action parameters
        {
          token,
          previewData,
          reportId: reportId.trim(),
          region,
          city,
          inspectionDate,
          ownerName,
        },
        // Auth options
        {
          requiredPoints: previewData.length || 0,
              deductPoints: (result) => {
                const completed = Number(result?.completedAssets) || previewData.length || 0;
                const ids = result?.reportId ? [result.reportId].filter(Boolean) : [];
                return {
                  amount: completed,
                  reportIds: ids,
                  reportId: result?.reportId,
                  recordId: result?.recordId || null,
                  batchId: result?.batchId || null,
                  source: "upload-assets",
                  pageName: UPLOAD_ASSETS_PAGE_NAME,
                  pageSource: UPLOAD_ASSETS_PAGE_SOURCE,
                  assetCount: completed,
                };
              },
          showInsufficientPointsModal: () =>
            setShowInsufficientPointsModal(true),
          onViewChange,
          onAuthSuccess: () => {
            console.log("[UploadAssets] Authentication successful");
          },
          onAuthFailure: (reason) => {
            console.warn("[UploadAssets] Authentication failed:", reason);
            // Clear progress on auth failure
            setSubmitProgress((prev) => {
              const next = { ...prev };
              delete next[reportId.trim()];
              return next;
            });
            // Only show error if it's not one of the handled auth cases
            if (
              reason !== "INSUFFICIENT_POINTS" &&
              reason !== "LOGIN_REQUIRED"
            ) {
              setError(reason?.message || "Authentication failed");
            }
          },
        },
      );

      // Handle the result
      if (result?.success) {
        setSuccess(result.message);

        // Clear progress after success
        setTimeout(() => {
          setSubmitProgress((prev) => {
            const next = { ...prev };
            delete next[reportId.trim()];
            return next;
          });
        }, 2000);

        // Clear form if upload was successful
        if (result.completedAssets > 0) {
          setTimeout(() => {
            removeFile();
          }, 2000);
        }
      } else if (!result && error === "") {
        // Auth failed but error already handled in onAuthFailure
        console.log("[UploadAssets] Upload cancelled due to auth failure");
      }
    } catch (error) {
      console.error("[UploadAssets] Error in handleUploadToDB:", error);
      // Clear progress on error
      setSubmitProgress((prev) => {
        const next = { ...prev };
        delete next[reportId.trim()];
        return next;
      });
      setError(
        error?.message || error?.error || "An unexpected error occurred",
      );
    } finally {
      setUploadLoading(false);
    }
  };

  const handlePauseFlow = async (reportId) => {
    try {
      const result = await window.electronAPI.pauseCompleteFlow?.(reportId);
      if (result?.status === "SUCCESS") {
        setFlowPaused((prev) => ({ ...prev, [reportId]: true }));
      }
    } catch (error) {
      console.error("[UploadAssets] Error pausing flow:", error);
      setError("Failed to pause flow");
    }
  };

  const handleResumeFlow = async (reportId) => {
    try {
      const result = await window.electronAPI.resumeCompleteFlow?.(reportId);
      if (result?.status === "SUCCESS") {
        setFlowPaused((prev) => ({ ...prev, [reportId]: false }));
      }
    } catch (error) {
      console.error("[UploadAssets] Error resuming flow:", error);
      setError("Failed to resume flow");
    }
  };

  const handleStopFlow = async (reportId) => {
    try {
      const result = await window.electronAPI.stopCompleteFlow?.(reportId);
      if (result?.status === "SUCCESS") {
        setFlowStopped((prev) => ({ ...prev, [reportId]: true }));
        setUploadLoading(false);
        // Clear progress
        setSubmitProgress((prev) => {
          const next = { ...prev };
          delete next[reportId];
          return next;
        });
      }
    } catch (error) {
      console.error("[UploadAssets] Error stopping flow:", error);
      setError("Failed to stop flow");
    }
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

  const handleStoreAndSubmitLater = async () => {
    // Validation
    if (!reportId.trim()) {
      setError(
        "Report ID could not be extracted from file name. Please check the file name.",
      );
      return;
    }

    if (!previewData || previewData.length === 0) {
      setError("No data to upload");
      return;
    }

    // Check if all common fields are filled
    if (!inspectionDate || !region || !city || !ownerName) {
      setError(
        "Please fill all common fields (Inspection Date, Region, City, and Owner Name)",
      );
      return;
    }

    setError("");
    setSuccess("");
    setUploadLoading(true);

    try {
      const tokenObj = await window.electronAPI.getToken?.();
      const activeToken = tokenObj?.refreshToken || tokenObj?.token;

      console.log(
        "[UploadAssets] Storing report for later submission with token:",
        !!activeToken,
      );

      // Upload report to backend (without automation)
      const uploadResult = await window.electronAPI.apiRequest(
        "POST",
        "/api/report/createReportWithCommonFields",
        {
          reportId: reportId.trim(),
          reportData: previewData,
          commonFields: {
            region: region || undefined,
            city: city || undefined,
            inspectionDate: inspectionDate || undefined,
            ownerName: ownerName || undefined,
          },
          companyOfficeId: selectedCompanyOfficeId || undefined,
        },
        {
          Authorization: `Bearer ${token}`,
        },
      );

      console.log("[UploadAssets] Upload response:", uploadResult);

      if (!uploadResult.success) {
        throw new Error(uploadResult.message || "Failed to create report");
      }

      // Build success message
      const successMessage = `✅ Successfully stored report "${reportId}" with ${previewData.length} assets for later submission`;

      // Add common fields info
      const commonFieldsInfo = [];
      if (inspectionDate)
        commonFieldsInfo.push(`Inspection Date: ${inspectionDate}`);
      if (region) commonFieldsInfo.push(`Region: ${region}`);
      if (city) commonFieldsInfo.push(`City: ${city}`);
      if (ownerName) commonFieldsInfo.push(`Owner: ${ownerName}`);

      let fullMessage = successMessage;
      if (commonFieldsInfo.length > 0) {
        fullMessage += `\n\nCommon fields applied:\n• ${commonFieldsInfo.join("\n• ")}`;
      }

      setSuccess(fullMessage);

      // Clear form and refresh reports table
      setTimeout(() => {
        removeFile();
        // Trigger refresh of ReportsTable component
        window.dispatchEvent(new CustomEvent("refreshReportsTable"));
      }, 2000);
    } catch (error) {
      console.error(
        "[UploadAssets] Error in handleStoreAndSubmitLater:",
        error,
      );

      // Handle authentication errors
      if (
        error?.message?.includes("Unauthorized") ||
        error?.message?.includes("token") ||
        error?.message?.includes("auth")
      ) {
        setError("Your session has expired. Please log in again.");
        // Optionally trigger login
        // login();
      } else {
        setError(error?.message || "An unexpected error occurred");
      }
    } finally {
      setUploadLoading(false);
    }
  };

  const removeFile = () => {
    setExcelFileName(null);
    setExcelFilePath(null);
    setPreviewData(null);
    setReportId("");
    setInspectionDate("");
    setRegion("");
    setCity("");
    setOwnerName("");
    setAvailableCities([]);
    setError("");
    setSuccess("");
  };

  const formatValue = (v) => {
    if (v === null || v === undefined || v === "-") return "-";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "object") {
      if (v.value !== undefined) return formatValue(v.value);
      return JSON.stringify(v);
    }

    if (typeof v === "string" && /^\d+$/.test(v) && v.length > 3) {
      const num = parseInt(v);
      if (num > 1000) {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(num);
      }
    }

    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return new Date(v).toLocaleDateString();
    }

    return String(v);
  };

  const formatColumnName = (columnName) => {
    return columnName
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const getTodayDate = () => {
    return new Date().toISOString().split("T")[0];
  };

  const PreviewTable = ({ data }) => {
    if (!data || data.length === 0)
      return (
        <div className="p-6 text-center text-slate-500 border-2 border-dashed border-slate-300 rounded-lg bg-slate-50">
          <FileText className="w-12 h-12 mx-auto mb-2 text-slate-300" />
          <div className="text-sm font-medium">No preview data to display</div>
        </div>
      );

    const displayData = data.slice(0, 50);

    return (
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Table className="w-4 h-4 text-blue-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Data Preview
              </h3>
              <p className="text-[10px] text-slate-600">
                Showing {displayData.length} of {data.length} records
                {displayData.length < data.length && " (first 50 rows)"}
              </p>
            </div>
          </div>
        </div>

        <div className="max-h-96 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gradient-to-r from-blue-600 to-blue-700 text-white sticky top-0">
              <tr>
                {tableHeadings.map((column) => (
                  <th
                    key={column}
                    className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider border-r border-white/10 last:border-r-0"
                  >
                    {formatColumnName(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {displayData.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="hover:bg-blue-50/30 transition-colors"
                >
                  {tableHeadings.map((column) => (
                    <td
                      key={column}
                      className={`px-2 py-1.5 border-r border-slate-100 last:border-r-0 whitespace-nowrap ${
                        (column === "inspection_date" && inspectionDate) ||
                        (column === "region" && region) ||
                        (column === "city" && city)
                          ? "text-emerald-600 font-semibold"
                          : "text-slate-700"
                      }`}
                    >
                      {formatValue(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[10px] text-slate-600">
          <div className="flex justify-between items-center">
            <span>
              Columns:{" "}
              <span className="font-semibold text-slate-800">
                {tableHeadings.length}
              </span>
            </span>
            <span>
              Total rows:{" "}
              <span className="font-semibold text-slate-800">
                {data.length}
              </span>
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Check if upload should be enabled
  const isUploadEnabled =
    excelFileName &&
    previewData &&
    previewData.length > 0 &&
    reportId.trim() &&
    inspectionDate &&
    region &&
    city &&
    ownerName;

  const isStoreEnabled =
    excelFileName &&
    previewData &&
    previewData.length > 0 &&
    reportId.trim() &&
    inspectionDate &&
    region &&
    city &&
    ownerName;

  return (
    <div className="relative p-3 space-y-3 page-animate overflow-x-hidden">
      {showInsufficientPointsModal && (
        <div className="fixed inset-0 z-[9999]">
          {/* Modal positioned at top */}
          <div className="absolute top-20 left-1/2 transform -translate-x-1/2 w-full max-w-sm">
            <InsufficientPointsModal
              viewChange={onViewChange}
              onClose={() => setShowInsufficientPointsModal(false)}
            />
          </div>
        </div>
      )}

      <DeductionNotification
        source="upload-assets"
        defaultPageName={UPLOAD_ASSETS_PAGE_NAME}
        defaultPageSource={UPLOAD_ASSETS_PAGE_SOURCE}
        onViewChange={onViewChange}
      />

      {/* File Selection Section - Top */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-3">
        <div className="space-y-2">
          {/* Main row with Excel input taking remaining width */}
          <div className="flex items-center gap-2">
            <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-dashed border-slate-300 bg-slate-50 cursor-pointer hover:bg-blue-50 hover:border-blue-400 transition-all flex-1 group">
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <FileText className="w-4 h-4 text-blue-600 group-hover:text-blue-700" />
                <span className="font-semibold">
                  {excelFileName ? (
                    <span className="truncate" title={excelFileName}>
                      {excelFileName}
                    </span>
                  ) : (
                    "Choose Excel file"
                  )}
                </span>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onClick={(e) => {
                  // Prevent the default file input dialog
                  e.preventDefault();
                  // Use electron's showOpenDialog instead
                  openFileDialogAndExtract();
                  // Reset the input
                  e.target.value = null;
                }}
              />
              <span className="text-xs font-semibold text-blue-600 group-hover:text-blue-700 whitespace-nowrap">
                Browse
              </span>
            </label>

            {/* Button container */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                disabled={downloadingTemplate}
                className="inline-flex items-center gap-1.5 rounded-md border border-blue-600 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 hover:border-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {downloadingTemplate ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {downloadingTemplate ? "Downloading..." : "Export Template"}
              </button>

              <button
                type="button"
                onClick={removeFile}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors whitespace-nowrap"
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </button>
            </div>
          </div>

          {/* Status Messages */}
          {(error || success) && (
            <div
              className={`rounded-lg border px-3 py-2 flex items-start gap-2 shadow-sm card-animate ${
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
              <div className="text-xs font-medium whitespace-pre-line">
                {error || success}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Common Fields Section - Full Row Below File Selection */}
      {previewData && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-3">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">
            Common Fields
          </h3>

          <div className="grid grid-cols-4 gap-3">
            {/* Inspection Date */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Inspection Date
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
                <input
                  type="date"
                  value={inspectionDate}
                  onChange={(e) =>
                    handleCommonFieldChange("inspectionDate", e.target.value)
                  }
                  max={getTodayDate()}
                  className="w-full pl-10 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                />
              </div>
            </div>

            {/* Region */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Region
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
                <select
                  value={region}
                  onChange={(e) =>
                    handleCommonFieldChange("region", e.target.value)
                  }
                  className="w-full pl-10 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all appearance-none bg-white cursor-pointer"
                >
                  <option value="">Select Region</option>
                  {Object.keys(saudiRegions).map((regionName) => (
                    <option key={regionName} value={regionName}>
                      {regionName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* City */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                City
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
                <select
                  value={city}
                  onChange={(e) =>
                    handleCommonFieldChange("city", e.target.value)
                  }
                  disabled={!region}
                  className="w-full pl-10 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all appearance-none bg-white disabled:bg-slate-50 disabled:text-slate-400 cursor-pointer disabled:cursor-not-allowed"
                >
                  <option value="">
                    {region ? "Select City" : "Select region first"}
                  </option>
                  {availableCities.map((cityName) => (
                    <option key={cityName} value={cityName}>
                      {cityName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Owner Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Owner Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
                <input
                  type="text"
                  value={ownerName}
                  onChange={(e) =>
                    handleCommonFieldChange("ownerName", e.target.value)
                  }
                  className="w-full pl-10 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                  placeholder="Owner name"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleUploadToDB}
          disabled={!isUploadEnabled || uploadLoading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md
                                bg-green-600 hover:bg-green-700
                                text-white text-xs font-semibold
                                shadow-md hover:shadow-lg hover:scale-[1.01]
                                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                                transition-all"
        >
          {uploadLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          {uploadLoading ? "Uploading..." : "Store & Submit Now"}
        </button>

        <button
          type="button"
          onClick={handleStoreAndSubmitLater}
          disabled={!isStoreEnabled || uploadLoading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md
                                bg-blue-600 hover:bg-blue-700
                                text-white text-xs font-semibold
                                shadow-md hover:shadow-lg hover:scale-[1.01]
                                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                                transition-all"
        >
          {uploadLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FileIcon className="w-4 h-4" />
          )}
          {uploadLoading ? "Storing..." : "Store & Submit Later"}
        </button>
      </div>

      {/* Progress Bar with Controls - Show if there's active progress */}
      {submitProgress[reportId?.trim()] && uploadLoading && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 shadow-sm p-3">
          <div className="space-y-2">
            {/* Progress info */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">
                    {submitProgress[reportId.trim()]?.message ||
                      "Processing..."}
                  </span>
                </div>
                <span className="text-sm font-semibold text-blue-900">
                  {submitProgress[reportId.trim()]?.current}/
                  {submitProgress[reportId.trim()]?.total} (
                  {Math.round(submitProgress[reportId.trim()]?.percentage || 0)}
                  %)
                </span>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${submitProgress[reportId.trim()]?.percentage || 0}%`,
                  }}
                />
              </div>
            </div>

            {/* Control buttons */}
            <div className="flex items-center gap-2">
              {!flowPaused[reportId.trim()] ? (
                <button
                  type="button"
                  onClick={() => handlePauseFlow(reportId.trim())}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-600 bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 transition-colors"
                >
                  <svg
                    className="w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleResumeFlow(reportId.trim())}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-green-600 bg-green-50 text-green-700 text-xs font-semibold hover:bg-green-100 transition-colors"
                >
                  <svg
                    className="w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Resume
                </button>
              )}

              <button
                type="button"
                onClick={() => handleStopFlow(reportId.trim())}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-600 bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 transition-colors"
              >
                <svg
                  className="w-3 h-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
                    clipRule="evenodd"
                  />
                </svg>
                Stop
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Table - Full Width Below Everything */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">Data Preview</h3>
          {previewData && (
            <div className="text-xs text-slate-600 font-medium">
              {previewData.length} records
            </div>
          )}
        </div>

        {previewLoading ? (
          <div className="flex items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-300 rounded-lg bg-slate-50">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            <div className="text-slate-600">
              <div className="text-sm font-semibold">Extracting data...</div>
              <div className="text-xs">Processing your Excel file</div>
            </div>
          </div>
        ) : previewData ? (
          <PreviewTable data={previewData} />
        ) : (
          <div className="text-center p-3 border-2 border-dashed border-300 rounded-lg bg-slate-50">
            <div className="text-xs">Validation results will appear here</div>
          </div>
        )}
      </div>

      {/* Reports Table Section */}
      <div className="mt-4">
        <ReportsTable />
      </div>
    </div>
  );
};

export default UploadAssets;
