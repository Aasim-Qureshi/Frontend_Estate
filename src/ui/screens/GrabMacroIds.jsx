import React, { useEffect, useMemo, useState } from "react";
import { useRam } from "../context/RAMContext";
import { useValueNav } from "../context/ValueNavContext";
import {
    Download,
    CheckCircle,
    ArrowLeft,
    FileText,
    RefreshCw,
    List,
    Database,
    RotateCcw,
    Search,
    Pause,
    Play,
    StopCircle,
    Info
} from "lucide-react";

import { checkMissingPages } from "../../api/report";

const GrabMacroIds = () => {
    // Step management
    const [currentStep, setCurrentStep] = useState('report-id-input');

    // Report ID state
    const [reportId, setReportId] = useState("");

    // Error state
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [missingPagesInfo, setMissingPagesInfo] = useState(null);

    // Grabbing state
    const [isGrabbingMacros, setIsGrabbingMacros] = useState(false);
    const [isRetryingMacros, setIsRetryingMacros] = useState(false);
    const [isCheckingMissingPages, setIsCheckingMissingPages] = useState(false);
    const [grabResult, setGrabResult] = useState(null);
    const [macroIds, setMacroIds] = useState([]);

    // Control state
    const [isProcessPaused, setIsProcessPaused] = useState(false);
    const [activeProcessType, setActiveProcessType] = useState(null); // 'grab' or 'retry'

    const { ramInfo } = useRam();
    const { selectedCompany } = useValueNav();
    const selectedCompanyOfficeId = useMemo(() => {
        const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
        return officeId ? String(officeId) : "";
    }, [selectedCompany]);

    // Get the tabs count to display
    const getTabsCount = () => {
        return ramInfo?.recommendedTabs || 3;
    };

    // Handle macro IDs grabbing using Electron IPC
    const handleGrabMacroIds = async () => {
        if (!reportId.trim()) {
            setError("Please enter a report ID");
            return;
        }

        // Get tabs from RAM info or use default of 3
        const tabsNumValue = getTabsCount();

        setError("");
        setSuccessMessage("");
        setMissingPagesInfo(null);
        setIsProcessPaused(false);

        setIsGrabbingMacros(true);
        setActiveProcessType('grab');
        setCurrentStep('grabbing-in-progress');

        try {
            console.log(`Grabbing macro IDs for report: ${reportId} with tabs: ${tabsNumValue}`);

            // Use Electron IPC instead of API call
            const result = await window.electronAPI.grabMacroIds(reportId, tabsNumValue);
            console.log("Macro IDs grab result:", result);

            setGrabResult(result);

            if (result.status === "SUCCESS") {
                const ids = result?.macro_ids_with_pages || [];
                setMacroIds(Array.isArray(ids) ? ids : []);
                setCurrentStep('success');
                setSuccessMessage("Macro IDs grabbed successfully!");
            } else {
                setError(result.error || 'Failed to grab macro IDs');
                setCurrentStep('error');
            }
        } catch (err) {
            console.error("Error grabbing macro IDs:", err);
            setError(err.message || 'An unexpected error occurred while grabbing macro IDs');
            setCurrentStep('error');
        } finally {
            setIsGrabbingMacros(false);
            setActiveProcessType(null);
        }
    };

    // Handle retry macro IDs grabbing using Electron IPC
    const handleRetryGrabMacroIds = async () => {
        if (!reportId.trim()) {
            setError("Please enter a report ID");
            return;
        }

        // Get tabs from RAM info or use default of 3
        const tabsNumValue = getTabsCount();

        setError("");
        setSuccessMessage("");
        setMissingPagesInfo(null);
        setIsProcessPaused(false);

        setIsRetryingMacros(true);
        setActiveProcessType('retry');
        setCurrentStep('grabbing-in-progress');

        try {
            console.log(`Retrying grab macro IDs for report: ${reportId} with tabs: ${tabsNumValue}`);

            // Use Electron IPC retry endpoint
            const result = await window.electronAPI.retryMacroIds(reportId, tabsNumValue);
            console.log("Retry macro IDs result:", result);

            setGrabResult(result);

            if (result.status === "SUCCESS") {
                const ids = result?.macro_ids_with_pages || [];
                setMacroIds(Array.isArray(ids) ? ids : []);
                setCurrentStep('success');
                setSuccessMessage("Macro IDs retried successfully!");
            } else {
                setError(result.error || 'Failed to retry grabbing macro IDs');
                setCurrentStep('error');
            }
        } catch (err) {
            console.error("Error retrying macro IDs:", err);
            setError(err.message || 'An unexpected error occurred while retrying macro IDs');
            setCurrentStep('error');
        } finally {
            setIsRetryingMacros(false);
            setActiveProcessType(null);
        }
    };

    // Handle pause for current process
    const handlePauseProcess = async () => {
        if (!reportId || !activeProcessType) {
            setError("No active process to pause");
            return;
        }

        try {
            let result;
            if (activeProcessType === 'grab') {
                result = await window.electronAPI.pauseGrabMacroIds(reportId);
            } else if (activeProcessType === 'retry') {
                result = await window.electronAPI.pauseRetryMacroIds(reportId);
            }

            if (result?.status === "SUCCESS") {
                setIsProcessPaused(true);
                setSuccessMessage(`Process paused successfully`);
                setError("");
            } else {
                setError(result?.error || "Failed to pause process");
                setSuccessMessage("");
            }
        } catch (err) {
            console.error("Error pausing process:", err);
            setError("Failed to pause process");
            setSuccessMessage("");
        }
    };

    // Handle resume for current process
    const handleResumeProcess = async () => {
        if (!reportId || !activeProcessType) {
            setError("No active process to resume");
            return;
        }

        try {
            let result;
            if (activeProcessType === 'grab') {
                result = await window.electronAPI.resumeGrabMacroIds(reportId);
            } else if (activeProcessType === 'retry') {
                result = await window.electronAPI.resumeRetryMacroIds(reportId);
            }

            if (result?.status === "SUCCESS") {
                setIsProcessPaused(false);
                setSuccessMessage(`Process resumed successfully`);
                setError("");
            } else {
                setError(result?.error || "Failed to resume process");
                setSuccessMessage("");
            }
        } catch (err) {
            console.error("Error resuming process:", err);
            setError("Failed to resume process");
            setSuccessMessage("");
        }
    };

    // Handle stop for current process
    const handleStopProcess = async () => {
        if (!reportId || !activeProcessType) {
            setError("No active process to stop");
            return;
        }

        try {
            let result;
            if (activeProcessType === 'grab') {
                result = await window.electronAPI.stopGrabMacroIds(reportId);
            } else if (activeProcessType === 'retry') {
                result = await window.electronAPI.stopRetryMacroIds(reportId);
            }

            if (result?.status === "SUCCESS") {
                setIsProcessPaused(false);
                setIsGrabbingMacros(false);
                setIsRetryingMacros(false);
                setActiveProcessType(null);
                setCurrentStep('report-id-input');
                setSuccessMessage(`Process stopped successfully`);
                setError("");
            } else {
                setError(result?.error || "Failed to stop process");
                setSuccessMessage("");
            }
        } catch (err) {
            console.error("Error stopping process:", err);
            setError("Failed to stop process");
            setSuccessMessage("");
        }
    };

    // Handle check missing pages
    const handleCheckMissingPages = async () => {
        if (!reportId.trim()) {
            setError("Please enter a report ID");
            return;
        }

        setError("");
        setSuccessMessage("");
        setIsCheckingMissingPages(true);

        try {
            console.log(`Checking missing pages for report: ${reportId}`);

            // Call the API function
            const result = await checkMissingPages(reportId, selectedCompanyOfficeId || null);
            console.log("Missing pages check result:", result);

            setMissingPagesInfo(result.data);

            // Show success message
            if (result.data.success) {
                if (result.data.hasMissing) {
                    setError(`Missing pages detected: ${result.data.missingPages.join(', ')}`);
                } else {
                    setError("No missing pages found! All pages are present.");
                }
            } else {
                setError("Failed to check missing pages");
            }
        } catch (err) {
            console.error("Error checking missing pages:", err);
            setError(err.message || 'An unexpected error occurred while checking missing pages');
        } finally {
            setIsCheckingMissingPages(false);
        }
    };

    // Reset process
    const resetProcess = () => {
        setCurrentStep('report-id-input');
        setReportId("");
        setError("");
        setSuccessMessage("");
        setIsGrabbingMacros(false);
        setIsRetryingMacros(false);
        setIsCheckingMissingPages(false);
        setGrabResult(null);
        setMacroIds([]);
        setMissingPagesInfo(null);
        setIsProcessPaused(false);
        setActiveProcessType(null);
    };

    // Handle back button
    const handleBack = () => {
        window.history.back();
    };

    // Handle navigation to other pages
    const handleViewReports = () => {
        console.log("Navigate to view reports");
    };

    const handleGoHome = () => {
        console.log("Navigate to home");
    };

    // Check if control buttons should be disabled
    const areControlButtonsDisabled = () => {
        return !activeProcessType || currentStep !== 'grabbing-in-progress';
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
            <div className="max-w-4xl mx-auto px-4">
                {/* Header */}
                <div className="text-center mb-8">
                    <button
                        onClick={handleBack}
                        className="flex items-center gap-2 text-blue-600 hover:text-blue-800 mb-4 mx-auto transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>
                    <h1 className="text-3xl font-bold text-gray-800 mb-2">📋 Grab Macro IDs</h1>
                    <p className="text-gray-600">Extract macro IDs from an existing report</p>
                </div>

                {/* Main Content Area */}
                <div className="bg-white rounded-2xl shadow-lg p-6">
                    {/* Step 1: Report ID Input */}
                    {currentStep === 'report-id-input' && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                    <List className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-semibold text-gray-800">Enter Report Details</h2>
                                    <p className="text-gray-600">Provide the report ID to extract macro IDs from</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {/* Report ID Input */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Report ID *
                                    </label>
                                    <input
                                        type="text"
                                        value={reportId}
                                        onChange={(e) => {
                                            setReportId(e.target.value);
                                            setError("");
                                            setSuccessMessage("");
                                            setMissingPagesInfo(null);
                                        }}
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                                        placeholder="Enter report ID"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        The ID of the report to extract macro IDs from
                                    </p>
                                </div>

                                {/* Tabs Information Box */}
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                    <div className="flex items-start gap-3">
                                        <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                                        <div className="flex-1">
                                            <h4 className="font-medium text-blue-800 mb-1">Processing Configuration</h4>
                                            <p className="text-blue-700 mb-2">
                                                Macro IDs will be grabbed using <strong className="text-blue-900">{getTabsCount()} parallel tabs</strong> per browser instance.
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

                                {/* Success Message */}
                                {successMessage && (
                                    <div className="rounded-lg p-4 bg-green-50 border border-green-200">
                                        <div className="flex items-center gap-3">
                                            <CheckCircle className="w-5 h-5 text-green-500" />
                                            <span className="text-green-700">{successMessage}</span>
                                        </div>
                                    </div>
                                )}

                                {/* Error Message */}
                                {error && !error.includes("No missing pages found") && (
                                    <div className="rounded-lg p-4 bg-red-50 border border-red-200">
                                        <div className="flex items-center gap-3">
                                            <FileText className="w-5 h-5 text-red-500" />
                                            <span className="text-red-700">{error}</span>
                                        </div>
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                                    <button
                                        onClick={handleGrabMacroIds}
                                        disabled={!reportId.trim() || isGrabbingMacros || isRetryingMacros || isCheckingMissingPages}
                                        className="px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-semibold flex items-center gap-2 transition-colors"
                                    >
                                        {isGrabbingMacros ? (
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Download className="w-4 h-4" />
                                        )}
                                        {isGrabbingMacros ? "Grabbing..." : "Grab Macro IDs"}
                                    </button>

                                    <button
                                        onClick={handleRetryGrabMacroIds}
                                        disabled={!reportId.trim() || isGrabbingMacros || isRetryingMacros || isCheckingMissingPages}
                                        className="px-8 py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-400 text-white rounded-lg font-semibold flex items-center gap-2 transition-colors"
                                    >
                                        {isRetryingMacros ? (
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <RotateCcw className="w-4 h-4" />
                                        )}
                                        {isRetryingMacros ? "Retrying..." : "Retry Grab"}
                                    </button>

                                    <button
                                        onClick={handleCheckMissingPages}
                                        disabled={!reportId.trim() || isGrabbingMacros || isRetryingMacros || isCheckingMissingPages}
                                        className="px-8 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg font-semibold flex items-center gap-2 transition-colors"
                                    >
                                        {isCheckingMissingPages ? (
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Search className="w-4 h-4" />
                                        )}
                                        {isCheckingMissingPages ? "Checking..." : "Check Missing Pages"}
                                    </button>
                                </div>

                                {/* Missing Pages Info Display */}
                                {error && error.includes("No missing pages found") && (
                                    <div className="rounded-lg p-4 bg-green-50 border border-green-200">
                                        <div className="flex items-center gap-3">
                                            <CheckCircle className="w-5 h-5 text-green-500" />
                                            <span className="text-green-700">{error}</span>
                                        </div>

                                        {/* Display missing pages details if available */}
                                        {missingPagesInfo?.hasMissing && missingPagesInfo.missingPages.length > 0 && (
                                            <div className="mt-3 pl-8">
                                                <p className="text-sm font-medium text-gray-700 mb-1">Missing Pages:</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {missingPagesInfo.missingPages.map((page, index) => (
                                                        <span
                                                            key={index}
                                                            className="px-3 py-1 bg-red-100 text-red-800 text-sm rounded-full font-medium"
                                                        >
                                                            Page {page}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Information Box */}
                                <div className="bg-gray-100 border border-gray-300 rounded-lg p-4">
                                    <div className="flex items-center gap-3">
                                        <Database className="w-5 h-5 text-gray-500" />
                                        <div>
                                            <p className="font-medium text-gray-800">What this does:</p>
                                            <p className="text-sm text-gray-600">
                                                Extracts all macro IDs from the specified report and displays them in a list format for easy copying or downloading.
                                                The process uses parallel tabs for optimal performance.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Grabbing In Progress */}
                    {currentStep === 'grabbing-in-progress' && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                    <RefreshCw className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-semibold text-gray-800">
                                        {activeProcessType === 'retry' ? 'Retrying Macro IDs' : 'Grabbing Macro IDs'}
                                    </h2>
                                    <p className="text-gray-600">
                                        {isProcessPaused ? 'Process is paused. Click Resume to continue.' : 'Processing in progress...'}
                                    </p>
                                </div>
                            </div>

                            {/* Control Buttons */}
                            <div className="flex flex-wrap gap-3 justify-center mb-6">
                                <button
                                    onClick={handlePauseProcess}
                                    disabled={areControlButtonsDisabled() || isProcessPaused}
                                    className="px-6 py-3 bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-300 text-white rounded-lg font-semibold flex items-center gap-2 transition-colors"
                                >
                                    <Pause className="w-4 h-4" />
                                    Pause
                                </button>

                                <button
                                    onClick={handleResumeProcess}
                                    disabled={areControlButtonsDisabled() || !isProcessPaused}
                                    className="px-6 py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-lg font-semibold flex items-center gap-2 transition-colors"
                                >
                                    <Play className="w-4 h-4" />
                                    Resume
                                </button>

                                <button
                                    onClick={handleStopProcess}
                                    disabled={areControlButtonsDisabled()}
                                    className="px-6 py-3 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white rounded-lg font-semibold flex items-center gap-2 transition-colors"
                                >
                                    <StopCircle className="w-4 h-4" />
                                    Stop
                                </button>
                            </div>

                            {/* Success/Error Messages */}
                            {successMessage && (
                                <div className="rounded-lg p-4 bg-green-50 border border-green-200">
                                    <div className="flex items-center gap-3">
                                        <CheckCircle className="w-5 h-5 text-green-500" />
                                        <span className="text-green-700">{successMessage}</span>
                                    </div>
                                </div>
                            )}

                            {error && (
                                <div className="rounded-lg p-4 bg-red-50 border border-red-200">
                                    <div className="flex items-center gap-3">
                                        <FileText className="w-5 h-5 text-red-500" />
                                        <span className="text-red-700">{error}</span>
                                    </div>
                                </div>
                            )}

                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
                                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    {isProcessPaused ? (
                                        <Pause className="w-8 h-8 text-blue-600" />
                                    ) : (
                                        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
                                    )}
                                </div>
                                <h3 className="text-xl font-semibold text-blue-800 mb-2">
                                    {isProcessPaused ? 'Process Paused' : 'Processing Report'}
                                </h3>
                                <p className="text-blue-600 mb-4">
                                    {isProcessPaused
                                        ? `The ${activeProcessType === 'retry' ? 'retry' : 'grab'} process for report ${reportId} is paused. Click Resume to continue.`
                                        : `${activeProcessType === 'retry' ? 'Retrying' : 'Grabbing'} macro IDs from report ${reportId} using ${getTabsCount()} parallel tab${getTabsCount() !== 1 ? 's' : ''}. Please wait...`}
                                </p>

                                {/* Status Indicator */}
                                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${isProcessPaused ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>
                                    <div className={`w-2 h-2 rounded-full ${isProcessPaused ? 'bg-yellow-500' : 'bg-blue-500'}`}></div>
                                    <span className="font-medium">
                                        {isProcessPaused ? 'PAUSED' : 'IN PROGRESS'}
                                    </span>
                                </div>
                            </div>

                            {/* Information Box */}
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                <p className="text-gray-700">
                                    <strong>Note:</strong> You can pause the process at any time and resume it later.
                                    Clicking "Stop" will cancel the current operation and return you to the input screen.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Success */}
                    {currentStep === 'success' && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-semibold text-gray-800">Success!</h2>
                                    <p className="text-gray-600">Macro IDs have been extracted successfully</p>
                                </div>
                            </div>

                            <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                                <div className="text-center mb-6">
                                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <CheckCircle className="w-8 h-8 text-green-600" />
                                    </div>
                                    <h3 className="text-xl font-semibold text-green-800 mb-2">Macro IDs Extracted Successfully!</h3>
                                    <p className="text-green-600">Found <strong>{macroIds.length}</strong> macro ID{macroIds.length !== 1 ? 's' : ''}</p>
                                </div>

                                {/* Macro IDs List */}
                                {macroIds.length > 0 ? (
                                    <div className="space-y-4">
                                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-96 overflow-y-auto">
                                            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-200 mb-2">
                                                <div className="col-span-1">#</div>
                                                <div className="col-span-8">Macro ID</div>
                                                <div className="col-span-3">Page</div>
                                            </div>
                                            <div className="space-y-1">
                                                {macroIds.map((macroData, index) => {
                                                    const [macroId, pageNumber] = macroData;
                                                    return (
                                                        <div
                                                            key={index}
                                                            className="grid grid-cols-12 gap-2 items-center p-2 bg-white rounded border border-gray-200"
                                                        >
                                                            <div className="col-span-1 text-xs text-gray-500 text-center">
                                                                {index + 1}
                                                            </div>
                                                            <div className="col-span-8">
                                                                <code className="text-sm font-mono text-gray-800 break-all">
                                                                    {macroId}
                                                                </code>
                                                            </div>
                                                            <div className="col-span-3 text-sm text-gray-600 text-center">
                                                                Page {pageNumber}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
                                        <p className="text-yellow-700">
                                            No macro IDs found in report <strong>{reportId}</strong>
                                        </p>
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
                                    <button
                                        onClick={handleViewReports}
                                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
                                    >
                                        View Reports
                                    </button>
                                    <button
                                        onClick={resetProcess}
                                        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
                                    >
                                        Grab More Macro IDs
                                    </button>
                                    <button
                                        onClick={handleGoHome}
                                        className="px-6 py-3 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-lg font-semibold transition-colors"
                                    >
                                        Go Home
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Error State */}
                    {currentStep === 'error' && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                                    <FileText className="w-5 h-5 text-red-600" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-semibold text-gray-800">Error</h2>
                                    <p className="text-gray-600">There was an issue extracting macro IDs</p>
                                </div>
                            </div>

                            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
                                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <FileText className="w-8 h-8 text-red-600" />
                                </div>
                                <h3 className="text-xl font-semibold text-red-800 mb-2">Failed to Extract Macro IDs</h3>
                                <p className="text-red-600 mb-4">{error}</p>

                                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                                    <button
                                        onClick={() => setCurrentStep('report-id-input')}
                                        className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
                                    >
                                        Try Again
                                    </button>
                                    <button
                                        onClick={resetProcess}
                                        className="px-6 py-3 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-lg font-semibold transition-colors"
                                    >
                                        Start Over
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GrabMacroIds;
