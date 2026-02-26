import React, { useState, useEffect, useMemo } from "react";
import {
  Database,
  Filter,
  Search,
  RefreshCcw,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Download,
  Calendar,
  MapPin,
  DollarSign,
  User,
  Image as ImageIcon,
  Phone,
  ExternalLink,
  Loader2,
  X,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Maximize2,
  Info,
  FileText,
  Clock,
  Link as LinkIcon,
  Hash,
  Tag,
} from "lucide-react";

const API_BASE_URL = "http://167.71.231.64:3000";
const PRIVATE_COMMENT_MARKER =
  ":: \u0631\u062f \u062e\u0627\u0635. \u064a\u0638\u0647\u0631 \u0644\u0644\u0639\u0627\u0631\u0636 \u0641\u0642\u0637 ::";

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const isPrivateComment = (value) =>
  normalizeText(value) === normalizeText(PRIVATE_COMMENT_MARKER);

const extractCommentText = (comment) =>
  comment?.body ?? comment?.text ?? comment?.comment ?? "";

const getVisibleComments = (comments) =>
  (Array.isArray(comments) ? comments : []).filter(
    (comment) => !isPrivateComment(extractCommentText(comment)),
  );

const HarajData = () => {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showData, setShowData] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(10);

  // Image modal state
  const [imageModal, setImageModal] = useState({
    isOpen: false,
    images: [],
    currentIndex: 0,
    adTitle: "",
  });
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  // Details modal state
  const [detailsModal, setDetailsModal] = useState({
    isOpen: false,
    ad: null,
  });

  // Filters
  const [filters, setFilters] = useState({
    city: "",
    manufacturingYear: "",
    carBrand: "",
    hasPrice: "",
    hasImages: "",
    hasContact: "",
    search: "",
  });

  const [uniqueCities, setUniqueCities] = useState([]);
  const [uniqueManufacturingYears, setUniqueManufacturingYears] = useState([]);
  const [uniqueCarBrands, setUniqueCarBrands] = useState([]);

  // Load data
  const loadAds = async (page = 1) => {
    if (!showData || !window?.electronAPI) return;

    setLoading(true);
    setError("");
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });

      // Add filters to query
      if (filters.city) queryParams.append("city", filters.city);
      if (filters.manufacturingYear)
        queryParams.append("manufacturingYear", filters.manufacturingYear);
      if (filters.carBrand) queryParams.append("carBrand", filters.carBrand);
      if (filters.hasPrice === "yes") queryParams.append("hasPrice", "true");
      if (filters.hasPrice === "no") queryParams.append("hasPrice", "false");
      if (filters.hasImages === "yes") queryParams.append("hasImages", "true");
      if (filters.hasImages === "no") queryParams.append("hasImages", "false");
      if (filters.hasContact === "yes")
        queryParams.append("hasContact", "true");
      if (filters.hasContact === "no")
        queryParams.append("hasContact", "false");
      if (filters.search) queryParams.append("search", filters.search);

      const response = await window.electronAPI.apiRequest(
        "GET",
        `/api/ads/all?${queryParams.toString()}`,
      );

      if (response) {
        const items = response.items || [];

        // Debug: Log first item's images structure to help diagnose the issue
        if (items.length > 0) {
          const firstAd = items[0];
          console.log("=== FRONTEND DEBUG: First Ad Images ===");
          console.log("Raw images field:", firstAd.images);
          console.log("Images type:", typeof firstAd.images);
          console.log("Is array:", Array.isArray(firstAd.images));
          if (Array.isArray(firstAd.images)) {
            console.log("Images length:", firstAd.images.length);
            if (firstAd.images.length > 0) {
              console.log("First image:", firstAd.images[0]);
              console.log("First image type:", typeof firstAd.images[0]);
            }
          }
          console.log("Normalized images:", normalizeImages(firstAd.images));
          console.log(
            "Normalized count:",
            normalizeImages(firstAd.images).length,
          );
          // Check all fields that might contain images
          const imageFields = Object.keys(firstAd).filter(
            (k) =>
              k.toLowerCase().includes("image") ||
              k.toLowerCase().includes("photo") ||
              k.toLowerCase().includes("media") ||
              k.toLowerCase().includes("picture"),
          );
          console.log("Fields with image-related names:", imageFields);
          imageFields.forEach((field) => {
            console.log(`  ${field}:`, firstAd[field]);
          });
          console.log("=====================================");
        }

        setAds(items);
        setTotalPages(response.pages || 1);
        setTotal(response.total || 0);
        setCurrentPage(response.page || 1);
      }
    } catch (err) {
      const msg =
        err?.response?.data?.error || err?.message || "Failed to load ads data";
      setError(msg);
      setAds([]);
    } finally {
      setLoading(false);
    }
  };

  // Load unique values for filters
  const loadFilterOptions = async () => {
    if (!window?.electronAPI) return;
    try {
      const response = await window.electronAPI.apiRequest(
        "GET",
        "/api/ads/all?limit=5000",
      );
      if (response?.items) {
        const cities = [
          ...new Set(response.items.map((ad) => ad.city).filter(Boolean)),
        ].sort();

        // Extract manufacturing years (backend extracts them)
        const years = [
          ...new Set(
            response.items
              .map((ad) => ad.manufacturingYear)
              .filter((y) => y !== null && y !== undefined),
          ),
        ].sort((a, b) => b - a);
        setUniqueManufacturingYears(years);

        // Extract car brands (backend extracts them)
        const brands = [
          ...new Set(response.items.map((ad) => ad.carBrand).filter(Boolean)),
        ].sort();
        setUniqueCarBrands(brands);

        setUniqueCities(cities);
      }
    } catch (err) {
      console.error("Failed to load filter options:", err);
    }
  };

  useEffect(() => {
    if (showData) {
      loadAds(currentPage);
    }
  }, [showData, currentPage, filters]);

  useEffect(() => {
    loadFilterOptions();
  }, []);

  // Keyboard navigation for image modal
  useEffect(() => {
    if (!imageModal.isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        closeImageModal();
      } else if (e.key === "ArrowUp" && imageModal.images.length > 1) {
        const container = document.getElementById("image-scroll-container");
        if (container) {
          const imageHeight = container.clientHeight;
          container.scrollBy({ top: -imageHeight, behavior: "smooth" });
        }
        setImageModal((prev) => ({
          ...prev,
          currentIndex:
            (prev.currentIndex - 1 + prev.images.length) % prev.images.length,
        }));
      } else if (e.key === "ArrowDown" && imageModal.images.length > 1) {
        const container = document.getElementById("image-scroll-container");
        if (container) {
          const imageHeight = container.clientHeight;
          container.scrollBy({ top: imageHeight, behavior: "smooth" });
        }
        setImageModal((prev) => ({
          ...prev,
          currentIndex: (prev.currentIndex + 1) % prev.images.length,
        }));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageModal.isOpen, imageModal.images.length]);

  // Scroll to correct position when modal opens or currentIndex changes
  useEffect(() => {
    if (!imageModal.isOpen || imageModal.images.length === 0) return;

    const container = document.getElementById("image-scroll-container");
    if (container) {
      const imageHeight = container.clientHeight;
      container.scrollTo({
        top: imageHeight * imageModal.currentIndex,
        behavior: "smooth",
      });
    }
  }, [imageModal.isOpen, imageModal.currentIndex]);

  // Update currentIndex based on scroll position
  useEffect(() => {
    if (!imageModal.isOpen || imageModal.images.length === 0) return;

    const container = document.getElementById("image-scroll-container");
    if (!container) return;

    const handleScroll = () => {
      const imageHeight = container.clientHeight;
      const scrollTop = container.scrollTop;
      const newIndex = Math.round(scrollTop / imageHeight);

      if (
        newIndex !== imageModal.currentIndex &&
        newIndex >= 0 &&
        newIndex < imageModal.images.length
      ) {
        setImageModal((prev) => ({
          ...prev,
          currentIndex: newIndex,
        }));
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [imageModal.isOpen, imageModal.images.length, imageModal.currentIndex]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const handleShowData = () => {
    setShowData(true);
    setCurrentPage(1);
  };

  const handleHideData = () => {
    setShowData(false);
    setAds([]);
  };

  const parseDateValue = (value) => {
    if (value === null || value === undefined || value === "") return null;

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const ms = numeric > 1e12 ? numeric : numeric * 1000;
      const numericDate = new Date(ms);
      return Number.isNaN(numericDate.getTime()) ? null : numericDate;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const formatDate = (dateValue) => {
    const parsedDate = parseDateValue(dateValue);
    if (!parsedDate) return "N/A";

    return parsedDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getAdPostedDate = (ad) => {
    const postDate = ad?.item?.postDate ?? ad?.postDate;
    const formatted = formatDate(postDate);
    if (formatted !== "N/A") return formatted;
    return ad?.postedRelativeTime || formatDate(ad?.lastScrapedAt) || "N/A";
  };

  const formatPrice = (price, currency) => {
    if (!price) return "N/A";
    const formatted = new Intl.NumberFormat("en-US").format(price);
    return currency ? `${formatted} ${currency}` : formatted;
  };

  // Open details modal
  const openDetailsModal = (ad) => {
    setDetailsModal({
      isOpen: true,
      ad: ad,
    });
  };

  // Close details modal
  const closeDetailsModal = () => {
    setDetailsModal({
      isOpen: false,
      ad: null,
    });
  };

  // Format value for display
  const formatValue = (value) => {
    if (value === null || value === undefined) return "N/A";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object" && !Array.isArray(value)) {
      return JSON.stringify(value, null, 2);
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? `${value.length} item(s)` : "Empty";
    }
    return String(value);
  };

  // Get field label
  const getFieldLabel = (key) => {
    const labels = {
      _id: "ID",
      haraj_id: "Haraj ID",
      adId: "Ad ID",
      url: "URL",
      title: "Title",
      city: "City",
      postedRelativeTime: "Posted Time",
      price: "Price",
      currency: "Currency",
      description: "Description",
      contact: "Contact",
      images: "Images",
      comments: "Comments",
      lastScrapedAt: "Last Scraped",
      tracking: "Tracking",
      scrapeRuns: "Scrape Runs",
      createdAt: "Created At",
      updatedAt: "Updated At",
    };
    return (
      labels[key] ||
      key.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase())
    );
  };

  const filteredAds = useMemo(() => {
    if (!filters.search) return ads;
    const searchLower = filters.search.toLowerCase();
    return ads.filter(
      (ad) =>
        ad.title?.toLowerCase().includes(searchLower) ||
        ad.description?.toLowerCase().includes(searchLower) ||
        ad.city?.toLowerCase().includes(searchLower),
    );
  }, [ads, filters.search]);

  // Normalize images array - handle both string URLs and objects
  const normalizeImages = (images, ad = null) => {
    // Handle null, undefined, or empty values
    if (!images) return [];

    // Helper function to extract URL from any structure
    const extractUrl = (item) => {
      if (!item) return null;

      // If it's a string, accept it if it's not empty
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (!trimmed) return null;

        // Accept full URLs
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          return trimmed;
        }
        // Accept protocol-relative URLs
        if (trimmed.startsWith("//")) {
          return "https:" + trimmed;
        }
        // Accept relative URLs - try to construct full URL
        if (trimmed.startsWith("/") && ad && ad.url) {
          try {
            const baseUrl = new URL(ad.url);
            return new URL(trimmed, baseUrl.origin).href;
          } catch {
            return trimmed;
          }
        }
        // Accept any non-empty string (might be a valid path/URL)
        return trimmed;
      }

      // If it's an object, try to extract URL from various properties
      // Prioritize originalUrl and cloudinaryUrl (Haraj format)
      if (typeof item === "object" && item !== null) {
        // Try direct URL properties first - check originalUrl and cloudinaryUrl first (Haraj format)
        const url =
          item.originalUrl ||
          item.cloudinaryUrl ||
          item.url ||
          item.src ||
          item.link ||
          item.image ||
          item.imageUrl ||
          item.path ||
          item.uri ||
          item.href ||
          item.original ||
          item.full ||
          item.thumbnail ||
          item.value ||
          item.data;
        if (url) {
          if (typeof url === "string") {
            const trimmed = url.trim();
            if (!trimmed) return null;
            // Accept any string that looks like a URL or path
            if (
              trimmed.startsWith("http://") ||
              trimmed.startsWith("https://") ||
              trimmed.startsWith("//") ||
              trimmed.startsWith("/")
            ) {
              if (trimmed.startsWith("//")) {
                return "https:" + trimmed;
              }
              if (trimmed.startsWith("/") && ad && ad.url) {
                try {
                  const baseUrl = new URL(ad.url);
                  return new URL(trimmed, baseUrl.origin).href;
                } catch {
                  return trimmed;
                }
              }
              return trimmed;
            }
            // Even if it doesn't start with http, accept it
            return trimmed;
          } else if (typeof url === "object") {
            // Nested object, recurse
            return extractUrl(url);
          }
        }

        // Try nested structures (e.g., item.data.url, item.media.url)
        if (item.data && typeof item.data === "object") {
          const nestedUrl = extractUrl(item.data);
          if (nestedUrl) return nestedUrl;
        }
        if (item.media && typeof item.media === "object") {
          const nestedUrl = extractUrl(item.media);
          if (nestedUrl) return nestedUrl;
        }

        // If object has array properties, try to extract from them
        if (Array.isArray(item.items)) {
          const urls = item.items.map((i) => extractUrl(i)).filter(Boolean);
          return urls.length > 0 ? urls : null;
        }
      }

      return null;
    };

    // Get the ad object for context (we'll pass it through)
    // Note: We can't access ad here, so we'll handle relative URLs in the display logic

    // If it's a string, try to parse it as JSON first
    if (typeof images === "string") {
      try {
        const parsed = JSON.parse(images);
        images = parsed;
      } catch {
        // If not JSON, treat as single URL string
        const url = extractUrl(images);
        return url ? (Array.isArray(url) ? url : [url]) : [];
      }
    }

    // If it's not an array, try to convert it
    if (!Array.isArray(images)) {
      const url = extractUrl(images);
      if (url) {
        return Array.isArray(url) ? url : [url];
      }
      return [];
    }

    // Process array of images - recursively extract URLs
    const urls = [];
    for (const img of images) {
      const url = extractUrl(img);
      if (url) {
        if (Array.isArray(url)) {
          urls.push(...url);
        } else {
          urls.push(url);
        }
      } else if (Array.isArray(img)) {
        // Handle nested arrays
        const nestedUrls = img.map((i) => extractUrl(i)).filter(Boolean);
        urls.push(...nestedUrls);
      }
    }

    return urls.filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates
  };

  // Open image modal
  const openImageModal = (images, adTitle, startIndex = 0, ad = null) => {
    const normalizedImages = normalizeImages(images, ad);
    if (normalizedImages.length === 0) {
      console.warn("No images to display after normalization");
      return;
    }

    setImageLoading(true);
    setImageError(false);
    setImageModal({
      isOpen: true,
      images: normalizedImages,
      currentIndex: Math.min(startIndex, normalizedImages.length - 1),
      adTitle: adTitle || "Images",
    });
  };

  // Close image modal
  const closeImageModal = () => {
    setImageModal({
      isOpen: false,
      images: [],
      currentIndex: 0,
      adTitle: "",
    });
  };

  // Navigate images in modal
  const navigateImage = (direction) => {
    const { images, currentIndex } = imageModal;
    setImageLoading(true);
    setImageError(false);
    if (direction === "next") {
      setImageModal((prev) => ({
        ...prev,
        currentIndex: (prev.currentIndex + 1) % images.length,
      }));
    } else {
      setImageModal((prev) => ({
        ...prev,
        currentIndex: (prev.currentIndex - 1 + images.length) % images.length,
      }));
    }
  };

  // Download image using Electron
  const downloadImage = async (imageUrl, imageName) => {
    if (!imageUrl || typeof imageUrl !== "string") {
      console.error("Invalid image URL:", imageUrl);
      return;
    }

    try {
      // Ensure imageName is a string
      let safeImageName =
        typeof imageName === "string"
          ? imageName
          : `haraj-image-${Date.now()}.${imageUrl.split(".").pop()?.split("?")[0] || "jpg"}`;

      // Clean filename - remove invalid characters
      safeImageName = safeImageName
        .replace(/[^a-z0-9.-]/gi, "-")
        .replace(/-+/g, "-")
        .substring(0, 200);

      // Use Electron API for download
      if (window.electronAPI && window.electronAPI.downloadImage) {
        try {
          const result = await window.electronAPI.downloadImage(
            imageUrl,
            safeImageName,
          );
          if (result?.status === "SUCCESS") {
            return;
          } else if (result?.status === "CANCELED") {
            return; // User canceled
          } else {
            throw new Error(result?.error || "Download failed");
          }
        } catch (electronError) {
          console.warn("Electron download failed:", electronError);
          // Fallback to opening in browser
          if (window.electronAPI && window.electronAPI.openExternal) {
            await window.electronAPI.openExternal(imageUrl);
          }
        }
      } else {
        // Fallback: open in external browser
        if (window.electronAPI && window.electronAPI.openExternal) {
          await window.electronAPI.openExternal(imageUrl);
        } else {
          window.open(imageUrl, "_blank");
        }
      }
    } catch (error) {
      console.error("Failed to download image:", error);
      // Final fallback: open in external browser
      if (window.electronAPI && window.electronAPI.openExternal) {
        await window.electronAPI.openExternal(imageUrl);
      } else {
        window.open(imageUrl, "_blank");
      }
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-900/15 bg-gradient-to-r from-white via-emerald-50 to-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-lg">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-emerald-950">Haraj Data</h1>
            <p className="text-[11px] text-slate-600">
              View and filter scraped Haraj advertisements
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showData && (
            <button
              type="button"
              onClick={loadAds.bind(null, currentPage)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-900/20 bg-white px-3 py-2 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCcw className="w-4 h-4" />
              )}
              Refresh
            </button>
          )}
          <button
            type="button"
            onClick={showData ? handleHideData : handleShowData}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[11px] font-semibold shadow-sm transition-all ${
              showData
                ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                : "bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700"
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

      {/* Filters */}
      {showData && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-slate-500" />
            <h2 className="text-[13px] font-semibold text-slate-900">
              Filters
            </h2>
          </div>
          <div className="flex items-end gap-2 overflow-x-auto">
            {/* Search */}
            <div className="flex-shrink-0 w-[180px]">
              <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => handleFilterChange("search", e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-8 pr-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
            </div>

            {/* City */}
            <div className="flex-shrink-0 w-[120px]">
              <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                City
              </label>
              <select
                value={filters.city}
                onChange={(e) => handleFilterChange("city", e.target.value)}
                className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                <option value="">All Cities</option>
                {uniqueCities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </div>

            {/* Manufacturing Year */}
            <div className="flex-shrink-0 w-[110px]">
              <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                Year
              </label>
              <select
                value={filters.manufacturingYear}
                onChange={(e) =>
                  handleFilterChange("manufacturingYear", e.target.value)
                }
                className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                <option value="">All Years</option>
                {uniqueManufacturingYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            {/* Car Brand */}
            <div className="flex-shrink-0 w-[130px]">
              <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                Brand
              </label>
              <select
                value={filters.carBrand}
                onChange={(e) => handleFilterChange("carBrand", e.target.value)}
                className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                <option value="">All Brands</option>
                {uniqueCarBrands.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </div>

            {/* Has Price */}
            <div className="flex-shrink-0 w-[90px]">
              <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                Has Price
              </label>
              <select
                value={filters.hasPrice}
                onChange={(e) => handleFilterChange("hasPrice", e.target.value)}
                className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                <option value="">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            {/* Has Images */}
            <div className="flex-shrink-0 w-[90px]">
              <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                Has Images
              </label>
              <select
                value={filters.hasImages}
                onChange={(e) =>
                  handleFilterChange("hasImages", e.target.value)
                }
                className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                <option value="">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            {/* Has Contact */}
            <div className="flex-shrink-0 w-[100px]">
              <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                Has Contact
              </label>
              <select
                value={filters.hasContact}
                onChange={(e) =>
                  handleFilterChange("hasContact", e.target.value)
                }
                className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                <option value="">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      {/* Data Table */}
      {showData && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Table Header Info */}
          <div className="px-4 py-3 bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold text-slate-700">
                Total Records:{" "}
                <span className="text-emerald-600">
                  {total.toLocaleString()}
                </span>
              </span>
              <span className="text-[10px] text-slate-500">
                Showing {(currentPage - 1) * limit + 1} -{" "}
                {Math.min(currentPage * limit, total)} of {total}
              </span>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
          ) : filteredAds.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Database className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-[13px] font-semibold text-slate-600">
                No data found
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Try adjusting your filters
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      Title
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      City
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      Price
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      Posted
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      Images
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      Contact
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredAds.map((ad, index) => (
                    <tr
                      key={ad._id || ad.haraj_id || index}
                      className="hover:bg-emerald-50/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="max-w-xs">
                          <p className="text-[11px] font-semibold text-slate-900 line-clamp-2">
                            {ad.title || "N/A"}
                          </p>
                          {ad.description && (
                            <p className="text-[10px] text-slate-500 mt-1 line-clamp-1">
                              {ad.description}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-[11px] text-slate-700">
                            {ad.city || "N/A"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {ad.price ? (
                          <div className="flex items-center gap-1.5">
                            <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-[11px] font-semibold text-emerald-700">
                              {formatPrice(ad.price, ad.currency)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            N/A
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-[11px] text-slate-600">
                            {getAdPostedDate(ad)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const normalizedImages = normalizeImages(
                            ad.images,
                            ad,
                          );
                          return normalizedImages.length > 0 ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  openImageModal(ad.images, ad.title, 0, ad)
                                }
                                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors group"
                              >
                                <ImageIcon className="w-3.5 h-3.5" />
                                <span className="text-[11px] font-semibold">
                                  {normalizedImages.length}
                                </span>
                                <Maximize2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              0
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        {ad.contact?.phone ? (
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-green-600" />
                            <span className="text-[11px] text-green-700 font-semibold">
                              Yes
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {ad.url && (
                            <a
                              href={ad.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-semibold transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              View in Haraj
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => openDetailsModal(ad)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-semibold transition-colors"
                          >
                            <Info className="w-3.5 h-3.5" />
                            See More
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && filteredAds.length > 0 && totalPages > 1 && (
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <div className="text-[11px] text-slate-600">
                Page {currentPage} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage((prev) => Math.max(1, prev - 1))
                  }
                  disabled={currentPage === 1 || loading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                  }
                  disabled={currentPage === totalPages || loading}
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

      {/* Empty State */}
      {!showData && (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50">
          <div className="h-20 w-20 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center mb-4">
            <Database className="w-10 h-10 text-emerald-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">
            Ready to View Haraj Data
          </h2>
          <p className="text-[12px] text-slate-600 max-w-md mb-6">
            Click the "Show Data" button above to load and display all scraped
            Haraj advertisements with advanced filtering options.
          </p>
        </div>
      )}

      {/* Image Modal */}
      {imageModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="relative w-full h-full flex flex-col items-center justify-center p-4">
            {/* Close Button */}
            <button
              type="button"
              onClick={closeImageModal}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Image Counter */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm text-white text-[12px] font-semibold">
              {imageModal.currentIndex + 1} / {imageModal.images.length}
            </div>

            {/* Title */}
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 max-w-2xl">
              <h3 className="text-white text-sm font-semibold text-center line-clamp-2 px-4 py-2 rounded-lg bg-black/50 backdrop-blur-sm">
                {imageModal.adTitle}
              </h3>
            </div>

            {/* Main Image Container - Vertical Scrollable */}
            <div className="relative w-full max-w-6xl h-full max-h-[90vh] flex flex-col items-center justify-center mt-20 mb-16">
              {/* Previous Button (Top) */}
              {imageModal.images.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const container = document.getElementById(
                      "image-scroll-container",
                    );
                    if (container) {
                      const imageHeight = container.clientHeight;
                      container.scrollBy({
                        top: -imageHeight,
                        behavior: "smooth",
                      });
                    }
                    navigateImage("prev");
                  }}
                  className="absolute top-20 left-1/2 -translate-x-1/2 z-20 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors shadow-lg"
                  title="Previous Image"
                >
                  <ChevronLeftIcon className="w-6 h-6 rotate-90" />
                </button>
              )}

              {/* Vertical Scrollable Image Container */}
              <div
                id="image-scroll-container"
                className="w-full h-full overflow-y-auto overflow-x-hidden snap-y snap-mandatory flex flex-col"
                style={{
                  scrollbarWidth: "thin",
                  scrollbarColor: "rgba(255,255,255,0.3) transparent",
                  WebkitOverflowScrolling: "touch",
                }}
              >
                {imageModal.images.map((img, idx) => {
                  // Extract image URL
                  let imageUrl = "";
                  if (typeof img === "string") {
                    imageUrl = img;
                  } else if (typeof img === "object" && img !== null) {
                    imageUrl =
                      img.url ||
                      img.src ||
                      img.link ||
                      img.image ||
                      img.imageUrl ||
                      "";
                  } else {
                    imageUrl = String(img);
                  }

                  if (
                    !imageUrl ||
                    (!imageUrl.startsWith("http://") &&
                      !imageUrl.startsWith("https://"))
                  ) {
                    return null;
                  }

                  return (
                    <div
                      key={idx}
                      className="flex-shrink-0 w-full h-full snap-center flex items-center justify-center relative min-h-[70vh] py-4"
                    >
                      {imageLoading && idx === imageModal.currentIndex && (
                        <div className="absolute inset-0 flex items-center justify-center z-10">
                          <Loader2 className="w-12 h-12 animate-spin text-white" />
                        </div>
                      )}
                      <img
                        src={imageUrl}
                        alt={`Image ${idx + 1} - ${imageModal.adTitle}`}
                        className={`max-w-full max-h-[70vh] object-contain rounded-lg shadow-2xl transition-opacity duration-300 ${
                          imageLoading && idx === imageModal.currentIndex
                            ? "opacity-0"
                            : "opacity-100"
                        }`}
                        loading="lazy"
                        onError={(e) => {
                          e.target.onerror = null;
                          if (idx === imageModal.currentIndex) {
                            setImageLoading(false);
                            setImageError(true);
                          }
                        }}
                        onLoad={(e) => {
                          if (idx === imageModal.currentIndex) {
                            setImageLoading(false);
                            setImageError(false);
                          }
                          e.target.style.opacity = "1";
                        }}
                      />
                      {imageError && idx === imageModal.currentIndex && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-black/50 rounded-lg z-10">
                          <ImageIcon className="w-16 h-16 mb-4 opacity-50" />
                          <p className="text-sm">
                            Failed to load image in modal
                          </p>
                          <p className="text-xs mt-2 opacity-75 mb-4 px-4 text-center break-all">
                            URL:{" "}
                            {imageUrl.length > 80
                              ? imageUrl.substring(0, 80) + "..."
                              : imageUrl}
                          </p>
                          {window.electronAPI &&
                            window.electronAPI.showImageWindow && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    if (
                                      !imageUrl ||
                                      typeof imageUrl !== "string"
                                    ) {
                                      console.error(
                                        "Invalid image URL:",
                                        imageUrl,
                                      );
                                      return;
                                    }
                                    await window.electronAPI.showImageWindow(
                                      imageUrl,
                                    );
                                  } catch (err) {
                                    console.error(
                                      "Failed to open image window:",
                                      err,
                                    );
                                  }
                                }}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold"
                              >
                                Open in Electron Browser
                              </button>
                            )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Next Button (Bottom) */}
              {imageModal.images.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const container = document.getElementById(
                      "image-scroll-container",
                    );
                    if (container) {
                      const imageHeight = container.clientHeight;
                      container.scrollBy({
                        top: imageHeight,
                        behavior: "smooth",
                      });
                    }
                    navigateImage("next");
                  }}
                  className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors shadow-lg"
                  title="Next Image"
                >
                  <ChevronRightIcon className="w-6 h-6 rotate-90" />
                </button>
              )}
            </div>

            {/* Download Button */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
              <button
                type="button"
                onClick={async () => {
                  let currentImage = imageModal.images[imageModal.currentIndex];

                  // Ensure we have a string URL
                  if (typeof currentImage !== "string") {
                    if (
                      typeof currentImage === "object" &&
                      currentImage !== null
                    ) {
                      currentImage =
                        currentImage.url ||
                        currentImage.src ||
                        currentImage.link ||
                        currentImage.image ||
                        currentImage.imageUrl ||
                        "";
                    } else {
                      currentImage = String(currentImage);
                    }
                  }

                  if (
                    !currentImage ||
                    currentImage.trim() === "" ||
                    (!currentImage.startsWith("http://") &&
                      !currentImage.startsWith("https://"))
                  ) {
                    console.error(
                      "Invalid image URL for download:",
                      currentImage,
                    );
                    return;
                  }

                  // Extract file extension from URL
                  const urlParts = currentImage.split(".");
                  const extension =
                    urlParts.length > 1
                      ? urlParts[urlParts.length - 1].split("?")[0]
                      : "jpg";

                  // Create safe filename
                  const safeTitle = (imageModal.adTitle || "haraj-image")
                    .replace(/[^a-z0-9]/gi, "-")
                    .toLowerCase()
                    .substring(0, 50);

                  const imageName = `${safeTitle}-${imageModal.currentIndex + 1}.${extension}`;
                  await downloadImage(currentImage, imageName);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[12px] shadow-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                Download Image
              </button>
            </div>

            {/* Custom Scrollbar Styles */}
            <style>{`
                            #image-scroll-container::-webkit-scrollbar {
                                width: 8px;
                            }
                            #image-scroll-container::-webkit-scrollbar-track {
                                background: rgba(0, 0, 0, 0.2);
                                border-radius: 4px;
                            }
                            #image-scroll-container::-webkit-scrollbar-thumb {
                                background: rgba(255, 255, 255, 0.3);
                                border-radius: 4px;
                            }
                            #image-scroll-container::-webkit-scrollbar-thumb:hover {
                                background: rgba(255, 255, 255, 0.5);
                            }
                        `}</style>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {detailsModal.isOpen && detailsModal.ad && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-7xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Ad Details</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDetailsModal}
                className="p-2 rounded-lg hover:bg-white/20 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* First Row: Title, Price, Posted Time, Description */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                {/* Title */}
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-3 hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-2">
                    <div className="h-5 w-5 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-3 h-3 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[9px] font-semibold text-slate-700 uppercase tracking-wide mb-1">
                        Title
                      </h3>
                      <p className="text-[11px] font-semibold text-slate-900 line-clamp-2 break-words">
                        {detailsModal.ad.title || "N/A"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Price */}
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-3 hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-2">
                    <div className="h-5 w-5 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <DollarSign className="w-3 h-3 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[9px] font-semibold text-slate-700 uppercase tracking-wide mb-1">
                        Price
                      </h3>
                      <p className="text-[11px] font-semibold text-emerald-700">
                        {detailsModal.ad.price
                          ? formatPrice(
                              detailsModal.ad.price,
                              detailsModal.ad.currency,
                            )
                          : "N/A"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Posted Time */}
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-3 hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-2">
                    <div className="h-5 w-5 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <Clock className="w-3 h-3 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[9px] font-semibold text-slate-700 uppercase tracking-wide mb-1">
                        Posted Time
                      </h3>
                      <p className="text-[11px] text-slate-700">
                        {getAdPostedDate(detailsModal.ad)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-3 hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-2">
                    <div className="h-5 w-5 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-3 h-3 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[9px] font-semibold text-slate-700 uppercase tracking-wide mb-1">
                        Description
                      </h3>
                      <p className="text-[11px] text-slate-700 line-clamp-3 break-words">
                        {detailsModal.ad.description || "N/A"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Second Row: City, Comments, Contact, Created At, URL */}
              <div className="grid grid-cols-5 gap-3 mb-4">
                {/* City */}
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-2 hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-1.5">
                    <div className="h-5 w-5 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-3 h-3 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[9px] font-semibold text-slate-700 uppercase tracking-wide mb-0.5">
                        City
                      </h3>
                      <p className="text-[10px] text-slate-900 line-clamp-2 break-words">
                        {detailsModal.ad.city || "N/A"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Comments - Special handling */}
                {(() => {
                  const comments = getVisibleComments(detailsModal.ad.comments);
                  const hasComments =
                    Array.isArray(comments) && comments.length > 0;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-2 hover:shadow-sm transition-shadow">
                      <div className="flex items-start gap-1.5">
                        <div className="h-5 w-5 rounded-md bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-3 h-3 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-[9px] font-semibold text-slate-700 uppercase tracking-wide mb-0.5">
                            Comments
                          </h3>
                          {hasComments ? (
                            <p className="text-[10px] font-semibold text-blue-700">
                              {comments.length} comment(s)
                            </p>
                          ) : (
                            <p className="text-[9px] text-slate-500 italic">
                              No comments
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Contact - Special handling */}
                {(() => {
                  const contact = detailsModal.ad.contact;
                  const phone = contact?.phone;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-2 hover:shadow-sm transition-shadow">
                      <div className="flex items-start gap-1.5">
                        <div className="h-5 w-5 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                          <Phone className="w-3 h-3 text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-[9px] font-semibold text-slate-700 uppercase tracking-wide mb-0.5">
                            Contact
                          </h3>
                          {phone ? (
                            <a
                              href={`tel:${phone}`}
                              className="text-[10px] font-semibold text-green-700 hover:text-green-800 transition-colors line-clamp-1 break-all"
                            >
                              {phone}
                            </a>
                          ) : (
                            <p className="text-[9px] text-slate-500 italic">
                              No phone
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Created At */}
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-2 hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-1.5">
                    <div className="h-5 w-5 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <Calendar className="w-3 h-3 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[9px] font-semibold text-slate-700 uppercase tracking-wide mb-0.5">
                        Created At
                      </h3>
                      <p className="text-[10px] text-slate-700 line-clamp-2 break-words">
                        {formatDate(detailsModal.ad.createdAt) || "N/A"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* URL */}
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-2 hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-1.5">
                    <div className="h-5 w-5 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <LinkIcon className="w-3 h-3 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[9px] font-semibold text-slate-700 uppercase tracking-wide mb-0.5">
                        URL
                      </h3>
                      {detailsModal.ad.url ? (
                        <a
                          href={detailsModal.ad.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-blue-600 hover:text-blue-800 transition-colors line-clamp-2 break-all"
                        >
                          {detailsModal.ad.url.length > 40
                            ? detailsModal.ad.url.substring(0, 40) + "..."
                            : detailsModal.ad.url}
                        </a>
                      ) : (
                        <p className="text-[9px] text-slate-500 italic">N/A</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Remaining Fields in 3-column grid */}
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(detailsModal.ad)
                  .filter(([key]) => {
                    // Remove these fields (including title, price, postedRelativeTime, description, city, comments, contact, createdAt, url, and author fields)
                    const excludedFields = [
                      "_id",
                      "haraj_id",
                      "adId",
                      "lastScrapedAt",
                      "scrapeRuns",
                      "tracking",
                      "updatedAt",
                      "__v",
                      "title",
                      "price",
                      "currency",
                      "postedRelativeTime",
                      "description",
                      "city",
                      "comments",
                      "contact",
                      "createdAt",
                      "url",
                      "authorName",
                      "authorUrl",
                    ];
                    return !excludedFields.includes(key);
                  })
                  .map(([key, value]) => {
                    const label = getFieldLabel(key);
                    const isLongText =
                      typeof value === "string" && value.length > 100;
                    const isObject =
                      typeof value === "object" &&
                      value !== null &&
                      !Array.isArray(value);
                    const isArray = Array.isArray(value);

                    // Get icon based on field type
                    const getIcon = () => {
                      if (key.includes("url") || key === "url") return LinkIcon;
                      if (key === "images") return ImageIcon;
                      if (key === "contact" || key.includes("phone"))
                        return Phone;
                      if (key === "price" || key === "currency")
                        return DollarSign;
                      if (key === "city") return MapPin;
                      if (key === "comments") return FileText;
                      return Tag;
                    };

                    const Icon = getIcon();

                    // Skip fields already handled in first and second rows
                    if (
                      key === "contact" ||
                      key === "comments" ||
                      key === "city" ||
                      key === "url" ||
                      key === "createdAt" ||
                      key === "description"
                    ) {
                      return null;
                    }

                    // Special handling for Images field - Full width
                    if (key === "images") {
                      const normalizedImages = normalizeImages(
                        value,
                        detailsModal.ad,
                      );
                      const hasImages = normalizedImages.length > 0;
                      return (
                        <div
                          key={key}
                          className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-2.5 hover:shadow-sm transition-shadow w-full"
                          style={{ gridColumn: "1 / -1" }}
                        >
                          <div className="flex items-start gap-2">
                            <div className="h-6 w-6 rounded-md bg-purple-100 flex items-center justify-center flex-shrink-0">
                              <ImageIcon className="w-3.5 h-3.5 text-purple-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-2">
                                <h3 className="text-[10px] font-semibold text-slate-700 uppercase tracking-wide">
                                  {label}{" "}
                                  {hasImages && (
                                    <span className="text-purple-600">
                                      ({normalizedImages.length})
                                    </span>
                                  )}
                                </h3>
                                {hasImages && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openImageModal(
                                        value,
                                        detailsModal.ad.title,
                                        0,
                                        detailsModal.ad,
                                      )
                                    }
                                    className="text-[9px] px-2 py-1 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-md font-semibold transition-colors flex items-center gap-1"
                                  >
                                    <Maximize2 className="w-3 h-3" />
                                    View All
                                  </button>
                                )}
                              </div>
                              {hasImages ? (
                                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                                  {normalizedImages.map((imgUrl, idx) => (
                                    <div
                                      key={idx}
                                      className="group relative aspect-square rounded-lg overflow-hidden border-2 border-slate-200 hover:border-purple-400 transition-all cursor-pointer bg-slate-100"
                                      onClick={() =>
                                        openImageModal(
                                          value,
                                          detailsModal.ad.title,
                                          idx,
                                          detailsModal.ad,
                                        )
                                      }
                                    >
                                      <img
                                        src={imgUrl}
                                        alt={`Image ${idx + 1}`}
                                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"
                                        onError={(e) => {
                                          e.target.style.display = "none";
                                          e.target.parentElement.innerHTML =
                                            '<div class="w-full h-full flex items-center justify-center text-[10px] text-slate-400">Error</div>';
                                        }}
                                      />
                                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                        <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                      </div>
                                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[9px] text-white font-semibold">
                                            #{idx + 1}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={async (e) => {
                                              e.stopPropagation();
                                              const safeTitle = (
                                                detailsModal.ad.title || "haraj"
                                              )
                                                .replace(/[^a-z0-9]/gi, "-")
                                                .toLowerCase()
                                                .substring(0, 50);
                                              const extension =
                                                imgUrl
                                                  .split(".")
                                                  .pop()
                                                  ?.split("?")[0] || "jpg";
                                              await downloadImage(
                                                imgUrl,
                                                `${safeTitle}-${idx + 1}.${extension}`,
                                              );
                                            }}
                                            className="p-1 bg-white/20 hover:bg-white/30 rounded transition-colors"
                                            title="Download image"
                                          >
                                            <Download className="w-3 h-3 text-white" />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 px-3 py-4 bg-slate-50 border-2 border-dashed border-slate-200 rounded-md">
                                  <ImageIcon className="w-4 h-4 text-slate-300" />
                                  <span className="text-[11px] text-slate-400 italic">
                                    No images available
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Default handling for other fields
                    const displayValue = formatValue(value);
                    return (
                      <div
                        key={key}
                        className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-2 hover:shadow-sm transition-shadow"
                      >
                        <div className="flex items-start gap-1.5">
                          <div className="h-5 w-5 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                            <Icon className="w-3 h-3 text-emerald-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-[9px] font-semibold text-slate-700 uppercase tracking-wide mb-0.5">
                              {label}
                            </h3>
                            <div className="text-[10px] text-slate-900">
                              {isObject ? (
                                <pre className="whitespace-pre-wrap break-words text-[9px] bg-slate-100 p-1 rounded border border-slate-200 max-h-20 overflow-y-auto">
                                  {displayValue}
                                </pre>
                              ) : isLongText ? (
                                <div className="bg-slate-100 p-1 rounded border border-slate-200 max-h-16 overflow-y-auto">
                                  <p className="text-[9px] whitespace-pre-wrap break-words">
                                    {displayValue}
                                  </p>
                                </div>
                              ) : (
                                <p className="break-words text-[10px] line-clamp-2">
                                  {displayValue}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <div className="text-[11px] text-slate-600">
                Total Fields:{" "}
                {
                  Object.keys(detailsModal.ad).filter(
                    (k) =>
                      ![
                        "_id",
                        "haraj_id",
                        "adId",
                        "lastScrapedAt",
                        "scrapeRuns",
                        "tracking",
                        "updatedAt",
                        "__v",
                        "authorName",
                        "authorUrl",
                      ].includes(k),
                  ).length
                }
              </div>
              <div className="flex items-center gap-2">
                {detailsModal.ad.url && (
                  <a
                    href={detailsModal.ad.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View in Haraj
                  </a>
                )}
                <button
                  type="button"
                  onClick={closeDetailsModal}
                  className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-semibold transition-colors"
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

export default HarajData;
