export const deductPoints = async (token, amount, meta = {}) => {
    if (!token || !amount) return null;

    const normalized = Number(amount);
    if (!Number.isFinite(normalized) || normalized <= 0) return null;

    if (!window?.electronAPI?.apiRequest) {
        throw new Error('API client is unavailable');
    }

    const payload = { amount: normalized, ...meta };
    const response = await window.electronAPI.apiRequest(
        'PATCH',
        '/api/packages/deduct',
        payload,
        { Authorization: `Bearer ${token}` }
    );

    const normalizeReportIds = (value) => {
        if (Array.isArray(value)) return value.filter(Boolean);
        if (typeof value === 'string') {
            return value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
        }
        return [];
    };

    const metaReportIds = normalizeReportIds(meta.reportIds);
    const responseReportIds = normalizeReportIds(response?.reportIds);
    const detail = {
        remainingPoints: response?.remainingPoints,
        deducted: normalized,
        ...meta,
        reportIds: responseReportIds.length ? responseReportIds : metaReportIds,
        reportId: response?.reportId || meta.reportId || null,
        deductionId: response?.deductionId || null,
        recordId: response?.recordId || meta.recordId || null,
        batchId: response?.batchId || meta.batchId || null,
        assetCount:
            Number.isFinite(response?.assetCount)
                ? response.assetCount
                : Number.isFinite(meta.assetCount)
                    ? meta.assetCount
                    : undefined,
        source: meta.source || response?.source,
        pageName: meta.pageName || response?.pageName,
        pageSource: meta.pageSource || response?.pageSource,
        message: response?.message || meta.message,
        metadata: response?.metadata,
        reportSummaries: response?.reportSummaries,
        createdAt: response?.createdAt || new Date().toISOString(),
    };

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('points-updated', { detail }));
    }

    return response;
};
