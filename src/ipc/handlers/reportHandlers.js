const pythonAPI = require("../../services/python/PythonAPI");
const {
  extractAssetDataFromExcel,
} = require("../../services/excel/extractAssetDataFromExcel");
const path = require("path");
const fs = require("fs");
const { app, net, BrowserWindow } = require("electron");

const reportHandlers = {
  // async handleValidateReport(event, reportId) {
  //     try {
  //         console.log('[MAIN] Received validate report request:', reportId);

  //         const result = await pythonAPI.report.validateReport(reportId);
  //         console.log("Result at handler:", result);

  //         if (result.status === 'SUCCESS') {
  //             return { status: 'SUCCESS', message: 'Report is valid' };

  //         } else if (result.status === 'NOT_FOUND') {
  //             return { status: 'NOT_FOUND', message: 'Report not found' };

  //         } else if (result.status === 'MACROS_EXIST') {
  //             return { status: 'MACROS_EXIST', message: 'Report has macros' };

  //         }
  //         else {
  //             return { status: 'ERROR', error: result.error || 'Report validation failed' };
  //         }

  //     } catch (error) {
  //         console.error('[MAIN] Validate report error:', error);
  //         return { status: 'ERROR', error: error.message };
  //     }
  // },

  async handleValidateReport(
    event,
    reportId,
    userId = null,
    companyOfficeId = null,
  ) {
    try {
      console.log("[MAIN] Received validate report request:", reportId);

      const result = await pythonAPI.report.validateReport(
        reportId,
        userId,
        companyOfficeId,
      );
      console.log("Result at handler (FULL):", result);

      if (result.status === "SUCCESS") {
        return { ...result, message: "Report is valid" };
      } else if (result.status === "NOT_FOUND") {
        return { ...result, message: "Report not found" };
      } else if (result.status === "MACROS_EXIST") {
        return {
          ...result,
          message: `Report has ${result.assetsExact} macros`,
        };
      } else {
        return {
          ...result,
          status: "ERROR",
          error: result.error || "Report validation failed",
        };
      }
    } catch (error) {
      console.error("[MAIN] Validate report error:", error);
      return { status: "ERROR", error: error.message };
    }
  },

  async handleCompleteFlow(event, reportId, tabsNum) {
    try {
      console.log("[MAIN] Received complete flow request:", reportId, tabsNum);

      // Get the window that sent the event
      const senderWindow = BrowserWindow.fromWebContents(event.sender);

      if (!senderWindow || senderWindow.isDestroyed()) {
        return { status: "FAILED", error: "Window not available" };
      }

      // IMPORTANT: The process ID in Python is 'complete-flow-{reportId}'
      const processId = `complete-flow-${reportId}`;

      // Store the cleanup function
      const unregisterProgress = () => {
        pythonAPI.workerService.unregisterProgressCallback(processId);
      };

      try {
        // Register progress callback using the correct process ID format
        pythonAPI.workerService.registerProgressCallback(
          processId,
          (progressData) => {
            console.log("[MAIN] Complete flow progress update:", progressData);

            // Make sure we have a valid sender window
            if (!senderWindow || senderWindow.isDestroyed()) {
              console.warn("[MAIN] Window destroyed, cannot send progress");
              unregisterProgress();
              return;
            }

            // Send progress to renderer via IPC
            // Use 'submit-reports-quickly-progress' channel to match ReportsTable listener
            senderWindow.webContents.send("submit-reports-quickly-progress", {
              ...progressData,
              reportId: reportId, // Include original reportId for table matching
              processId: processId,
            });
          },
        );

        // Execute the complete flow
        const result = await pythonAPI.report.completeFlow(reportId, tabsNum);

        // Ensure cleanup
        unregisterProgress();

        return result;
      } catch (err) {
        console.error("[MAIN] Complete flow error:", err);

        // Ensure cleanup on error
        unregisterProgress();

        // Also send an error progress update
        if (senderWindow && !senderWindow.isDestroyed()) {
          senderWindow.webContents.send("submit-reports-quickly-progress", {
            reportId: reportId,
            processId: processId,
            status: "FAILED",
            error: err.message,
            current: 0,
            total: 1,
            percentage: 0,
          });
        }

        return { status: "FAILED", error: err.message || String(err) };
      }
    } catch (error) {
      console.error("[MAIN] Complete flow error:", error);
      return { status: "FAILED", error: error.message };
    }
  },

  async handlePauseCompleteFlow(event, reportId) {
    try {
      console.log("[MAIN] Received pause complete flow request:", reportId);
      const result = await pythonAPI.report.pauseCompleteFlow(reportId);
      console.log("[MAIN] Pause result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Pause complete flow error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleResumeCompleteFlow(event, reportId) {
    try {
      console.log("[MAIN] Received resume complete flow request:", reportId);
      const result = await pythonAPI.report.resumeCompleteFlow(reportId);
      console.log("[MAIN] Resume result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Resume complete flow error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleStopCompleteFlow(event, reportId) {
    try {
      console.log("[MAIN] Received stop complete flow request:", reportId);
      const result = await pythonAPI.report.stopCompleteFlow(reportId);
      console.log("[MAIN] Stop result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Stop complete flow error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleCreateMacros(event, reportId, macroCount, tabsNum, batchSize) {
    try {
      console.log(
        "[MAIN] Received create macros request:",
        reportId,
        macroCount,
        tabsNum,
        batchSize,
      );

      const result = await pythonAPI.report.createMacros(
        reportId,
        macroCount,
        tabsNum,
        batchSize,
      );
      console.log("Result at handler:", result);

      if (result.status === "SUCCESS") {
        return { status: "SUCCESS", message: "Macros created" };
      } else if (result.status === "FAILED") {
        return {
          status: "FAILED",
          error: result.error || "Macro creation failed",
        };
      } else {
        return {
          status: "ERROR",
          error: result.error || "Macro creation failed",
        };
      }
    } catch (error) {
      console.error("[MAIN] Create macros error:", error);
      return { status: "ERROR", error: error.message };
    }
  },

  async handleExtractAssetData(
    event,
    excelFilePathOrDialogResult,
    options = {},
  ) {
    try {
      console.log("[MAIN] handleExtractAssetData called with:", {
        excelFilePathOrDialogResult,
        options,
      });

      let excelFilePath = null;

      if (!excelFilePathOrDialogResult) {
        throw new Error("No file path provided to extract-asset-data");
      }

      if (typeof excelFilePathOrDialogResult === "string") {
        excelFilePath = excelFilePathOrDialogResult;
      } else if (
        Array.isArray(excelFilePathOrDialogResult) &&
        excelFilePathOrDialogResult.length > 0
      ) {
        excelFilePath = excelFilePathOrDialogResult[0];
      } else if (typeof excelFilePathOrDialogResult === "object") {
        if (
          Array.isArray(excelFilePathOrDialogResult.filePaths) &&
          excelFilePathOrDialogResult.filePaths.length > 0
        ) {
          excelFilePath = excelFilePathOrDialogResult.filePaths[0];
        } else if (typeof excelFilePathOrDialogResult.path === "string") {
          excelFilePath = excelFilePathOrDialogResult.path;
        } else if (typeof excelFilePathOrDialogResult.filePath === "string") {
          excelFilePath = excelFilePathOrDialogResult.filePath;
        }
      }

      if (!excelFilePath) {
        throw new Error(
          "Could not determine excel file path from the provided argument.",
        );
      }

      if (!fs.existsSync(excelFilePath)) {
        throw new Error(`Excel file not found: ${excelFilePath}`);
      }

      const result = await extractAssetDataFromExcel(excelFilePath, options);

      return result;
    } catch (err) {
      console.error(
        "[MAIN] Extract asset data error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleCreateReportsByBatch(event, batchId, tabsNum) {
    // Get the window that sent the event
    const senderWindow = BrowserWindow.fromWebContents(event.sender);

    if (!senderWindow || senderWindow.isDestroyed()) {
      return { status: "FAILED", error: "Window not available" };
    }

    // Store the cleanup function
    const unregisterProgress = () => {
      pythonAPI.workerService.unregisterProgressCallback(batchId);
    };

    try {
      // Register progress callback for the entire batch
      pythonAPI.workerService.registerProgressCallback(
        batchId,
        (progressData) => {
          console.log("[MAIN] Batch progress update:", progressData);

          // Make sure we have a valid sender window
          if (!senderWindow || senderWindow.isDestroyed()) {
            console.warn("[MAIN] Window destroyed, cannot send progress");
            unregisterProgress();
            return;
          }

          // Send progress to renderer via IPC
          senderWindow.webContents.send("create-reports-by-batch-progress", {
            ...progressData,
            batchId: batchId,
            processId: batchId,
          });
        },
      );

      // Execute the batch creation
      const result = await pythonAPI.report.createReportsByBatch(
        batchId,
        tabsNum,
      );

      // Ensure cleanup
      unregisterProgress();

      return result;
    } catch (err) {
      console.error("[MAIN] Create reports by batch error:", err);

      // Ensure cleanup on error
      unregisterProgress();

      // Also send an error progress update
      if (senderWindow && !senderWindow.isDestroyed()) {
        senderWindow.webContents.send("create-reports-by-batch-progress", {
          batchId: batchId,
          status: "FAILED",
          error: err.message,
          current: 0,
          total: 1,
          percentage: 0,
        });
      }

      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleCreateReportById(event, recordId, tabsNum) {
    try {
      // Get the window that sent the event
      const senderWindow = BrowserWindow.fromWebContents(event.sender);

      // Register progress callback for real-time updates
      pythonAPI.workerService.registerProgressCallback(
        recordId,
        (progressData) => {
          console.log(
            "[MAIN] Progress update for report:",
            recordId,
            progressData,
          );
          // Send progress to renderer via IPC
          if (senderWindow && !senderWindow.isDestroyed()) {
            senderWindow.webContents.send("submit-reports-quickly-progress", {
              ...progressData,
              reportId: recordId,
              processId: recordId,
            });
          }
        },
      );

      // Execute create report
      const result = await pythonAPI.report.createReportById(recordId, tabsNum);

      // Unregister progress callback
      pythonAPI.workerService.unregisterProgressCallback(recordId);

      return result;
    } catch (err) {
      console.error(
        "[MAIN] Create report by id error:",
        err && err.stack ? err.stack : err,
      );
      // Unregister on error
      pythonAPI.workerService.unregisterProgressCallback(recordId);
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleRetryCreateReportById(event, recordId, tabsNum) {
    try {
      return await pythonAPI.report.retryCreateReportById(recordId, tabsNum);
    } catch (err) {
      console.error(
        "[MAIN] Retry create report by id error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleRetryElRajhiReport(event, batchId, tabsNum) {
    try {
      return await pythonAPI.report.retryAlRahjiReport(batchId, tabsNum);
    } catch (err) {
      console.error(
        "[MAIN] Retry ElRajhi report error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleFinalizeMultipleReports(event, reportIds) {
    try {
      return await pythonAPI.report.finalizeMultipleReports(reportIds);
    } catch (err) {
      console.error(
        "[MAIN] Finalize multiple reports error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleRetryElRajhiReportByReportIds(event, reportIds, tabsNum) {
    try {
      return await pythonAPI.report.retryElRajhiReportByReportIds(
        reportIds,
        tabsNum,
      );
    } catch (err) {
      console.error(
        "[MAIN] Retry ElRajhi report by report ids error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleRetryElRajhiReportByRecordIds(event, recordIds, tabsNum) {
    try {
      return await pythonAPI.report.retryElRajhiReportByRecordIds(
        recordIds,
        tabsNum,
      );
    } catch (err) {
      console.error(
        "[MAIN] Retry ElRajhi report by record ids error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handlePauseElRajhiBatch(event, batchId) {
    try {
      return await pythonAPI.report.pauseElRajhiBatch(batchId);
    } catch (err) {
      console.error(
        "[MAIN] Pause ElRajhi batch error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleResumeElRajhiBatch(event, batchId) {
    try {
      return await pythonAPI.report.resumeElRajhiBatch(batchId);
    } catch (err) {
      console.error(
        "[MAIN] Resume ElRajhi batch error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleStopElRajhiBatch(event, batchId) {
    try {
      return await pythonAPI.report.stopElRajhiBatch(batchId);
    } catch (err) {
      console.error(
        "[MAIN] Stop ElRajhi batch error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleGrabMacroIds(event, reportId, tabsNum) {
    try {
      return await pythonAPI.report.grabMacroIds(reportId, tabsNum);
    } catch (err) {
      console.error(
        "[MAIN] Grab macro IDs error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handlePauseGrabMacroIds(event, reportId) {
    try {
      return await pythonAPI.report.pauseGrabMacroIds(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Pause grab macro IDs error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleResumeGrabMacroIds(event, reportId) {
    try {
      return await pythonAPI.report.resumeGrabMacroIds(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Resume grab macro IDs error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleStopGrabMacroIds(event, reportId) {
    try {
      return await pythonAPI.report.stopGrabMacroIds(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Stop grab macro IDs error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleElRajhiUploadReport(
    event,
    batchId,
    tabsNum,
    pdfOnly,
    finalizeSubmission = true,
    company = null,
  ) {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const processId = `elrajhi-filler-${batchId}`;
    const unregisterProgress = () => {
      pythonAPI.workerService.unregisterProgressCallback(processId);
    };

    try {
      if (senderWindow && !senderWindow.isDestroyed()) {
        pythonAPI.workerService.registerProgressCallback(
          processId,
          (progressData) => {
            if (!senderWindow || senderWindow.isDestroyed()) {
              unregisterProgress();
              return;
            }

            senderWindow.webContents.send("submit-reports-quickly-progress", {
              ...progressData,
              batchId,
              processId,
            });
          },
        );
      }

      const result = await pythonAPI.report.ElRajhiUploadReport(
        batchId,
        tabsNum,
        pdfOnly,
        finalizeSubmission,
        company,
      );
      unregisterProgress();
      return result;
    } catch (err) {
      unregisterProgress();
      if (senderWindow && !senderWindow.isDestroyed()) {
        senderWindow.webContents.send("submit-reports-quickly-progress", {
          batchId,
          processId,
          status: "FAILED",
          error: err.message || String(err),
          current: 0,
          total: 1,
          percentage: 0,
          message: err.message || "ElRajhi batch failed to start",
        });
      }
      console.error(
        "[MAIN] ElRajhiUploadReport error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleCheckElRajhiBatches(event, batchId, tabsNum) {
    try {
      return await pythonAPI.report.checkElrajhiBatches(batchId, tabsNum);
    } catch (err) {
      console.error(
        "[MAIN] Check ElRajhi batches error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleDownloadRegistrationCertificates(event, payload = {}) {
    try {
      const reports = Array.isArray(payload?.reports) ? payload.reports : [];
      const downloadPath = payload?.downloadPath;
      const tabsNum = payload?.tabsNum;
      return await pythonAPI.report.downloadRegistrationCertificates(
        reports,
        downloadPath,
        tabsNum,
      );
    } catch (err) {
      console.error(
        "[MAIN] Download registration certificates error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleRetryMacroIds(event, reportId, tabsNum) {
    try {
      return await pythonAPI.report.retryMacroIds(reportId, tabsNum);
    } catch (err) {
      console.error(
        "[MAIN] Retry macro IDs error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handlePauseRetryMacroIds(event, reportId) {
    try {
      return await pythonAPI.report.pauseRetryMacroIds(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Pause retry macro IDs error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleResumeRetryMacroIds(event, reportId) {
    try {
      return await pythonAPI.report.resumeRetryMacroIds(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Resume retry macro IDs error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleStopRetryMacroIds(event, reportId) {
    try {
      return await pythonAPI.report.stopRetryMacroIds(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Stop retry macro IDs error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleReuploadElRajhiReport(event, reportId) {
    try {
      return await pythonAPI.report.reuploadElrajhiReport(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Reupload ElRajhi report error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleMacroFill(event, reportId, tabsNum) {
    try {
      // Get the window that sent the event
      const senderWindow = BrowserWindow.fromWebContents(event.sender);

      // Register progress callback
      pythonAPI.workerService.registerProgressCallback(
        reportId,
        (progressData) => {
          console.log("[MAIN] Progress update:", progressData);
          // Send progress to renderer
          if (senderWindow && !senderWindow.isDestroyed()) {
            senderWindow.webContents.send("macro-fill-progress", progressData);
          }
        },
      );

      // Execute macro fill
      const result = await pythonAPI.report.macroFill(reportId, tabsNum);

      // Unregister progress callback
      pythonAPI.workerService.unregisterProgressCallback(reportId);

      return result;
    } catch (err) {
      console.error(
        "[MAIN] Macro fill error:",
        err && err.stack ? err.stack : err,
      );
      // Unregister on error
      pythonAPI.workerService.unregisterProgressCallback(reportId);
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleMacroFillRetry(
    event,
    reportId,
    tabsNum,
    recordId = null,
    assetData = null,
  ) {
    try {
      return await pythonAPI.report.macroFillRetry(
        reportId,
        tabsNum,
        recordId,
        assetData,
      );
    } catch (err) {
      console.error(
        "[MAIN] Macro fill retry error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handlePauseMacroFill(event, reportId) {
    try {
      console.log("[MAIN] Received pause macro fill request:", reportId);
      const result = await pythonAPI.report.pauseMacroFill(reportId);
      console.log("[MAIN] Pause result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Pause macro fill error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleResumeMacroFill(event, reportId) {
    try {
      console.log("[MAIN] Received resume macro fill request:", reportId);
      const result = await pythonAPI.report.resumeMacroFill(reportId);
      console.log("[MAIN] Resume result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Resume macro fill error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleStopMacroFill(event, reportId) {
    try {
      console.log("[MAIN] Received stop macro fill request:", reportId);
      const result = await pythonAPI.report.stopMacroFill(reportId);
      console.log("[MAIN] Stop result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Stop macro fill error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleFullCheck(event, reportId, tabsNum) {
    try {
      return await pythonAPI.report.fullCheck(reportId, tabsNum);
    } catch (err) {
      console.error(
        "[MAIN] Full check error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handlePauseFullCheck(event, reportId) {
    try {
      console.log("[MAIN] Received pause full check request:", reportId);
      const result = await pythonAPI.report.pauseFullCheck(reportId);
      console.log("[MAIN] Pause result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Pause full check error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleResumeFullCheck(event, reportId) {
    try {
      console.log("[MAIN] Received resume full check request:", reportId);
      const result = await pythonAPI.report.resumeFullCheck(reportId);
      console.log("[MAIN] Resume result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Resume full check error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleStopFullCheck(event, reportId) {
    try {
      console.log("[MAIN] Received stop full check request:", reportId);
      const result = await pythonAPI.report.stopFullCheck(reportId);
      console.log("[MAIN] Stop result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Stop full check error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleHalfCheck(event, reportId, tabsNum) {
    try {
      return await pythonAPI.report.halfCheck(reportId, tabsNum);
    } catch (err) {
      console.error(
        "[MAIN] Half check error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handlePauseHalfCheck(event, reportId) {
    try {
      console.log("[MAIN] Received pause half check request:", reportId);
      const result = await pythonAPI.report.pauseHalfCheck(reportId);
      console.log("[MAIN] Pause result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Pause half check error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleResumeHalfCheck(event, reportId) {
    try {
      console.log("[MAIN] Received resume half check request:", reportId);
      const result = await pythonAPI.report.resumeHalfCheck(reportId);
      console.log("[MAIN] Resume result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Resume half check error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleStopHalfCheck(event, reportId) {
    try {
      console.log("[MAIN] Received stop half check request:", reportId);
      const result = await pythonAPI.report.stopHalfCheck(reportId);
      console.log("[MAIN] Stop result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Stop half check error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async deleteReport(
    event,
    reportId,
    maxRounds,
    userId,
    companyOfficeId = null,
  ) {
    try {
      // Get the window that sent the event
      const senderWindow = BrowserWindow.fromWebContents(event.sender);

      // Register progress callback
      pythonAPI.workerService.registerProgressCallback(
        reportId,
        (progressData) => {
          console.log("[MAIN] Delete report progress update:", progressData);
          // Send progress to renderer
          if (senderWindow && !senderWindow.isDestroyed()) {
            senderWindow.webContents.send(
              "delete-report-progress",
              progressData,
            );
          }
        },
      );

      // Execute delete report
      const result = await pythonAPI.report.deleteReport(
        reportId,
        maxRounds,
        userId,
        companyOfficeId,
      );

      // Unregister progress callback
      pythonAPI.workerService.unregisterProgressCallback(reportId);

      return result;
    } catch (err) {
      console.error(
        "[MAIN] Delete report error:",
        err && err.stack ? err.stack : err,
      );
      // Unregister on error
      pythonAPI.workerService.unregisterProgressCallback(reportId);
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async deleteMultipleReports(event, reportIds, maxRounds) {
    try {
      return await pythonAPI.report.deleteMultipleReports(reportIds, maxRounds);
    } catch (err) {
      console.error(
        "[MAIN] Delete multiple reports error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async pauseDeleteReport(event, reportId) {
    try {
      return await pythonAPI.report.pauseDeleteReport(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Pause delete report error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async resumeDeleteReport(event, reportId) {
    try {
      return await pythonAPI.report.resumeDeleteReport(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Resume delete report error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async stopDeleteReport(event, reportId) {
    try {
      return await pythonAPI.report.stopDeleteReport(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Stop delete report error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async deleteIncompleteAssets(
    event,
    reportId,
    maxRounds,
    userId,
    companyOfficeId = null,
  ) {
    try {
      // Get the window that sent the event
      const senderWindow = BrowserWindow.fromWebContents(event.sender);

      // Register progress callback
      pythonAPI.workerService.registerProgressCallback(
        reportId,
        (progressData) => {
          console.log(
            "[MAIN] Delete incomplete assets progress update:",
            progressData,
          );
          // Send progress to renderer via dedicated channel
          if (senderWindow && !senderWindow.isDestroyed()) {
            senderWindow.webContents.send(
              "delete-assets-progress",
              progressData,
            );
          }
        },
      );

      // Execute delete incomplete assets
      const result = await pythonAPI.report.deleteIncompleteAssets(
        reportId,
        maxRounds,
        userId,
        companyOfficeId,
      );

      // Unregister progress callback
      pythonAPI.workerService.unregisterProgressCallback(reportId);

      return result;
    } catch (err) {
      console.error(
        "[MAIN] Delete incomplete assets error:",
        err && err.stack ? err.stack : err,
      );
      // Unregister on error
      pythonAPI.workerService.unregisterProgressCallback(reportId);
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async pauseDeleteIncompleteAssets(event, reportId) {
    try {
      return await pythonAPI.report.pauseDeleteIncompleteAssets(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Pause delete incomplete assets error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async resumeDeleteIncompleteAssets(event, reportId) {
    try {
      return await pythonAPI.report.resumeDeleteIncompleteAssets(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Resume delete incomplete assets error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async stopDeleteIncompleteAssets(event, reportId) {
    try {
      return await pythonAPI.report.stopDeleteIncompleteAssets(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Stop delete incomplete assets error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async getReportDeletions(
    event,
    userId,
    deleteType,
    page,
    limit,
    searchTerm = "",
    companyOfficeId = null,
  ) {
    try {
      return await pythonAPI.report.getReportDeletions(
        userId,
        deleteType,
        page,
        limit,
        searchTerm,
        companyOfficeId,
      );
    } catch (err) {
      console.error(
        "[MAIN] Get report deletions error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async storeReportDeletion(event, deletionData) {
    try {
      return await pythonAPI.report.storeReportDeletion(deletionData);
    } catch (err) {
      console.error(
        "[MAIN] Store report deletion error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async getValidationResults(event, userId, reportIds) {
    try {
      return await pythonAPI.report.getValidationResults(userId, reportIds);
    } catch (err) {
      console.error(
        "[MAIN] Get validation results error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async getCheckedReports(
    event,
    userId,
    page,
    limit,
    searchTerm = "",
    companyOfficeId = null,
  ) {
    try {
      return await pythonAPI.report.getCheckedReports(
        userId,
        page,
        limit,
        searchTerm,
        companyOfficeId,
      );
    } catch (err) {
      console.error(
        "[MAIN] Get checked reports error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleCancelledReport(event, reportId) {
    try {
      return await pythonAPI.report.handleCancelledReport(reportId);
    } catch (err) {
      console.error(
        "[MAIN] Handle cancelled report error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleDuplicateReport(event, recordId, company, tabsNum) {
    try {
      let resolvedCompany = company;
      let resolvedTabs = tabsNum;

      if (typeof company === "number" && tabsNum === undefined) {
        resolvedTabs = company;
        resolvedCompany = undefined;
      }

      return await pythonAPI.report.duplicateReport(
        recordId,
        resolvedCompany,
        resolvedTabs,
      );
    } catch (err) {
      console.error(
        "[MAIN] Duplicate report navigation error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handlePauseCreateMacros(event, reportId) {
    try {
      console.log("[MAIN] Received pause create macros request:", reportId);
      const result = await pythonAPI.report.pauseCreateMacros(reportId);
      console.log("[MAIN] Pause result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Pause create macros error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleResumeCreateMacros(event, reportId) {
    try {
      console.log("[MAIN] Received resume create macros request:", reportId);
      const result = await pythonAPI.report.resumeCreateMacros(reportId);
      console.log("[MAIN] Resume result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Resume create macros error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleStopCreateMacros(event, reportId) {
    try {
      console.log("[MAIN] Received stop create macros request:", reportId);
      const result = await pythonAPI.report.stopCreateMacros(reportId);
      console.log("[MAIN] Stop result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Stop create macros error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleRealEstateFormFill(
    event,
    record_id,
    pdfPath = null,
    approachSelections,
  ) {
    try {
      console.log(
        "[MAIN] Received real estate form fill request:",
        record_id,
        pdfPath,
      );
      const result = await pythonAPI.report.realEstateFormFill(
        record_id,
        pdfPath,
        approachSelections,
      );
      console.log("[MAIN] Real estate form fill result:", result);
      return result;
    } catch (err) {
      console.error(
        "[MAIN] Real estate form fill error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },

  async handleDownloadRealEstatePdf(event, reportId) {
    try {
      const res = await net.fetch(
        `http://167.71.231.64:5000/api/transactions/${reportId}/pdf`,
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match ? match[1] : `transaction-${reportId}.pdf`;

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const downloadDir = path.join(
        app.getPath("temp"),
        "taqeem-real-estate-pdfs",
      );
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }

      const filePath = path.join(downloadDir, `${reportId}-${filename}`);
      fs.writeFileSync(filePath, buffer);

      return { status: "SUCCESS", filePath, filename };
    } catch (err) {
      console.error(
        "[MAIN] Download real estate PDF error:",
        err && err.stack ? err.stack : err,
      );
      return { status: "FAILED", error: err.message || String(err) };
    }
  },
};

module.exports = reportHandlers;
