import React, { useEffect, useMemo, useState } from 'react';
import {
    Database,
    Filter,
    Search,
    RefreshCcw,
    Eye,
    EyeOff,
    Loader2,
    ChevronLeft,
    ChevronRight,
    MapPin,
    DollarSign,
    Image,
    ExternalLink,
    Tag,
    X
} from 'lucide-react';

const PAGE_LIMIT = 20;
const SORT_OPTIONS = [
    { value: 'newest', label: 'Newest' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'price_asc', label: 'Price (Low - High)' },
    { value: 'price_desc', label: 'Price (High - Low)' },
    { value: 'mileage_asc', label: 'Mileage (Low - High)' },
    { value: 'mileage_desc', label: 'Mileage (High - Low)' }
];

const safeStringify = (value) => {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

const formatNumber = (value) => {
    const number = typeof value === 'string' ? Number(value.replace(/[,\s]/g, '')) : Number(value);
    if (!Number.isFinite(number)) return 'N/A';
    return new Intl.NumberFormat('en-US').format(number);
};

const formatDateTime = (value) => {
    if (!value) return 'N/A';
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'N/A';
        return date.toLocaleString('en-US', { hour12: false });
    } catch {
        return String(value);
    }
};

const buildDetailLabel = (key) => {
    if (!key) return '';
    const friendly = key
        .replace(/[_\-\.]/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .trim();
    return friendly.charAt(0).toUpperCase() + friendly.slice(1);
};

const renderDetailValue = (value) => {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) {
        if (!value.length) return 'Empty array';
        const items = value
            .slice(0, 3)
            .map((item) => (typeof item === 'object' ? safeStringify(item) : String(item)));
        const suffix = value.length > 3 ? ` +${value.length - 3} more` : '';
        return items.join(', ') + suffix;
    }
    if (typeof value === 'object') {
        const raw = safeStringify(value);
        return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
    }
    return String(value);
};

const resolveImageUrl = (value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        const keysToCheck = ['url', 'image', 'imageUrl', 'originalUrl', 'cloudinaryUrl', 'src', 'link', 'path'];
        for (const key of keysToCheck) {
            if (value[key]) return value[key];
        }
    }
    return null;
};
const YallaMotor = () => {
    const [ads, setAds] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showData, setShowData] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [filters, setFilters] = useState({
        q: '',
        brand: '',
        model: '',
        year: '',
        city: '',
        minPrice: '',
        maxPrice: '',
        minMileage: '',
        maxMileage: '',
        hasImages: '',
        sort: 'newest'
    });
    const [options, setOptions] = useState({
        brands: [],
        models: [],
        years: [],
        cities: []
    });
    const [detailModal, setDetailModal] = useState({
        isOpen: false,
        loading: false,
        ad: null,
        error: ''
    });
    const [showAllHeaders, setShowAllHeaders] = useState(false);

    const handleFilterChange = (key, value) => {
        setFilters((prev) => ({
            ...prev,
            [key]: value,
            ...(key === 'brand' ? { model: '' } : {})
        }));
        setCurrentPage(1);
    };

    const handleShowData = () => {
        setShowData(true);
        setCurrentPage(1);
    };

    const handleHideData = () => {
        setShowData(false);
        setAds([]);
        setError('');
        setTotal(0);
        setTotalPages(1);
    };

    const loadFilters = async () => {
        if (!window?.electronAPI) return;
        try {
            const [brandResp, yearResp, cityResp] = await Promise.all([
                window.electronAPI.apiRequest('GET', '/api/yalla/cars/brands'),
                window.electronAPI.apiRequest('GET', '/api/yalla/cars/years'),
                window.electronAPI.apiRequest('GET', '/api/yalla/cars/cities')
            ]);

            const brands = brandResp?.items
                ?.map((row) => row.brand)
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b)) || [];

            const years = yearResp?.items
                ?.map((row) => row.year)
                .filter(Boolean)
                .sort((a, b) => Number(b) - Number(a)) || [];

            const cities = cityResp?.items
                ?.map((row) => row.city)
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b)) || [];

            setOptions((prev) => ({
                ...prev,
                brands,
                years,
                cities
            }));
        } catch (loadErr) {
            console.error('Failed to load Yalla filter options:', loadErr);
        }
    };

    const fetchModelsForBrand = async (brandValue) => {
        if (!window?.electronAPI) return;
        if (!brandValue) {
            setOptions((prev) => ({ ...prev, models: [] }));
            return;
        }
        try {
            const response = await window.electronAPI.apiRequest(
                'GET',
                `/api/yalla/cars/models?brand=${encodeURIComponent(brandValue)}`
            );
            const models = response?.items
                ?.map((row) => row.model)
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b)) || [];
            setOptions((prev) => ({ ...prev, models }));
        } catch (err) {
            console.error('Failed to load models for brand', brandValue, err);
            setOptions((prev) => ({ ...prev, models: [] }));
        }
    };

    const loadList = async (pageNumber = 1) => {
        if (!showData || !window?.electronAPI) return;
        setLoading(true);
        setError('');
        try {
            const query = new URLSearchParams({
                page: pageNumber.toString(),
                limit: PAGE_LIMIT.toString(),
                sort: filters.sort || 'newest'
            });

            if (filters.q) query.append('q', filters.q);
            if (filters.brand) query.append('brand', filters.brand);
            if (filters.model) query.append('model', filters.model);
            if (filters.year) query.append('year', filters.year);
            if (filters.city) query.append('city', filters.city);
            if (filters.minPrice) query.append('minPrice', filters.minPrice);
            if (filters.maxPrice) query.append('maxPrice', filters.maxPrice);
            if (filters.minMileage) query.append('minMileage', filters.minMileage);
            if (filters.maxMileage) query.append('maxMileage', filters.maxMileage);
            if (filters.hasImages === '1' || filters.hasImages === 'true') {
                query.append('hasImages', '1');
            }

            const response = await window.electronAPI.apiRequest('GET', `/api/yalla?${query.toString()}`);
            setAds(response?.items || []);
            setTotal(response?.total || 0);
            setTotalPages(response?.pages || 1);
        } catch (fetchErr) {
            setError(fetchErr?.response?.data?.message || fetchErr?.message || 'Failed to load Yalla cars');
            setAds([]);
            setTotal(0);
            setTotalPages(1);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        loadFilters();
    }, []);

    useEffect(() => {
        fetchModelsForBrand(filters.brand);
    }, [filters.brand]);

    useEffect(() => {
        if (!showData) return;
        loadList(currentPage);
    }, [showData, currentPage, filters]);

    useEffect(() => {
        if (!detailModal.isOpen) {
            setShowAllHeaders(false);
        }
    }, [detailModal.isOpen]);

    const handleRefresh = () => {
        loadList(currentPage);
    };

    const openDetailModal = async (ad) => {
        if (!ad) return;
        setShowAllHeaders(false);
        setDetailModal({ isOpen: true, loading: true, ad: null, error: '' });
        const identifier = String(ad.url || ad._id || '').trim();
        if (!identifier) {
            setDetailModal((prev) => ({ ...prev, loading: false, error: 'Missing record identifier' }));
            return;
        }
        try {
            const response = await window.electronAPI.apiRequest(
                'GET',
                `/api/yalla/cars/one?url=${encodeURIComponent(identifier)}`
            );
            setDetailModal((prev) => ({
                ...prev,
                loading: false,
                ad: response?.item || null,
                error: response && !response?.item ? 'Record not found' : ''
            }));
        } catch (detailErr) {
            setDetailModal((prev) => ({
                ...prev,
                loading: false,
                error: detailErr?.response?.data?.message || detailErr?.message || 'Failed to load record'
            }));
        }
    };

    const closeDetailModal = () => {
        setDetailModal({ isOpen: false, loading: false, ad: null, error: '' });
    };

    const detailFields = useMemo(() => {
        const detail = detailModal.ad?.detail;
        if (!detail || typeof detail !== 'object') return [];
        const excludedKeys = new Set(['breadcrumb', 'overview', 'images', 'features', 'importantSpecs', 'detailImages']);
        return Object.entries(detail)
            .filter(([key]) => !excludedKeys.has(key))
            .map(([key, value]) => ({ key, value }))
            .filter(({ key, value }) => {
                if (value === null || value === undefined || value === '') return false;
                if (Array.isArray(value)) {
                    const arr = value.filter((item) => item !== null && item !== undefined && String(item).trim());
                    return arr.length > 0;
                }
                if (typeof value === 'object') return false;
                return true;
            })
            .sort((a, b) => a.key.localeCompare(b.key));
    }, [detailModal.ad]);

    const detailFieldsToShow = useMemo(() => {
        if (!detailFields.length) return [];
        if (showAllHeaders) return detailFields;
        return detailFields.slice(0, 6);
    }, [detailFields, showAllHeaders]);

    const hasMoreHeaders = detailFields.length > 6;

    const detailImages = useMemo(() => {
        const raw = detailModal.ad?.detail?.images;
        if (!Array.isArray(raw)) return [];
        return raw
            .map((item) => resolveImageUrl(item))
            .filter(Boolean);
    }, [detailModal.ad]);

    const breadcrumb = Array.isArray(detailModal.ad?.detail?.breadcrumb)
        ? detailModal.ad.detail.breadcrumb
        : [];
    const cityName = breadcrumb[2] || detailModal.ad?.city || 'City not set';
    const brandName = breadcrumb[3] || detailModal.ad?.brand || 'Unknown brand';
    const modelName = breadcrumb[4] || detailModal.ad?.model || 'Unknown model';
    const yearName = breadcrumb[5] || detailModal.ad?.year || 'Year not scraped';
    const hasPrice = Boolean(detailModal.ad?.cardPriceText || detailModal.ad?.priceNum);
    const hasImages = detailImages.length > 0;

    const featuresList = useMemo(() => {
        const detail = detailModal.ad?.detail;
        if (!detail) return [];
        const candidates = detail.features ?? detail.featureList ?? detail.detailFeatures;
        if (!Array.isArray(candidates)) return [];
        return candidates
            .map((item) => (typeof item === 'string' ? item : safeStringify(item)))
            .map((item) => item.trim())
            .filter(Boolean);
    }, [detailModal.ad]);

    const importantSpecsEntries = useMemo(() => {
        const specs = detailModal.ad?.detail?.importantSpecs;
        if (!specs || typeof specs !== 'object') return [];
        return Object.entries(specs)
            .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
            .map(([key, value]) => ({
                key,
                value
            }));
    }, [detailModal.ad]);

    const openExternal = (url) => {
        if (!url) return;
        if (window?.electronAPI?.openExternal) {
            window.electronAPI.openExternal(url);
        } else {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };

    const handlePrevPage = () => {
        setCurrentPage((prev) => Math.max(1, prev - 1));
    };

    const handleNextPage = () => {
        setCurrentPage((prev) => Math.min(totalPages, prev + 1));
    };

    const resetFilters = () => {
        setFilters({
            q: '',
            brand: '',
            model: '',
            year: '',
            city: '',
            minPrice: '',
            maxPrice: '',
            minMileage: '',
            maxMileage: '',
            hasImages: '',
            sort: 'newest'
        });
        setCurrentPage(1);
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-900/15 bg-gradient-to-r from-white via-emerald-50 to-white px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white flex items-center justify-center shadow-lg">
                        <Database className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-emerald-950">Yalla Motor</h1>
                        <p className="text-[11px] text-slate-600">Explore the scraped Yalla Motor catalog with the same professional controls.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {showData && (
                        <button
                            type="button"
                            onClick={handleRefresh}
                            disabled={loading}
                            className="inline-flex items-center gap-2 rounded-lg border border-emerald-900/20 bg-white px-3 py-2 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
                            Refresh
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={showData ? handleHideData : handleShowData}
                        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[11px] font-semibold shadow-sm transition-all ${
                            showData
                                ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700'
                        }`}
                    >
                        {showData ? (
                            <>
                                <EyeOff className="w-4 h-4" />
                                Hide Data
                            </>
                        ) : (
                            <>
                                <Eye className="w-4 h-4" />
                                Show Data
                            </>
                        )}
                    </button>
                </div>
            </div>

            {showData && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
                            <Filter className="w-4 h-4 text-slate-500" />
                            Filters
                        </div>
                        <button
                            type="button"
                            onClick={resetFilters}
                            className="text-[11px] font-semibold text-slate-500 hover:text-slate-900"
                        >
                            Clear filters
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Search</label>
                            <div className="relative mt-1">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                <input
                                    type="search"
                                    value={filters.q}
                                    onChange={(e) => handleFilterChange('q', e.target.value)}
                                    placeholder="Keywords"
                                    className="w-full rounded-lg border border-slate-300 bg-white px-8 py-2 text-[11px] shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Brand</label>
                            <select
                                value={filters.brand}
                                onChange={(e) => handleFilterChange('brand', e.target.value)}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                            >
                                <option value="">All Brands</option>
                                {options.brands.map((brand) => (
                                    <option key={brand} value={brand}>{brand}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Model</label>
                            <select
                                value={filters.model}
                                onChange={(e) => handleFilterChange('model', e.target.value)}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                                disabled={!options.models.length}
                            >
                                <option value="">All Models</option>
                                {options.models.map((model) => (
                                    <option key={model} value={model}>{model}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Year</label>
                            <select
                                value={filters.year}
                                onChange={(e) => handleFilterChange('year', e.target.value)}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                            >
                                <option value="">All Years</option>
                                {options.years.map((year) => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">City</label>
                            <select
                                value={filters.city}
                                onChange={(e) => handleFilterChange('city', e.target.value)}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                            >
                                <option value="">All Cities</option>
                                {options.cities.map((city) => (
                                    <option key={city} value={city}>{city}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Min Price</label>
                            <input
                                type="number"
                                value={filters.minPrice}
                                onChange={(e) => handleFilterChange('minPrice', e.target.value)}
                                placeholder="0"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Max Price</label>
                            <input
                                type="number"
                                value={filters.maxPrice}
                                onChange={(e) => handleFilterChange('maxPrice', e.target.value)}
                                placeholder="Any"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Mileage =</label>
                            <input
                                type="number"
                                value={filters.minMileage}
                                onChange={(e) => handleFilterChange('minMileage', e.target.value)}
                                placeholder="0"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Mileage =</label>
                            <input
                                type="number"
                                value={filters.maxMileage}
                                onChange={(e) => handleFilterChange('maxMileage', e.target.value)}
                                placeholder="Any"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Has Images</label>
                            <select
                                value={filters.hasImages}
                                onChange={(e) => handleFilterChange('hasImages', e.target.value)}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                            >
                                <option value="">Any</option>
                                <option value="1">With Images</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Sort</label>
                            <select
                                value={filters.sort}
                                onChange={(e) => handleFilterChange('sort', e.target.value)}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] font-semibold shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                            >
                                {SORT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            )}
            {showData && error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] text-rose-700">
                    {error}
                </div>
            )}

            {showData && (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 text-[12px] text-slate-600">
                        <div className="flex items-center gap-2">
                            <Tag className="h-4 w-4 text-slate-400" />
                            <span>Showing {ads.length} items of {total.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
                            <span>Page {currentPage}</span>
                            <span>/</span>
                            <span>{totalPages}</span>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-[12px]">
                            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-4 py-2 w-16">Cover</th>
                                    <th className="px-4 py-2">Title & Source</th>
                                    <th className="px-4 py-2">Price</th>
                                    <th className="px-4 py-2">Brand / Model / Year</th>
                                    <th className="px-4 py-2">City / Section</th>
                                    <th className="px-4 py-2">Mileage / Images</th>
                                    <th className="px-4 py-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ads.map((ad, index) => (
                                    <tr key={ad._id || ad.url || index} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                                        <td className="px-4 py-3">
                                            {ad.coverImage ? (
                                                <img
                                                    src={ad.coverImage}
                                                    alt={ad.cardTitle || 'cover'}
                                                    className="h-14 w-14 rounded-xl object-cover"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-100 text-slate-400">
                                                    <Image className="h-5 w-5" />
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                type="button"
                                                onClick={() => openDetailModal(ad)}
                                                className="text-sm font-semibold text-slate-900 hover:text-emerald-500"
                                            >
                                                {ad.cardTitle || 'Untitled listing'}
                                            </button>
                                            <p className="text-[11px] text-slate-500">
                                                Source: {ad.source || 'Yalla'}
                                            </p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1">
                                                <DollarSign className="h-4 w-4 text-emerald-500" />
                                                <span className="text-sm font-semibold text-slate-900">
                                                    {ad.cardPriceText || (ad.priceNum ? `${formatNumber(ad.priceNum)} SAR` : 'N/A')}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-[11px] text-slate-600">
                                            <div>{ad.brand || 'Unknown Brand'}</div>
                                            <div>{ad.model || 'Unknown Model'}</div>
                                            <div>{ad.year || 'Year not scraped'}</div>
                                        </td>
                                        <td className="px-4 py-3 text-[11px] text-slate-600">
                                            <div className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-slate-400" />
                                                <span>{ad.city || 'City not set'}</span>
                                            </div>
                                            <div className="text-[10px] text-slate-400">
                                                Section: {ad.sectionLabel || 'N/A'}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-[11px] text-slate-600">
                                            <div>Mileage: {ad.mileageNum ? `${formatNumber(ad.mileageNum)} KM` : 'N/A'}</div>
                                            <div>Images: {ad.imagesCount != null ? ad.imagesCount : '-'}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => openDetailModal(ad)}
                                                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-600"
                                                >
                                                    <Eye className="h-3.5 w-3.5" />
                                                    See more
                                                </button>
                                                {ad.url && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openExternal(ad.url)}
                                                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                                                    >
                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                        Open Link
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-50">
                        <span className="text-[11px] text-slate-500">
                            Showing {ads.length} of {total.toLocaleString()} results - Limit {PAGE_LIMIT} per page
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handlePrevPage}
                                disabled={currentPage <= 1 || loading}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-600 disabled:opacity-50"
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Prev
                            </button>
                            <button
                                type="button"
                                onClick={handleNextPage}
                                disabled={currentPage >= totalPages || loading}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-600 disabled:opacity-50"
                            >
                                Next
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                    {loading && (
                        <div className="px-4 py-6 text-center text-[11px] text-slate-500">
                            <Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-400" />
                            <p className="mt-2">Loading Yalla Motor listings...</p>
                        </div>
                    )}
                    {!loading && !ads.length && (
                        <div className="px-4 py-6 text-center text-[12px] text-slate-500">
                            No records found for the selected filters.
                        </div>
                    )}
                </div>
            )}
            {!showData && (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-gradient-to-br from-white to-slate-50 p-8 text-center text-slate-500">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 mb-4">
                        <Database className="h-10 w-10 text-emerald-600" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 mb-2">Ready to view Yalla Motor data</h2>
                    <p className="text-[11px] text-slate-500">Press Show Data to stream the latest listings and inspect every header.</p>
                </div>
            )}

            {detailModal.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="relative flex w-full max-w-7xl flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-2xl">
                        <button
                            type="button"
                            onClick={closeDetailModal}
                            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:text-slate-600"
                        >
                            <X className="h-5 w-5" />
                        </button>
                        <div className="border-b px-5 py-4 bg-slate-50">
                            <div className="space-y-1">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Yalla Motor record</p>
                                <p className="text-lg font-semibold text-slate-900 line-clamp-2">{detailModal.ad?.cardTitle || 'Untitled listing'}</p>
                                <p className="text-[10px] text-slate-500">
                                    {detailFields.length} headers · Updated {formatDateTime(detailModal.ad?.lastSeenAt)}
                                </p>
                            </div>
                        </div>
                        <div className="max-h-[82vh] overflow-hidden">
                            <div className="max-h-[76vh] space-y-5 overflow-y-auto px-5 py-4">
                                {detailModal.loading && (
                                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                                        Loading details...
                                    </div>
                                )}
                                {detailModal.error && (
                                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] text-rose-700">
                                        {detailModal.error}
                                    </div>
                                )}
                                {detailModal.ad && (
                                    <div className="space-y-6">
                                        <div className="grid gap-4 lg:grid-cols-[1.5fr,1fr]">
                                            <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Overview</p>
                                                <div className="mt-2 grid gap-2 text-sm text-slate-600">
                                                    {[
                                                        {
                                                            label: 'Price',
                                                            value: detailModal.ad.cardPriceText || (detailModal.ad.priceNum ? `${formatNumber(detailModal.ad.priceNum)} SAR` : 'Not available')
                                                        },
                                                        { label: 'Mileage', value: detailModal.ad.mileageNum ? `${formatNumber(detailModal.ad.mileageNum)} KM` : 'Not available' },
                                                        { label: 'Images', value: detailImages.length ? `${detailImages.length} available` : 'No images' }
                                                    ].map((item) => (
                                                        <div key={item.label} className="flex flex-col rounded-2xl border border-white/60 bg-white/80 px-3 py-2 shadow-sm">
                                                            <span className="text-[9px] uppercase text-slate-400">{item.label}</span>
                                                            <span className="text-[12px] font-semibold text-slate-900">{item.value}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-950 p-4 text-white shadow-2xl">
                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">Key facts</p>
                                                <div className="mt-4 space-y-3 text-[11px]">
                                                    {[
                                                        { label: 'City', value: cityName },
                                                        { label: 'Brand', value: brandName },
                                                        { label: 'Model', value: modelName },
                                                        { label: 'Year', value: yearName }
                                                    ].map((item) => (
                                                        <div key={item.label} className="flex items-center justify-between rounded-2xl bg-white/10 px-3 py-2 text-sm">
                                                            <span className="text-white/70">{item.label}</span>
                                                            <span className="font-semibold text-white">{item.value}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Image gallery</p>
                                                {detailImages.length > 0 && (
                                                    <span className="text-[10px] text-slate-400">
                                                        {detailImages.length} image{detailImages.length > 1 ? 's' : ''}
                                                    </span>
                                                )}
                                            </div>
                                            {detailImages.length > 0 ? (
                                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                                                    {detailImages.slice(0, 8).map((src, idx) => (
                                                        <button
                                                            key={`${src}-${idx}`}
                                                            type="button"
                                                            onClick={() => openExternal(src)}
                                                            className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                                                        >
                                                            <img src={src} alt={`detail-${idx}`} className="h-24 w-full object-cover" loading="lazy" />
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-500">
                                                    <Image className="h-4 w-4" />
                                                    No images available
                                                </div>
                                            )}
                                        </div>
                                        {(featuresList.length > 0 || importantSpecsEntries.length > 0) && (
                                            <div className="grid gap-4 lg:grid-cols-2">
                                                {featuresList.length > 0 && (
                                                    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                                                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Features</div>
                                                        <div className="mt-3 flex flex-wrap gap-2">
                                                            {featuresList.map((feature) => (
                                                                <span
                                                                    key={feature}
                                                                    className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700"
                                                                >
                                                                    {feature}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {importantSpecsEntries.length > 0 && (
                                                    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Important specs</p>
                                                                <p className="text-[10px] text-slate-400">{importantSpecsEntries.length} fields</p>
                                                            </div>
                                                            {importantSpecsEntries.length > 6 && (
                                                                <span className="text-[11px] font-semibold text-slate-500">
                                                                    Showing {Math.min(6, importantSpecsEntries.length)}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="mt-3 space-y-2 text-[12px] text-slate-700">
                                                            {importantSpecsEntries.slice(0, 6).map(({ key, value }) => (
                                                                <div key={key} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-xs">
                                                                    <span className="text-[10px] text-slate-400">{buildDetailLabel(key)}</span>
                                                                    <span className="font-semibold text-slate-900">{renderDetailValue(value)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {detailFields.length > 0 && (
                                            <div className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
                                                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                                                    <div>
                                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Headers</p>
                                                        <p className="text-[10px] text-slate-400">{detailFields.length} captured keys</p>
                                                    </div>
                                                    {hasMoreHeaders && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowAllHeaders((prev) => !prev)}
                                                            className="text-[11px] font-semibold text-emerald-600 transition hover:text-emerald-700"
                                                        >
                                                            {showAllHeaders ? 'Show fewer headers' : 'See more headers'}
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="grid max-h-[320px] grid-cols-1 gap-3 overflow-y-auto px-4 py-4 sm:grid-cols-2">
                                                    {detailFieldsToShow.map(({ key, value }) => (
                                                        <div key={key} className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
                                                            <div className="text-[9px] font-semibold text-slate-400">{buildDetailLabel(key)}</div>
                                                            <p className="text-[11px] leading-snug text-slate-900">{renderDetailValue(value)}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-4 border-t px-5 py-3 bg-slate-50">
                            <div className="text-[11px] text-slate-500">
                                Has Price: {hasPrice ? 'Yes' : 'No'} | Has Images: {hasImages ? 'Yes' : 'No'}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {detailModal.ad?.url && (
                                    <button
                                        type="button"
                                        onClick={() => openExternal(detailModal.ad.url)}
                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                        Open listing
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={closeDetailModal}
                                    className="inline-flex items-center gap-1 rounded-lg border border-transparent bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white shadow hover:bg-emerald-500"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default YallaMotor;

