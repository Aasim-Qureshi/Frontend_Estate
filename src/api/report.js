const httpClient = require("./httpClient")

const uploadAssetDataToDatabase = async (reportId, reportData, companyOfficeId = null) => {
    const url = `/report/createReport`;
    const payload = { reportId, reportData };
    if (companyOfficeId) {
        payload.companyOfficeId = companyOfficeId;
    }
    return await httpClient.post(url, payload);
};

const createReportWithCommonFields = async (reportId, reportData, commonFields, companyOfficeId = null) => {
    const url = `/report/createReportWithCommonFields`;
    const payload = { reportId, reportData, commonFields };
    if (companyOfficeId) {
        payload.companyOfficeId = companyOfficeId;
    }
    return await httpClient.post(url, payload);
};

const updateUrgentReport = async (reportId, reportData = {}, options = {}) => {
    const formData = new FormData();
    const { pdfFile } = options;

    formData.append("reportId", reportId);

    Object.entries(reportData || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (key === "valuers") {
            formData.append(key, JSON.stringify(value));
            return;
        }
        formData.append(key, value);
    });

    if (pdfFile) {
        formData.append("pdf", pdfFile);
    }

    const response = await httpClient.patch(
        `/elrajhi-upload/reports/${reportId}`,
        formData,
        {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        }
    );

    return response.data;
};

const getAllReports = async (options = {}) => {
    const url = `/report/getAllReports`;

    const {
        page = 1,
        limit = 10,
        ...filters
    } = options;

    console.log("page", page);

    const params = new URLSearchParams({
        page: page,
        limit: limit
    });

    Object.keys(filters).forEach(key => {
        if (filters[key] !== undefined && filters[key] !== null && filters[key] !== "") {
            params.append(key, filters[key]);
        }
    });

    const fullUrl = `${url}?${params.toString()}`;
    const response = await httpClient.get(fullUrl);

    return response.data;
};


const reportExistenceCheck = async (reportId, companyOfficeId = null) => {
    const url = `/report/reportExistenceCheck/${reportId}`;
    return await httpClient.get(url, {
        params: companyOfficeId ? { companyOfficeId } : {}
    });
}

const addCommonFields = async (reportId, inspectionDate, region, city, ownerName, companyOfficeId = null) => {
    const url = '/report/addCommonFields';
    const payload = { reportId, inspectionDate, region, city, ownerName };
    if (companyOfficeId) {
        payload.companyOfficeId = companyOfficeId;
    }
    return await httpClient.put(url, payload);
}

const checkMissingPages = async (reportId, companyOfficeId = null) => {
    const url = `/report/checkMissingPages/${reportId}`;
    return await httpClient.get(url, {
        params: companyOfficeId ? { companyOfficeId } : {}
    });
}

const uploadElrajhiBatch = async (validationExcelFile, validationPdfFiles, valuers = null, companyOfficeId = null) => {
    const formData = new FormData();

    // field name MUST match Multer config: 'excel'
    formData.append("excel", validationExcelFile);

    // field name MUST match Multer config: 'pdfs'
    (validationPdfFiles || []).forEach((file) => {
        formData.append("pdfs", file);
    });

    if (Array.isArray(valuers) && valuers.length > 0) {
        formData.append("valuers", JSON.stringify(valuers));
    }
    if (companyOfficeId) {
        formData.append("companyOfficeId", companyOfficeId);
    }

    const response = await httpClient.post(
        "/elrajhi-upload",
        formData,
        {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        }
    );

    return response.data;
};

const multiExcelUpload = async (validationExcelFiles, validationPdfFiles, valuers = null, companyOfficeId = null) => {
    const formData = new FormData();
    validationExcelFiles.forEach((file) => {
        formData.append("excels", file);
    });
    validationPdfFiles.forEach((file) => {
        formData.append("pdfs", file);
    });
    if (Array.isArray(valuers) && valuers.length > 0) {
        formData.append("valuers", JSON.stringify(valuers));
    }
    if (companyOfficeId) {
        formData.append("companyOfficeId", companyOfficeId);
    }

    const response = await httpClient.post(
        "/multi-approach",
        formData,
        {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        }
    );
    return response.data;
};

const fetchMultiApproachReports = async (companyOfficeId = null) => {
    const response = await httpClient.get("/multi-approach", {
        params: companyOfficeId ? { companyOfficeId } : {}
    });
    return response.data;
};

const updateMultiApproachReport = async (reportId, payload = {}, options = {}) => {
    const { pdfFile, useTemporaryPdf } = options;
    let requestBody = payload;
    const headers = {};

    const shouldUseFormData = Boolean(pdfFile || useTemporaryPdf);
    if (shouldUseFormData) {
        const formData = new FormData();

        Object.entries(payload || {}).forEach(([key, value]) => {
            if (value === undefined || value === null) return;
            if (key === "valuers" || key === "report_users" || typeof value === "object") {
                formData.append(key, JSON.stringify(value));
            } else {
                formData.append(key, value);
            }
        });

        if (pdfFile) {
            formData.append("pdf", pdfFile);
        }

        if (useTemporaryPdf) {
            formData.append("useTemporaryPdf", "true");
        }

        requestBody = formData;
        headers["Content-Type"] = "multipart/form-data";
    }

    const response = await httpClient.patch(
        `/multi-approach/${reportId}`,
        requestBody,
        { headers }
    );
    return response.data;
};

const deleteMultiApproachReport = async (reportId) => {
    const response = await httpClient.delete(`/multi-approach/${reportId}`);
    return response.data;
};

const updateMultiApproachAsset = async (reportId, assetIndex, payload) => {
    const response = await httpClient.patch(`/multi-approach/${reportId}/assets/${assetIndex}`, payload);
    return response.data;
};

const deleteMultiApproachAsset = async (reportId, assetIndex) => {
    const response = await httpClient.delete(`/multi-approach/${reportId}/assets/${assetIndex}`);
    return response.data;
};

const fetchLatestUserReport = async (companyOfficeId = null) => {
    const url = `/duplicate-report/latest`;
    const response = await httpClient.get(url, {
        params: companyOfficeId ? { companyOfficeId } : {}
    });
    return response.data;
};

const createDuplicateReport = async (payload, companyOfficeId = null) => {
    const url = `/duplicate-report`;
    if (companyOfficeId && payload && typeof payload.append === "function") {
        payload.append("companyOfficeId", companyOfficeId);
    }
    const response = await httpClient.post(url, payload, {
        headers: {
            "Content-Type": "multipart/form-data",
        },
    });
    return response.data;
}

const fetchDuplicateReports = async ({ page = 1, limit = 10, status = "all", companyOfficeId = null } = {}) => {
  const params = { page, limit, status };
  if (companyOfficeId) params.companyOfficeId = companyOfficeId;
  const response = await httpClient.get("/duplicate-report", {
    params,
  });
  return response.data;
};


const updateDuplicateReport = async (reportId, payload) => {
    const response = await httpClient.patch(`/duplicate-report/${reportId}`, payload);
    return response.data;
};

const deleteDuplicateReport = async (reportId) => {
    const response = await httpClient.delete(`/duplicate-report/${reportId}`);
    return response.data;
};

const updateDuplicateReportAsset = async (reportId, assetIndex, payload) => {
    const response = await httpClient.patch(`/duplicate-report/${reportId}/assets/${assetIndex}`, payload);
    return response.data;
};

const deleteDuplicateReportAsset = async (reportId, assetIndex) => {
    const response = await httpClient.delete(`/duplicate-report/${reportId}/assets/${assetIndex}`);
    return response.data;
};

const fetchElrajhiBatches = async (companyOfficeId = null) => {
    const response = await httpClient.get("/elrajhi-upload/batches", {
        params: companyOfficeId ? { companyOfficeId } : {}
    });
    return response.data;
};

const fetchElrajhiBatchReports = async (batchId, companyOfficeId = null) => {
    const response = await httpClient.get(`/elrajhi-upload/batches/${batchId}/reports`, {
        params: companyOfficeId ? { companyOfficeId } : {}
    });
    return response.data;
};

const fetchElrajhiReportById = async (reportId) => {
    const response = await httpClient.get(`/elrajhi-upload/reports/${reportId}`);
    return response.data;
};

const createManualMultiApproachReport = async (payload, companyOfficeId = null) => {
    const finalPayload = { ...(payload || {}) };
    if (companyOfficeId) {
        finalPayload.companyOfficeId = companyOfficeId;
    }
    const response = await httpClient.post("/multi-approach/manual", finalPayload);
    return response.data;
};

const submitReportsQuicklyUpload = async (validationExcelFiles, validationPdfFiles, skipPdfUpload = false, companyOfficeId = null) => {
    const formData = new FormData();
    validationExcelFiles.forEach((file) => {
        formData.append("excels", file);
    });
    validationPdfFiles.forEach((file) => {
        formData.append("pdfs", file);
    });
    if (skipPdfUpload) {
        formData.append("skipPdfUpload", "true");
    }
    if (companyOfficeId) {
        formData.append("companyOfficeId", companyOfficeId);
    }

    const response = await httpClient.post(
        "/submit-reports-quickly",
        formData,
        {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        }
    );
    return response.data;
};

const fetchSubmitReportsQuickly = async (companyOfficeId = null) => {
    const response = await httpClient.get("/submit-reports-quickly", {
        params: companyOfficeId ? { companyOfficeId } : {}
    });
    return response.data;
};

const updateSubmitReportsQuickly = async (reportId, payload) => {
    const response = await httpClient.patch(`/submit-reports-quickly/${reportId}`, payload);
    return response.data;
};

const deleteSubmitReportsQuickly = async (reportId) => {
    const response = await httpClient.delete(`/submit-reports-quickly/${reportId}`);
    return response.data;
};

const updateSubmitReportsQuicklyAsset = async (reportId, assetIndex, payload) => {
    const response = await httpClient.patch(`/submit-reports-quickly/${reportId}/assets/${assetIndex}`, payload);
    return response.data;
};

const deleteSubmitReportsQuicklyAsset = async (reportId, assetIndex) => {
    const response = await httpClient.delete(`/submit-reports-quickly/${reportId}/assets/${assetIndex}`);
    return response.data;
};


module.exports = {
    uploadAssetDataToDatabase,
    createReportWithCommonFields,
    reportExistenceCheck,
    addCommonFields,
    checkMissingPages,
    uploadElrajhiBatch,
    multiExcelUpload,
    getAllReports,
    fetchLatestUserReport,
    createDuplicateReport,
    fetchDuplicateReports,
    updateDuplicateReport,
    deleteDuplicateReport,
    updateDuplicateReportAsset,
    deleteDuplicateReportAsset,
    updateUrgentReport,
    fetchElrajhiBatches,
    fetchElrajhiBatchReports,
    fetchElrajhiReportById,
    createManualMultiApproachReport,
    fetchMultiApproachReports,
    updateMultiApproachReport,
    deleteMultiApproachReport,
    updateMultiApproachAsset,
    deleteMultiApproachAsset,
    submitReportsQuicklyUpload,
    fetchSubmitReportsQuickly,
    updateSubmitReportsQuickly,
    deleteSubmitReportsQuickly,
    updateSubmitReportsQuicklyAsset,
    deleteSubmitReportsQuicklyAsset
};
