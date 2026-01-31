import React, { useMemo, useState } from "react";
import {
    CheckCircle,
    ArrowLeft,
    MapPin,
    Calendar,
    AlertTriangle,
    RefreshCw,
    Eye,
    EyeOff,
    User
} from "lucide-react";
import { addCommonFields } from "../../api/report";
import { useValueNav } from "../context/ValueNavContext";

// Saudi Arabia regions and cities data
const saudiRegions = {
    "منطقة الرياض": ["الرياض", "الدرعية", "ضرما", "المزاحمية", "شقراء", "الدوادمي", "وادي الدواسر"],
    "مكة المكرمة": ["مكة المكرمة", "جدة", "الطائف", "القنفذة", "الليث", "رابغ"],
    "المدينة المنورة": ["المدينة المنورة", "ينبع", "العلا", "المهد", "الحناكية"],
    "القصيم": ["بريدة", "عنيزة", "الرس", "المذنب", "البكيرية", "البدائع"],
    "الشرقية": ["الدمام", "الخبر", "الأحساء", "الجبيل", "القطيف", "حفر الباطن"],
    "عسير": ["أبها", "خميس مشيط", "بيشة", "النماص", "ظهران الجنوب"],
    "تبوك": ["تبوك", "الوجه", "ضباء", "تيماء", "أملج"],
    "حائل": ["حائل", "بقعاء", "الغزالة", "الشنان"],
    "الحدود الشمالية": ["عرعر", "رفحاء", "طريف", "العويقيلة"],
    "جازان": ["جازان", "صبيا", "أبو عريش", "صامطة", "بيش", "الدرب"],
    "نجران": ["نجران", "شرورة", "حبونا", "بدر الجنوب"],
    "الباحة": ["الباحة", "بلجرشي", "المندق", "المخواة", "قلوة"],
    "الجوف": ["سكاكا", "القريات", "دومة الجندل", "طبرجل"]
};

const AddCommonFields = () => {

    const { selectedCompany } = useValueNav();
    const selectedCompanyOfficeId = useMemo(() => {
        const officeId = selectedCompany?.officeId || selectedCompany?.office_id;
        return officeId ? String(officeId) : "";
    }, [selectedCompany]);

    // Form state
    const [reportId, setReportId] = useState("");
    const [inspectionDate, setInspectionDate] = useState("");
    const [region, setRegion] = useState("");
    const [city, setCity] = useState("");
    const [ownerName, setOwnerName] = useState("");
    const [availableCities, setAvailableCities] = useState([]);

    const [isUpdating, setIsUpdating] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);
    const [updateResult, setUpdateResult] = useState(null);
    const [showAssetPreview, setShowAssetPreview] = useState(false);

    // Handle region change
    const handleRegionChange = (e) => {
        const selectedRegion = e.target.value;
        setRegion(selectedRegion);
        setCity(""); // Reset city when region changes

        if (selectedRegion && saudiRegions[selectedRegion]) {
            setAvailableCities(saudiRegions[selectedRegion]);
        } else {
            setAvailableCities([]);
        }
    };

    // Handle form submission
    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!reportId.trim()) {
            setError("Report ID is required");
            return;
        }

        if (!inspectionDate) {
            setError("Inspection date is required");
            return;
        }

        if (!region || !city) {
            setError("Both region and city are required");
            return;
        }

        setError("");
        setIsUpdating(true);

        try {
            console.log(`Adding common fields to report: ${reportId}`);
            console.log(`Fields - Date: ${inspectionDate}, Region: ${region}, City: ${city}, Owner: ${ownerName}`);

            const result = await addCommonFields(
                reportId,
                inspectionDate,
                region,
                city,
                ownerName,
                selectedCompanyOfficeId || null
            );
            console.log("Add common fields result:", result);

            setUpdateResult(result.data);

            if (result.data.success) {
                setSuccess(true);
            } else {
                const errorMessage = result?.error ||
                    result?.message ||
                    'Failed to add common fields';
                setError(errorMessage);
            }
        } catch (err) {
            console.error("Error adding common fields:", err);
            const errorMessage = err.response?.data?.error ||
                err.response?.data?.message ||
                err.message ||
                'An unexpected error occurred while adding common fields';
            setError(errorMessage);
        } finally {
            setIsUpdating(false);
        }
    };

    // Reset form
    const resetForm = () => {
        setReportId("");
        setInspectionDate("");
        setRegion("");
        setCity("");
        setOwnerName("");
        setAvailableCities([]);
        setError("");
        setSuccess(false);
        setUpdateResult(null);
        setShowAssetPreview(false);
    };

    // Get current date in YYYY-MM-DD format for date input max attribute
    const getTodayDate = () => {
        return new Date().toISOString().split('T')[0];
    };

    // Get asset data from the response
    const assetData = updateResult?.data?.asset_data || [];

    // Function to get display value for a field
    const getDisplayValue = (value) => {
        if (value === null || value === undefined) return '-';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    };

    // Get all unique keys from asset data for table headers
    const getAllKeys = () => {
        const keys = new Set();
        assetData.forEach(asset => {
            Object.keys(asset).forEach(key => {
                keys.add(key);
            });
        });
        return Array.from(keys).sort();
    };

    if (success) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 py-8">
                <div className="max-w-6xl mx-auto px-4">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <button
                            onClick={resetForm}
                            className="flex items-center gap-2 text-green-600 hover:text-green-800 mb-4 mx-auto transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back
                        </button>
                        <h1 className="text-3xl font-bold text-gray-800 mb-2">✅ Common Fields Added</h1>
                        <p className="text-gray-600">Common fields have been successfully added to the report</p>
                    </div>

                    {/* Success Content */}
                    <div className="bg-white rounded-2xl shadow-lg p-8">
                        <div className="text-center mb-8">
                            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CheckCircle className="w-10 h-10 text-green-600" />
                            </div>
                            <h2 className="text-2xl font-semibold text-green-800 mb-2">Common Fields Added Successfully!</h2>
                            <p className="text-gray-600">The report has been updated with the common field values.</p>
                        </div>

                        {/* Summary Section */}
                        <div className="bg-gray-50 rounded-lg p-6 mb-8">
                            <h3 className="font-medium text-gray-800 mb-4 text-center">Update Summary</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-white p-4 rounded-lg border border-gray-200">
                                    <div className="text-sm text-gray-500">Report ID</div>
                                    <div className="font-semibold text-gray-800">{reportId}</div>
                                </div>
                                <div className="bg-white p-4 rounded-lg border border-gray-200">
                                    <div className="text-sm text-gray-500">Inspection Date</div>
                                    <div className="font-semibold text-green-600">{inspectionDate}</div>
                                </div>
                                <div className="bg-white p-4 rounded-lg border border-gray-200">
                                    <div className="text-sm text-gray-500">Region</div>
                                    <div className="font-semibold text-green-600">{region}</div>
                                </div>
                                <div className="bg-white p-4 rounded-lg border border-gray-200">
                                    <div className="text-sm text-gray-500">City</div>
                                    <div className="font-semibold text-green-600">{city}</div>
                                </div>
                                <div className="bg-white p-4 rounded-lg border border-gray-200">
                                    <div className="text-sm text-gray-500">Owner Name</div>
                                    <div className="font-semibold text-green-600">{ownerName || 'Not provided'}</div>
                                </div>
                                <div className="bg-white p-4 rounded-lg border border-gray-200">
                                    <div className="text-sm text-gray-500">Assets Updated</div>
                                    <div className="font-semibold text-green-600">{assetData.length} assets</div>
                                </div>
                            </div>
                        </div>

                        {/* Asset Data Preview */}
                        {assetData.length > 0 && (
                            <div className="mb-8">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-gray-800">
                                        Asset Data Preview ({assetData.length} assets)
                                    </h3>
                                    <button
                                        onClick={() => setShowAssetPreview(!showAssetPreview)}
                                        className="flex items-center gap-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors"
                                    >
                                        {showAssetPreview ? (
                                            <>
                                                <EyeOff className="w-4 h-4" />
                                                Hide Preview
                                            </>
                                        ) : (
                                            <>
                                                <Eye className="w-4 h-4" />
                                                Show Preview
                                            </>
                                        )}
                                    </button>
                                </div>

                                {showAssetPreview && (
                                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                                        <div className="max-h-96 overflow-auto">
                                            <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-gray-50 sticky top-0">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0">
                                                            #
                                                        </th>
                                                        {getAllKeys().map((key) => (
                                                            <th
                                                                key={key}
                                                                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0 whitespace-nowrap"
                                                            >
                                                                {key}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white divide-y divide-gray-200">
                                                    {assetData.map((asset, index) => (
                                                        <tr
                                                            key={asset._id || index}
                                                            className="hover:bg-gray-50 transition-colors"
                                                        >
                                                            <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                                                                {index + 1}
                                                            </td>
                                                            {getAllKeys().map((key) => (
                                                                <td
                                                                    key={key}
                                                                    className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate"
                                                                    title={getDisplayValue(asset[key])}
                                                                >
                                                                    {getDisplayValue(asset[key])}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="bg-gray-50 px-4 py-3 border-t border-gray-200">
                                            <p className="text-xs text-gray-500">
                                                Showing {assetData.length} assets. Scroll horizontally and vertically to view all data.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Additional Info */}
                        {updateResult?.message && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                                <div className="flex items-center gap-3">
                                    <MapPin className="w-5 h-5 text-blue-500" />
                                    <span className="text-blue-700">{updateResult.message}</span>
                                </div>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-6 border-t border-gray-200">
                            <button
                                onClick={resetForm}
                                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
                            >
                                Add More Common Fields
                            </button>
                            <button
                                onClick={resetForm}
                                className="px-6 py-3 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-lg font-semibold transition-colors"
                            >
                                Start Over
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
            <div className="max-w-2xl mx-auto px-4">
                {/* Header */}
                <div className="text-center mb-8">
                    <button
                        onClick={resetForm}
                        className="flex items-center gap-2 text-blue-600 hover:text-blue-800 mb-4 mx-auto transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>
                    <h1 className="text-3xl font-bold text-gray-800 mb-2">📍 Add Common Fields</h1>
                    <p className="text-gray-600">Add common inspection date, region, city, and owner name to all assets in a report</p>
                </div>

                {/* Main Form */}
                <div className="bg-white rounded-2xl shadow-lg p-8">
                    <form onSubmit={handleSubmit} className="space-y-6">
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
                                }}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                                placeholder="Enter existing report ID"
                                disabled={isUpdating}
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Enter the report ID where you want to add common fields
                            </p>
                        </div>

                        {/* Inspection Date */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Inspection Date *
                            </label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    type="date"
                                    value={inspectionDate}
                                    onChange={(e) => {
                                        setInspectionDate(e.target.value);
                                        setError("");
                                    }}
                                    max={getTodayDate()}
                                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                                    disabled={isUpdating}
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Select the inspection date for all assets
                            </p>
                        </div>

                        {/* Region Dropdown */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Region *
                            </label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <select
                                    value={region}
                                    onChange={handleRegionChange}
                                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors appearance-none bg-white"
                                    disabled={isUpdating}
                                >
                                    <option value="">Select Region</option>
                                    {Object.keys(saudiRegions).map(regionName => (
                                        <option key={regionName} value={regionName}>
                                            {regionName}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Select the region where assets are located
                            </p>
                        </div>

                        {/* City Dropdown */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                City *
                            </label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <select
                                    value={city}
                                    onChange={(e) => {
                                        setCity(e.target.value);
                                        setError("");
                                    }}
                                    disabled={!region || isUpdating}
                                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors appearance-none bg-white disabled:bg-gray-50 disabled:text-gray-400"
                                >
                                    <option value="">{region ? "Select City" : "Select region first"}</option>
                                    {availableCities.map(cityName => (
                                        <option key={cityName} value={cityName}>
                                            {cityName}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Select the city where assets are located
                            </p>
                        </div>

                        {/* Owner Name Input */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Owner Name
                            </label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    type="text"
                                    value={ownerName}
                                    onChange={(e) => {
                                        setOwnerName(e.target.value);
                                        setError("");
                                    }}
                                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                                    placeholder="Enter owner name (optional)"
                                    disabled={isUpdating}
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Enter the owner name (optional)
                            </p>
                        </div>

                        {/* Information Box */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <div className="flex items-center gap-3">
                                <MapPin className="w-5 h-5 text-blue-500" />
                                <div>
                                    <p className="font-medium text-blue-800">About This Process</p>
                                    <p className="text-sm text-blue-600">
                                        This will add the same inspection date, region, city, and owner name to all assets in the specified report.
                                        The report must already exist in the system. Owner name is optional.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Error Display */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                <div className="flex items-center gap-3">
                                    <AlertTriangle className="w-5 h-5 text-red-500" />
                                    <span className="text-red-700">{error}</span>
                                </div>
                            </div>
                        )}

                        {/* Submit Button */}
                        <div className="flex gap-4 pt-4">
                            <button
                                type="button"
                                onClick={resetForm}
                                disabled={isUpdating}
                                className="flex-1 px-6 py-3 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-100 text-gray-700 rounded-lg font-semibold transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!reportId.trim() || !inspectionDate || !region || !city || isUpdating}
                                className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                            >
                                {isUpdating ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        Adding Common Fields...
                                    </>
                                ) : (
                                    <>
                                        <MapPin className="w-4 h-4" />
                                        Add Common Fields
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default AddCommonFields;


