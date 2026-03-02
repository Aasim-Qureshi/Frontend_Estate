import React, { useMemo, useState, useEffect } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    FileText,
    FileUp,
    Loader2,
    Plus,
    Trash2,
    X,
} from "lucide-react";
import { fetchElrajhiReportById, updateUrgentReport } from "../../api/report";

const buildInitialForm = () => ({
    report_id: "",
    title: "",
    source_excel_name: "",
    batch_id: "",
    purpose_id: "",
    value_premise_id: "",
    report_type: "تقرير مفصل",
    valued_at: "",
    submitted_at: "",
    inspection_date: "",
    value: "",
    valuation_currency: "1",
    client_name: "",
    owner_name: "",
    telephone: "",
    email: "",
    region: "",
    city: "",
    asset_name: "",
    asset_usage: "",
    pdf_path: "",
    report_status: "",
    submit_state: "0",
});

const InputField = ({ label, required = false, error, className = "", ...props }) => (
    <div className={`flex flex-col ${className}`}>
        <label className="block text-[11px] font-medium text-gray-700 mb-1">
            {label} {required && <span className="text-red-500">*</span>}
        </label>
        <input
            {...props}
            className={`w-full px-2.5 py-1.5 border rounded-md text-xs leading-tight focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all ${error ? "border-red-400 bg-red-50" : "border-gray-300"
                } ${props.disabled ? "bg-gray-100 text-gray-500" : ""}`}
        />
        {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
);

const SelectField = ({ label, required = false, options, error, className = "", ...props }) => (
    <div className={`flex flex-col ${className}`}>
        <label className="block text-[11px] font-medium text-gray-700 mb-1">
            {label} {required && <span className="text-red-500">*</span>}
        </label>
        <select
            {...props}
            className={`w-full px-2.5 py-1.5 border rounded-md text-xs leading-tight focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all ${error ? "border-red-400 bg-red-50" : "border-gray-300"
                } ${props.disabled ? "bg-gray-100 text-gray-500" : ""}`}
        >
            {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
        {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
);

const Section = ({ title, children, action }) => (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
            {action}
        </div>
        {children}
    </div>
);

const EditReportModal = ({ report, isOpen, onClose, onSave, refreshData }) => {
    const [formData, setFormData] = useState(buildInitialForm());
    const [valuers, setValuers] = useState([]);
    const [errors, setErrors] = useState({});
    const [submitting, setSubmitting] = useState(false);
    const [status, setStatus] = useState(null);
    const [pdfFile, setPdfFile] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(false);

    const requiredFields = useMemo(
        () => [
            "title",
            "purpose_id",
            "value_premise_id",
            "valued_at",
            "submitted_at",
            "value",
            "client_name",
            "telephone",
            "email",
            "region",
            "city",
            "asset_name",
            "asset_usage",
            "inspection_date",
            "report_type",
        ],
        []
    );

    const formatDate = (dateString) => {
        if (!dateString) return "";
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return "";
            return date.toISOString().split("T")[0];
        } catch (error) {
            console.error("Error formatting date:", dateString, error);
            return "";
        }
    };

    const hydrateFormFromReport = (data = {}) => {
        const next = buildInitialForm();
        next.report_id = data.report_id || data.reportId || "";
        next.title = data.title || "";
        next.source_excel_name = data.source_excel_name || data.sourceExcelName || data.excel_name || "";
        next.batch_id = data.batch_id || data.batchId || "";
        next.purpose_id = data.purpose_id?.toString() || "";
        next.value_premise_id = data.value_premise_id?.toString() || "";
        next.report_type = data.report_type || "تقرير مفصل";
        next.valued_at = formatDate(data.valued_at);
        next.submitted_at = formatDate(data.submitted_at);
        next.inspection_date = formatDate(data.inspection_date);
        const rawValue = data.value ?? data.final_value;
        next.value = rawValue !== undefined && rawValue !== null ? rawValue.toString() : "";
        next.valuation_currency = data.valuation_currency?.toString() || "1";
        next.client_name = data.client_name || "";
        next.owner_name = data.owner_name || data.client_name || "";
        next.telephone = data.telephone || "";
        next.email = data.email || "";
        next.region = data.region || "";
        next.city = data.city || "";
        next.asset_name = data.asset_name || "";
        next.asset_usage = data.asset_usage || "";
        next.pdf_path = data.pdf_path || data.path_pdf || "";
        next.report_status = data.report_status || data.status || "";
        next.submit_state = typeof data.submit_state === "number"
            ? data.submit_state.toString()
            : data.submit_state || "0";

        setFormData(next);
        setValuers(Array.isArray(data.valuers) ? data.valuers : []);
    };

    const loadFullReport = async (reportIdToLoad) => {
        if (!reportIdToLoad) return;
        setLoadingDetails(true);
        try {
            const response = await fetchElrajhiReportById(reportIdToLoad);
            const fullReport = response?.report || response?.data?.report || response;
            if (fullReport) {
                hydrateFormFromReport({ ...report, ...fullReport });
            }
        } catch (err) {
            setStatus({
                type: "error",
                message: err?.response?.data?.error || err.message || "Failed to load full report details.",
            });
        } finally {
            setLoadingDetails(false);
        }
    };

    useEffect(() => {
        if (isOpen && report) {
            setStatus(null);
            setErrors({});
            setPdfFile(null);
            hydrateFormFromReport(report);
            const reportIdToLoad = report.report_id || report.reportId || report._id || report.id;
            loadFullReport(reportIdToLoad);
        }
    }, [isOpen, report]);

    const handleFieldChange = (field, value) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors((prev) => ({ ...prev, [field]: undefined }));
        }
    };

    const handleValuerChange = (index, field, value) => {
        setValuers((prev) =>
            prev.map((valuer, idx) =>
                idx === index ? { ...valuer, [field]: value } : valuer
            )
        );
    };

    const addValuer = () => {
        setValuers((prev) => [...prev, { valuerId: "", valuerName: "", percentage: "" }]);
    };

    const removeValuer = (index) => {
        setValuers((prev) => prev.filter((_, idx) => idx !== index));
    };

    const validate = () => {
        const newErrors = {};
        requiredFields.forEach((field) => {
            if (!formData[field] || formData[field].toString().trim() === "") {
                newErrors[field] = "Required";
            }
        });

        if (formData.value && Number(formData.value) <= 0) {
            newErrors.value = "Must be greater than 0";
        }

        const hasValuerData = valuers.some(
            (v) =>
                (v.valuerId && v.valuerId.toString().trim() !== "") ||
                (v.valuerName && v.valuerName.toString().trim() !== "") ||
                v.percentage
        );
        if (hasValuerData) {
            const total = valuers.reduce(
                (sum, v) => sum + Number(v.percentage || 0),
                0
            );
            if (Math.abs(total - 100) > 0.1) {
                newErrors.valuers = "Valuer percentages should total 100%";
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async () => {
        const targetReportId = formData.report_id || report?.report_id || report?.reportId || report?._id || report?.id;
        if (!targetReportId) {
            setStatus({ type: "error", message: "Report ID is missing." });
            return;
        }

        if (!validate()) {
            setStatus({ type: "error", message: "Please fill all required fields." });
            return;
        }

        try {
            setSubmitting(true);
            setStatus(null);

            const sanitizedValuers = (valuers || [])
                .map((valuer) => ({
                    valuerId: valuer.valuerId || valuer.valuer_id || "",
                    valuerName: valuer.valuerName || valuer.valuer_name || "",
                    percentage: Number(valuer.percentage || 0),
                }))
                .filter(
                    (valuer) =>
                        valuer.valuerId ||
                        valuer.valuerName ||
                        Number.isFinite(valuer.percentage)
                );

            const { report_id: formReportId, ...restForm } = formData;

            const updateData = {
                ...restForm,
                purpose_id: Number(formData.purpose_id),
                value_premise_id: Number(formData.value_premise_id),
                value: Number(formData.value),
                final_value: Number(formData.value),
                valuation_currency: formData.valuation_currency ? Number(formData.valuation_currency) : undefined,
                owner_name: formData.owner_name || formData.client_name,
                submit_state: formData.submit_state === "" ? undefined : Number(formData.submit_state),
                valuers: sanitizedValuers,
            };

            if (formReportId) {
                updateData.report_id = formReportId;
            }

            const response = await updateUrgentReport(targetReportId, updateData, { pdfFile });
            const isSuccess = response?.status !== "failed" && response?.success !== false;
            const updated = response?.report || { ...updateData, report_id: targetReportId };

            if (isSuccess) {
                setStatus({
                    type: "success",
                    message: response?.message || "Report updated successfully!",
                });

                if (onSave) {
                    await onSave(updated);
                }

                if (refreshData) {
                    await refreshData(report?.batchId || report?.batch_id || formData.batch_id);
                }

                setTimeout(() => {
                    onClose();
                }, 800);
            } else {
                setStatus({
                    type: "error",
                    message: response?.error || response?.message || "Failed to update report.",
                });
            }
        } catch (err) {
            console.error("Error updating report:", err);
            setStatus({
                type: "error",
                message: err.message || "Failed to update report. Please try again.",
            });
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[92vh] overflow-hidden flex flex-col">
                <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
                    <div className="space-y-0.5">
                        <h2 className="text-lg font-bold text-gray-900">
                            Edit Report {formData.report_id || report?.report_id}
                        </h2>
                        <p className="text-xs text-gray-600">
                            Asset: {formData.asset_name || report?.asset_name || "Unknown"}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        disabled={submitting}
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <div className="px-5 py-4 overflow-y-auto space-y-3">
                    {status && (
                        <div
                            className={`rounded-lg border px-3 py-2.5 flex items-start gap-2 text-sm ${status.type === "error"
                                    ? "border-red-200 bg-red-50 text-red-800"
                                    : status.type === "success"
                                        ? "border-green-200 bg-green-50 text-green-800"
                                        : "border-yellow-200 bg-yellow-50 text-yellow-800"
                                }`}
                        >
                            {status.type === "success" ? (
                                <CheckCircle2 className="w-4 h-4 mt-0.5" />
                            ) : (
                                <AlertTriangle className="w-4 h-4 mt-0.5" />
                            )}
                            <div className="text-xs leading-relaxed">{status.message}</div>
                        </div>
                    )}

                    {loadingDetails && (
                        <div className="flex items-center gap-2 text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading full report details...
                        </div>
                    )}

                    <Section title="Report Information">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                            <InputField
                                label="Report ID"
                                type="text"
                                value={formData.report_id}
                                disabled
                                placeholder="Report ID"
                            />
                            <InputField
                                label="Report Title"
                                required
                                type="text"
                                value={formData.title}
                                onChange={(e) => handleFieldChange("title", e.target.value)}
                                error={errors.title}
                                placeholder="Enter report title"
                            />
                            <SelectField
                                label="Report Type"
                                required
                                value={formData.report_type}
                                onChange={(e) => handleFieldChange("report_type", e.target.value)}
                                options={[
                                    { value: "تقرير مفصل", label: "Detailed Report" },
                                    { value: "ملخص التقرير", label: "Report Summary" },
                                    { value: "مراجعة مع قيمة جديدة", label: "Review with New Value" },
                                    { value: "مراجعة بدون قيمة جديدة", label: "Review without New Value" },
                                ]}
                            />
                            <SelectField
                                label="Valuation Purpose"
                                required
                                value={formData.purpose_id}
                                onChange={(e) => handleFieldChange("purpose_id", e.target.value)}
                                options={[
                                    { value: "", label: "Select" },
                                    { value: "1", label: "Selling" },
                                    { value: "2", label: "Buying" },
                                    { value: "5", label: "Rent Value" },
                                    { value: "6", label: "Insurance" },
                                    { value: "8", label: "Accounting Purposes" },
                                    { value: "9", label: "Financing" },
                                    { value: "10", label: "Disputes and Litigation" },
                                    { value: "12", label: "Tax Related Valuations" },
                                    { value: "14", label: "Other" },
                                ]}
                                error={errors.purpose_id}
                            />
                            <SelectField
                                label="Value Premise"
                                required
                                value={formData.value_premise_id}
                                onChange={(e) => handleFieldChange("value_premise_id", e.target.value)}
                                options={[
                                    { value: "", label: "Select" },
                                    { value: "1", label: "Highest and Best Use" },
                                    { value: "2", label: "Current Use" },
                                    { value: "3", label: "Orderly Liquidation" },
                                    { value: "4", label: "Forced Sale" },
                                    { value: "5", label: "Other" },
                                ]}
                                error={errors.value_premise_id}
                            />
                            <InputField
                                label="Valued At"
                                required
                                type="date"
                                value={formData.valued_at}
                                onChange={(e) => handleFieldChange("valued_at", e.target.value)}
                                error={errors.valued_at}
                            />
                            <InputField
                                label="Submitted At"
                                required
                                type="date"
                                value={formData.submitted_at}
                                onChange={(e) => handleFieldChange("submitted_at", e.target.value)}
                                error={errors.submitted_at}
                            />
                            <InputField
                                label="Valuation Value"
                                required
                                type="number"
                                value={formData.value}
                                onChange={(e) => handleFieldChange("value", e.target.value)}
                                error={errors.value}
                                placeholder="Enter value"
                                step="0.01"
                            />
                            <div className="xl:col-span-2 col-span-1 flex flex-col gap-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-2 text-[11px] text-slate-700 min-w-0">
                                        <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                                        <span className="truncate">
                                            {pdfFile
                                                ? `Selected: ${pdfFile.name}`
                                                : formData.pdf_path
                                                    ? `Current: ${formData.pdf_path}`
                                                    : "No PDF saved for this report"}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <label className="inline-flex items-center gap-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-md cursor-pointer hover:bg-blue-100 transition-colors">
                                            <FileUp className="w-4 h-4" />
                                            Replace PDF
                                            <input
                                                type="file"
                                                accept="application/pdf"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0] || null;
                                                    setPdfFile(file);
                                                    if (file) {
                                                        handleFieldChange("pdf_path", file.name || "selected.pdf");
                                                    }
                                                }}
                                            />
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.pdf_path}
                                            readOnly
                                            disabled
                                            className="flex-1 min-w-0 px-2.5 py-1.5 border border-slate-200 rounded-md text-[11px] bg-gray-100 text-gray-600"
                                            placeholder="Path saved in database"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Section>

                    <Section title="Client Information">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                            <InputField
                                label="Client Name"
                                required
                                type="text"
                                value={formData.client_name}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    handleFieldChange("client_name", value);
                                    if (!formData.owner_name || formData.owner_name === formData.client_name) {
                                        handleFieldChange("owner_name", value);
                                    }
                                }}
                                error={errors.client_name}
                                placeholder="Enter client name"
                            />
                            <InputField
                                label="Telephone"
                                required
                                type="tel"
                                value={formData.telephone}
                                onChange={(e) => handleFieldChange("telephone", e.target.value)}
                                error={errors.telephone}
                                placeholder="e.g. +966500000000"
                            />
                            <InputField
                                label="Email"
                                required
                                type="email"
                                value={formData.email}
                                onChange={(e) => handleFieldChange("email", e.target.value)}
                                error={errors.email}
                                placeholder="e.g. example@domain.com"
                            />
                        </div>
                    </Section>

                    <Section
                        title="Valuers"
                        action={
                            <button
                                type="button"
                                onClick={addValuer}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Add valuer
                            </button>
                        }
                    >
                        {errors.valuers && (
                            <p className="text-[11px] text-red-500 mb-2">{errors.valuers}</p>
                        )}
                        {valuers.length === 0 && (
                            <p className="text-[11px] text-gray-500">No valuers added.</p>
                        )}
                        <div className="space-y-2">
                            {valuers.map((valuer, idx) => (
                                <div
                                    key={`valuer-${idx}`}
                                    className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 items-end border border-slate-200 rounded-md p-2"
                                >
                                    <InputField
                                        label="Valuer ID"
                                        type="text"
                                        value={valuer.valuerId || valuer.valuer_id || ""}
                                        onChange={(e) => handleValuerChange(idx, "valuerId", e.target.value)}
                                        className="mb-0"
                                    />
                                    <InputField
                                        label="Valuer Name"
                                        type="text"
                                        value={valuer.valuerName || valuer.valuer_name || ""}
                                        onChange={(e) => handleValuerChange(idx, "valuerName", e.target.value)}
                                        className="mb-0"
                                    />
                                    <InputField
                                        label="Contribution %"
                                        type="number"
                                        value={valuer.percentage ?? valuer.contribution_percentage ?? ""}
                                        onChange={(e) => handleValuerChange(idx, "percentage", e.target.value)}
                                        className="mb-0"
                                        placeholder="0"
                                    />
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => removeValuer(idx)}
                                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Section>

                    <Section title="Asset Data">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                            <InputField
                                label="Asset Name"
                                required
                                type="text"
                                value={formData.asset_name}
                                onChange={(e) => handleFieldChange("asset_name", e.target.value)}
                                error={errors.asset_name}
                                placeholder="Enter asset name"
                            />
                            <InputField
                                label="Asset Usage"
                                required
                                type="text"
                                value={formData.asset_usage}
                                onChange={(e) => handleFieldChange("asset_usage", e.target.value)}
                                error={errors.asset_usage}
                                placeholder="Enter usage / code"
                            />
                            <InputField
                                label="Owner Name"
                                type="text"
                                value={formData.owner_name}
                                onChange={(e) => handleFieldChange("owner_name", e.target.value)}
                                placeholder="Enter owner name"
                            />
                            <InputField
                                label="Inspection Date"
                                required
                                type="date"
                                value={formData.inspection_date}
                                onChange={(e) => handleFieldChange("inspection_date", e.target.value)}
                                error={errors.inspection_date}
                            />
                            <InputField
                                label="Region"
                                required
                                type="text"
                                value={formData.region}
                                onChange={(e) => handleFieldChange("region", e.target.value)}
                                error={errors.region}
                                placeholder="Enter region"
                            />
                            <InputField
                                label="City"
                                required
                                type="text"
                                value={formData.city}
                                onChange={(e) => handleFieldChange("city", e.target.value)}
                                error={errors.city}
                                placeholder="Enter city"
                            />
                        </div>
                    </Section>
                </div>

                <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-3 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={submitting}
                        className={`px-4 py-2 text-xs font-semibold text-white rounded-md transition-colors flex items-center gap-2 ${submitting
                                ? "bg-blue-400 cursor-not-allowed"
                                : "bg-blue-600 hover:bg-blue-700"
                            }`}
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="w-4 h-4" />
                                Save Changes
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EditReportModal;
