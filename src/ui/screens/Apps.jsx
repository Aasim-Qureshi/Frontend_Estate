import React, { useMemo } from 'react';
import { UploadCloud, Compass, ChevronRight, Info, ShieldCheck, Building2 } from 'lucide-react';
import { useValueNav } from '../context/ValueNavContext';
import navigation from '../constants/navigation';
import { useTranslation } from 'react-i18next';

const { valueSystemCards, valueSystemGroups } = navigation;

const cardIcons = {
    'uploading-reports': UploadCloud,
    'evaluation-sources': Compass,
    'admin-console': ShieldCheck,
    'company-console': Building2
};

const cardThemes = {
    'uploading-reports': {
        glow: 'bg-cyan-400/25',
        border: 'border-cyan-400/40',
        accent: 'text-cyan-200',
        badge: 'from-cyan-500 to-blue-600',
        ring: 'ring-cyan-300/50'
    },
    'evaluation-sources': {
        glow: 'bg-emerald-400/25',
        border: 'border-emerald-400/40',
        accent: 'text-emerald-200',
        badge: 'from-emerald-500 to-teal-600',
        ring: 'ring-emerald-300/50'
    },
    'admin-console': {
        glow: 'bg-amber-400/25',
        border: 'border-amber-400/40',
        accent: 'text-amber-200',
        badge: 'from-amber-500 to-orange-600',
        ring: 'ring-amber-300/50'
    },
    'company-console': {
        glow: 'bg-orange-400/25',
        border: 'border-orange-400/40',
        accent: 'text-orange-200',
        badge: 'from-orange-500 to-rose-600',
        ring: 'ring-orange-300/50'
    },
    default: {
        glow: 'bg-slate-400/25',
        border: 'border-slate-700/60',
        accent: 'text-slate-200',
        badge: 'from-slate-700 to-slate-900',
        ring: 'ring-slate-600/60'
    }
};

const Apps = ({ onViewChange }) => {
    const { t } = useTranslation();
    const {
        selectedCard,
        selectedDomain,
        selectedCompany,
        activeGroup,
        setActiveGroup,
        chooseCard,
        chooseDomain,
        ensureCompaniesLoaded,
        setActiveTab,
        autoSelectDefaultCompany
    } = useValueNav();

    const stageHint = useMemo(() => {
        if (activeGroup) return t('apps.stage.selectTab');
        if (!selectedCard) return t('apps.stage.pickCard');
        if (selectedCard === 'uploading-reports' && !selectedDomain) return t('apps.stage.chooseDomain');
        if (selectedCard === 'uploading-reports' && selectedDomain === 'real-estate') {
            return t('apps.stage.realEstateSoon');
        }
        if (selectedCard === 'uploading-reports' && selectedDomain === 'equipments' && !selectedCompany) {
            return t('apps.stage.pickCompany');
        }
        return '';
    }, [selectedCard, selectedDomain, selectedCompany, activeGroup, t]);

    const openUploadingReports = (card) => {
        const uploadTabs = valueSystemGroups.uploadReports?.tabs || [];
        const firstUploadTab = uploadTabs[0]?.id || 'submit-reports-quickly';

        // Prime navigation immediately so users land on the main page without waiting for company loading
        chooseCard(card.id);
        chooseDomain('equipments');
        setActiveGroup('uploadReports');
        setActiveTab(firstUploadTab);
        if (onViewChange) onViewChange(firstUploadTab);

        // Load companies and auto-select default in the background
        (async () => {
            try {
                const loadedCompanies = await ensureCompaniesLoaded('equipment');
                await autoSelectDefaultCompany({ skipNavigation: true, companiesList: loadedCompanies });
            } catch (err) {
                console.warn('Failed to preload companies', err);
            }
        })();
    };

    const openEvaluationSources = (card) => {
        const evaluationTabs = valueSystemGroups.evaluationSources?.tabs || [];
        const mainTab = evaluationTabs.find((tab) => tab.id === 'yalla-motor')?.id
            || evaluationTabs.find((tab) => tab.id === 'haraj-scrape')?.id
            || evaluationTabs.find((tab) => tab.id === 'haraj')?.id
            || evaluationTabs[0]?.id
            || 'haraj-scrape';

        chooseCard(card.id);
        setActiveGroup('evaluationSources');
        setActiveTab(mainTab);
        if (onViewChange) onViewChange(mainTab);
    };

    const handleCardClick = async (card) => {
        if (card.id === 'uploading-reports') {
            await openUploadingReports(card);
            return;
        }
        if (card.id === 'evaluation-sources') {
            openEvaluationSources(card);
            return;
        }
        chooseCard(card.id);
        setActiveGroup(card.defaultGroup || null);
        if (onViewChange) onViewChange('apps');
    };

    // Show entry cards as long as no card/group is active; allow preselected company.
    const showCards = !selectedCard && !activeGroup;
    const showHint = Boolean(activeGroup && stageHint);

    return (
        <div className="space-y-6">
            {showCards && (
                <div className="w-full flex justify-center">
                    <div className="grid w-full max-w-5xl justify-items-center gap-4 sm:grid-cols-2">
                        {valueSystemCards.filter((card) => {
                            if (card.id === 'admin-console' || card.id === 'company-console') return false;
                            return true;
                        }).map((card) => {
                            const Icon = cardIcons[card.id] || Info;
                            const theme = cardThemes[card.id] || cardThemes.default;
                            const isActive = selectedCard === card.id;
                            return (
                                <button
                                    key={card.id}
                                    type="button"
                                    onClick={() => handleCardClick(card)}
                                    className={`group relative w-full max-w-[280px] aspect-square overflow-hidden rounded-3xl border bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-left transition-all shadow-[0_16px_30px_rgba(15,23,42,0.25)] mt-2 ${theme.border} ${isActive
                                        ? `ring-2 ${theme.ring} scale-[1.01]`
                                        : 'hover:-translate-y-1 hover:shadow-[0_22px_40px_rgba(15,23,42,0.35)]'
                                        }`}
                                >
                                    <span className={`pointer-events-none absolute -top-12 right-[-40px] h-32 w-32 rounded-full blur-3xl ${theme.glow}`} />
                                    <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.2),rgba(15,23,42,0))] opacity-70" />
                                    <div className="relative flex h-full flex-col gap-4 p-6">
                                        <div className="flex items-center justify-between">
                                            <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br ${theme.badge} text-white shadow-[0_12px_26px_rgba(15,23,42,0.2)]`}>
                                                <Icon className="w-5 h-5" />
                                            </span>
                                            <span className="text-[10px] font-semibold text-slate-300 text-compact">{t('apps.cardBadge')}</span>
                                        </div>
                                        <div className="flex-1">
                                            <h2 className="font-display text-[15px] font-semibold text-slate-100 leading-tight text-compact line-clamp-2">
                                                {t(`navigation.cards.${card.id}.title`, { defaultValue: card.title })}
                                            </h2>
                                            <p className="mt-2 text-[10px] text-slate-300 leading-snug line-clamp-3">
                                                {t(`navigation.cards.${card.id}.description`, { defaultValue: card.description })}
                                            </p>
                                        </div>
                                        <div className={`flex items-center gap-1 text-[11px] font-semibold ${theme.accent}`}>
                                            <span>{t('common.open')}</span>
                                            <ChevronRight className="w-4 h-4 transition group-hover:translate-x-0.5 rtl-flip" />
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {showHint && (
                <div className="w-full">
                    <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200/70 bg-white/80 px-5 py-4 text-center text-[11px] text-slate-600 shadow-sm">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            {t('apps.mainLinks')}
                        </div>
                        <div className="mt-2 text-[14px] font-semibold text-slate-900">
                            {t(`navigation.groups.${activeGroup}.title`, {
                                defaultValue: valueSystemGroups[activeGroup]?.title || activeGroup
                            })}
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">{stageHint}</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Apps;
