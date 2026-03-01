'use client';

/**
 * Theme Editor — manage whitelabel themes for public pages.
 * Themes are JSON files stored on disk (data/active-theme.json).
 * All theme customization requires a valid Sellf Pro license.
 * @see lib/themes/index.ts for types and presets
 * @see lib/actions/theme.ts for server actions
 * @see components/providers/whitelabel-provider.tsx for CSS injection
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/contexts/ToastContext';
import { useConfig } from '@/components/providers/config-provider';
import {
 getActiveTheme,
 saveActiveTheme,
 removeActiveTheme,
 getThemePresets,
 checkThemeLicense,
 exportActiveTheme,
} from '@/lib/actions/theme';
import { themeConfigSchema, THEME_PRESETS } from '@/lib/themes';
import type { ThemeConfig, ThemePreset } from '@/lib/themes';

// ===== TYPES =====

type EditorTab = 'colors' | 'typography' | 'shapes';

const DEFAULT_THEME: ThemeConfig = THEME_PRESETS[0].theme;

// ===== COLOR PICKER =====

let colorFieldCounter = 0;

function ColorField({
 label,
 value,
 onChange,
 disabled,
}: {
 label: string;
 value: string;
 onChange: (v: string) => void;
 disabled?: boolean;
}) {
 const [id] = useState(() => `color-field-${++colorFieldCounter}`);
 const isHex = value.startsWith('#');
 return (
 <div className="flex items-center gap-2">
 <input
 type="color"
 value={isHex ? value : '#000000'}
 onChange={(e) => onChange(e.target.value)}
 disabled={disabled}
 aria-label={label}
 className="w-8 h-8 border-2 border-sf-border-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
 />
 <div className="flex-1 min-w-0">
 <label htmlFor={id} className="block text-xs text-sf-muted truncate">{label}</label>
 <input
 id={id}
 type="text"
 value={value}
 onChange={(e) => onChange(e.target.value)}
 disabled={disabled}
 className="w-full px-2 py-1 text-xs border-2 border-sf-border-medium bg-sf-input text-sf-heading disabled:opacity-50"
 />
 </div>
 </div>
 );
}

// ===== MAIN COMPONENT =====

export default function BrandingSettings() {
 const t = useTranslations('settings.branding');
 const { addToast } = useToast();
 const { demoMode } = useConfig();

 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [licenseValid, setLicenseValid] = useState(false);
 const [activeTheme, setActiveTheme] = useState<ThemeConfig | null>(null);
 const [presets, setPresets] = useState<ThemePreset[]>([]);
 const [editTheme, setEditTheme] = useState<ThemeConfig>(DEFAULT_THEME);
 const [activeTab, setActiveTab] = useState<EditorTab>('colors');
 const [hasChanges, setHasChanges] = useState(false);
 const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
 const fileInputRef = useRef<HTMLInputElement>(null);

 // ===== LOAD DATA =====

 useEffect(() => {
 async function load() {
 try {
 const [theme, presetsData, licensed] = await Promise.all([
 getActiveTheme(),
 getThemePresets(),
 checkThemeLicense(),
 ]);

 setActiveTheme(theme);
 setPresets(presetsData);
 setLicenseValid(licensed);

 if (theme) {
 setEditTheme(theme);
 // Find matching preset
 const match = presetsData.find(
 (p) => p.theme.name === theme.name && p.theme.colors.accent === theme.colors.accent
 );
 setSelectedPresetId(match?.id ?? 'custom');
 } else {
 setEditTheme(DEFAULT_THEME);
 setSelectedPresetId(null);
 }
 } catch (error) {
 console.error('[BrandingSettings] Load error:', error);
 } finally {
 setLoading(false);
 }
 }
 load();
 }, []);

 // ===== HANDLERS =====

 const updateColors = useCallback(
 (key: string, value: string) => {
 setEditTheme((prev) => ({
 ...prev,
 colors: { ...prev.colors, [key]: value },
 }));
 setHasChanges(true);
 setSelectedPresetId('custom');
 },
 []
 );

 const updateLightColors = useCallback(
 (key: string, value: string) => {
 setEditTheme((prev) => ({
 ...prev,
 'colors-light': { ...prev['colors-light'], [key]: value },
 }));
 setHasChanges(true);
 setSelectedPresetId('custom');
 },
 []
 );

 const updateTypography = useCallback(
 (key: string, value: string) => {
 setEditTheme((prev) => ({
 ...prev,
 typography: { ...prev.typography, [key]: value },
 }));
 setHasChanges(true);
 setSelectedPresetId('custom');
 },
 []
 );

 const updateShapes = useCallback(
 (key: string, value: string) => {
 setEditTheme((prev) => ({
 ...prev,
 shapes: { ...prev.shapes, [key]: value },
 }));
 setHasChanges(true);
 setSelectedPresetId('custom');
 },
 []
 );

 const selectPreset = (preset: ThemePreset) => {
 setEditTheme(preset.theme);
 setSelectedPresetId(preset.id);
 setHasChanges(true);
 };

 const handleSave = async () => {
 if (!licenseValid) {
 addToast(t('licenseRequired'), 'error');
 return;
 }

 setSaving(true);
 try {
 const result = await saveActiveTheme(editTheme);
 if (result.success) {
 setActiveTheme(editTheme);
 setHasChanges(false);
 addToast(t('saveSuccess'), 'success');
 } else {
 addToast(result.error || t('saveError'), 'error');
 }
 } catch (error) {
 console.error('[BrandingSettings] Save error:', error);
 addToast(t('errorOccurred'), 'error');
 } finally {
 setSaving(false);
 }
 };

 const handleRemoveTheme = async () => {
 setSaving(true);
 try {
 const result = await removeActiveTheme();
 if (result.success) {
 setActiveTheme(null);
 setEditTheme(DEFAULT_THEME);
 setSelectedPresetId(null);
 setHasChanges(false);
 addToast(t('themeRemoved'), 'success');
 } else {
 addToast(result.error || t('saveError'), 'error');
 }
 } catch (error) {
 console.error('[BrandingSettings] Remove error:', error);
 addToast(t('errorOccurred'), 'error');
 } finally {
 setSaving(false);
 }
 };

 const handleExport = async () => {
 try {
 const json = JSON.stringify(editTheme, null, 2);
 const blob = new Blob([json], { type: 'application/json' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = `${editTheme.name.toLowerCase().replace(/\s+/g, '-')}-theme.json`;
 a.click();
 URL.revokeObjectURL(url);
 } catch (error) {
 console.error('[BrandingSettings] Export error:', error);
 addToast(t('errorOccurred'), 'error');
 }
 };

 const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
 const file = e.target.files?.[0];
 if (!file) return;

 const MAX_THEME_FILE_SIZE = 100 * 1024; // 100KB
 if (file.size > MAX_THEME_FILE_SIZE) {
 addToast(t('fileTooLarge'), 'error');
 return;
 }

 const reader = new FileReader();
 reader.onload = (event) => {
 try {
 const raw = JSON.parse(event.target?.result as string);
 const result = themeConfigSchema.safeParse(raw);
 if (!result.success) {
 addToast(t('invalidThemeFile'), 'error');
 return;
 }
 setEditTheme(result.data);
 setSelectedPresetId('custom');
 setHasChanges(true);
 addToast(t('themeImported'), 'success');
 } catch {
 addToast(t('invalidThemeFile'), 'error');
 }
 };
 reader.readAsText(file);
 // Reset file input
 if (fileInputRef.current) fileInputRef.current.value = '';
 };

 // ===== RENDER =====

 if (loading) {
 return (
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="animate-pulse space-y-4">
 <div className="h-4 bg-sf-raised w-1/4"></div>
 <div className="h-10 bg-sf-raised"></div>
 <div className="h-10 bg-sf-raised"></div>
 </div>
 </div>
 );
 }

 const colors = editTheme.colors;
 const lightColors = editTheme['colors-light'] || {};
 const typo = editTheme.typography || {};
 const shapes = editTheme.shapes || {};

 return (
 <div className="space-y-6">
 {/* Demo PRO Badge */}
 {demoMode && (
 <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20">
 <svg className="w-5 h-5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
 </svg>
 <div>
 <p className="text-sm font-medium text-blue-400">
 <span className="inline-flex items-center gap-1.5">
 {t('demoProTitle')}
 <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300">PRO</span>
 </span>
 </p>
 <p className="text-xs text-blue-400/80">{t('demoProDesc')}</p>
 </div>
 </div>
 )}

 {/* License Badge */}
 {!licenseValid && !demoMode && (
 <div className="flex items-center gap-3 p-4 bg-sf-warning-soft border border-sf-warning/20">
 <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
 </svg>
 <div>
 <p className="text-sm font-medium text-sf-warning">{t('licenseRequiredTitle')}</p>
 <p className="text-xs text-sf-warning">{t('licenseRequiredDesc')}</p>
 </div>
 </div>
 )}

 {/* Active Theme Status */}
 {activeTheme && (
 <div className="flex items-center justify-between p-4 bg-sf-success-soft border border-sf-success/20">
 <div className="flex items-center gap-3">
 <div className="w-3 h-3 bg-green-500 animate-pulse"></div>
 <div>
 <p className="text-sm font-medium text-sf-success">
 {t('activeTheme')}: {activeTheme.name}
 </p>
 </div>
 </div>
 <button
 type="button"
 onClick={handleRemoveTheme}
 disabled={saving}
 className="text-xs text-sf-danger hover:opacity-80 disabled:opacity-50"
 >
 {t('removeTheme')}
 </button>
 </div>
 )}

 <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
 {/* LEFT: Preset Selector + Editor */}
 <div className="xl:col-span-2 space-y-6">
 {/* Preset Grid */}
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="flex items-center justify-between mb-4">
 <h2 className="text-lg font-semibold text-sf-heading">{t('themePresets')}</h2>
 <div className="flex items-center gap-2">
 <button
 type="button"
 onClick={() => fileInputRef.current?.click()}
 className="text-xs px-3 py-1.5 border-2 border-sf-border-medium text-sf-body hover:bg-sf-hover transition-colors"
 >
 {t('importTheme')}
 </button>
 <button
 type="button"
 onClick={handleExport}
 className="text-xs px-3 py-1.5 border-2 border-sf-border-medium text-sf-body hover:bg-sf-hover transition-colors"
 >
 {t('exportTheme')}
 </button>
 <input
 ref={fileInputRef}
 type="file"
 accept=".json"
 onChange={handleImport}
 className="hidden"
 />
 </div>
 </div>

 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
 {presets.map((preset) => (
 <button
 key={preset.id}
 type="button"
 onClick={() => selectPreset(preset)}
 className={`relative p-3 border-2 transition-all text-left ${
 selectedPresetId === preset.id
 ? 'border-sf-accent bg-sf-accent-soft'
 : 'border-sf-border hover:border-sf-accent/50'
 }`}
 >
 {/* Color swatch row */}
 <div className="flex gap-1 mb-2">
 <div className="w-5 h-5" style={{ backgroundColor: preset.theme.colors.accent }}></div>
 <div className="w-5 h-5" style={{ backgroundColor: preset.theme.colors['bg-deep'] }}></div>
 <div className="w-5 h-5" style={{ backgroundColor: preset.theme.colors['text-heading'] }}></div>
 </div>
 <p className="text-xs font-medium text-sf-heading truncate">{preset.theme.name}</p>
 {selectedPresetId === preset.id && (
 <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-sf-accent-bg flex items-center justify-center">
 <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
 </svg>
 </div>
 )}
 </button>
 ))}
 </div>
 </div>

 {/* Editor Tabs */}
 <div className="bg-sf-base border-2 border-sf-border-medium">
 {/* Tab Headers */}
 <div className="flex border-b border-sf-border">
 {(['colors', 'typography', 'shapes'] as EditorTab[]).map((tab) => (
 <button
 key={tab}
 type="button"
 onClick={() => setActiveTab(tab)}
 className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
 activeTab === tab
 ? 'text-sf-accent border-b-2 border-sf-accent'
 : 'text-sf-muted hover:text-sf-body'
 }`}
 >
 {t(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)}
 </button>
 ))}
 </div>

 {/* Tab Content */}
 <div className="p-6">
 {/* Theme Name */}
 <div className="mb-6">
 <label htmlFor="branding-theme-name" className="block text-sm font-medium text-sf-body mb-1">{t('themeName')}</label>
 <input
 id="branding-theme-name"
 type="text"
 value={editTheme.name}
 onChange={(e) => {
 setEditTheme((prev) => ({ ...prev, name: e.target.value }));
 setHasChanges(true);
 setSelectedPresetId('custom');
 }}
 className="w-full px-3 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading text-sm"
 placeholder={t('themeNamePlaceholder')}
 />
 </div>

 {/* COLORS TAB */}
 {activeTab === 'colors' && (
 <div className="space-y-6">
 {/* Dark mode colors */}
 <div>
 <h4 className="text-sm font-medium text-sf-heading mb-3">{t('darkModeColors')}</h4>
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
 <ColorField label="Accent" value={colors.accent} onChange={(v) => updateColors('accent', v)} />
 <ColorField label="Accent Hover" value={colors['accent-hover']} onChange={(v) => updateColors('accent-hover', v)} />
 <ColorField label="Accent Soft" value={colors['accent-soft']} onChange={(v) => updateColors('accent-soft', v)} />
 <ColorField label="Background Deep" value={colors['bg-deep']} onChange={(v) => updateColors('bg-deep', v)} />
 <ColorField label="Background Base" value={colors['bg-base'] || ''} onChange={(v) => updateColors('bg-base', v)} />
 <ColorField label="Background Raised" value={colors['bg-raised'] || ''} onChange={(v) => updateColors('bg-raised', v)} />
 <ColorField label="Text Heading" value={colors['text-heading']} onChange={(v) => updateColors('text-heading', v)} />
 <ColorField label="Text Body" value={colors['text-body'] || ''} onChange={(v) => updateColors('text-body', v)} />
 <ColorField label="Text Muted" value={colors['text-muted'] || ''} onChange={(v) => updateColors('text-muted', v)} />
 <ColorField label="Border" value={colors.border || ''} onChange={(v) => updateColors('border', v)} />
 <ColorField label="Success" value={colors.success || ''} onChange={(v) => updateColors('success', v)} />
 <ColorField label="Danger" value={colors.danger || ''} onChange={(v) => updateColors('danger', v)} />
 </div>
 </div>

 {/* Light mode overrides */}
 <div>
 <h4 className="text-sm font-medium text-sf-heading mb-3">{t('lightModeColors')}</h4>
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
 <ColorField label="Accent" value={lightColors.accent || ''} onChange={(v) => updateLightColors('accent', v)} />
 <ColorField label="Accent Hover" value={lightColors['accent-hover'] || ''} onChange={(v) => updateLightColors('accent-hover', v)} />
 <ColorField label="Background Deep" value={lightColors['bg-deep'] || ''} onChange={(v) => updateLightColors('bg-deep', v)} />
 <ColorField label="Background Base" value={lightColors['bg-base'] || ''} onChange={(v) => updateLightColors('bg-base', v)} />
 <ColorField label="Background Raised" value={lightColors['bg-raised'] || ''} onChange={(v) => updateLightColors('bg-raised', v)} />
 <ColorField label="Text Heading" value={lightColors['text-heading'] || ''} onChange={(v) => updateLightColors('text-heading', v)} />
 <ColorField label="Text Body" value={lightColors['text-body'] || ''} onChange={(v) => updateLightColors('text-body', v)} />
 <ColorField label="Text Muted" value={lightColors['text-muted'] || ''} onChange={(v) => updateLightColors('text-muted', v)} />
 </div>
 </div>
 </div>
 )}

 {/* TYPOGRAPHY TAB */}
 {activeTab === 'typography' && (
 <div className="space-y-4">
 <div>
 <label htmlFor="branding-font-family" className="block text-sm font-medium text-sf-body mb-1">{t('fontFamilyLabel')}</label>
 <input
 id="branding-font-family"
 type="text"
 value={typo['font-family'] || 'inherit'}
 onChange={(e) => updateTypography('font-family', e.target.value)}
 className="w-full px-3 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading text-sm"
 placeholder={t('fontFamilyPlaceholder')}
 />
 <p className="mt-1 text-xs text-sf-muted">{t('fontFamilyHelp')}</p>
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
 <label htmlFor="branding-heading-weight" className="block text-sm font-medium text-sf-body mb-1">{t('headingWeight')}</label>
 <select
 id="branding-heading-weight"
 value={typo['font-heading-weight'] || '700'}
 onChange={(e) => updateTypography('font-heading-weight', e.target.value)}
 className="w-full px-3 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading text-sm"
 >
 <option value="400">400 — Regular</option>
 <option value="500">500 — Medium</option>
 <option value="600">600 — Semibold</option>
 <option value="700">700 — Bold</option>
 <option value="800">800 — Extra Bold</option>
 <option value="900">900 — Black</option>
 </select>
 </div>
 <div>
 <label htmlFor="branding-body-weight" className="block text-sm font-medium text-sf-body mb-1">{t('bodyWeight')}</label>
 <select
 id="branding-body-weight"
 value={typo['font-body-weight'] || '400'}
 onChange={(e) => updateTypography('font-body-weight', e.target.value)}
 className="w-full px-3 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading text-sm"
 >
 <option value="300">300 — Light</option>
 <option value="400">400 — Regular</option>
 <option value="500">500 — Medium</option>
 </select>
 </div>
 </div>

 <div>
 <label htmlFor="branding-letter-spacing" className="block text-sm font-medium text-sf-body mb-1">{t('letterSpacing')}</label>
 <input
 id="branding-letter-spacing"
 type="text"
 value={typo['letter-spacing-heading'] || '-0.02em'}
 onChange={(e) => updateTypography('letter-spacing-heading', e.target.value)}
 className="w-full px-3 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading text-sm"
 placeholder={t('letterSpacingPlaceholder')}
 />
 </div>
 </div>
 )}

 {/* SHAPES TAB */}
 {activeTab === 'shapes' && (
 <div className="space-y-4">
 <div className="grid grid-cols-2 gap-4">
 {[
 { key: 'radius-sm', label: t('radiusSmall'), placeholder: '6px' },
 { key: 'radius-md', label: t('radiusMedium'), placeholder: '12px' },
 { key: 'radius-lg', label: t('radiusLarge'), placeholder: '16px' },
 { key: 'radius-full', label: t('radiusFull'), placeholder: '9999px' },
 ].map(({ key, label, placeholder }) => (
 <div key={key}>
 <label htmlFor={`branding-shape-${key}`} className="block text-sm font-medium text-sf-body mb-1">{label}</label>
 <input
 id={`branding-shape-${key}`}
 type="text"
 value={(shapes as Record<string, string | undefined>)[key] || ''}
 onChange={(e) => updateShapes(key, e.target.value)}
 className="w-full px-3 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading text-sm"
 placeholder={placeholder}
 />
 </div>
 ))}
 </div>
 </div>
 )}
 </div>

 {/* Save Bar */}
 <div className="flex items-center justify-between px-6 py-4 border-t border-sf-border">
 <div className="text-xs text-sf-muted">
 {hasChanges ? t('unsavedChanges') : activeTheme ? t('themeActive') : t('noThemeActive')}
 </div>
 <div className="flex items-center gap-3">
 <button
 type="button"
 onClick={handleSave}
 disabled={saving || !hasChanges || !licenseValid}
 className="px-5 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
 >
 {saving ? t('saving') : t('saveTheme')}
 </button>
 </div>
 </div>
 </div>
 </div>

 {/* RIGHT: Live Preview */}
 <div className="xl:col-span-1">
 <div className="bg-sf-base border-2 border-sf-border-medium p-6 sticky top-6">
 <h3 className="text-lg font-semibold text-sf-heading mb-4">{t('livePreview')}</h3>

 {/* Mini store preview */}
 <div
 data-a11y-preview="branding"
 className="overflow-hidden border-2 border-sf-border-medium"
 style={{
 backgroundColor: colors['bg-deep'],
 fontFamily: typo['font-family'] === 'inherit' ? undefined : typo['font-family'],
 }}
 >
 {/* Header bar */}
 <div className="px-4 py-3 flex items-center gap-2" style={{ backgroundColor: colors['bg-base'] || colors['bg-deep'] }}>
 <div className="w-6 h-6" style={{ backgroundColor: colors.accent }}></div>
 <div className="text-xs font-semibold" style={{ color: colors['text-heading'], fontWeight: typo['font-heading-weight'] || '700' }}>
 {editTheme.name}
 </div>
 </div>

 {/* Content area */}
 <div className="p-4 space-y-3">
 <div
 className="text-sm font-bold"
 style={{
 color: colors['text-heading'],
 fontWeight: typo['font-heading-weight'] || '700',
 letterSpacing: typo['letter-spacing-heading'],
 }}
 >
 {t('previewHeading')}
 </div>
 <div className="text-xs" style={{ color: colors['text-body'] || colors['text-heading'], fontWeight: typo['font-body-weight'] || '400' }}>
 {t('previewBody')}
 </div>

 {/* Product card preview */}
 <div
 className="p-3"
 style={{
 backgroundColor: colors['bg-raised'] || colors['bg-base'] || colors['bg-deep'],
 borderRadius: shapes['radius-md'] || '12px',
 }}
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold" style={{ color: colors['text-heading'] }}>Product</span>
 <span className="text-xs font-bold" style={{ color: colors.accent }}>$29</span>
 </div>
 <button
 type="button"
 className="w-full py-1.5 text-xs font-medium text-white transition-colors"
 style={{
 backgroundColor: colors.accent,
 borderRadius: shapes['radius-sm'] || '6px',
 }}
 >
 {t('previewButton')}
 </button>
 </div>

 {/* Status colors */}
 <div className="flex gap-2">
 <span className="inline-block w-3 h-3" style={{ backgroundColor: colors.success || '#10B981' }}></span>
 <span className="inline-block w-3 h-3" style={{ backgroundColor: colors.warning || '#F59E0B' }}></span>
 <span className="inline-block w-3 h-3" style={{ backgroundColor: colors.danger || '#EF4444' }}></span>
 <span className="text-xs" style={{ color: colors['text-muted'] || colors['text-body'] }}>{t('previewStatus')}</span>
 </div>
 </div>
 </div>

 {/* Color swatches */}
 <div className="mt-4">
 <p className="text-xs text-sf-muted mb-2">{t('colorPalette')}</p>
 <div className="flex flex-wrap gap-1.5">
 {[colors.accent, colors['accent-hover'], colors['bg-deep'], colors['bg-raised'] || colors['bg-deep'], colors['text-heading']].map(
 (c, i) => (
 <div key={i} className="w-8 h-8 border-2 border-sf-border-medium" style={{ backgroundColor: c }}></div>
 )
 )}
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
}
