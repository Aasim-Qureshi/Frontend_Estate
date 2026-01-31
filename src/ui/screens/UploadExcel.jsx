import React, { useState, useMemo } from "react";
import {
    ArrowLeft,
    Upload,
    AlertTriangle,
    RefreshCw,
    Table,
    FileText,
    X,
    CheckCircle,
    AlertCircle
} from "lucide-react";
import { uploadAssetDataToDatabase } from "../../api/report";
import { useValueNav } from "../context/ValueNavContext";

const UploadExcel = () => {
    const { selectedCompany } = useValueNav();
    const selectedCompanyOfficeId = useMemo(() => {
        const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
        return officeId ? String(officeId) : "";
    }, [selectedCompany]);
    const [report_id, setReportId] = useState("");
    const [excelFileName, setExcelFileName] = useState(null);
    const [excelFilePath, setExcelFilePath] = useState(null);
    const [previewData, setPreviewData] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [uploadLoading, setUploadLoading] = useState(false);

    // Updated table headings to match backend field names
    const tableHeadings = [
        'asset_name',
        'asset_usage_id',
        'market_approach',
        'market_approach_value',
        'cost_approach',
        'cost_approach_value',
        'region',
        'city',
        'inspection_date'
    ];

    const openFileDialogAndExtract = async () => {
        try {
            setError("");
            setSuccess("");
            setPreviewData(null);

            const dlgResult = await window.electronAPI.showOpenDialog();

            if (!dlgResult) {
                return;
            }

            let filePath = null;

            if (typeof dlgResult === "string") {
                filePath = dlgResult;
            } else if (Array.isArray(dlgResult) && dlgResult.length > 0 && typeof dlgResult[0] === "string") {
                filePath = dlgResult[0];
            } else if (typeof dlgResult === "object") {
                if (Array.isArray(dlgResult.filePaths) && dlgResult.filePaths.length > 0 && typeof dlgResult.filePaths[0] === "string") {
                    filePath = dlgResult.filePaths[0];
                } else if (typeof dlgResult.path === "string") {
                    filePath = dlgResult.path;
                }
            }

            if (!filePath || typeof filePath !== "string") {
                setError("Unexpected result from file dialog. Please try again.");
                return;
            }

            setExcelFilePath(filePath);
            const name = filePath.split(/[\\/]/).pop();
            setExcelFileName(name);

            setPreviewLoading(true);
            console.log("[UploadExcel] calling extract-asset-data for", filePath);

            const result = await window.electronAPI.extractAssetData(filePath, { cleanup: false });

            console.log("[UploadExcel] extract-asset-data result:", result);

            const preview = result?.data ?? null;
            if (!preview) {
                setError("No preview data returned from extract-asset-data.");
                setPreviewData(null);
            } else {
                const processedData = processPreviewData(Array.isArray(preview) ? preview : [preview]);
                setPreviewData(processedData);
                const info = result?.info || {};
                setSuccess(`Successfully extracted ${processedData.length} records (${info.marketCount || 0} market approach, ${info.costCount || 0} cost approach)`);
            }
        } catch (err) {
            console.error("[UploadExcel] error extracting preview:", err);
            setError(err?.message || "Failed to extract preview via IPC");
            setPreviewData(null);
        } finally {
            setPreviewLoading(false);
        }
    };

    // Process preview data to match backend field names
    const processPreviewData = (data) => {
        if (!data || !Array.isArray(data)) return [];

        return data.map(item => {
            const processed = { ...item };

            // Remove baseData column if it exists
            if (processed.baseData !== undefined) {
                delete processed.baseData;
            }

            // Map fields to match backend field names exactly - REMOVE THE '-' DEFAULTS
            const mappedData = {
                // Basic asset fields
                'asset_name': processed.asset_name || processed.assetName,
                'asset_usage_id': String(
                    processed.asset_usage_id ?? processed.assetUsageId ?? ""
                ),

                // Market approach fields
                'market_approach': processed.market_approach || processed.marketApproach ||
                    (processed.approach_type === 'market' ? 'Market' : undefined),
                'market_approach_value': processed.market_approach_value || processed.marketApproachValue ||
                    (processed.approach_type === 'market' ? processed.final_value || processed.finalValue : undefined),

                // Cost approach fields  
                'cost_approach': processed.cost_approach || processed.costApproach ||
                    (processed.approach_type === 'cost' ? 'Cost' : undefined),
                'cost_approach_value': processed.cost_approach_value || processed.costApproachValue ||
                    processed.cost_value || processed.costValue ||
                    (processed.approach_type === 'cost' ? processed.final_value || processed.finalValue : undefined),

                // Location fields
                'region': processed.region || processed.Region || processed.location_region,
                'city': processed.city || processed.City || processed.location_city,

                // Date field
                'inspection_date': processed.inspection_date || processed.inspectionDate || processed.date,

                // Additional fields that might be needed for backend
                'asset_type': processed.asset_type || processed.assetType || '0',
                'production_capacity': processed.production_capacity || processed.productionCapacity || '0',
                'production_capacity_measuring_unit': processed.production_capacity_measuring_unit || processed.productionCapacityMeasuringUnit || '0',
                'product_type': processed.product_type || processed.productType || '0',
                'country': processed.country || processed.Country || 'المملكة العربية السعودية',
                'submitState': processed.submitState || 0,
                'final_value': processed.final_value || processed.finalValue
            };

            // Remove any undefined values to prevent storing them
            Object.keys(mappedData).forEach(key => {
                if (mappedData[key] === undefined || mappedData[key] === null) {
                    delete mappedData[key];
                }
            });

            return mappedData;
        });
    };

    const handleUploadToDB = async () => {
        try {
            setError("");
            setSuccess("");
            setUploadLoading(true);

            if (!report_id.trim()) {
                setError("Report ID is required");
                return;
            }

            if (!previewData || previewData.length === 0) {
                setError("No data to upload");
                return;
            }

            console.log("[UploadExcel] Uploading to DB:", {
                report_id,
                recordCount: previewData.length,
                data: previewData
            });

            // Use the API function instead of Electron IPC
            const result = await uploadAssetDataToDatabase(
                report_id.trim(),
                previewData,
                selectedCompanyOfficeId || null
            );

            console.log("[UploadExcel] Upload successful:", result);

            setSuccess(`Successfully uploaded ${previewData.length} records to database with Report ID: ${report_id}`);

        } catch (err) {
            console.error("[UploadExcel] error uploading to DB:", err);
            setError(err?.message || "Failed to upload data to database");
        } finally {
            setUploadLoading(false);
        }
    };

    const removeFile = () => {
        setExcelFileName(null);
        setExcelFilePath(null);
        setPreviewData(null);
        setError("");
        setSuccess("");
    };

    const formatValue = (v) => {
        if (v === null || v === undefined || v === '-') return "-";
        if (typeof v === "boolean") return v ? "Yes" : "No";
        if (typeof v === "object") {
            if (v.value !== undefined) return formatValue(v.value);
            return JSON.stringify(v);
        }

        // Format numeric values that look like currency
        if (typeof v === "string" && /^\d+$/.test(v) && v.length > 3) {
            const num = parseInt(v);
            if (num > 1000) {
                return new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                }).format(num);
            }
        }

        // Format inspection dates and other dates
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
            return new Date(v).toLocaleDateString();
        }

        return String(v);
    };

    // Helper function to convert snake_case to Title Case for display
    const formatColumnName = (columnName) => {
        return columnName
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    };

    const PreviewTable = ({ data }) => {
        if (!data || data.length === 0) return (
            <div className="p-6 text-center text-gray-500 border-2 border-dashed rounded-lg">
                <FileText className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                <div>No preview data to display</div>
            </div>
        );

        const displayData = data.slice(0, 50);

        return (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-3">
                        <Table className="w-5 h-5 text-blue-600" />
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">Data Preview</h3>
                            <p className="text-sm text-gray-600">
                                Showing {displayData.length} of {data.length} records
                                {displayData.length < data.length && " (first 50 rows)"}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleUploadToDB}
                        disabled={uploadLoading}
                        className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
                    >
                        {uploadLoading ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                            <CheckCircle className="w-4 h-4" />
                        )}
                        {uploadLoading ? "Uploading..." : "Upload to Database"}
                    </button>
                </div>

                <div className="max-h-96 overflow-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                {tableHeadings.map(column => (
                                    <th
                                        key={column}
                                        className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider border-r border-gray-200 last:border-r-0"
                                    >
                                        {formatColumnName(column)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {displayData.map((row, rowIndex) => (
                                <tr
                                    key={rowIndex}
                                    className="hover:bg-gray-50 transition-colors"
                                >
                                    {tableHeadings.map(column => (
                                        <td
                                            key={column}
                                            className="px-4 py-3 text-sm text-gray-900 border-r border-gray-100 last:border-r-0 whitespace-nowrap"
                                        >
                                            {formatValue(row[column])}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
                    <div className="flex justify-between items-center">
                        <span>Columns: {tableHeadings.length}</span>
                        <span>Total rows: {data.length}</span>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-6xl mx-auto">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-8 text-white">
                        <div className="flex items-center gap-3 mb-2">
                            <Table className="w-8 h-8" />
                            <h1 className="text-3xl font-bold">Excel Data Upload</h1>
                        </div>
                        <p className="text-blue-100 text-lg">
                            Upload and preview Excel files with asset valuation data
                        </p>
                    </div>

                    {/* Main Content */}
                    <div className="p-6 space-y-6">
                        {/* Report ID Section - Now Required */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <label className="block text-sm font-medium text-blue-900 mb-2">
                                Report ID <span className="text-red-500">*</span>
                            </label>
                            <input
                                value={report_id}
                                onChange={e => setReportId(e.target.value)}
                                placeholder="Enter report identifier (required)..."
                                className="w-full max-w-md border border-blue-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            {!report_id.trim() && (
                                <div className="flex items-center gap-1 mt-2 text-red-600 text-sm">
                                    <AlertCircle className="w-4 h-4" />
                                    Report ID is required for upload
                                </div>
                            )}
                        </div>

                        {/* File Selection Section */}
                        <div className="border border-gray-200 rounded-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold text-gray-900">File Selection</h2>
                                {excelFileName && (
                                    <button
                                        onClick={removeFile}
                                        className="text-red-600 hover:text-red-700 flex items-center gap-1 text-sm font-medium"
                                    >
                                        <X className="w-4 h-4" />
                                        Remove File
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center gap-4 mb-4">
                                <button
                                    onClick={openFileDialogAndExtract}
                                    disabled={previewLoading}
                                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
                                >
                                    {previewLoading ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Upload className="w-4 h-4" />
                                    )}
                                    {previewLoading ? "Processing..." : "Select Excel File"}
                                </button>

                                <div className="flex-1">
                                    {excelFileName ? (
                                        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                            <FileText className="w-4 h-4 text-green-600" />
                                            <span className="text-sm font-medium text-green-800">
                                                Selected: <strong>{excelFileName}</strong>
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-gray-500 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                                            No file selected
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Info Note */}
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                                <div className="flex gap-3 items-start">
                                    <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
                                    <div className="text-sm">
                                        <div className="font-medium text-amber-800 mb-1">API Integration Active</div>
                                        <ul className="text-amber-700 space-y-1 list-disc list-inside">
                                            <li>Using HTTP API for database upload</li>
                                            <li>Report ID is required</li>
                                            <li>Data will be sent to backend server</li>
                                            <li>Check console for detailed request/response</li>
                                            <li>Field names now match backend exactly</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Status Messages */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-red-700">
                                    <AlertTriangle className="w-4 h-4" />
                                    <span className="font-medium">Error:</span>
                                    <span>{error}</span>
                                </div>
                            </div>
                        )}

                        {success && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-green-700">
                                    <CheckCircle className="w-4 h-4" />
                                    <span className="font-medium">Success:</span>
                                    <span>{success}</span>
                                </div>
                            </div>
                        )}

                        {/* Preview Section */}
                        <div>
                            {previewLoading ? (
                                <div className="flex items-center justify-center gap-3 p-8 bg-white border border-gray-200 rounded-lg">
                                    <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
                                    <div className="text-gray-600">
                                        <div className="font-medium">Extracting data...</div>
                                        <div className="text-sm">Processing your Excel file</div>
                                    </div>
                                </div>
                            ) : previewData ? (
                                <PreviewTable data={previewData} />
                            ) : (
                                <div className="text-center p-8 bg-white border-2 border-dashed border-gray-300 rounded-lg">
                                    <Table className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                                    <div className="text-gray-500">
                                        <div className="font-medium mb-1">No preview available</div>
                                        <div className="text-sm">Select an Excel file to see data preview</div>
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

export default UploadExcel;
