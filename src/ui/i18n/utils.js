const LANG_STORAGE_KEY = 'valueTech.language';
const SUPPORTED_LANGS = ['en', 'ar'];

const normalizeLang = (lang) => {
    if (!lang) return null;
    return String(lang).trim().toLowerCase().split('-')[0];
};

const isSupportedLang = (lang) => SUPPORTED_LANGS.includes(lang);

const getPathLanguage = (pathname) => {
    if (!pathname) return null;
    const segments = pathname.split('/').filter(Boolean);
    if (!segments.length) return null;
    const candidate = normalizeLang(segments[0]);
    return isSupportedLang(candidate) ? candidate : null;
};

const getUrlLanguage = () => {
    if (typeof window === 'undefined' || !window.location) return null;
    try {
        const url = new URL(window.location.href);
        const pathLang = getPathLanguage(url.pathname);
        const queryLang = normalizeLang(url.searchParams.get('lang'));
        if (isSupportedLang(pathLang)) return pathLang;
        if (isSupportedLang(queryLang)) return queryLang;
        return null;
    } catch (err) {
        return null;
    }
};

const getStoredLanguage = () => {
    if (typeof window === 'undefined') return null;
    try {
        const stored = normalizeLang(window.localStorage.getItem(LANG_STORAGE_KEY));
        return isSupportedLang(stored) ? stored : null;
    } catch (err) {
        return null;
    }
};

const detectInitialLanguage = () => getUrlLanguage() || getStoredLanguage() || 'ar';

const persistLanguage = (lang) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch (err) {
        // ignore storage errors
    }
};

const updateDocumentLanguage = (lang) => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
};

const syncUrlLanguage = (lang) => {
    if (typeof window === 'undefined' || !window.location) return;
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('lang', lang);

        const protocol = url.protocol;
        const canRewritePath = protocol === 'http:' || protocol === 'https:';
        const pathLang = getPathLanguage(url.pathname);
        if (canRewritePath && pathLang) {
            const segments = url.pathname.split('/').filter(Boolean);
            if (segments.length) {
                segments[0] = lang;
                url.pathname = `/${segments.join('/')}`;
            }
        }

        window.history.replaceState({}, '', url.toString());
    } catch (err) {
        // ignore URL sync errors
    }
};

module.exports = {
    LANG_STORAGE_KEY,
    SUPPORTED_LANGS,
    normalizeLang,
    isSupportedLang,
    getPathLanguage,
    getUrlLanguage,
    getStoredLanguage,
    detectInitialLanguage,
    persistLanguage,
    updateDocumentLanguage,
    syncUrlLanguage
};
