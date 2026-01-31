import React, { useState, useEffect, useMemo, use } from "react";
import { useRam } from "../context/RAMContext";
import { useValueNav } from "../context/ValueNavContext";
import {
    Search,
    CheckCircle,
    ArrowLeft,
    FileText,
    RefreshCw,
    Plus,
    Hash,
    Play,
    Database,
    FileCheck,
    Pause,
    Resume,
    StopCircle,
    Info
} from "lucide-react";

// Import your API functions
import { reportExistenceCheck } from "../../api/report"; // Adjust the import path as needed

const AssetCreate = () => {
    // Form state
    const [reportId, setReportId] = useState("");
    const [assetCount, setAssetCount] = useState("");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [creationResult, setCreationResult] = useState(null);
    const [isSuccess, setIsSuccess] = useState(false);

    // Report validation state
    const [isCheckingReport, setIsCheckingReport] = useState(false);
    const [isCheckingDB, setIsCheckingDB] = useState(false);
    const [reportExists, setReportExists] = useState(null);
    const [dbCheckResult, setDbCheckResult] = useState(null);

    // Separate error states for each button
    const [taqeemError, setTaqeemError] = useState("");
    const [dbError, setDbError] = useState("");

    // NEW: Progress and control states
    const [isCreating, setIsCreating] = useState(false);
    const [progress, setProgress] = useState(null);
    const [showControls, setShowControls] = useState(false);

    const { ramInfo } = useRam();
    const { selectedCompany } = useValueNav();
    const selectedCompanyOfficeId = useMemo(() => {
        const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
        return officeId ? String(officeId) : "";
    }, [selectedCompany]);

    // Check if form is valid
    const isFormValid = reportId.trim() && assetCount.trim();
    const canCreateAssets = isFormValid && (reportExists === true || dbCheckResult?.success === true);

    // Effect to listen for progress updates
    useEffect(() => {
        let unsubscribe = null;

        if (window.electronAPI && window.electronAPI.onCreateMacrosProgress) {
            unsubscribe = window.electronAPI.onCreateMacrosProgress((progressData) => {
                console.log("Progress update received:", progressData);
                setProgress(progressData);

                // If we receive progress, show the control buttons
                if (!showControls) {
                    setShowControls(true);
                }

                // Check if the process is completed
                if (progressData.status === 'COMPLETED' || progressData.status === 'FAILED') {
                    setIsCreating(false);
                    setTimeout(() => {
                        setShowControls(false);
                        setProgress(null);
                    }, 3000);
                }
            });
        }

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, [showControls]);

    // Handle report validation in Taqeem - matching ValidateReport component
    const handleCheckReportInTaqeem = async () => {
        if (!reportId.trim()) {
            setTaqeemError("Please enter a report ID");
            return;
        }

        setIsCheckingReport(true);
        setTaqeemError("");
        setReportExists(null);
        setDbCheckResult(null); // Clear DB result when checking Taqeem

        try {
            const result = await window.electronAPI.validateReport(
                reportId,
                null,
                selectedCompanyOfficeId || null
            );
            console.log("Full API response:", result);

            // Handle the IPC response exactly like ValidateReport component
            if (result.status === "SUCCESS") {
                setReportExists(true);
                setTaqeemError("");
            } else {
                setReportExists(false);
                setTaqeemError(result.message || "Report validation failed. Please check the ID and try again.");
            }
        } catch (err) {
            console.error("Error checking report:", err);
            setReportExists(false);
            setTaqeemError(err.message || "Error validating report. Please try again.");
        } finally {
            setIsCheckingReport(false);
        }
    };

    // NEW: Handle report existence check in Database - Direct API call
    const handleCheckReportInDB = async () => {
        if (!reportId.trim()) {
            setDbError("Please enter a report ID");
            return;
        }

        setIsCheckingDB(true);
        setDbError("");
        setDbCheckResult(null);
        setReportExists(null); // Clear Taqeem result when checking DB

        try {
            console.log(`Checking report existence in DB: ${reportId}`);

            // Direct API call to your backend
            const result = await reportExistenceCheck(reportId, selectedCompanyOfficeId || null);
            console.log("DB check result:", result);

            setDbCheckResult(result.data);

            if (result.data.success) {
                setDbError("");
            } else {
                setDbError(result.data.message || "Report not found in database. Please check the ID and try again.");
            }
        } catch (err) {
            console.error("Error checking report in DB:", err);
            setDbError(err.message || "Error checking report in database. Please try again.");
        } finally {
            setIsCheckingDB(false);
        }
    };

    // Handle asset creation - Updated to use direct API call if needed
    const handleCreateAssets = async () => {
        if (!isFormValid) {
            setError("Please complete all fields first");
            return;
        }

        const count = parseInt(assetCount);
        if (isNaN(count) || count <= 0) {
            setError("Asset count must be a positive number");
            return;
        }

        // Get tabs from RAM info or use default of 3
        const tabsNum = ramInfo?.recommendedTabs || 3;

        setError("");
        setIsLoading(true);
        setIsCreating(true);
        setShowControls(true);
        setProgress({ status: 'STARTING', message: 'Starting asset creation...' });

        try {
            console.log(`Creating assets for report: ${reportId}, count: ${count}, tabs: ${tabsNum}`);

            // Use the createMacros function from Electron API
            const result = await window.electronAPI.createMacros(reportId, count, tabsNum);
            console.log("Asset creation result:", result);

            setCreationResult(result);

            if (result.status === 'SUCCESS') {
                setIsSuccess(true);
                setIsCreating(false);
                setShowControls(false);
                setProgress(null);
            } else {
                setError(result.error || 'Failed to create assets');
                setIsCreating(false);
                setShowControls(false);
                setProgress(null);
            }
        } catch (err) {
            console.error("Error creating assets:", err);
            setError(err.message || 'An unexpected error occurred during asset creation');
            setIsCreating(false);
            setShowControls(false);
            setProgress(null);
        } finally {
            setIsLoading(false);
        }
    };

    // NEW: Handle pause asset creation
    const handlePauseCreateAssets = async () => {
        try {
            setProgress({ status: 'PAUSING', message: 'Pausing asset creation...' });
            const result = await window.electronAPI.pauseCreateMacros(reportId);
            console.log("Pause result:", result);

            if (result.status === 'SUCCESS') {
                setProgress({ status: 'PAUSED', message: 'Asset creation paused' });
                setIsCreating(false);
            } else {
                setError(result.error || 'Failed to pause asset creation');
            }
        } catch (err) {
            console.error("Error pausing asset creation:", err);
            setError(err.message || 'Failed to pause asset creation');
        }
    };

    // NEW: Handle resume asset creation
    const handleResumeCreateAssets = async () => {
        try {
            setProgress({ status: 'RESUMING', message: 'Resuming asset creation...' });
            const result = await window.electronAPI.resumeCreateMacros(reportId);
            console.log("Resume result:", result);

            if (result.status === 'SUCCESS') {
                setProgress({ status: 'IN_PROGRESS', message: 'Asset creation resumed' });
                setIsCreating(true);
            } else {
                setError(result.error || 'Failed to resume asset creation');
            }
        } catch (err) {
            console.error("Error resuming asset creation:", err);
            setError(err.message || 'Failed to resume asset creation');
        }
    };

    // NEW: Handle stop asset creation
    const handleStopCreateAssets = async () => {
        try {
            setProgress({ status: 'STOPPING', message: 'Stopping asset creation...' });
            const result = await window.electronAPI.stopCreateMacros(reportId);
            console.log("Stop result:", result);

            if (result.status === 'SUCCESS') {
                setProgress({ status: 'STOPPED', message: 'Asset creation stopped' });
                setIsCreating(false);
                setIsLoading(false);

                // Hide controls after a delay
                setTimeout(() => {
                    setShowControls(false);
                    setProgress(null);
                }, 2000);
            } else {
                setError(result.error || 'Failed to stop asset creation');
            }
        } catch (err) {
            console.error("Error stopping asset creation:", err);
            setError(err.message || 'Failed to stop asset creation');
        }
    };

    // Reset process
    const resetProcess = () => {
        setReportId("");
        setAssetCount("");
        setError("");
        setIsLoading(false);
        setCreationResult(null);
        setIsSuccess(false);
        setReportExists(null);
        setIsCheckingReport(false);
        setIsCheckingDB(false);
        setDbCheckResult(null);
        setTaqeemError("");
        setDbError("");
        setIsCreating(false);
        setProgress(null);
        setShowControls(false);
    };

    // Handle back button
    const handleBack = () => {
        resetProcess();
    };

    // Format progress message for display
    const getProgressDisplay = () => {
        if (!progress) return null;

        const statusColors = {
            STARTING: 'text-blue-600',
            IN_PROGRESS: 'text-green-600',
            PAUSING: 'text-yellow-600',
            PAUSED: 'text-yellow-600',
            RESUMING: 'text-blue-600',
            STOPPING: 'text-red-600',
            STOPPED: 'text-red-600',
            COMPLETED: 'text-green-600',
            FAILED: 'text-red-600'
        };

        const statusIcons = {
            STARTING: <RefreshCw className="w-4 h-4 animate-spin" />,
            IN_PROGRESS: <RefreshCw className="w-4 h-4 animate-spin" />,
            PAUSING: <Pause className="w-4 h-4" />,
            PAUSED: <Pause className="w-4 h-4" />,
            RESUMING: <RefreshCw className="w-4 h-4 animate-spin" />,
            STOPPING: <StopCircle className="w-4 h-4" />,
            STOPPED: <StopCircle className="w-4 h-4" />,
            COMPLETED: <CheckCircle className="w-4 h-4" />,
            FAILED: <FileText className="w-4 h-4" />
        };

        return (
            <div className={`flex items-center gap-2 ${statusColors[progress.status] || 'text-gray-600'}`}>
                {statusIcons[progress.status] || <RefreshCw className="w-4 h-4" />}
                <span className="font-medium">{progress.message}</span>
                {progress.current && progress.total && (
                    <span className="text-sm">
                        ({progress.current}/{progress.total})
                    </span>
                )}
            </div>
        );
    };

    // Get the tabs count to display
    const getTabsCount = () => {
        return ramInfo?.recommendedTabs || 3;
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
            <div className="max-w-2xl mx-auto px-4">
                {/* Header */}
                <div className="text-center mb-8">
                    <button
                        onClick={handleBack}
                        className="flex items-center gap-2 text-blue-600 hover:text-blue-800 mb-4 mx-auto transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>
                    <h1 className="text-3xl font-bold text-gray-800 mb-2">🛠️ Asset Creation</h1>
                    <p className="text-gray-600">Create new assets for an existing report</p>
                </div>

                {/* Main Content Area */}
                <div className="bg-white rounded-2xl shadow-lg p-6">
                    {isSuccess ? (
                        /* Success State */
                        <div className="space-y-6">
                            <div className="text-center">
                                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <CheckCircle className="w-8 h-8 text-green-600" />
                                </div>
                                <h2 className="text-2xl font-bold text-green-800 mb-2">Success!</h2>
                                <p className="text-green-600 mb-4">Your assets have been created successfully</p>
                            </div>

                            <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                                <h3 className="text-xl font-semibold text-green-800 mb-4 text-center">Assets Created Successfully!</h3>
                                <p className="text-green-600 mb-2 text-center">Report ID: <strong>{reportId}</strong></p>

                                <div className="bg-white rounded-lg p-4 max-w-md mx-auto mb-4">
                                    <h4 className="font-medium text-gray-800 mb-3 text-center">Creation Details:</h4>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-gray-600">Tabs Used:</span>
                                            <span className="font-medium">{getTabsCount()}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-600">Asset Count:</span>
                                            <span className="font-medium">{assetCount}</span>
                                        </div>
                                        {creationResult?.data?.status && (
                                            <div className="flex justify-between">
                                                <span className="text-gray-600">Status:</span>
                                                <span className="font-medium text-green-600">{creationResult.data.status}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <p className="text-green-600 mb-6 text-center">The assets have been successfully created and added to your report.</p>

                                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                                    <button
                                        onClick={resetProcess}
                                        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
                                    >
                                        View Reports
                                    </button>
                                    <button
                                        onClick={resetProcess}
                                        className="px-6 py-3 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-lg font-semibold transition-colors"
                                    >
                                        Create New Assets
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Main Form */
                        <div className="space-y-6">
                            <div className="text-center mb-6">
                                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <Plus className="w-6 h-6 text-blue-600" />
                                </div>
                                <h2 className="text-2xl font-bold text-gray-800 mb-2">Create Assets</h2>
                                <p className="text-gray-600">Enter the report details to create new assets</p>
                            </div>

                            <div className="space-y-6">
                                {/* Report ID Input with Check Buttons */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        <Search className="w-4 h-4 inline mr-1" />
                                        Report ID *
                                    </label>
                                    <div className="flex gap-3 mb-3">
                                        <input
                                            type="text"
                                            value={reportId}
                                            onChange={(e) => {
                                                setReportId(e.target.value);
                                                setReportExists(null); // Reset validation when ID changes
                                                setDbCheckResult(null);
                                                setError("");
                                                setTaqeemError("");
                                                setDbError("");
                                            }}
                                            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                                            placeholder="Enter existing report ID"
                                        />
                                    </div>

                                    {/* Check Report Buttons */}
                                    <div className="flex gap-3 mb-2">
                                        <div className="flex-1 flex flex-col">
                                            <button
                                                onClick={handleCheckReportInTaqeem}
                                                disabled={isCheckingDB || isCreating}
                                                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                                            >
                                                {isCheckingReport ? (
                                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <Search className="w-4 h-4" />
                                                )}
                                                {isCheckingReport ? "Checking..." : "Check Report in Taqeem"}
                                            </button>
                                            {/* Taqeem Error Message */}
                                            {taqeemError && (
                                                <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-3">
                                                    <div className="flex items-center gap-2">
                                                        <FileText className="w-4 h-4 text-red-500" />
                                                        <span className="text-red-700 text-sm">{taqeemError}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex-1 flex flex-col">
                                            <button
                                                onClick={handleCheckReportInDB}
                                                disabled={isCheckingReport || isCreating}
                                                className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                                            >
                                                {isCheckingDB ? (
                                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <Database className="w-4 h-4" />
                                                )}
                                                {isCheckingDB ? "Checking..." : "Check Report in DB"}
                                            </button>
                                            {/* DB Error Message */}
                                            {dbError && (
                                                <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-3">
                                                    <div className="flex items-center gap-2">
                                                        <Database className="w-4 h-4 text-red-500" />
                                                        <span className="text-red-700 text-sm">{dbError}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <p className="text-xs text-gray-500 mt-1">
                                        Enter the report ID and verify it exists before creating assets
                                    </p>

                                    {/* Report Validation Status - Taqeem */}
                                    {reportExists === true && (
                                        <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-4">
                                            <div className="flex items-center gap-3">
                                                <CheckCircle className="w-5 h-5 text-green-500" />
                                                <div>
                                                    <p className="font-medium text-green-800">Report Validated in Taqeem</p>
                                                    <p className="text-sm text-green-600">
                                                        Report ID <strong>{reportId}</strong> exists in Taqeem system.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {reportExists === false && !taqeemError && (
                                        <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                            <div className="flex items-center gap-3">
                                                <FileCheck className="w-5 h-5 text-yellow-500" />
                                                <div>
                                                    <p className="font-medium text-yellow-800">Report Not Found in Taqeem</p>
                                                    <p className="text-sm text-yellow-600">
                                                        Please check the report ID and try again.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Report Validation Status - Database */}
                                    {dbCheckResult?.success === true && (
                                        <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-4">
                                            <div className="flex items-center gap-3">
                                                <Database className="w-5 h-5 text-green-500" />
                                                <div>
                                                    <p className="font-medium text-green-800">Report Found in Database</p>
                                                    <p className="text-sm text-green-600">
                                                        Report ID <strong>{reportId}</strong> exists in the database.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {dbCheckResult?.success === false && !dbError && (
                                        <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                            <div className="flex items-center gap-3">
                                                <Database className="w-5 h-5 text-yellow-500" />
                                                <div>
                                                    <p className="font-medium text-yellow-800">Report Not Found in Database</p>
                                                    <p className="text-sm text-yellow-600">
                                                        Please check the report ID and try again.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Tabs Information Box */}
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                    <div className="flex items-start gap-3">
                                        <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                                        <div className="flex-1">
                                            <h4 className="font-medium text-blue-800 mb-1">Tabs Configuration</h4>
                                            <p className="text-blue-700 mb-2">
                                                Assets will be created using <strong className="text-blue-900">{getTabsCount()} tabs</strong> per browser instance.
                                            </p>
                                            <div className="text-xs text-blue-600">
                                                This value is automatically determined based on your system's available RAM
                                                to ensure optimal performance and stability.
                                                {ramInfo?.message && (
                                                    <div className="mt-1 italic">{ramInfo.message}</div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="bg-blue-100 text-blue-800 font-bold text-xl px-3 py-2 rounded-lg">
                                            {getTabsCount()}
                                        </div>
                                    </div>
                                </div>

                                {/* Asset Count */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        <Hash className="w-4 h-4 inline mr-1" />
                                        Asset Count *
                                    </label>
                                    <input
                                        type="number"
                                        value={assetCount}
                                        onChange={(e) => {
                                            setAssetCount(e.target.value);
                                            setError("");
                                        }}
                                        min="1"
                                        disabled={isCreating}
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed"
                                        placeholder="Enter number of assets to create"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Enter the total number of assets to create
                                    </p>
                                </div>

                                {/* Configuration Preview */}
                                {(assetCount || reportId) && (
                                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                        <h4 className="font-medium text-gray-800 mb-2">Configuration Preview:</h4>
                                        <div className="space-y-2 text-sm">
                                            {reportId && (
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Report ID:</span>
                                                    <span className="font-medium">{reportId}</span>
                                                    {(reportExists === true || dbCheckResult?.success === true) && (
                                                        <CheckCircle className="w-4 h-4 text-green-500 ml-2" />
                                                    )}
                                                    {(reportExists === false || dbCheckResult?.success === false) && (
                                                        <FileCheck className="w-4 h-4 text-yellow-500 ml-2" />
                                                    )}
                                                </div>
                                            )}
                                            <div className="flex justify-between">
                                                <span className="text-gray-600">Tabs per Browser:</span>
                                                <span className="font-medium">{getTabsCount()}</span>
                                            </div>
                                            {assetCount && (
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Asset Count:</span>
                                                    <span className="font-medium">{assetCount}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Progress Display */}
                                {progress && (
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                {getProgressDisplay()}
                                            </div>
                                            {progress.percentage !== undefined && (
                                                <div className="text-right">
                                                    <div className="text-sm text-gray-600">Progress</div>
                                                    <div className="font-bold text-blue-700">{progress.percentage}%</div>
                                                </div>
                                            )}
                                        </div>
                                        {progress.percentage !== undefined && (
                                            <div className="mt-3">
                                                <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-blue-600 rounded-full transition-all duration-300"
                                                        style={{ width: `${progress.percentage}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* General Error Display (for asset creation) */}
                                {error && (
                                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                        <div className="flex items-center gap-3">
                                            <FileText className="w-5 h-5 text-red-500" />
                                            <span className="text-red-700">{error}</span>
                                        </div>
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="flex flex-col sm:flex-row gap-3 pt-4">
                                    <button
                                        onClick={handleBack}
                                        disabled={isCreating}
                                        className="flex-1 px-6 py-3 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                                    >
                                        <ArrowLeft className="w-4 h-4" />
                                        Back
                                    </button>

                                    {!showControls ? (
                                        <button
                                            onClick={handleCreateAssets}
                                            disabled={!canCreateAssets || isCreating || isLoading}
                                            className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                                        >
                                            {isLoading ? (
                                                <RefreshCw className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <Play className="w-4 h-4" />
                                            )}
                                            {isLoading ? "Creating Assets..." : "Create Assets"}
                                        </button>
                                    ) : (
                                        <div className="flex-1 flex gap-2">
                                            {isCreating ? (
                                                <button
                                                    onClick={handlePauseCreateAssets}
                                                    className="flex-1 px-4 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                                                >
                                                    <Pause className="w-4 h-4" />
                                                    Pause
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={handleResumeCreateAssets}
                                                    className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                                                >
                                                    <RefreshCw className="w-4 h-4" />
                                                    Resume
                                                </button>
                                            )}
                                            <button
                                                onClick={handleStopCreateAssets}
                                                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                                            >
                                                <StopCircle className="w-4 h-4" />
                                                Stop
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AssetCreate;
