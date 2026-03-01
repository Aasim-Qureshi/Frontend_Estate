import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
  FileSpreadsheet,
  Calendar,
  MapPin,
  User,
  CheckCircle2,
  Loader2,
  ChevronRight,
  RefreshCw,
  Send,
  FileIcon,
} from "lucide-react";
import ReportsTable from "../components/ReportsTable";
import DeductionNotification from "../components/DeductionNotification";
import { downloadTemplateFile } from "../utils/templateDownload";
import excelIconFallback from "../../../public/images/excelicon.png";

const UPLOAD_ASSETS_PAGE_NAME = "Upload Assets";
const UPLOAD_ASSETS_PAGE_SOURCE = "upload-assets";

const UploadAssets = ({ onViewChange }) => {
  const { t, i18n } = useTranslation();
  const translate = (key, defaultValue, options = {}) =>
    t(`uploadAssets.${key}`, { defaultValue, ...options });
  const quickTranslate = (key, defaultValue, options = {}) =>
    t(`submitReportsQuickly.${key}`, { defaultValue, ...options });
  const isArabicUi = useMemo(
    () => i18n?.dir?.(i18n?.resolvedLanguage || i18n?.language) === "rtl",
    [i18n, i18n?.language, i18n?.resolvedLanguage],
  );
  const [excelFileName, setExcelFileName] = useState(null);
  const [showInsufficientPointsModal, setShowInsufficientPointsModal] =
    useState(false);
  const [excelFilePath, setExcelFilePath] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploadLoading, setUploadLoading] = useState(false);
  const [reportId, setReportId] = useState("");
  const [flowPaused, setFlowPaused] = useState({});
  const [flowStopped, setFlowStopped] = useState({});
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationModalStep, setValidationModalStep] = useState("validation");
  const [excelIconSrc, setExcelIconSrc] = useState(excelIconFallback);
  const [hasAutoOpenedValidationModal, setHasAutoOpenedValidationModal] =
    useState(false);

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
      setShowValidationModal(false);
      setValidationModalStep("validation");
      setHasAutoOpenedValidationModal(false);

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
        setError(translate("messages.noFileSelected", "No file selected"));
        return;
      }

      setExcelFilePath(filePath);
      const name = filePath.split(/[\\/]/).pop();
      setExcelFileName(name);

      const extractedReportId = extractFileNameWithoutExtension(filePath);
      setReportId(extractedReportId);

      console.log("[UploadAssets] calling extract-asset-data for", filePath);

      const result = await window.electronAPI.extractAssetData(filePath);

      console.log("[UploadAssets] extract-asset-data result:", result);

      if (result?.status === "FAILED" || result?.error) {
        throw new Error(
          result.error ||
            translate(
              "messages.extractFailed",
              "Failed to extract data from Excel file",
            ),
        );
      }

      const preview = result?.data ?? null;
      if (!preview) {
        setError(
          translate(
            "messages.noPreviewData",
            "No preview data returned from extract-asset-data.",
          ),
        );
        setPreviewData(null);
      } else {
        const processedData = processPreviewData(
          Array.isArray(preview) ? preview : [preview],
        );
        setPreviewData(processedData);
        const info = result?.info || {};
        setSuccess(
          translate(
            "messages.extractSuccess",
            "Successfully extracted {{count}} records ({{market}} market approach, {{cost}} cost approach)",
            {
              count: processedData.length,
              market: info.marketCount || 0,
              cost: info.costCount || 0,
            },
          ),
        );
      }
    } catch (err) {
      console.error("[UploadAssets] error extracting preview:", err);
      setError(
        err?.message ||
          translate(
            "messages.extractPreviewFailed",
            "Failed to extract preview via IPC",
          ),
      );
      setPreviewData(null);
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
  const missingCommonFields = useMemo(() => {
    const missing = [];

    if (!inspectionDate) {
      missing.push(translate("commonFields.inspectionDate", "Inspection Date"));
    }
    if (!region) {
      missing.push(translate("commonFields.region", "Region"));
    }
    if (!city) {
      missing.push(translate("commonFields.city", "City"));
    }
    if (!ownerName) {
      missing.push(translate("commonFields.ownerName", "Owner Name"));
    }

    return missing;
  }, [inspectionDate, region, city, ownerName, t]);

  const hasPreviewRecords = !!(previewData && previewData.length > 0);
  const hasExcelStepReady = !!(excelFileName && reportId.trim() && hasPreviewRecords);
  const hasCommonFieldsStepReady = missingCommonFields.length === 0;
  const isValidationReady = hasExcelStepReady && hasCommonFieldsStepReady;

  useEffect(() => {
    if (!hasExcelStepReady || !hasCommonFieldsStepReady) {
      setHasAutoOpenedValidationModal(false);
      return;
    }

    if (showValidationModal || hasAutoOpenedValidationModal || uploadLoading) {
      return;
    }

    setValidationModalStep("validation");
    setShowValidationModal(true);
    setHasAutoOpenedValidationModal(true);
  }, [
    hasExcelStepReady,
    hasCommonFieldsStepReady,
    showValidationModal,
    hasAutoOpenedValidationModal,
    uploadLoading,
  ]);

  // Get RAM info from context
  const { ramInfo } = useRam();

  // Helper function to get tabs count from RAM info
  const getTabsCount = () => {
    return ramInfo?.recommendedTabs || 1;
  };

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
      setSuccess(
        quickTranslate(
          "messages.success.templateDownloaded",
          "Excel template downloaded successfully.",
        ),
      );
    } catch (err) {
      const message =
        err?.message ||
        quickTranslate(
          "messages.error.templateDownload",
          "Failed to download Excel template. Please try again.",
        );
      setError(
        message.includes("not found")
          ? quickTranslate(
              "messages.error.templateNotFound",
              "Template file not found. Please contact administrator to ensure the template file exists in the public folder.",
            )
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
        translate(
          "messages.reportIdFromFileFailed",
          "Report ID could not be extracted from file name. Please check the file name.",
        ),
      );
      return;
    }

    if (!previewData || previewData.length === 0) {
      setError(translate("messages.noDataToUpload", "No data to upload"));
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
              message: translate("progress.starting", "Starting submission..."),
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
            throw new Error(
              uploadResult.message ||
                translate(
                  "messages.failedToCreateReport",
                  "Failed to create report",
                ),
            );
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
              translate(
                "messages.flowCompletionFailed",
                "Flow completion failed: {{message}}",
                {
                  message:
                    flowResult?.message ||
                    translate("messages.unknownError", "Unknown error"),
                },
              ),
            );
          }

          // 3. Deduct points if assets were completed
          const completedAssets = flowResult?.summary?.complete_macros;
          console.log("[UploadAssets] Completed assets:", completedAssets);

          // Build success message
          const successMessage = translate(
            "messages.createSuccess",
            'Successfully created report "{{reportId}}" with {{count}} assets',
            {
              reportId,
              count: previewData.length,
            },
          );

          // Add common fields info if any were set
          const commonFieldsInfo = [];
          if (inspectionDate) {
            commonFieldsInfo.push(
              translate(
                "messages.commonFieldInspectionDate",
                "Inspection Date: {{value}}",
                {
                  value: inspectionDate,
                },
              ),
            );
          }
          if (region) {
            commonFieldsInfo.push(
              translate("messages.commonFieldRegion", "Region: {{value}}", {
                value: region,
              }),
            );
          }
          if (city) {
            commonFieldsInfo.push(
              translate("messages.commonFieldCity", "City: {{value}}", {
                value: city,
              }),
            );
          }
          if (ownerName) {
            commonFieldsInfo.push(
              translate("messages.commonFieldOwner", "Owner: {{value}}", {
                value: ownerName,
              }),
            );
          }

          let fullMessage = successMessage;
          if (commonFieldsInfo.length > 0) {
            fullMessage += `\n\n${translate(
              "messages.commonFieldsApplied",
              "Common fields applied:",
            )}\n• ${commonFieldsInfo.join("\n• ")}`;
          }

          if (flowResult?.summary) {
            fullMessage += `\n\n${translate(
              "messages.flowCompleted",
              "Flow completed: {{count}} assets processed",
              { count: completedAssets || 0 },
            )}`;
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
              setError(
                reason?.message ||
                  translate("messages.authFailed", "Authentication failed"),
              );
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
        error?.message ||
          error?.error ||
          translate("messages.unexpectedError", "An unexpected error occurred"),
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
      setError(
        quickTranslate("messages.error.pauseProcess", "Failed to pause process."),
      );
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
      setError(
        quickTranslate(
          "messages.error.resumeProcess",
          "Failed to resume process.",
        ),
      );
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
      setError(
        quickTranslate("messages.error.stopProcess", "Failed to stop process."),
      );
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
        translate(
          "messages.reportIdFromFileFailed",
          "Report ID could not be extracted from file name. Please check the file name.",
        ),
      );
      return;
    }

    if (!previewData || previewData.length === 0) {
      setError(translate("messages.noDataToUpload", "No data to upload"));
      return;
    }

    // Check if all common fields are filled
    if (!inspectionDate || !region || !city || !ownerName) {
      setError(
        translate(
          "messages.fillCommonFields",
          "Please fill all common fields (Inspection Date, Region, City, and Owner Name)",
        ),
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
        throw new Error(
          uploadResult.message ||
            translate("messages.failedToCreateReport", "Failed to create report"),
        );
      }

      // Build success message
      const successMessage = translate(
        "messages.storeSuccess",
        'Successfully stored report "{{reportId}}" with {{count}} assets for later submission',
        {
          reportId,
          count: previewData.length,
        },
      );

      // Add common fields info
      const commonFieldsInfo = [];
      if (inspectionDate) {
        commonFieldsInfo.push(
          translate(
            "messages.commonFieldInspectionDate",
            "Inspection Date: {{value}}",
            {
              value: inspectionDate,
            },
          ),
        );
      }
      if (region) {
        commonFieldsInfo.push(
          translate("messages.commonFieldRegion", "Region: {{value}}", {
            value: region,
          }),
        );
      }
      if (city) {
        commonFieldsInfo.push(
          translate("messages.commonFieldCity", "City: {{value}}", {
            value: city,
          }),
        );
      }
      if (ownerName) {
        commonFieldsInfo.push(
          translate("messages.commonFieldOwner", "Owner: {{value}}", {
            value: ownerName,
          }),
        );
      }

      let fullMessage = successMessage;
      if (commonFieldsInfo.length > 0) {
        fullMessage += `\n\n${translate(
          "messages.commonFieldsApplied",
          "Common fields applied:",
        )}\n• ${commonFieldsInfo.join("\n• ")}`;
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
        setError(
          translate(
            "messages.sessionExpired",
            "Your session has expired. Please log in again.",
          ),
        );
        // Optionally trigger login
        // login();
      } else {
        setError(
          error?.message ||
            translate("messages.unexpectedError", "An unexpected error occurred"),
        );
      }
    } finally {
      setUploadLoading(false);
    }
  };

  const openValidationModal = () => {
    if (!isValidationReady) return;
    setValidationModalStep("validation");
    setShowValidationModal(true);
    setHasAutoOpenedValidationModal(true);
  };

  const closeValidationModal = () => {
    if (uploadLoading) return;
    setShowValidationModal(false);
    setValidationModalStep("validation");
  };

  const continueValidationModal = () => {
    if (!isValidationReady || uploadLoading) return;
    setValidationModalStep("action");
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
    setShowValidationModal(false);
    setValidationModalStep("validation");
    setHasAutoOpenedValidationModal(false);
  };

  const getTodayDate = () => {
    return new Date().toISOString().split("T")[0];
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
    <div
      className="relative p-3 space-y-3 page-animate overflow-x-hidden"
      dir={isArabicUi ? "rtl" : "ltr"}
    >
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
        defaultPageName={t("navigation.tabs.upload-assets.label", {
          defaultValue: UPLOAD_ASSETS_PAGE_NAME,
        })}
        defaultPageSource={UPLOAD_ASSETS_PAGE_SOURCE}
        onViewChange={onViewChange}
      />

      <div className="space-y-2">
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-blue-50/25 shadow-[0_12px_32px_rgba(15,23,42,0.08)] p-2.5">
          <div className="pointer-events-none absolute -top-12 -left-12 h-28 w-28 rounded-full bg-blue-200/20 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-14 -right-10 h-32 w-32 rounded-full bg-emerald-200/20 blur-2xl" />
          <div
            className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] items-stretch gap-1.5"
            style={{ direction: isArabicUi ? "rtl" : "ltr" }}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-blue-200 bg-blue-50 px-1.5 text-[9px] font-semibold text-blue-700 whitespace-nowrap">
                {quickTranslate("workflow.step1UploadExcel", "Step 1: Upload Excel")}
              </span>
              <label
                className={`group relative flex min-h-[42px] flex-1 items-center gap-2 rounded-xl border border-slate-300/90 bg-white/90 px-2 py-1.5 shadow-sm transition-all hover:-translate-y-[1px] hover:border-blue-400 hover:bg-blue-50/70 cursor-pointer ${
                  isArabicUi ? "text-right" : "text-left"
                }`}
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 ring-1 ring-blue-200/70">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-blue-700" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-semibold text-slate-800">
                    {excelFileName ? (
                      <span title={excelFileName}>{excelFileName}</span>
                    ) : (
                      quickTranslate("filePicker.chooseExcel", "Choose Excel file")
                    )}
                  </span>
                  <span className="block text-[8px] font-medium text-slate-500">
                    .xlsx / .xls
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center rounded-md bg-blue-600 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm transition-colors group-hover:bg-blue-700">
                  {quickTranslate("filePicker.browse", "Browse")}
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onClick={(e) => {
                    e.preventDefault();
                    openFileDialogAndExtract();
                    e.target.value = null;
                  }}
                />
              </label>
            </div>

            <button
              type="button"
              onClick={openValidationModal}
              disabled={!isValidationReady || uploadLoading}
              className="inline-flex min-h-[42px] min-w-[142px] w-auto items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-slate-900 px-3 text-[10px] font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Table className="h-3.5 w-3.5" />
              {translate(
                "commonFields.completeUploadSteps",
                "Complete Asset Upload Steps",
              )}
            </button>

            <button
              type="button"
              onClick={removeFile}
              className="group inline-flex min-h-[42px] min-w-[94px] w-auto items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2 text-[10px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-[1px] hover:border-slate-400 hover:bg-slate-50"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-slate-600 ring-1 ring-slate-200 transition-colors group-hover:bg-slate-200">
                <RefreshCw className="h-3 w-3" />
              </span>
              {quickTranslate("filePicker.reset", "Reset")}
            </button>

            <button
              type="button"
              onClick={handleDownloadTemplate}
              disabled={downloadingTemplate}
              title={quickTranslate("filePicker.exportTemplate", "Export Excel Template")}
              aria-label={quickTranslate("filePicker.exportTemplate", "Export Excel Template")}
              className="group inline-flex min-h-[42px] min-w-[122px] w-auto items-center justify-center gap-1.5 rounded-xl border border-emerald-300/90 bg-gradient-to-br from-white via-emerald-50 to-emerald-100 px-2 text-emerald-800 shadow-sm transition-all hover:-translate-y-[1px] hover:from-emerald-50 hover:to-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloadingTemplate ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-700" />
              ) : (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/80 ring-1 ring-emerald-200/90">
                  <img
                    src={excelIconSrc}
                    alt="Excel icon"
                    onError={() => setExcelIconSrc(excelIconFallback)}
                    className="h-3.5 w-3.5 pointer-events-none object-contain"
                  />
                </span>
              )}
              <span className="text-[10px] font-semibold leading-tight">
                {downloadingTemplate
                  ? quickTranslate("filePicker.downloading", "Downloading...")
                  : quickTranslate("filePicker.exportTemplate", "Export Excel Template")}
              </span>
            </button>
          </div>
          {hasExcelStepReady && !hasCommonFieldsStepReady && (
            <div className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-800">
              <div className="font-semibold">
                {quickTranslate("validationModal.actionRequired", "Action required")}
              </div>
              <div className="mt-0.5">
                {translate(
                  "messages.fillCommonFields",
                  "Please fill all common fields (Inspection Date, Region, City, and Owner Name)",
                )}
              </div>
            </div>
          )}
        </div>

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

      {previewData && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="mb-1 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                {quickTranslate("validationModal.step2.badge", "Step 2")}
              </span>
              <h3 className="text-sm font-semibold text-slate-800">
                {quickTranslate("validationModal.step2.badge", "Step 2")}:{" "}
                {translate("commonFields.title", "Common Fields")}
              </h3>
              <p className="mt-1 text-[11px] text-slate-600">
                {quickTranslate(
                  "validationModal.step2.subtitle",
                  "Update important report fields before choosing how to continue.",
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  hasCommonFieldsStepReady
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {hasCommonFieldsStepReady
                  ? quickTranslate("validationModal.noIssues", "No issues detected")
                  : quickTranslate("validationModal.actionRequired", "Action required")}
              </span>
              <button
                type="button"
                onClick={openValidationModal}
                disabled={!isValidationReady || uploadLoading}
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-slate-900 px-3 text-[10px] font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Table className="h-3.5 w-3.5" />
                {translate(
                  "commonFields.completeUploadSteps",
                  "Complete Asset Upload Steps",
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {translate("commonFields.inspectionDate", "Inspection Date")}
              </label>
              <div className="relative">
                <Calendar
                  className={`absolute top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none ${
                    isArabicUi ? "right-3" : "left-3"
                  }`}
                />
                <input
                  type="date"
                  value={inspectionDate}
                  onChange={(e) =>
                    handleCommonFieldChange("inspectionDate", e.target.value)
                  }
                  max={getTodayDate()}
                  className={`w-full py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all ${
                    isArabicUi
                      ? "pr-10 pl-3 text-right"
                      : "pl-10 pr-3 text-left"
                  }`}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {translate("commonFields.region", "Region")}
              </label>
              <div className="relative">
                <MapPin
                  className={`absolute top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none ${
                    isArabicUi ? "right-3" : "left-3"
                  }`}
                />
                <select
                  value={region}
                  onChange={(e) =>
                    handleCommonFieldChange("region", e.target.value)
                  }
                  className={`w-full py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all appearance-none bg-white cursor-pointer ${
                    isArabicUi
                      ? "pr-10 pl-3 text-right"
                      : "pl-10 pr-3 text-left"
                  }`}
                >
                  <option value="">
                    {translate("commonFields.selectRegion", "Select Region")}
                  </option>
                  {Object.keys(saudiRegions).map((regionName) => (
                    <option key={regionName} value={regionName}>
                      {regionName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {translate("commonFields.city", "City")}
              </label>
              <div className="relative">
                <MapPin
                  className={`absolute top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none ${
                    isArabicUi ? "right-3" : "left-3"
                  }`}
                />
                <select
                  value={city}
                  onChange={(e) =>
                    handleCommonFieldChange("city", e.target.value)
                  }
                  disabled={!region}
                  className={`w-full py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all appearance-none bg-white disabled:bg-slate-50 disabled:text-slate-400 cursor-pointer disabled:cursor-not-allowed ${
                    isArabicUi
                      ? "pr-10 pl-3 text-right"
                      : "pl-10 pr-3 text-left"
                  }`}
                >
                  <option value="">
                    {region
                      ? translate("commonFields.selectCity", "Select City")
                      : translate(
                          "commonFields.selectRegionFirst",
                          "Select region first",
                        )}
                  </option>
                  {availableCities.map((cityName) => (
                    <option key={cityName} value={cityName}>
                      {cityName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {translate("commonFields.ownerName", "Owner Name")}
              </label>
              <div className="relative">
                <User
                  className={`absolute top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none ${
                    isArabicUi ? "right-3" : "left-3"
                  }`}
                />
                <input
                  type="text"
                  value={ownerName}
                  onChange={(e) =>
                    handleCommonFieldChange("ownerName", e.target.value)
                  }
                  className={`w-full py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all ${
                    isArabicUi
                      ? "pr-10 pl-3 text-right"
                      : "pl-10 pr-3 text-left"
                  }`}
                  placeholder={translate(
                    "commonFields.ownerPlaceholder",
                    "Owner name",
                  )}
                />
              </div>
            </div>
          </div>
        </div>
      )}

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
                      translate("progress.processing", "Processing...")}
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
                  {translate("progress.pause", "Pause")}
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
                  {translate("progress.resume", "Resume")}
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
                {translate("progress.stop", "Stop")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reports Table Section */}
      <div className="mt-4">
        <ReportsTable onViewChange={onViewChange} showTemporary={false} />
      </div>

      {showValidationModal && (
        <div
          className="fixed inset-0 z-[9999] flex h-screen items-center justify-center overflow-y-auto px-4 py-6"
          onClick={closeValidationModal}
        >
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-6xl max-h-[95vh]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pointer-events-none absolute -top-12 right-6 h-28 w-28 rounded-full bg-cyan-400/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-10 left-4 h-32 w-32 rounded-full bg-blue-500/20 blur-3xl" />
            <div className="relative rounded-[32px] bg-gradient-to-br from-cyan-200/70 via-white to-blue-200/70 p-[1px] shadow-[0_40px_120px_rgba(15,23,42,0.35)]">
              <div className="relative flex max-h-[95vh] flex-col overflow-hidden rounded-[32px] bg-white/95 backdrop-blur-xl">
                <div className="relative sticky top-0 z-10 overflow-hidden bg-gradient-to-r from-slate-950 via-blue-900 to-slate-900 px-5 py-4 text-white">
                  <div className="pointer-events-none absolute -right-10 top-0 h-20 w-20 rounded-full bg-cyan-400/25 blur-2xl" />
                  <div className="pointer-events-none absolute left-6 top-6 h-16 w-16 rounded-full bg-indigo-500/20 blur-2xl" />
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[9px] uppercase tracking-[0.3em] text-cyan-200 font-semibold">
                        {quickTranslate("validationModal.title", "Excel Validation")}
                      </div>
                      <div className="mt-1 text-xs text-blue-100">
                        {quickTranslate(
                          "validationModal.subtitle",
                          "Validation Results",
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold">
                        <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5">
                          {quickTranslate("workflow.step1UploadExcel", "Step 1: Upload Excel")}
                        </span>
                        <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5">
                          {quickTranslate("validationModal.step2.badge", "Step 2")}:
                          {" "}
                          {translate("commonFields.title", "Common Fields")}
                        </span>
                        <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5">
                          {quickTranslate(
                            "workflow.step3StoreSubmitAction",
                            "Step 3: Store & Submit Action",
                          )}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={
                        validationModalStep === "validation"
                          ? continueValidationModal
                          : closeValidationModal
                      }
                      disabled={
                        uploadLoading ||
                        (validationModalStep === "validation" &&
                          !isValidationReady)
                      }
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                      {quickTranslate("validationModal.continueButton", "Continue")}
                    </button>
                  </div>
                </div>

                <div
                  className="relative flex-1 overflow-y-auto px-5 py-4"
                  style={{ direction: isArabicUi ? "rtl" : "ltr" }}
                >
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_55%),radial-gradient(circle_at_bottom,rgba(14,165,233,0.08),transparent_50%)]" />
                  <div className="relative z-10 space-y-4">
                    {validationModalStep === "validation" ? (
                      <>
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <span className="mb-1 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                            {quickTranslate("workflow.step1UploadExcel", "Step 1: Upload Excel")}
                          </span>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <div className="text-[10px] font-semibold text-slate-500">
                                {quickTranslate("validationModal.table.headers.excel", "Excel")}
                              </div>
                              <div className="text-xs font-semibold text-slate-800 truncate">
                                {excelFileName || "-"}
                              </div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <div className="text-[10px] font-semibold text-slate-500">
                                {quickTranslate("reports.table.reportId", "Report ID")}
                              </div>
                              <div className="text-xs font-semibold text-slate-800 truncate">
                                {reportId || "-"}
                              </div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <div className="text-[10px] font-semibold text-slate-500">
                                {translate("preview.title", "Data Preview")}
                              </div>
                              <div className="text-xs font-semibold text-slate-800">
                                {translate("preview.records", "{{count}} records", {
                                  count: previewData?.length || 0,
                                })}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <span className="mb-1 inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                            {quickTranslate("validationModal.step2.badge", "Step 2")}
                          </span>
                          <div className="text-xs font-semibold text-slate-800">
                            {translate("commonFields.title", "Common Fields")}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <div className="text-[10px] font-semibold text-slate-500">
                                {translate("commonFields.inspectionDate", "Inspection Date")}
                              </div>
                              <div className="text-xs font-semibold text-slate-800">
                                {inspectionDate || "-"}
                              </div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <div className="text-[10px] font-semibold text-slate-500">
                                {translate("commonFields.region", "Region")}
                              </div>
                              <div className="text-xs font-semibold text-slate-800">
                                {region || "-"}
                              </div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <div className="text-[10px] font-semibold text-slate-500">
                                {translate("commonFields.city", "City")}
                              </div>
                              <div className="text-xs font-semibold text-slate-800">
                                {city || "-"}
                              </div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <div className="text-[10px] font-semibold text-slate-500">
                                {translate("commonFields.ownerName", "Owner Name")}
                              </div>
                              <div className="text-xs font-semibold text-slate-800">
                                {ownerName || "-"}
                              </div>
                            </div>
                          </div>
                        </div>

                        {isValidationReady ? (
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-4 text-emerald-700 shadow-[0_10px_30px_rgba(16,185,129,0.12)]">
                            <div className="flex items-center gap-3">
                              <CheckCircle2 className="w-6 h-6" />
                              <div>
                                <div className="text-sm font-semibold">
                                  {quickTranslate(
                                    "validationModal.noIssues",
                                    "No issues detected",
                                  )}
                                </div>
                                <p className="text-xs text-emerald-700/90">
                                  {quickTranslate(
                                    "validationModal.noIssuesDetails",
                                    "Your Excel files look clean. You can proceed with uploading and submission.",
                                  )}
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-amber-700 shadow-[0_10px_30px_rgba(245,158,11,0.12)]">
                            <div className="text-sm font-semibold">
                              {quickTranslate("validationModal.actionRequired", "Action required")}
                            </div>
                            <p className="text-xs text-amber-700/90">
                              {translate(
                                "messages.fillCommonFields",
                                "Please fill all common fields (Inspection Date, Region, City, and Owner Name)",
                              )}
                            </p>
                            {!!missingCommonFields.length && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {missingCommonFields.map((fieldName) => (
                                  <span
                                    key={fieldName}
                                    className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                                  >
                                    {fieldName}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              {quickTranslate("validationModal.step3.badge", "Step 3")}
                            </span>
                            <h3 className="text-sm font-semibold text-slate-800">
                              {quickTranslate(
                                "workflow.step3StoreSubmitAction",
                                "Step 3: Store & Submit Action",
                              )}
                            </h3>
                          </div>
                          <p className="mt-2 text-xs text-slate-600">
                            {quickTranslate(
                              "validationModal.step2.actionHint",
                              "Choose how to continue with the uploaded reports.",
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/90 px-6 py-4 text-xs text-slate-500">
                  {validationModalStep === "validation" ? (
                    <>
                      <span>
                        {quickTranslate(
                          "validationModal.footerContinueHint",
                          "Continue to edit report info and choose the upload action.",
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={continueValidationModal}
                        disabled={!isValidationReady || uploadLoading}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="w-4 h-4" />
                        {quickTranslate("validationModal.continueButton", "Continue")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setValidationModalStep("validation")}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400"
                      >
                        {quickTranslate("validationModal.step2.back", "Back to validation")}
                      </button>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleStoreAndSubmitLater}
                          disabled={!isStoreEnabled || uploadLoading}
                          className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {uploadLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <FileIcon className="w-4 h-4" />
                          )}
                          {uploadLoading
                            ? translate("actions.storing", "Storing...")
                            : quickTranslate(
                                "actions.storeAndSubmitLater",
                                "Store and Submit Later",
                              )}
                        </button>
                        <button
                          type="button"
                          onClick={handleUploadToDB}
                          disabled={!isUploadEnabled || uploadLoading}
                          className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {uploadLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          {uploadLoading
                            ? quickTranslate("actions.uploading", "Uploading...")
                            : quickTranslate(
                                "actions.storeAndSubmitNow",
                                "Store and Submit Now",
                              )}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadAssets;
