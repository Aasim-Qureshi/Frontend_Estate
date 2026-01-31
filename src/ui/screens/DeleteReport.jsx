import React, { useState, useEffect, useMemo } from "react";
import {
  CheckCircle,
  FileText,
  Trash2,
  Search,
  PlayCircle,
  Package,
  PauseCircle,
  Play,
  StopCircle,
  AlertCircle,
  LoaderCircle,
  RefreshCw
} from "lucide-react";
import { useSession } from "../context/SessionContext";
import { useValueNav } from "../context/ValueNavContext";
import { useAuthAction } from "../hooks/useAuthAction"; // ✅ add


const DeleteReport = () => {
  // Report ID state
  const [reportId, setReportId] = useState("");
  const [showInsufficientPointsModal, setShowInsufficientPointsModal] = useState(false);

  const { executeWithAuth } = useAuthAction(); // ✅


  const { user, token } = useSession();   // ✅ you need token
  const { selectedCompany } = useValueNav();
  const selectedCompanyOfficeId = useMemo(() => {
    const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
    return officeId ? String(officeId) : "";
  }, [selectedCompany]);
  const userId = useMemo(
    () => user?._id || user?.id || user?.userId || user?.user?._id || null,
    [user]
  );


  const [reportSummaryRow, setReportSummaryRow] = useState([]);

  // New state for result column
  const [reportResults, setReportResults] = useState({});

  // Error state
  const [error, setError] = useState("");

  // Operation states
  const [isCheckingReport, setIsCheckingReport] = useState(false);
  const [reportExists, setReportExists] = useState(null);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [deleteAssetsRequested, setDeleteAssetsRequested] = useState(false);

  // New states for status change
  const [statusChangeResult, setStatusChangeResult] = useState(null);

  // New states for pause/resume/stop operations
  const [deleteReportStatus, setDeleteReportStatus] = useState(null); // 'running', 'paused', 'stopped', 'completed'
  const [deleteAssetsStatus, setDeleteAssetsStatus] = useState(null); // 'running', 'paused', 'stopped', 'completed'
  const [operationResult, setOperationResult] = useState(null);

  // Progress state
  const [deleteReportProgress, setDeleteReportProgress] = useState(null);
  const [deleteReportProgressById, setDeleteReportProgressById] = useState({});
  const [deleteAssetsProgressById, setDeleteAssetsProgressById] = useState({});
  const [rowActionById, setRowActionById] = useState({});
  const [selectedActionById, setSelectedActionById] = useState({});
  const [deletedRows, setDeletedRows] = useState([]);
  const [deletedPage, setDeletedPage] = useState(1);
  const [deletedTotal, setDeletedTotal] = useState(0);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [deletedError, setDeletedError] = useState("");
  const [checkedPage, setCheckedPage] = useState(1);
  const [checkedTotal, setCheckedTotal] = useState(0);
  const [checkedLoading, setCheckedLoading] = useState(false);
  const [checkedError, setCheckedError] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const deletedLimit = 10;
  const checkedLimit = 10;
  const deletedTotalPages = useMemo(
    () => Math.max(1, Math.ceil(deletedTotal / deletedLimit)),
    [deletedTotal, deletedLimit]
  );
  const checkedTotalPages = useMemo(
    () => Math.max(1, Math.ceil(checkedTotal / checkedLimit)),
    [checkedTotal, checkedLimit]
  );

  // Selected reports state
  const [selectedReports, setSelectedReports] = useState(new Set());

  const deletedById = useMemo(() => {
    return deletedRows.reduce((acc, row) => {
      if (row?.report_id) {
        acc[row.report_id] = row;
      }
      return acc;
    }, {});
  }, [deletedRows]);

  const tableRows = useMemo(() => {
    const rows = reportSummaryRow.map((row) => {
      const deletedInfo = deletedById[row.reportId];
      const isDeleted = !!deletedInfo?.deleted;
      const normalizedStatus = isDeleted
        ? "Deleted"
        : (row.lastStatus === "NOT_FOUND" ? "Not Found" : row.reportStatus);
      return {
        ...row,
        reportStatus: normalizedStatus,
        isDeleted,
        deletedType: deletedInfo?.delete_type || null,
        deletedTotalAssets: deletedInfo?.total_assets ?? null,
        deletedRemainingAssets: deletedInfo?.remaining_assets ?? null,
        result: row.result || (isDeleted ? "Deleted" : "-")
      };
    });

    Object.values(deletedById).forEach((row) => {
      if (!row?.report_id) return;
      const exists = rows.some((r) => r.reportId === row.report_id);
      if (!exists) {
        rows.push({
          reportId: row.report_id,
          reportStatus: "Deleted",
          totalAssets: row.total_assets ?? 0,
          isDeleted: !!row.deleted,
          deletedType: row.delete_type || null,
          deletedTotalAssets: row.total_assets ?? null,
          deletedRemainingAssets: row.remaining_assets ?? null,
          result: "Deleted"
        });
      }
    });

    return rows;
  }, [reportSummaryRow, deletedById]);

  const filteredRows = useMemo(() => {
    if (filterMode === "checked") {
      return tableRows.filter((row) => !row.isDeleted);
    }
    if (filterMode === "deleted-report") {
      return tableRows.filter((row) => row.isDeleted && row.deletedType === "report");
    }
    if (filterMode === "deleted-asset") {
      return tableRows.filter((row) => row.isDeleted && row.deletedType === "assets");
    }
    return tableRows;
  }, [tableRows, filterMode]);

  // Progress listener effect
  useEffect(() => {
    const unsubscribe = window.electronAPI.onDeleteReportProgress((progressData) => {
      console.log('Delete report progress:', progressData);
      setDeleteReportProgress(progressData);
      if (progressData?.reportId) {
        setDeleteReportProgressById(prev => ({
          ...prev,
          [progressData.reportId]: progressData
        }));
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onDeleteAssetsProgress((progressData) => {
      console.log('Delete assets progress:', progressData);
      const key =
        progressData?.reportId ||
        progressData?.report_id ||
        (typeof progressData?.processId === "string"
          ? progressData.processId.replace("delete-incomplete-assets-", "")
          : null);
      if (key) {
        setDeleteAssetsProgressById(prev => ({
          ...prev,
          [key]: progressData
        }));
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (!userId) return;
    setDeletedLoading(true);
    setDeletedError("");
    window.electronAPI.getReportDeletions(
      userId,
      null,
      deletedPage,
      deletedLimit,
      searchTerm,
      selectedCompanyOfficeId || null
    )
      .then((res) => {
        if (!isMounted) return;
        if (res?.status === "SUCCESS") {
          setDeletedRows(res.items || []);
          setDeletedTotal(res.total || 0);
        } else {
          setDeletedError(res?.error || "Failed to load deleted reports");
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setDeletedError(err?.message || "Failed to load deleted reports");
      })
      .finally(() => {
        if (isMounted) setDeletedLoading(false);
      });
    return () => { isMounted = false; };
  }, [userId, deletedPage, deletedLimit, deleteReportStatus, deleteAssetsStatus, searchTerm, selectedCompanyOfficeId]);

  const loadCheckedReports = async (page = checkedPage) => {
    if (!userId) {
      setReportSummaryRow([]);
      setCheckedTotal(0);
      return;
    }
    setCheckedLoading(true);
    setCheckedError("");
    try {
      const res = await window.electronAPI.getCheckedReports(
        userId,
        page,
        checkedLimit,
        searchTerm,
        selectedCompanyOfficeId || null
      );
      if (res?.status === "SUCCESS") {
        const items = (res.items || []).map((row) => {
          const assetsExact = Number(row.assets_exact);
          const assetsCount = Number.isFinite(assetsExact) ? assetsExact : 0;
          const lastStatus = row.last_status_check_status || "UNKNOWN";
          return {
            reportId: row.report_id,
            totalAssets: assetsCount,
            reportStatus: row.report_status || row.report_status_label || "Unknown",
            presentOrNot: Number.isFinite(assetsExact)
              ? (assetsExact > 0 ? "Present" : "Not Present")
              : "Unknown",
            exists: lastStatus !== "NOT_FOUND",
            lastCheckedAt: row.last_status_check_at || null,
            lastStatus
          };
        });

        // Load validation results from DB and merge with items
        if (items.length > 0) {
          try {
            const reportIds = items.map(item => item.reportId);
            const validationRes = await window.electronAPI.getValidationResults(userId, reportIds);
            if (validationRes?.status === "SUCCESS" && validationRes.items) {
              const validationById = validationRes.items.reduce((acc, val) => {
                acc[val.report_id] = val;
                return acc;
              }, {});

              // Merge validation results with items
              items.forEach(item => {
                const validation = validationById[item.reportId];
                if (validation && validation.result) {
                  item.result = validation.result;
                  // Update totalAssets and reportStatus from validation if available
                  if (validation.total_assets != null) {
                    item.totalAssets = validation.total_assets;
                  }
                  if (validation.report_status) {
                    item.reportStatus = validation.report_status;
                  }
                }
              });
            }
          } catch (err) {
            console.error("Error loading validation results:", err);
            // Continue even if validation results fail to load
          }
        }

        setReportSummaryRow(items);
        setCheckedTotal(res.total || 0);
        setCheckedPage(res.page || page);
      } else {
        setCheckedError(res?.error || "Failed to load checked reports");
      }
    } catch (err) {
      setCheckedError(err?.message || "Failed to load checked reports");
    } finally {
      setCheckedLoading(false);
    }
  };

  useEffect(() => {
    loadCheckedReports(checkedPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedPage, userId, selectedCompanyOfficeId]);

  useEffect(() => {
    if (!userId) return;
    setCheckedPage(1);
    loadCheckedReports(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, userId]);

  useEffect(() => {
    if (!userId) return;
    setDeletedPage(1);
    // getReportDeletions effect will run on deletedPage change
  }, [searchTerm, userId, selectedCompanyOfficeId]);

  useEffect(() => {
    setCheckedPage(1);
    setDeletedPage(1);
  }, [selectedCompanyOfficeId]);

  useEffect(() => {
    if (deleteReportStatus === "success" || deleteReportStatus === "partial" ||
      deleteAssetsStatus === "success" || deleteAssetsStatus === "partial") {
      loadCheckedReports(checkedPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteReportStatus, deleteAssetsStatus]);

  // Clear selections when checking new reports
  useEffect(() => {
    setSelectedReports(new Set());
  }, [reportSummaryRow]);

  // Handle report selection
  const handleReportSelect = (reportId, isSelected) => {
    setSelectedReports(prev => {
      const newSet = new Set(prev);
      if (isSelected) {
        newSet.add(reportId);
      } else {
        newSet.delete(reportId);
      }
      return newSet;
    });
  };

  // Handle select all
  const handleSelectAll = (isSelected) => {
    if (isSelected) {
      const selectableReports = filteredRows
        .filter(row => !row.isDeleted)
        .map(row => row.reportId);
      setSelectedReports(new Set(selectableReports));
    } else {
      setSelectedReports(new Set());
    }
  };

  // Get selected report data
  const getSelectedReportData = () => {
    return filteredRows.filter(row => selectedReports.has(row.reportId));
  };

  // Handle delete selected reports
  const handleDeleteSelectedReports = async () => {
    const selectedIds = Array.from(selectedReports);
    if (selectedIds.length === 0) {
      setError("No reports selected");
      return;
    }

    setRowActionById(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => { next[id] = "check-report"; });
      return next;
    });

    const validationResults = await runWithConcurrency(selectedIds, 3, validateReportForDelete);
    const idsToDelete = validationResults.filter(r => r?.proceed).map(r => r.id);
    const autoDeleted = validationResults.filter(r => r?.autoDeleted).map(r => r.id);
    const validationFailed = validationResults.filter(r => r && !r.proceed && !r.autoDeleted);

    await loadCheckedReports(checkedPage);

    if (validationFailed.length) {
      setError(`Validation failed for ${validationFailed.length} report(s)`);
    } else {
      setError("");
    }

    if (!idsToDelete.length) {
      setStatusChangeResult({
        status: autoDeleted.length ? "SUCCESS" : "FAILED",
        message: autoDeleted.length
          ? `Report status set to Deleted for ${autoDeleted.length} report(s).`
          : "No reports eligible for deletion."
      });
      setRowActionById(prev => {
        const next = { ...prev };
        selectedIds.forEach(id => { delete next[id]; });
        return next;
      });
      setSelectedReports(new Set());
      return;
    }

    setDeleteRequested(true);
    setStatusChangeResult(null);
    setDeleteReportStatus("running");
    setOperationResult(null);
    setDeleteReportProgress(null);
    setDeleteReportProgressById({});
    setDeleteAssetsProgressById({});

    setRowActionById(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => { delete next[id]; });
      idsToDelete.forEach(id => { next[id] = "delete-report"; });
      return next;
    });

    const maxRounds = 10;
    const concurrency = Math.min(10, idsToDelete.length);

    setOperationResult({
      mode: "batch",
      items: Object.fromEntries(idsToDelete.map(id => [id, { status: "queued" }]))
    });

    try {
      const results = await runWithConcurrency(idsToDelete, concurrency, async (id) => {
        setOperationResult(prev => ({
          ...prev,
          items: { ...prev.items, [id]: { status: "running" } }
        }));

        try {
          const res = await window.electronAPI.deleteReport(id, maxRounds, userId, selectedCompanyOfficeId || null);
          setOperationResult(prev => ({
            ...prev,
            items: { ...prev.items, [id]: { status: "success", result: res } }
          }));
          return { id, ok: true, result: res };
        } catch (err) {
          setOperationResult(prev => ({
            ...prev,
            items: { ...prev.items, [id]: { status: "failed", error: String(err) } }
          }));
          return { id, ok: false, error: String(err) };
        }
      });

      const failed = results.filter(r => !r?.ok).length;

      setStatusChangeResult({
        total: idsToDelete.length,
        success: idsToDelete.length - failed,
        failed,
        results
      });

      setDeleteReportStatus(failed ? "partial" : "success");
      setDeleteReportProgress(null);
      setDeleteReportProgressById({});
      setRowActionById(prev => {
        const next = { ...prev };
        idsToDelete.forEach(id => { delete next[id]; });
        return next;
      });
      setSelectedReports(new Set());
      setReportId("");
    } catch (err) {
      console.error("Error initiating batch deletion:", err);
      setDeleteReportStatus("stopped");
      setDeleteReportProgress(null);
      setDeleteReportProgressById({});
      setRowActionById(prev => {
        const next = { ...prev };
        idsToDelete.forEach(id => { delete next[id]; });
        return next;
      });
    }
  };

  // Handle delete assets for selected reports
  const handleDeleteSelectedAssets = async () => {
    const selectedIds = Array.from(selectedReports);
    if (selectedIds.length === 0) {
      setError("No reports selected");
      return;
    }

    setRowActionById(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => { next[id] = "check-report"; });
      return next;
    });

    const validationResults = await runWithConcurrency(selectedIds, 10, validateReportForDelete);
    const idsToDelete = validationResults.filter(r => r?.proceed).map(r => r.id);
    const autoDeleted = validationResults.filter(r => r?.autoDeleted).map(r => r.id);
    const validationFailed = validationResults.filter(r => r && !r.proceed && !r.autoDeleted);

    await loadCheckedReports(checkedPage);

    if (validationFailed.length) {
      setError(`Validation failed for ${validationFailed.length} report(s)`);
    } else {
      setError("");
    }

    if (!idsToDelete.length) {
      setStatusChangeResult({
        status: autoDeleted.length ? "SUCCESS" : "FAILED",
        message: autoDeleted.length
          ? `Report status set to Deleted for ${autoDeleted.length} report(s).`
          : "No reports eligible for deletion."
      });
      setRowActionById(prev => {
        const next = { ...prev };
        selectedIds.forEach(id => { delete next[id]; });
        return next;
      });
      setSelectedReports(new Set());
      return;
    }

    setDeleteAssetsRequested(true);
    setStatusChangeResult(null);
    setDeleteAssetsStatus("running");
    setOperationResult(null);
    setDeleteAssetsProgressById({});
    setRowActionById(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => { delete next[id]; });
      idsToDelete.forEach(id => { next[id] = "delete-assets"; });
      return next;
    });

    const maxRounds = 10;
    const concurrency = Math.min(5, idsToDelete.length);

    try {
      const results = await runWithConcurrency(idsToDelete, concurrency, async (id) => {
        try {
          const res = await window.electronAPI.deleteIncompleteAssets(id, maxRounds, userId, selectedCompanyOfficeId || null);
          return { id, ok: true, result: res };
        } catch (err) {
          return { id, ok: false, error: String(err) };
        }
      });

      const failed = results.filter(r => !r?.ok).length;

      setStatusChangeResult({
        total: idsToDelete.length,
        success: idsToDelete.length - failed,
        failed,
        results
      });

      setDeleteAssetsStatus(failed ? "partial" : "success");
      setRowActionById(prev => {
        const next = { ...prev };
        idsToDelete.forEach(id => { delete next[id]; });
        return next;
      });
      setSelectedReports(new Set());
    } catch (err) {
      console.error("Error initiating batch asset deletion:", err);
      setDeleteAssetsStatus("stopped");
      setRowActionById(prev => {
        const next = { ...prev };
        idsToDelete.forEach(id => { delete next[id]; });
        return next;
      });
    }
  };

  const handleDeleteReportById = async (id) => {
    if (!id) return;
    setRowActionById(prev => ({ ...prev, [id]: "check-report" }));

    const validation = await validateReportForDelete(id);
    await loadCheckedReports(checkedPage);

    if (!validation?.proceed) {
      if (validation?.autoDeleted) {
        setStatusChangeResult({
          status: "SUCCESS",
          message: "Report status set to Deleted."
        });
      } else if (validation?.error) {
        setError(validation.error);
      }
      setRowActionById(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }

    setDeleteReportStatus("running");
    setOperationResult(null);
    setDeleteReportProgress(null);
    setDeleteReportProgressById({});
    setDeleteAssetsProgressById({});
    setRowActionById(prev => ({ ...prev, [id]: "delete-report" }));
    try {
      const res = await window.electronAPI.deleteReport(id, 10, userId, selectedCompanyOfficeId || null);
      setDeleteReportStatus("success");
      setOperationResult({
        type: "delete-report",
        status: res?.status || "SUCCESS",
        message: res?.message || "Delete report completed"
      });
    } catch (err) {
      setDeleteReportStatus("stopped");
      setOperationResult({
        type: "delete-report",
        status: "FAILED",
        message: err?.message || "Delete report failed"
      });
    } finally {
      setRowActionById(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleChangeStatusAndDeleteReport = async () => {
    const ids = parseReportIds(reportId);
    if (!ids.length) {
      setError("At least one Report ID is required");
      return;
    }

    await executeWithAuth(
      async (params) => {
        const { reportIds } = params;

        // Add rows immediately
        const initialRows = reportIds.map((id) => ({
          reportId: id,
          reportStatus: "Validating...",
          totalAssets: "Loading...",
          result: "Validating...",
        }));
        setReportSummaryRow((prev) => [...prev, ...initialRows]);
        setReportId("");

        // Step 1: Validate reports
        const validationResults = await runWithConcurrency(reportIds, 3, async (id) => {
          try {
            const result = await window.electronAPI.validateReport(id, userId, selectedCompanyOfficeId || null);
            const status = result?.status;
            const reportStatus = result?.reportStatus;
            const totalAssets = Number(result?.assetsExact ?? result?.microsCount ?? 0) || 0;

            const resultText = status === "NOT_FOUND" ? "Not Found" : "Validated";

            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === id
                  ? {
                    reportId: id,
                    reportStatus: status === "NOT_FOUND" ? "Not Found" : (reportStatus || "Unknown"),
                    totalAssets: status === "NOT_FOUND" ? 0 : totalAssets,
                    result: resultText,
                  }
                  : row
              )
            );

            return { id, result, reportStatus, totalAssets, resultText, isValid: status !== "NOT_FOUND" };
          } catch (err) {
            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === id ? { ...row, reportStatus: "Error", totalAssets: 0, result: "Validation Error" } : row
              )
            );
            return { id, error: String(err), isValid: false };
          }
        });

        const validReports = validationResults.filter(r => r.isValid);

        if (validReports.length === 0) {
          setError("No valid reports found to process");
          return { success: false };
        }

        // Step 2: Change status for all valid reports
        setStatusChangeResult({
          status: 'RUNNING',
          message: `Changing status for ${validReports.length} report(s)...`
        });

        const statusChangeResults = await runWithConcurrency(validReports, 3, async (report) => {
          try {
            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === report.id ? { ...row, result: "Changing Status..." } : row
              )
            );

            await window.electronAPI.handleCancelledReport(report.id);

            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === report.id ? { ...row, result: "Status Changed" } : row
              )
            );

            await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
              reportId: report.id,
              action: "change-status",
              userId,
              result: "Status Changed",
              reportStatus: report.reportStatus,
              totalAssets: report.totalAssets || 0,
            });

            return { id: report.id, statusSuccess: true };
          } catch (err) {
            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === report.id ? { ...row, result: "Status Change Failed" } : row
              )
            );

            await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
              reportId: report.id,
              action: "change-status",
              userId,
              result: "Status Change Failed",
              error: String(err),
            });

            return { id: report.id, statusSuccess: false, error: String(err) };
          }
        });

        const successfulStatusChanges = statusChangeResults.filter(r => r.statusSuccess);

        if (successfulStatusChanges.length === 0) {
          setStatusChangeResult({
            status: 'FAILED',
            message: "Failed to change status for all reports"
          });
          return { success: false };
        }

        // Step 3: Delete reports with successful status changes
        setDeleteReportStatus("running");
        setDeleteReportProgress(null);
        setDeleteReportProgressById({});

        const idsToDelete = successfulStatusChanges.map(r => r.id);
        const maxRounds = 10;
        const concurrency = Math.min(5, idsToDelete.length);

        const deleteResults = await runWithConcurrency(idsToDelete, concurrency, async (id) => {
          try {
            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === id ? { ...row, result: "Deleting..." } : row
              )
            );

            const res = await window.electronAPI.deleteReport(id, maxRounds, userId, selectedCompanyOfficeId || null);

            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === id ? { ...row, result: "Status Changed & Deleted" } : row
              )
            );

            await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
              reportId: id,
              action: "change-status-and-delete",
              userId,
              result: "Status Changed & Deleted",
            });

            return { id, deleteSuccess: true, result: res };
          } catch (err) {
            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === id ? { ...row, result: "Delete Failed" } : row
              )
            );

            await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
              reportId: id,
              action: "change-status-and-delete",
              userId,
              result: "Delete Failed",
              error: String(err),
            });

            return { id, deleteSuccess: false, error: String(err) };
          }
        });

        const successfulDeletes = deleteResults.filter(r => r.deleteSuccess);
        const failedDeletes = deleteResults.filter(r => !r.deleteSuccess);

        setDeleteReportStatus(failedDeletes.length === 0 ? "success" : "partial");

        setStatusChangeResult({
          status: 'COMPLETED',
          message: `Process completed: ${successfulStatusChanges.length} status changes attempted, ${successfulDeletes.length} successful deletes, ${failedDeletes.length} failed deletes`
        });

        await loadCheckedReports(1);

        return {
          success: true,
          statusChanges: successfulStatusChanges.length,
          deletes: successfulDeletes.length,
          failures: failedDeletes.length
        };
      },
      { token, reportIds: ids },
      {
        requiredPoints: ids.length * 2, // Charge for both operations
        showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
        onAuthFailure: (reason) => {
          if (reason !== "INSUFFICIENT_POINTS" && reason !== "LOGIN_REQUIRED") {
            setError(reason?.message || "Authentication failed for Change Status & Delete");
          }
        },
      }
    ).catch((err) => {
      if (!err?.message?.includes("INSUFFICIENT_POINTS") && !err?.message?.includes("LOGIN_REQUIRED")) {
        setError(err?.message || "Change Status & Delete failed");
      }
      setDeleteReportStatus("stopped");
    });
  };
  const handleDeleteAssetsById = async (id) => {
    if (!id) return;
    setRowActionById(prev => ({ ...prev, [id]: "check-report" }));

    const validation = await validateReportForDelete(id);
    await loadCheckedReports(checkedPage);

    if (!validation?.proceed) {
      if (validation?.autoDeleted) {
        setStatusChangeResult({
          status: "SUCCESS",
          message: "Report status set to Deleted."
        });
      } else if (validation?.error) {
        setError(validation.error);
      }
      setRowActionById(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }

    setDeleteAssetsStatus("running");
    setOperationResult(null);
    setDeleteAssetsProgressById({});
    setRowActionById(prev => ({ ...prev, [id]: "delete-assets" }));
    try {
      const res = await window.electronAPI.deleteIncompleteAssets(id, 10, userId, selectedCompanyOfficeId || null);
      setDeleteAssetsStatus("success");
      setOperationResult({
        type: "delete-incomplete-assets",
        status: res?.status || "SUCCESS",
        message: res?.message || "Delete assets completed"
      });
    } catch (err) {
      setDeleteAssetsStatus("stopped");
      setOperationResult({
        type: "delete-incomplete-assets",
        status: "FAILED",
        message: err?.message || "Delete assets failed"
      });
    } finally {
      setRowActionById(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleCheckSelectedReports = async () => {
    const selectedIds = Array.from(selectedReports);
    if (selectedIds.length === 0) {
      setError("No reports selected");
      return;
    }

    setRowActionById(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => { next[id] = "check-report"; });
      return next;
    });

    await runWithConcurrency(selectedIds, 3, async (id) => {
      try {
        await window.electronAPI.validateReport(id, userId, selectedCompanyOfficeId || null);
      } catch (err) {
        console.error("Check report failed:", err);
      }
    });

    await loadCheckedReports(checkedPage);

    // Update row results to "Checked" after check completes
    setReportSummaryRow(prev => prev.map(row =>
      selectedIds.includes(row.reportId) ? {
        ...row,
        result: "Checked"
      } : row
    ));

    setRowActionById(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => { delete next[id]; });
      return next;
    });
  };

  const handleCheckReportById = async (id) => {
    if (!id) return;
    setRowActionById(prev => ({ ...prev, [id]: "check-report" }));
    try {
      await window.electronAPI.validateReport(id, userId, selectedCompanyOfficeId || null);
      await loadCheckedReports(checkedPage);
      // Update row result to "Checked" after check completes
      setReportSummaryRow(prev => prev.map(row =>
        row.reportId === id ? {
          ...row,
          result: "Checked"
        } : row
      ));
    } catch (err) {
      console.error("Check report failed:", err);
    } finally {
      setRowActionById(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleChangeReportStatusById = async (id) => {
    if (!id) return;
    setRowActionById(prev => ({ ...prev, [id]: "change-status" }));
    setStatusChangeResult({
      status: 'REQUEST_SENT',
      message: 'Status change request sent'
    });

    try {
      await window.electronAPI.handleCancelledReport(id);
      await loadCheckedReports(checkedPage);
    } catch (err) {
      console.error('Status change encountered error:', err);
    } finally {
      setRowActionById(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleRowAction = async (reportId, action) => {
    const selectedAction = action || selectedActionById[reportId];
    if (!reportId || !selectedAction) return;
    try {
      if (selectedAction === "delete-report") {
        await handleDeleteReportById(reportId);
      } else if (selectedAction === "delete-assets") {
        await handleDeleteAssetsById(reportId);
      } else if (selectedAction === "check-report") {
        await handleCheckReportById(reportId);
      } else if (selectedAction === "change-status") {
        await handleChangeReportStatusById(reportId);
      }
    } finally {
      setSelectedActionById(prev => {
        const next = { ...prev };
        delete next[reportId];
        return next;
      });
    }
  };

  // New handlers for top-level buttons
  const handleRetrySelected = async () => {
    const selectedIds = Array.from(selectedReports);
    if (selectedIds.length === 0) return;

    // For each selected report, retry the last action based on its current state
    for (const id of selectedIds) {
      const row = filteredRows.find(r => r.reportId === id);
      if (row && row.result) {
        if (row.result.includes("Delete Failed")) {
          await handleDeleteReportById(id);
        } else if (row.result.includes("Change Failed")) {
          await handleChangeReportStatusById(id);
        } else {
          // Default to check report
          await handleCheckReportById(id);
        }
      }
    }
  };

  const handleCheckSelected = async () => {
    const selectedIds = Array.from(selectedReports);
    if (selectedIds.length === 0) return;

    setRowActionById(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => { next[id] = "check-report"; });
      return next;
    });

    await runWithConcurrency(selectedIds, 3, async (id) => {
      try {
        await window.electronAPI.validateReport(id, userId, selectedCompanyOfficeId || null);
      } catch (err) {
        console.error("Check report failed:", err);
      }
    });

    await loadCheckedReports(checkedPage);

    setRowActionById(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => { delete next[id]; });
      return next;
    });
  };

  const handleResumeSelected = async () => {
    const selectedIds = Array.from(selectedReports);
    if (selectedIds.length === 0) return;

    for (const id of selectedIds) {
      try {
        // Try to resume delete report first
        const result = await window.electronAPI.resumeDeleteReport(id);
        if (result?.status !== "SUCCESS") {
          // If that fails, try resume delete assets
          await window.electronAPI.resumeDeleteIncompleteAssets(id);
        }
      } catch (err) {
        console.error("Resume failed for", id, err);
      }
    }
    await loadCheckedReports(checkedPage);
  };

  const handlePauseSelected = async () => {
    const selectedIds = Array.from(selectedReports);
    if (selectedIds.length === 0) return;

    for (const id of selectedIds) {
      try {
        // Try to pause delete report first
        const result = await window.electronAPI.pauseDeleteReport(id);
        if (result?.status !== "SUCCESS") {
          // If that fails, try pause delete assets
          await window.electronAPI.pauseDeleteIncompleteAssets(id);
        }
      } catch (err) {
        console.error("Pause failed for", id, err);
      }
    }
    await loadCheckedReports(checkedPage);
  };

  const handleStopSelected = async () => {
    const selectedIds = Array.from(selectedReports);
    if (selectedIds.length === 0) return;

    for (const id of selectedIds) {
      try {
        // Try to stop delete report first
        const result = await window.electronAPI.stopDeleteReport(id);
        if (result?.status !== "SUCCESS") {
          // If that fails, try stop delete assets
          await window.electronAPI.stopDeleteIncompleteAssets(id);
        }
      } catch (err) {
        console.error("Stop failed for", id, err);
      }
    }
    await loadCheckedReports(checkedPage);
  };




  // const validateReportForDelete = async (id) => {
  //   try {
  //     let alreadyDeleted = false;

  //     if (userId) {
  //       const deletedRes = await window.electronAPI.getReportDeletions(userId, null, 1, 1, id);
  //       alreadyDeleted =
  //         deletedRes?.status === "SUCCESS" && (deletedRes.items || []).length > 0;

  //       // ✅ IMPORTANT: do NOT block deletion when alreadyDeleted
  //       if (alreadyDeleted) {
  //         return {
  //           id,
  //           proceed: true,              // ✅ allow deleteReport to run
  //           alreadyDeleted: true,
  //           result: { status: "ALREADY_DELETED_LOCAL" } // optional placeholder
  //         };
  //       }
  //     }

  //     const result = await window.electronAPI.validateReport(id, userId, selectedCompanyOfficeId || null);
  //     const status = result?.status;

  //     if (status === "NOT_FOUND") {
  //       // You can decide: still proceed or not.
  //       // If you want deleteReport to attempt anyway, set proceed:true.
  //       return { id, proceed: true, error: "Report not found", result };
  //     }

  //     if (status === "SUCCESS" || status === "MACROS_EXIST" || result?.hasMacros) {
  //       return { id, proceed: true, result };
  //     }

  //     return { id, proceed: true, error: result?.error || "Validation failed", result }; // still proceed if you insist
  //   } catch (err) {
  //     // If you want "always run deleteReport", even on errors:
  //     return { id, proceed: true, error: err?.message || String(err) };
  //   }
  // };



  const isDraftStatus = (s) => {
    const v = (s || "").toString().trim().toLowerCase();
    return v === "draft" || v === "مسودة";
  };

  const validateReportForDelete = async (id) => {
    try {
      let alreadyDeleted = false;

      if (userId) {
        const deletedRes = await window.electronAPI.getReportDeletions(
          userId,
          null,
          1,
          1,
          id,
          selectedCompanyOfficeId || null
        );
        alreadyDeleted =
          deletedRes?.status === "SUCCESS" && (deletedRes.items || []).length > 0;

        // allow re-run delete if already deleted locally
        if (alreadyDeleted) {
          return {
            id,
            proceed: true,
            alreadyDeleted: true,
            result: { status: "ALREADY_DELETED_LOCAL" }
          };
        }
      }

      const result = await window.electronAPI.validateReport(id, userId, selectedCompanyOfficeId || null);

      const status = result?.status;
      const reportStatus = result?.reportStatus;

      if (status === "NOT_FOUND") {
        return { id, proceed: false, error: result?.message || "Not Found", result };
      }

      // ✅ block delete if not draft
      if (!isDraftStatus(reportStatus)) {
        return {
          id,
          proceed: false,
          error: "Report - Can't be Deleted",
          result
        };
      }

      // if draft -> allow delete
      return { id, proceed: true, result };
    } catch (err) {
      return { id, proceed: false, error: err?.message || String(err) };
    }
  };


  const parseReportIds = (input) => {
    return [...new Set(
      (input || "").split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean)
    )];
  };

  const runWithConcurrency = async (items, limit, worker) => {
    const results = new Array(items.length);
    let idx = 0;

    const runners = Array.from({ length: Math.max(1, limit) }, async () => {
      while (true) {
        const current = idx++;
        if (current >= items.length) break;

        try {
          results[current] = await worker(items[current], current);
        } catch (e) {
          results[current] = { ok: false, error: String(e) };
        }
      }
    });

    await Promise.all(runners);
    return results;
  };


  // ✅ Replace your handleCheckReportInTaqeem with this version

  const handleCheckReportInTaqeem = async () => {
    const ids = parseReportIds(reportId);
    if (!ids.length) {
      setError("At least one Report ID is required");
      return;
    }

    await executeWithAuth(
      async (params) => {
        const { reportIds } = params;

        setIsCheckingReport(true);
        setError("");
        setReportExists(null);
        setStatusChangeResult(null);
        setOperationResult(null);
        setReportSummaryRow([]);

        // Reset input immediately
        setReportId("");

        const concurrency = 3;

        const results = await runWithConcurrency(reportIds, concurrency, async (id) => {
          try {
            const result = await window.electronAPI.validateReport(id, userId, selectedCompanyOfficeId || null);

            const totalAssets = Number(result?.assetsExact ?? result?.microsCount ?? 0) || 0;

            const exists = result?.status !== "NOT_FOUND" && result?.status !== "FAILED";
            const reportStatus = result?.reportStatus ?? "Unknown";

            const row = {
              reportId: result?.reportId || id,
              totalAssets,
              reportStatus,
              presentOrNot: totalAssets > 0 ? "Present" : "Not Present",
              exists,
              // ✅ THIS fixes "-" in UI
              result: result?.status === "NOT_FOUND" ? "Not Found" : "Checked",
            };

            // ✅ Store in DB so it persists
            await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
              reportId: row.reportId,
              action: "check-report",
              userId,
              result: row.result,
              // reportStatus: row.reportStatus,
              totalAssets: row.totalAssets,
            });

            return row;
          } catch (err) {
            const row = {
              reportId: id,
              totalAssets: 0,
              reportStatus: "Error",
              presentOrNot: "Error",
              exists: false,
              // ✅ show something meaningful instead of "-"
              result: "Check Failed",
            };

            // ✅ Store failure in DB too
            await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
              reportId: row.reportId,
              action: "check-report",
              userId,
              result: row.result,
              // reportStatus: row.reportStatus,
              totalAssets: row.totalAssets,
              error: String(err),
            });

            return row;
          }
        });

        setReportSummaryRow(results);

        const allExist = results.every((r) => r.exists);
        setReportExists(allExist);

        if (!allExist) setError("Some reports do not exist or failed to check.");

        // refresh table backed by DB
        await loadCheckedReports(1);

        return { success: true };
      },
      { token, reportIds: ids },
      {
        requiredPoints: ids.length,
        showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
        onAuthFailure: (reason) => {
          if (reason !== "INSUFFICIENT_POINTS" && reason !== "LOGIN_REQUIRED") {
            setError(reason?.message || "Authentication failed for Check Report");
          }
        },
      }
    )
      .catch((err) => {
        if (
          !err?.message?.includes("INSUFFICIENT_POINTS") &&
          !err?.message?.includes("LOGIN_REQUIRED")
        ) {
          setError(err?.message || "Check Report failed");
        }
      })
      .finally(() => {
        setIsCheckingReport(false);
      });
  };



  // ==========================================================================

  // Delete report Function With Batch Ids
  const handleDeleteReport = async () => {
    const ids = parseReportIds(reportId);
    if (!ids.length) {
      setError("At least one Report ID is required (comma separated)");
      return;
    }

    await executeWithAuth(
      async (params) => {
        const { reportIds } = params;

        // Add rows immediately
        const initialRows = reportIds.map((id) => ({
          reportId: id,
          reportStatus: "Validating...",
          totalAssets: "Loading...",
          result: "Validating...",
        }));
        setReportSummaryRow((prev) => [...prev, ...initialRows]);

        // Reset input
        setReportId("");

        // ✅ validate first
        const validationResults = await runWithConcurrency(reportIds, 3, async (id) => {
          const validation = await validateReportForDelete(id);

          const result = validation.result;
          const status = result?.status;
          const reportStatus = result?.reportStatus;
          const totalAssets = Number(result?.assetsExact ?? result?.microsCount ?? 0) || 0;

          let resultText = "";
          if (validation.alreadyDeleted) resultText = "Already Deleted (will re-run delete)";
          else if (status === "NOT_FOUND") resultText = "Not Found";
          else if (validation.proceed) resultText = "Validated";
          else resultText = validation.error || "Cannot Delete";

          setReportSummaryRow((prev) =>
            prev.map((row) =>
              row.reportId === id
                ? {
                  reportId: id,
                  reportStatus: status === "NOT_FOUND" ? "Not Found" : (reportStatus || "Unknown"),
                  totalAssets: status === "NOT_FOUND" ? 0 : totalAssets,
                  result: resultText,
                }
                : row
            )
          );

          return { id, proceed: validation.proceed, result, reportStatus, totalAssets, resultText, error: validation.error };
        });

        const idsToDelete = validationResults.filter((r) => r?.proceed).map((r) => r.id);
        const validationById = validationResults.reduce((acc, r) => ((acc[r.id] = r), acc), {});

        // store validation results
        for (const res of validationResults) {
          await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
            reportId: res.id,
            action: "delete-report",
            userId,
            result: res.resultText || (res.proceed ? "Validated" : "Cannot Delete"),
            //   reportStatus: res.reportStatus,
            totalAssets: res.totalAssets || 0,
            error: res.error,
          });
        }

        if (!idsToDelete.length) {
          setError("No reports are eligible for deletion");
          return { success: false };
        }

        // execute deletes
        setDeleteRequested(true);
        setDeleteReportStatus("running");
        setDeleteReportProgress(null);
        setDeleteReportProgressById({});

        const maxRounds = 10;
        const concurrency = 10;

        const results = await runWithConcurrency(idsToDelete, concurrency, async (id) => {
          try {
            const res = await window.electronAPI.deleteReport(id, maxRounds, userId, selectedCompanyOfficeId || null);

            const validation = validationById[id];
            const totalAssets = validation?.totalAssets || 0;
            const originalReportStatus = validation?.reportStatus || "Unknown";

            setReportSummaryRow((prev) =>
              prev.map((row) => (row.reportId === id ? { ...row, result: "Report - Deleted" } : row))
            );

            await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
              reportId: id,
              action: "delete-report",
              userId,
              result: "Report - Deleted",
              // reportStatus: originalReportStatus,
              totalAssets,
            });

            return { id, ok: true, result: res };
          } catch (err) {
            setReportSummaryRow((prev) =>
              prev.map((row) => (row.reportId === id ? { ...row, result: "Delete Failed" } : row))
            );

            await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
              reportId: id,
              action: "delete-report",
              userId,
              result: "Delete Failed",
              error: String(err),
            });

            return { id, ok: false, error: String(err) };
          }
        });

        const failed = results.filter((r) => !r?.ok).length;
        setDeleteReportStatus(failed ? "partial" : "success");

        await loadCheckedReports(1);

        return { success: true, results };
      },
      { token, reportIds: ids },
      {
        requiredPoints: ids.length, // ✅ cost per report deletion (edit as you want)
        showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
        onAuthFailure: (reason) => {
          if (reason !== "INSUFFICIENT_POINTS" && reason !== "LOGIN_REQUIRED") {
            setError(reason?.message || "Authentication failed for Delete Report");
          }
        },
      }
    ).catch((err) => {
      if (!err?.message?.includes("INSUFFICIENT_POINTS") && !err?.message?.includes("LOGIN_REQUIRED")) {
        setError(err?.message || "Delete Report failed");
      }
      setDeleteReportStatus("stopped");
    });
  };


  // ==========================================================================


  const handleDeleteReportAssets = async () => {
    const ids = parseReportIds(reportId);
    if (!ids.length) {
      setError("At least one Report ID is required");
      return;
    }

    await executeWithAuth(
      async (params) => {
        const { reportIds } = params;

        const initialRows = reportIds.map((id) => ({
          reportId: id,
          reportStatus: "Validating...",
          totalAssets: "Loading...",
          result: "Validating...",
        }));
        setReportSummaryRow((prev) => [...prev, ...initialRows]);

        setReportId("");

        const validationResults = await runWithConcurrency(reportIds, 3, async (id) => {
          try {
            const result = await window.electronAPI.validateReport(id, userId, selectedCompanyOfficeId || null);
            const status = result?.status;
            const reportStatus = result?.reportStatus;
            const totalAssets = Number(result?.assetsExact ?? result?.microsCount ?? 0) || 0;

            let proceed = false;   // ✅ default should be false
            let resultText = "";

            const isDraft =
              (reportStatus || "").toString().trim().toLowerCase() === "draft" ||
              (reportStatus || "").toString().trim() === "مسودة";

            if (status === "NOT_FOUND") {
              resultText = "Not Found";
              proceed = false; // ✅ block
            } else if (status === "SUCCESS" && isDraft) {
              resultText = "Validated";
              proceed = true; // ✅ allow
            } else {
              resultText = "Asset - Can't be Deleted";
              proceed = false; // ✅ block
            }


            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === id
                  ? {
                    reportId: id,
                    reportStatus: status === "NOT_FOUND" ? "Not Found" : (reportStatus || "Unknown"),
                    totalAssets: status === "NOT_FOUND" ? 0 : totalAssets,
                    result: resultText,
                  }
                  : row
              )
            );

            return { id, proceed, reportStatus, totalAssets, resultText };
          } catch (err) {
            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === id ? { ...row, reportStatus: "Error", totalAssets: 0, result: "Error" } : row
              )
            );
            return { id, proceed: false, error: String(err) };
          }
        });

        const idsToDelete = validationResults.filter((r) => r?.proceed).map((r) => r.id);
        const validationById = validationResults.reduce((acc, r) => ((acc[r.id] = r), acc), {});

        for (const res of validationResults) {
          await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
            reportId: res.id,
            action: "delete-assets",
            userId,
            result: res.resultText || (res.proceed ? "Validated" : "Cannot Delete"),
            //   reportStatus: res.reportStatus,
            totalAssets: res.totalAssets || 0,
            error: res.error,
          });
        }

        if (!idsToDelete.length) return { success: false };

        setDeleteAssetsRequested(true);
        setDeleteAssetsStatus("running");

        const maxRounds = 10;
        const concurrency = Math.min(5, idsToDelete.length);

        const results = await runWithConcurrency(idsToDelete, concurrency, async (id) => {
          try {
            const res = await window.electronAPI.deleteIncompleteAssets(id, maxRounds, userId, selectedCompanyOfficeId || null);

            const validation = validationById[id];
            const totalAssets = validation?.totalAssets || 0;
            const originalReportStatus = validation?.reportStatus || "Unknown";

            setReportSummaryRow((prev) =>
              prev.map((row) => (row.reportId === id ? { ...row, result: "Asset - Deleted" } : row))
            );

            await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
              reportId: id,
              action: "delete-assets",
              userId,
              result: "Asset - Deleted",
              reportStatus: originalReportStatus,
              totalAssets,
            });

            return { id, ok: true, result: res };
          } catch (err) {
            setReportSummaryRow((prev) =>
              prev.map((row) => (row.reportId === id ? { ...row, result: "Delete Failed" } : row))
            );

            await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
              reportId: id,
              action: "delete-assets",
              userId,
              result: "Delete Failed",
              error: String(err),
            });

            return { id, ok: false, error: String(err) };
          }
        });

        const failed = results.filter((r) => !r?.ok).length;
        setDeleteAssetsStatus(failed ? "partial" : "success");

        await loadCheckedReports(1);

        return { success: true, results };
      },
      { token, reportIds: ids },
      {
        requiredPoints: ids.length, // ✅ cost per report assets deletion (edit as you want)
        showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
        onAuthFailure: (reason) => {
          if (reason !== "INSUFFICIENT_POINTS" && reason !== "LOGIN_REQUIRED") {
            setError(reason?.message || "Authentication failed for Delete Assets");
          }
        },
      }
    ).catch((err) => {
      if (!err?.message?.includes("INSUFFICIENT_POINTS") && !err?.message?.includes("LOGIN_REQUIRED")) {
        setError(err?.message || "Delete Assets failed");
      }
      setDeleteAssetsStatus("stopped");
    });
  };


  // Handle pause delete report - CHECK API RESPONSE
  const handlePauseDeleteReport = async () => {
    if (!reportId.trim()) {
      setError("Report ID is required");
      return;
    }

    try {
      const result = await window.electronAPI.pauseDeleteReport(reportId);
      console.log("Pause delete report result:", result);

      if (result.status === "SUCCESS") {
        setDeleteReportStatus('paused');
      } else {
        setOperationResult({
          type: 'pause',
          operation: 'delete-report',
          status: result.status,
          message: result.message || "Failed to pause delete report"
        });
      }
    } catch (err) {
      console.error("Error pausing delete report:", err);
      setOperationResult({
        type: 'pause',
        operation: 'delete-report',
        status: 'FAILED',
        message: err.message || "Error pausing delete report"
      });
    }
  };

  // Handle resume delete report - CHECK API RESPONSE
  const handleResumeDeleteReport = async () => {
    if (!reportId.trim()) {
      setError("Report ID is required");
      return;
    }

    try {
      const result = await window.electronAPI.resumeDeleteReport(reportId);
      console.log("Resume delete report result:", result);

      if (result.status === "SUCCESS") {
        setDeleteReportStatus('running');
      } else {
        setOperationResult({
          type: 'resume',
          operation: 'delete-report',
          status: result.status,
          message: result.message || "Failed to resume delete report"
        });
      }
    } catch (err) {
      console.error("Error resuming delete report:", err);
      setOperationResult({
        type: 'resume',
        operation: 'delete-report',
        status: 'FAILED',
        message: err.message || "Error resuming delete report"
      });
    }
  };

  // Handle stop delete report - CHECK API RESPONSE
  const handleStopDeleteReport = async () => {
    if (!reportId.trim()) {
      setError("Report ID is required");
      return;
    }

    try {
      const result = await window.electronAPI.stopDeleteReport(reportId);
      console.log("Stop delete report result:", result);

      if (result.status === "SUCCESS") {
        setDeleteReportStatus('stopped');
        setDeleteReportProgress(null); // Clear progress on stop
        setDeleteReportProgressById({});
      } else {
        setOperationResult({
          type: 'stop',
          operation: 'delete-report',
          status: result.status,
          message: result.message || "Failed to stop delete report"
        });
      }
    } catch (err) {
      console.error("Error stopping delete report:", err);
      setOperationResult({
        type: 'stop',
        operation: 'delete-report',
        status: 'FAILED',
        message: err.message || "Error stopping delete report"
      });
    }
  };

  // Handle pause delete incomplete assets - CHECK API RESPONSE
  const handlePauseDeleteIncompleteAssets = async () => {
    if (!reportId.trim()) {
      setError("Report ID is required");
      return;
    }

    try {
      const result = await window.electronAPI.pauseDeleteIncompleteAssets(reportId);
      console.log("Pause delete incomplete assets result:", result);

      if (result.status === "SUCCESS") {
        setDeleteAssetsStatus('paused');
      } else {
        setOperationResult({
          type: 'pause',
          operation: 'delete-incomplete-assets',
          status: result.status,
          message: result.message || "Failed to pause delete assets"
        });
      }
    } catch (err) {
      console.error("Error pausing delete incomplete assets:", err);
      setOperationResult({
        type: 'pause',
        operation: 'delete-incomplete-assets',
        status: 'FAILED',
        message: err.message || "Error pausing delete assets"
      });
    }
  };

  // Handle resume delete incomplete assets - CHECK API RESPONSE
  const handleResumeDeleteIncompleteAssets = async () => {
    if (!reportId.trim()) {
      setError("Report ID is required");
      return;
    }

    try {
      const result = await window.electronAPI.resumeDeleteIncompleteAssets(reportId);
      console.log("Resume delete incomplete assets result:", result);

      if (result.status === "SUCCESS") {
        setDeleteAssetsStatus('running');
      } else {
        setOperationResult({
          type: 'resume',
          operation: 'delete-incomplete-assets',
          status: result.status,
          message: result.message || "Failed to resume delete assets"
        });
      }
    } catch (err) {
      console.error("Error resuming delete incomplete assets:", err);
      setOperationResult({
        type: 'resume',
        operation: 'delete-incomplete-assets',
        status: 'FAILED',
        message: err.message || "Error resuming delete assets"
      });
    }
  };

  // Handle stop delete incomplete assets - CHECK API RESPONSE
  const handleStopDeleteIncompleteAssets = async () => {
    if (!reportId.trim()) {
      setError("Report ID is required");
      return;
    }

    try {
      const result = await window.electronAPI.stopDeleteIncompleteAssets(reportId);
      console.log("Stop delete incomplete assets result:", result);

      if (result.status === "SUCCESS") {
        setDeleteAssetsStatus('stopped');
      } else {
        setOperationResult({
          type: 'stop',
          operation: 'delete-incomplete-assets',
          status: result.status,
          message: result.message || "Failed to stop delete assets"
        });
      }
    } catch (err) {
      console.error("Error stopping delete incomplete assets:", err);
      setOperationResult({
        type: 'stop',
        operation: 'delete-incomplete-assets',
        status: 'FAILED',
        message: err.message || "Error stopping delete assets"
      });
    }
  };


  const handleChangeReportStatus = async () => {
    const ids = parseReportIds(reportId);
    if (!ids.length) {
      setError("At least one Report ID is required");
      return;
    }

    await executeWithAuth(
      async (params) => {
        const { reportIds } = params;

        const initialRows = reportIds.map((id) => ({
          reportId: id,
          reportStatus: "Validating...",
          totalAssets: "Loading...",
          result: "Validating...",
        }));
        setReportSummaryRow((prev) => [...prev, ...initialRows]);
        setReportId("");

        const validationResults = await runWithConcurrency(reportIds, 3, async (id) => {
          try {
            const result = await window.electronAPI.validateReport(id, userId, selectedCompanyOfficeId || null);
            const status = result?.status;
            const reportStatus = result?.reportStatus;
            const totalAssets = Number(result?.assetsExact ?? result?.microsCount ?? 0) || 0;

            const resultText = status === "NOT_FOUND" ? "Not Found" : "Validated";

            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === id
                  ? {
                    reportId: id,
                    reportStatus: status === "NOT_FOUND" ? "Not Found" : (reportStatus || "Unknown"),
                    totalAssets: status === "NOT_FOUND" ? 0 : totalAssets,
                    result: resultText,
                  }
                  : row
              )
            );

            return { id, result, reportStatus, totalAssets, resultText };
          } catch (err) {
            setReportSummaryRow((prev) =>
              prev.map((row) =>
                row.reportId === id ? { ...row, reportStatus: "Error", totalAssets: 0, result: "Error" } : row
              )
            );
            return { id, error: String(err) };
          }
        });

        for (const res of validationResults) {
          if (res.result && res.result.status !== "NOT_FOUND") {
            try {
              await window.electronAPI.handleCancelledReport(res.id);

              setReportSummaryRow((prev) =>
                prev.map((row) => (row.reportId === res.id ? { ...row, result: "Status Changed" } : row))
              );

              await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
                reportId: res.id,
                action: "change-status",
                userId,
                result: "Status Changed",
                reportStatus: res.reportStatus,
                totalAssets: res.totalAssets || 0,
              });
            } catch (err) {
              setReportSummaryRow((prev) =>
                prev.map((row) => (row.reportId === res.id ? { ...row, result: "Change Failed" } : row))
              );

              await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
                reportId: res.id,
                action: "change-status",
                userId,
                result: "Change Failed",
                error: String(err),
              });
            }
          } else {
            await window.electronAPI.storeReportDeletion({
              companyOfficeId: selectedCompanyOfficeId || null,
              reportId: res.id,
              action: "change-status",
              userId,
              result: res.resultText || "Not Found",
              reportStatus: res.reportStatus,
              totalAssets: res.totalAssets || 0,
              error: res.error,
            });
          }
        }

        setStatusChangeResult({ status: "COMPLETED", message: "Status change process completed" });
        await loadCheckedReports(1);

        return { success: true };
      },
      { token, reportIds: ids },
      {
        requiredPoints: ids.length, // ✅ cost per status-change
        showInsufficientPointsModal: () => setShowInsufficientPointsModal(true),
        onAuthFailure: (reason) => {
          if (reason !== "INSUFFICIENT_POINTS" && reason !== "LOGIN_REQUIRED") {
            setError(reason?.message || "Authentication failed for Change Status");
          }
        },
      }
    ).catch((err) => {
      if (!err?.message?.includes("INSUFFICIENT_POINTS") && !err?.message?.includes("LOGIN_REQUIRED")) {
        setError(err?.message || "Change Status failed");
      }
    });
  };

  // Get status color
  const getStatusColor = (status) => {
    switch (status) {
      case 'running': return 'text-green-500';
      case 'paused': return 'text-yellow-500';
      case 'stopped': return 'text-red-500';
      case 'completed': return 'text-blue-500';
      default: return 'text-gray-500';
    }
  };

  // Get status text
  const getStatusText = (status) => {
    switch (status) {
      case 'running': return 'Running';
      case 'paused': return 'Paused';
      case 'stopped': return 'Stopped';
      case 'completed': return 'Completed';
      default: return 'Not Started';
    }
  };

  // Render operation status
  const renderOperationStatus = () => {
    if (!deleteReportStatus && !deleteAssetsStatus && !operationResult) return null;

    return (
      <div className="space-y-4">
        {/* Delete Report Status */}
        {deleteReportStatus && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-500" />
                <span className="font-medium text-gray-800">Delete Report</span>
              </div>
              <div className={`flex items-center gap-2 ${getStatusColor(deleteReportStatus)}`}>
                <div className={`w-2 h-2 rounded-full ${deleteReportStatus === 'running' ? 'bg-green-500 animate-pulse' :
                  deleteReportStatus === 'paused' ? 'bg-yellow-500' :
                    deleteReportStatus === 'stopped' ? 'bg-red-500' : 'bg-blue-500'}`} />
                <span className="text-sm font-medium">{getStatusText(deleteReportStatus)}</span>
              </div>
            </div>

            {deleteReportStatus === 'running' && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handlePauseDeleteReport}
                  className="flex-1 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <PauseCircle className="w-4 h-4" />
                  Pause
                </button>
                <button
                  onClick={handleStopDeleteReport}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <StopCircle className="w-4 h-4" />
                  Stop
                </button>
              </div>
            )}

            {/* Progress Bar */}
            {/* Progress moved into table */}

            {/* Completion Status */}
            {deleteReportStatus === 'success' && (
              <div className="mt-4  hidden ms-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle className="w-3 h-3 text-green-500" />
                <div>
                  <p className="font-sm text-green-800">Delete Completed Successfully</p>
                  {/* <p className="text-sm text-green-600">Report ID: {reportId}</p> */}
                </div>
              </div>
            )}

            {deleteReportStatus === 'paused' && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleResumeDeleteReport}
                  className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Resume
                </button>
                <button
                  onClick={handleStopDeleteReport}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <StopCircle className="w-4 h-4" />
                  Stop
                </button>
              </div>
            )}
          </div>
        )}

        {/* Delete Assets Status */}
        {deleteAssetsStatus && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-purple-500" />
                <span className="font-medium text-gray-800">Delete Assets</span>
              </div>
              <div className={`flex items-center gap-2 ${getStatusColor(deleteAssetsStatus)}`}>
                <div className={`w-2 h-2 rounded-full ${deleteAssetsStatus === 'running' ? 'bg-green-500 animate-pulse' :
                  deleteAssetsStatus === 'paused' ? 'bg-yellow-500' :
                    deleteAssetsStatus === 'stopped' ? 'bg-red-500' : 'bg-blue-500'}`} />
                <span className="text-sm font-medium">{getStatusText(deleteAssetsStatus)}</span>
              </div>
            </div>

            {deleteAssetsStatus === 'running' && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handlePauseDeleteIncompleteAssets}
                  className="flex-1 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <PauseCircle className="w-4 h-4" />
                  Pause
                </button>
                <button
                  onClick={handleStopDeleteIncompleteAssets}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <StopCircle className="w-4 h-4" />
                  Stop
                </button>
              </div>
            )}

            {deleteAssetsStatus === 'paused' && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleResumeDeleteIncompleteAssets}
                  className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Resume
                </button>
                <button
                  onClick={handleStopDeleteIncompleteAssets}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <StopCircle className="w-4 h-4" />
                  Stop
                </button>
              </div>
            )}
          </div>
        )}

        {/* Operation Result */}
        {operationResult && (
          <div className={`border rounded-xl p-4 ${operationResult.status === 'SUCCESS'
            ? 'bg-green-50 border-green-200'
            : operationResult.status === 'STOPPED'
              ? 'bg-yellow-50 border-yellow-200'
              : operationResult.status === 'FAILED'
                ? 'bg-red-50 border-red-200'
                : 'bg-blue-50 border-blue-200'
            }`}>
            <div className="flex items-center gap-3">
              {operationResult.status === 'SUCCESS' && <CheckCircle className="w-5 h-5 text-green-500" />}
              {operationResult.status === 'STOPPED' && <AlertCircle className="w-5 h-5 text-yellow-500" />}
              {operationResult.status === 'FAILED' && <AlertCircle className="w-5 h-5 text-red-500" />}
              {!['SUCCESS', 'STOPPED', 'FAILED'].includes(operationResult.status) && <AlertCircle className="w-5 h-5 text-blue-500" />}

              <div>
                <p className="font-medium">
                  {operationResult.type === 'delete-report' && 'Delete Report'}
                  {operationResult.type === 'delete-incomplete-assets' && 'Delete Assets'}
                  {operationResult.type === 'pause' && `Pause ${operationResult.operation.replace('-', ' ')}`}
                  {operationResult.type === 'resume' && `Resume ${operationResult.operation.replace('-', ' ')}`}
                  {operationResult.type === 'stop' && `Stop ${operationResult.operation.replace('-', ' ')}`}
                </p>
                <p className="text-sm mt-1">{operationResult.message}</p>
                {operationResult.data?.reportId && (
                  <p className="text-xs mt-1">
                    Report ID: <strong>{operationResult.data.reportId}</strong>
                  </p>
                )}
                {operationResult.data?.rounds && (
                  <p className="text-xs mt-1">
                    Rounds: <strong>{operationResult.data.rounds}</strong>
                  </p>
                )}
                {operationResult.data?.deletedAssets && (
                  <p className="text-xs mt-1">
                    Assets Deleted: <strong>{operationResult.data.deletedAssets}</strong>
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render status change result
  const renderStatusChangeResult = () => {
    if (!statusChangeResult) return null;

    const { status, message } = statusChangeResult;

    if (status === 'REQUEST_SENT') {
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-blue-500" />
            <div>
              <p className="font-medium text-blue-800">Status Change Request Sent</p>
              <p className="text-sm text-blue-600">{message}</p>
              <p className="text-xs text-blue-500 mt-1">
                Request sent for Report ID: <strong>{reportId}</strong>
              </p>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderProgressCell = (progress) => {
    if (!progress) return <span className="text-xs text-gray-500">-</span>;
    const total = progress.total || 1;
    const current = progress.current || 0;
    const remaining = progress.remaining !== undefined ? progress.remaining : Math.max(total - current, 0);
    const pct = Math.round((current / total) * 100);
    const isComplete = total > 0 && current >= total;
    return (
      <div>
        <div className="flex justify-between text-xs text-gray-600 mb-1">
          <span>{isComplete ? "Completed" : `${pct}%`}</span>
          <span>{isComplete ? `${total}/${remaining}` : `${current}/${total}`}</span>
        </div>
        {!isComplete && (
          <>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Total: {total}</span>
              <span>Remaining: {remaining}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              ></div>
            </div>
          </>
        )}
      </div>
    );
  };

  const getRowProgress = (reportId) => {
    const live = deleteReportProgressById[reportId] || deleteAssetsProgressById[reportId];
    if (live) return live;
    const deleted = deletedById[reportId];
    if (deleted && deleted.total_assets != null) {
      const total = Number(deleted.total_assets) || 0;
      const remaining = Number(deleted.remaining_assets) || 0;
      const current = Math.max(total - remaining, 0);
      return { total, current, remaining };
    }
    return null;
  };

  const getOperationStatusText = (action) => {
    switch (action) {
      case "check-report":
        return "Checking...";
      case "delete-report":
        return "Deleting Reports...";
      case "delete-assets":
        return "Deleting Assets...";
      case "change-status":
        return "Changing Status...";
      default:
        return null;
    }
  };

  return (
    <div className="max-h-screen bg-gradient-to-br from-red-50 to-orange-100 py-8">
      <div className="max-w-full mx-auto px-4">


        {/* Main Content Area */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          {/* Main Form */}
          <div className="space-y-6">

            <div className="flex items-center gap-3 animate-pulse">
              <FileText className="w-5 h-5 text-red-500" />
              <div>
                <p className="font-medium text-red-800">Warning: Irreversible Action</p>

              </div>
            </div>


            <div className="space-y-6">
              {/* Report ID Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Report IDs *
                </label>
                <div className="flex flex-col gap-3 mb-3">
                  <textarea
                    type="text"
                    value={reportId}
                    onChange={(e) => {
                      setReportId(e.target.value);
                      setError("");
                      setReportExists(null);
                      setDeleteRequested(false);
                      setDeleteAssetsRequested(false);
                      setStatusChangeResult(null);
                      setDeleteReportStatus(null);
                      setDeleteAssetsStatus(null);
                      setOperationResult(null);
                    }}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors"
                    placeholder="Enter Report IDs (space separated)"
                  />
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={handleDeleteReport}
                      disabled={selectedReports.size > 0 || deleteReportStatus === 'running'}
                      className="px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg font-normal flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete Report
                    </button>
                    <button
                      onClick={handleDeleteReportAssets}
                      disabled={deleteAssetsStatus === 'running'}
                      className="px-3 py-2 bg-blue-800 hover:bg-blue-900 disabled:bg-blue-400 text-white rounded-lg font-normal flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                    >
                      <Package className="w-3 h-3" />
                      Delete Assets
                    </button>
                    <button
                      onClick={handleChangeReportStatus}
                      className="px-4 py-3 bg-blue-800 hover:bg-blue-900 disabled:bg-blue-400 text-white rounded-lg font-normal flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                    >
                      <PlayCircle className="w-3 h-3" />
                      Change Status
                    </button>
                    <button
                      onClick={handleChangeStatusAndDeleteReport}
                      disabled={deleteReportStatus === 'running'}
                      className="px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white rounded-lg font-normal flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Change Status & Delete Report
                    </button>
                    <button
                      onClick={handleCheckReportInTaqeem}
                      className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-normal flex items-center gap-2 transition-colors whitespace-nowrap"
                    >


                      <Search className="w-3 h-3" />
                      Check Report
                    </button>





                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {selectedReports.size > 0
                    ? `${selectedReports.size} report(s) selected for batch operations. Use the buttons above the table.`
                    : "Enter the report IDs you wish to check or delete. Separate multiple IDs with spaces."
                  }
                </p>
                {filteredRows.length > 0 && (
                  <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-700">
                        Report Summary ({filteredRows.length} reports, {filteredRows.filter(row => !row.isDeleted).length} selectable)
                      </div>
                      {selectedReports.size > 0 && (
                        <div className="text-sm text-blue-600 font-medium">
                          {selectedReports.size} selected
                        </div>
                      )}
                    </div>



                    <div className="bg-white px-4 py-3 border-b flex flex-wrap items-center gap-3">
                      <select
                        value={filterMode}
                        onChange={(e) => setFilterMode(e.target.value)}
                        className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                      >
                        <option value="all">All</option>
                        <option value="checked">Checked</option>
                        <option value="deleted-report">Deleted Report</option>
                        <option value="deleted-asset">Deleted Asset</option>
                      </select>

                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search report ID"
                        className="text-xs border border-gray-300 rounded px-2 py-1 bg-white w-48"
                      />

                      {/* Dropdown */}
                      <div className="relative">
                        <details className="group">
                          <summary className="list-none cursor-pointer px-3 py-2 bg-gray-100 hover:bg-gray-200 text-black rounded-lg text-xs font-medium transition-colors">
                            Actions
                          </summary>

                          <div className="absolute right-0 z-10 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex flex-col gap-2">
                            <button
                              onClick={handleCheckSelectedReports}
                              disabled={selectedReports.size === 0}
                              className="py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-slate-200 text-black rounded-lg text-xs flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                            >

                              Check Selected
                            </button>

                            <button
                              onClick={handleDeleteSelectedReports}
                              disabled={selectedReports.size === 0 || deleteReportStatus === 'running'}
                              className="py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-slate-200 text-black rounded-lg text-xs flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                            >

                              Delete Selected Reports
                            </button>

                            <button
                              onClick={handleCheckSelected}
                              disabled={selectedReports.size === 0}
                              className="py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-slate-200 text-black rounded-lg text-xs flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                            >

                              Check
                            </button>

                            <button
                              onClick={handleDeleteSelectedAssets}
                              disabled={selectedReports.size === 0 || deleteAssetsStatus === 'running'}
                              className="py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-slate-200 text-black rounded-lg text-xs flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                            >

                              Delete Selected Assets
                            </button>

                            <button
                              onClick={handleResumeSelected}
                              disabled={selectedReports.size === 0}
                              className="py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-slate-200 text-black rounded-lg text-xs flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                            >

                              Resume
                            </button>

                            <button
                              onClick={handlePauseSelected}
                              disabled={selectedReports.size === 0}
                              className="py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-slate-200 text-black rounded-lg text-xs flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                            >

                              Pause
                            </button>

                            <button
                              onClick={handleStopSelected}
                              disabled={selectedReports.size === 0}
                              className=" py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-slate-200 text-black rounded-lg text-xs flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                            >

                              Stop
                            </button>
                          </div>
                        </details>
                      </div>
                    </div>


                    <div className="overflow-x-auto">
                      <table className="min-w-full text-[10px] text-slate-700">
                        <thead className="bg-blue-900/10 text-blue-900 sticky top-0">
                          <tr>
                            <th className="text-left px-4 py-2 font-semibold text-gray-600">
                              {(() => {
                                const selectableReports = filteredRows.filter(row => row.result !== 'Report - Deleted');
                                const allSelectableSelected = selectableReports.length > 0 &&
                                  selectableReports.every(row => selectedReports.has(row.reportId));

                                return (
                                  <input
                                    type="checkbox"
                                    checked={allSelectableSelected}
                                    onChange={(e) => handleSelectAll(e.target.checked)}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                );
                              })()}
                            </th>
                            <th className="text-left px-4 py-2 font-semibold text-gray-600">Report ID</th>
                            <th className="text-left px-4 py-2 font-semibold text-gray-600">Report Status</th>
                            <th className="text-left px-4 py-2 font-semibold text-gray-600">Total Assets</th>
                            <th className="text-left px-4 py-2 font-semibold text-gray-600">Result</th>
                            <th className="text-left px-4 py-2 font-semibold text-gray-600">Actions</th>
                            <th className="text-left px-4 py-2 font-semibold text-gray-600">Progress</th>
                            <th className="text-left px-4 py-2 font-semibold text-gray-600">Controls</th>
                          </tr>
                        </thead>

                        <tbody>
                          {checkedLoading && filteredRows.length === 0 && (
                            <tr>
                              <td className="px-4 py-3 text-gray-500" colSpan={7}>Loading checked reports...</td>
                            </tr>
                          )}
                          {!checkedLoading && filteredRows.length === 0 && (
                            <tr>
                              <td className="px-4 py-3 text-gray-500" colSpan={7}>No checked reports found.</td>
                            </tr>
                          )}
                          {filteredRows.map((row, index) => (
                            <tr key={index} className={`border-b ${selectedReports.has(row.reportId) ? 'bg-blue-50' : ''} ${row.result === 'Report - Deleted' ? 'opacity-60' : ''}`}>
                              <td className="px-4 py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedReports.has(row.reportId)}
                                  onChange={(e) => handleReportSelect(row.reportId, e.target.checked)}
                                  disabled={row.result === 'Report - Deleted'}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title={row.result === 'Report - Deleted' ? "Cannot select deleted reports" : ""}
                                />
                              </td>
                              <td className="px-4 py-2 text-gray-800 font-medium">{row.reportId}</td>
                              <td className="px-4 py-2 text-gray-800">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${row.reportStatus === "U.O3U^O_Oc" || row.reportStatus === "Draft"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-gray-100 text-gray-700"
                                  }`}>
                                  {row.reportStatus}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-gray-800">{row.totalAssets}</td>
                              <td className="px-4 py-2 text-gray-800">
                                {(() => {
                                  const inProgressAction = rowActionById[row.reportId];
                                  const statusText = inProgressAction ? getOperationStatusText(inProgressAction) : null;
                                  const displayText = statusText || row.result || "-";
                                  const isInProgress = !!statusText;

                                  return (
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${isInProgress
                                      ? "bg-yellow-100 text-yellow-700 animate-pulse"
                                      : row.result === "Validated" || row.result === "Checked" || row.result === "Status Changed" || row.result === "Asset - Deleted" || row.result === "Report - Deleted"
                                        ? "bg-green-100 text-green-700"
                                        : row.result === "Not Found" || row.result === "Report - Can't be Deleted" || row.result === "Delete Failed" || row.result === "Change Failed"
                                          ? "bg-red-100 text-red-700"
                                          : "bg-gray-100 text-gray-700"
                                      }`}>
                                      {displayText}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-2">
                                  <select
                                    value={selectedActionById[row.reportId] || ""}
                                    onChange={(e) => {
                                      const action = e.target.value;
                                      setSelectedActionById(prev => ({ ...prev, [row.reportId]: action }));
                                    }}
                                    className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                                    disabled={row.result === 'Report - Deleted' || !!rowActionById[row.reportId]}
                                  >
                                    <option value="" disabled>Actions</option>
                                    <option value="check-report">Check Report</option>
                                    <option value="delete-assets">Delete Assets</option>
                                    <option value="delete-report">Delete Report</option>
                                    <option value="change-status">Change Status</option>
                                  </select>
                                  <button
                                    onClick={() => handleRowAction(row.reportId)}
                                    disabled={row.result === 'Report - Deleted' || !selectedActionById[row.reportId] || !!rowActionById[row.reportId]}
                                    className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded"
                                  >
                                    Go
                                  </button>
                                </div>
                              </td>
                              <td className="px-4 py-2">
                                {renderProgressCell(getRowProgress(row.reportId))}
                              </td>
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-1 flex-wrap">


                                  <button
                                    onClick={async () => {
                                      try {
                                        await window.electronAPI.resumeDeleteReport(row.reportId);
                                        await loadCheckedReports(checkedPage);
                                      } catch (err) {
                                        console.error("Resume failed:", err);
                                      }
                                    }}
                                    disabled={row.result === 'Report - Deleted'}
                                    className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded flex items-center gap-1"
                                    title="Resume operation"
                                  >
                                    <Play className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={async () => {
                                      try {
                                        await window.electronAPI.pauseDeleteReport(row.reportId);
                                        await loadCheckedReports(checkedPage);
                                      } catch (err) {
                                        console.error("Pause failed:", err);
                                      }
                                    }}
                                    disabled={row.result === 'Report - Deleted'}
                                    className="px-2 py-1 text-xs bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-400 text-white rounded flex items-center gap-1"
                                    title="Pause operation"
                                  >
                                    <PauseCircle className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={async () => {
                                      try {
                                        await window.electronAPI.stopDeleteReport(row.reportId);
                                        await loadCheckedReports(checkedPage);
                                      } catch (err) {
                                        console.error("Stop failed:", err);
                                      }
                                    }}
                                    disabled={row.result === 'Report - Deleted'}
                                    className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded flex items-center gap-1"
                                    title="Stop operation"
                                  >
                                    <StopCircle className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {checkedError && (
                      <div className="px-4 py-2 text-xs text-red-600">{checkedError}</div>
                    )}
                    <div className="bg-gray-50 px-4 py-3 border-t flex items-center justify-between">
                      <button
                        onClick={() => setCheckedPage((p) => Math.max(p - 1, 1))}
                        disabled={checkedPage <= 1}
                        className="px-3 py-1 text-xs bg-white border rounded disabled:opacity-50"
                      >
                        Prev
                      </button>
                      <div className="text-xs text-gray-500">
                        Page {checkedPage} of {checkedTotalPages} - {checkedTotal} item(s)
                      </div>
                      <button
                        onClick={() => setCheckedPage((p) => Math.min(p + 1, checkedTotalPages))}
                        disabled={checkedPage >= checkedTotalPages}
                        className="px-3 py-1 text-xs bg-white border rounded disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>

                    {/* Optional: small status note below the table */}
                    <div
                      className={`px-4 py-2 text-xs ${reportExists === true ? "text-green-700" : "text-red-700"
                        }`}
                    >
                      {reportExists === true
                        ? "All reports verified successfully."
                        : reportExists === false
                          ? "Some reports not found or invalid."
                          : ""}
                    </div>
                  </div>
                )}

              </div>

              {renderOperationStatus()}

              {/* Status Change Section - ALWAYS VISIBLE */}
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">


                {/* Status Change Result */}
                {renderStatusChangeResult()}
              </div>

              {/* Delete Request Sent Confirmation */}
              {deleteRequested && !deleteReportStatus && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-blue-500" />
                    <div>
                      <p className="font-medium text-blue-800">Delete Request Sent</p>
                      <p className="text-sm text-blue-600">
                        Delete request sent for Report ID: <strong>{reportId}</strong>
                      </p>
                      <p className="text-xs text-blue-500 mt-1">
                        You can send multiple delete requests if needed.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Delete Assets Request Sent Confirmation */}
              {deleteAssetsRequested && !deleteAssetsStatus && (
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-purple-500" />
                    <div>
                      <p className="font-medium text-purple-800">Delete Assets Request Sent</p>
                      <p className="text-sm text-purple-600">
                        Delete assets request sent for Report ID: <strong>{reportId}</strong>
                      </p>
                      <p className="text-xs text-purple-500 mt-1">
                        You can send multiple delete assets requests if needed.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-red-500" />
                    <span className="text-red-700">{error}</span>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeleteReport;
