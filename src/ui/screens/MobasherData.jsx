import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Database,
  Filter,
  Search,
  RefreshCcw,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MapPin,
  DollarSign,
  Loader2,
  X,
  Info,
  Image
} from "lucide-react";

const SPEC_BRAND = "نوع السيارة";
const SPEC_MODEL = "طراز السيارة";
const SPEC_YEAR = "سنة الصنع";
const SPEC_FUEL = "نوع الوقود";
const SPEC_MILEAGE = "عداد الكيلومترات";

const SPEC_LABELS = {
  [SPEC_BRAND]: "نوع السيارة",
  [SPEC_MODEL]: "طراز السيارة",
  [SPEC_YEAR]: "سنة الصنع",
  [SPEC_FUEL]: "نوع الوقود",
  [SPEC_MILEAGE]: "عدد الكيلومترات"
};

const PAGE_LIMIT = 20;

const normalizeSpecValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map(normalizeSpecValue).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const preferred = ["value", "text", "label", "name", "title", "display", "url", "full"];
    for (const prop of preferred) {
      if (prop in value) {
        const nested = normalizeSpecValue(value[prop]);
        if (nested) return nested;
      }
    }
    for (const nested of Object.values(value)) {
      const nestedValue = normalizeSpecValue(nested);
      if (nestedValue) return nestedValue;
    }
  }
  return "";
};

const getSpecValue = (ad, ...keys) => {
  if (!ad?.specs) return "";
  for (const key of keys) {
    const normalized = normalizeSpecValue(ad.specs[key]);
    if (normalized) return normalized;
  }
  return "";
};

const formatFieldValue = (value) => {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.length ? value.map(formatFieldValue).join(", ") : "Empty";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .map(([k, v]) => `${k}: ${formatFieldValue(v)}`)
      .join("; ");
    return entries || JSON.stringify(value);
  }
  return String(value);
};

const DataRow = ({ label, value }) => (
  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]">
    <div className="text-[9px] uppercase text-slate-400 tracking-wide">{label}</div>
    <div className="text-slate-900">{value}</div>
  </div>
);

const MobasherData = () => {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showData, setShowData] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    search: "",
    brand: "",
    model: "",
    year: "",
    fuel: ""
  });
  const [filterOptions, setFilterOptions] = useState({
    brands: [],
    models: [],
    years: [],
    fuels: []
  });
  const [detailsModal, setDetailsModal] = useState({ isOpen: false, ad: null });

  const formatPrice = (value) => {
    if (value == null || value === "") return "N/A";
    if (typeof value === "number") {
      return new Intl.NumberFormat("en-US").format(value);
    }
    return String(value);
  };

  const fetchFilterOptions = useCallback(async () => {
    if (!window?.electronAPI) return;
    try {
      const response = await window.electronAPI.apiRequest("GET", `/api/mobasher?limit=500`);
      const items = response?.items || [];
      const brands = new Set();
      const models = new Set();
      const years = new Set();
      const fuels = new Set();
      items.forEach((item) => {
        const brand = getSpecValue(item, SPEC_BRAND);
        if (brand) brands.add(brand);
        const model = getSpecValue(item, SPEC_MODEL);
        if (model) models.add(model);
        const year = getSpecValue(item, SPEC_YEAR);
        if (year) years.add(year);
        const fuel = getSpecValue(item, SPEC_FUEL);
        if (fuel) fuels.add(fuel);
      });
      const sortList = (collection) => Array.from(collection).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
      setFilterOptions({
        brands: sortList(brands),
        models: sortList(models),
        years: sortList(years),
        fuels: sortList(fuels)
      });
    } catch (err) {
      console.error("Failed to load filter options", err);
    }
  }, []);

  const loadAds = useCallback(
    async (page = 1) => {
      if (!window?.electronAPI || !showData) return;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_LIMIT)
        });
        if (filters.brand) params.append("brand", filters.brand);
        if (filters.model) params.append("model", filters.model);
        if (filters.year) params.append("year", filters.year);
        if (filters.fuel) params.append("fuel", filters.fuel);
        if (filters.search.trim()) {
          params.append("query", filters.search.trim());
        }
        const endpoint = filters.search.trim() ? "/api/mobasher/search" : "/api/mobasher";
        const response = await window.electronAPI.apiRequest("GET", `${endpoint}?${params.toString()}`);
        setAds(response?.items || []);
        setTotal(response?.total || 0);
        setTotalPages(response?.pages || 1);
        setCurrentPage(response?.page || page);
      } catch (err) {
        console.error("Failed to load Mobasher data", err);
        setError(err?.response?.data?.message || err?.message || "Unable to fetch Mobasher data");
        setAds([]);
        setTotal(0);
        setTotalPages(1);
      } finally {
        setLoading(false);
      }
    },
    [filters, showData]
  );

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  useEffect(() => {
    if (showData) {
      loadAds(currentPage);
    }
  }, [currentPage, loadAds, showData]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const openModal = (ad) => {
    setDetailsModal({ isOpen: true, ad });
  };
  const closeModal = () => setDetailsModal({ isOpen: false, ad: null });

  const hasAds = useMemo(() => Array.isArray(ads) && ads.length > 0, [ads]);
  const extraAttributes = useMemo(() => {
    if (!detailsModal.ad) return [];
    const hiddenKeys = new Set([
      "specs",
      "images",
      "map",
      "description",
      "title",
      "url",
      "price",
      "priceText",
      "currency",
      "adId",
      "scrapedAt",
      "createdAt",
      "updatedAt",
      "preferredTime",
      "location"
    ]);
    return Object.entries(detailsModal.ad)
      .filter(([key]) => !hiddenKeys.has(key))
      .map(([key, value]) => ({ key, value: formatFieldValue(value) }));
  }, [detailsModal.ad]);

  const startRange = total ? (currentPage - 1) * PAGE_LIMIT + 1 : 0;
  const endRange = total ? Math.min(currentPage * PAGE_LIMIT, total) : 0;

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-900/20 bg-gradient-to-r from-white via-emerald-50 to-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-lg">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-emerald-950">Mobasher Data</h1>
            <p className="text-[11px] text-slate-600">Browse the Mobasher collection with backend filters.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showData && (
            <button
              type="button"
              onClick={() => loadAds(currentPage)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-900/20 bg-white px-3 py-2 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              Refresh
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowData((prev) => !prev);
              if (!showData) {
                setCurrentPage(1);
              }
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[11px] font-semibold shadow-sm transition ${
              showData ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : "bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
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
      </header>

      {showData && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <span className="text-[13px] font-semibold text-slate-900">Filters</span>
            </div>
            <div className="text-[11px] text-slate-500">
              Showing {startRange} - {endRange} of {total.toLocaleString()}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 text-[9px] font-semibold text-slate-600 uppercase">
              <span>Search</span>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => handleFilterChange("search", e.target.value)}
                  placeholder="Search title or description"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 pl-9 text-[10px] focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>
            </div>

            {[
              ["brand", "نوع السيارة", filterOptions.brands],
              ["model", "طراز السيارة", filterOptions.models],
              ["year", "سنة الصنع", filterOptions.years],
              ["fuel", "عدد الكيلومترات", filterOptions.fuels]
            ].map(([key, label, options]) => (
              <div key={key} className="flex flex-col gap-1 text-[9px] font-semibold text-slate-600 uppercase">
                <span>{label}</span>
                <select
                  value={filters[key]}
                  onChange={(e) => handleFilterChange(key, e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-[10px] focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                >
                  <option value="">All</option>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      {showData && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] font-semibold text-slate-700">
              Total Records: <span className="text-emerald-600">{total.toLocaleString()}</span>
            </div>
            <div className="text-[10px] text-slate-500">
              Page {currentPage} of {totalPages}
            </div>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
          ) : !hasAds ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Database className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-[13px] font-semibold text-slate-600">No records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[740px] divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      Title
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      نوع السيارة
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      طراز السيارة
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      سنة الصنع
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      عدد الكيلومترات
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      Price
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      Location
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {ads.map((ad, idx) => {
                    const brand = getSpecValue(ad, SPEC_BRAND);
                    const model = getSpecValue(ad, SPEC_MODEL);
                    const year = getSpecValue(ad, SPEC_YEAR);
                    const mileage = getSpecValue(ad, SPEC_MILEAGE, SPEC_FUEL);
                    return (
                      <tr key={ad.adId || ad._id || idx} className="hover:bg-emerald-50/40 transition-colors">
                        <td className="px-4 py-3 max-w-[220px] align-top">
                          <p className="text-[11px] font-semibold text-slate-900 line-clamp-2">{ad.title || "No title"}</p>
                          {ad.description && <p className="text-[10px] text-slate-500 mt-1 line-clamp-1">{ad.description}</p>}
                        </td>
                        <td className="px-4 py-3 align-top text-[11px] text-slate-800">{brand || "N/A"}</td>
                        <td className="px-4 py-3 align-top text-[11px] text-slate-800">{model || "N/A"}</td>
                        <td className="px-4 py-3 align-top text-[11px] text-slate-800">{year || "N/A"}</td>
                        <td className="px-4 py-3 align-top text-[11px] text-slate-800">{mileage || "N/A"}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-1">
                            <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-[11px] font-semibold text-emerald-700">{formatPrice(ad.price)}</span>
                          </div>
                          {ad.priceText && <div className="text-[9px] text-slate-400">{ad.priceText}</div>}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {ad.map?.url ? (
                            <a
                              href={ad.map.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                              Location
                            </a>
                          ) : (
                            <span className="text-[10px] text-slate-400 flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5" />
                              No map URL
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-wrap gap-2">
                            {ad.url && (
                              <a
                                href={ad.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-semibold transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Open
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => openModal(ad)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-semibold transition-colors"
                            >
                              <Info className="w-3.5 h-3.5" />
                              See More
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!loading && hasAds && totalPages > 1 && (
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-slate-600">Page {currentPage} of {totalPages}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {detailsModal.isOpen && detailsModal.ad && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-[calc(100vw-3rem)] sm:max-w-6xl xl:max-w-[1200px] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
              <div>
                <div className="text-[12px] font-semibold text-slate-900">Mobasher Ad Details</div>
                <div className="text-[10px] text-slate-500 line-clamp-1">
                  {detailsModal.ad.title || "Untitled"} {detailsModal.ad.adId ? `• #${detailsModal.ad.adId}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[82vh] overflow-y-auto px-5 py-5 space-y-6">
              <div className="space-y-4">
                <section className="space-y-3">
                  <div className="text-sm font-semibold text-slate-800 uppercase tracking-wide">Quick Facts</div>
                  <div className="flex flex-wrap gap-3">
                    {[
                      { label: "Ad ID", value: detailsModal.ad.adId },
                      { label: "Source", value: detailsModal.ad.source },
                      {
                        label: "Main Image",
                        value: detailsModal.ad.mainImage ? (
                          <a
                            href={detailsModal.ad.mainImage}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11px]"
                          >
                            <Image className="w-4 h-4" />
                            View
                          </a>
                        ) : (
                          "N/A"
                        )
                      },
                      {
                        label: "Created At",
                        value: detailsModal.ad.createdAt
                          ? new Date(detailsModal.ad.createdAt).toLocaleString()
                          : "N/A"
                      },
                      {
                        label: "Updated At",
                        value: detailsModal.ad.updatedAt
                          ? new Date(detailsModal.ad.updatedAt).toLocaleString()
                          : "N/A"
                      }
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="flex min-w-[160px] flex-1 flex-col gap-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]"
                      >
                        <div className="text-[9px] uppercase text-slate-400 tracking-wide">{item.label}</div>
                        <div className="text-slate-900">{item.value ?? "N/A"}</div>
                      </div>
                    ))}
                  </div>
                </section>
                <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
                  <section className="space-y-3">
                    <div className="text-sm font-semibold text-slate-800 uppercase tracking-wide">
                      Summary
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <DataRow label="Price" value={`${formatPrice(detailsModal.ad.price)} SAR`} />
                      <DataRow label="Currency" value={detailsModal.ad.currency || "N/A"} />
                      <DataRow
                        label="Posted At"
                        value={
                          detailsModal.ad.scrapedAt
                            ? new Date(detailsModal.ad.scrapedAt).toLocaleString()
                            : "N/A"
                        }
                      />
                      <DataRow label="Preferred Time" value={detailsModal.ad.preferredTime || "N/A"} />
                      <DataRow label="Contact" value={formatFieldValue(detailsModal.ad.contact)} />
                      <DataRow label="Ad Status" value={detailsModal.ad.status || "N/A"} />
                    </div>
                  </section>
                  <section className="space-y-3">
                    <div className="text-sm font-semibold text-slate-800 uppercase tracking-wide">
                      Location & Map
                    </div>
                    <div className="space-y-3">
                      <DataRow label="Region / City" value={detailsModal.ad.location || "N/A"} />
                      <DataRow
                        label="Map URL"
                        value={
                          detailsModal.ad.map?.url ? (
                            <a
                              href={detailsModal.ad.map.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11px]"
                            >
                              <MapPin className="w-4 h-4" />
                              Open map link
                            </a>
                          ) : (
                            "N/A"
                          )
                        }
                      />
                      <div className="rounded-2xl border border-dashed border-slate-300 p-3 text-[11px] text-slate-600">
                        <div className="text-[9px] uppercase text-slate-400 tracking-wide">Coordinates</div>
                        {detailsModal.ad.map?.coords ? (
                          <div>
                            <span className="font-semibold text-slate-800">
                              {detailsModal.ad.map.coords.lat?.toFixed(5) || "N/A"}
                            </span>{" "}
                            /
                            <span className="font-semibold text-slate-800">
                              {detailsModal.ad.map.coords.lng?.toFixed(5) || "N/A"}
                            </span>
                          </div>
                        ) : (
                          "N/A"
                        )}
                      </div>
                    </div>
                  </section>
                </div>
                <section className="space-y-3">
                  <div className="text-sm font-semibold text-slate-800 uppercase tracking-wide">Specs</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {Object.entries(detailsModal.ad.specs || {})
                      .filter(([key]) => !!key)
                      .map(([key, value]) => (
                        <DataRow key={key} label={SPEC_LABELS[key] || key} value={normalizeSpecValue(value)} />
                      ))}
                  </div>
                </section>
                <section className="space-y-3">
                  <div className="text-sm font-semibold text-slate-800 uppercase tracking-wide">All Attributes</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {extraAttributes.map((item) => (
                      <DataRow key={item.key} label={item.key} value={item.value} />
                    ))}
                  </div>
                </section>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              {detailsModal.ad.url && (
                <a
                  href={detailsModal.ad.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open source
                </a>
              )}
              <button
                type="button"
                onClick={closeModal}
                className="px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobasherData;
