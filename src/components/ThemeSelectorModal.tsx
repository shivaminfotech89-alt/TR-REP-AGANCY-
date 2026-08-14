import React, { useState } from 'react';
import { useTheme } from '../lib/ThemeContext';
import { Palette, Check, Sparkles, X, Moon, Sun, CheckCircle2, Zap, Layers } from 'lucide-react';

interface ThemeSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ThemeSelectorModal({ isOpen, onClose }: ThemeSelectorModalProps) {
  const { currentTheme, themeId, setThemeId, availableThemes } = useTheme();
  const [filterMode, setFilterMode] = useState<'all' | 'light' | 'dark'>('all');

  if (!isOpen) return null;

  const lightThemesCount = availableThemes.filter(t => t.themeMode === 'light').length;
  const darkThemesCount = availableThemes.filter(t => t.themeMode === 'dark').length;

  const displayedThemes = availableThemes.filter(t => {
    if (filterMode === 'light') return t.themeMode === 'light';
    if (filterMode === 'dark') return t.themeMode === 'dark';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full p-5 sm:p-6 space-y-4 animate-in zoom-in-95 max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-start justify-between shrink-0 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-xl shadow-md shadow-blue-500/20">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                Workspace Theme & Appearance
                <span className="text-[10px] font-extrabold uppercase bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full border border-blue-200">
                  {availableThemes.length} Presets
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Choose from modern light themes, crisp high-contrast palettes, and cyberpunk dark workspaces.
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Filter Tabs */}
        <div className="flex items-center justify-between shrink-0 bg-slate-100/80 p-1 rounded-xl border border-slate-200">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                filterMode === 'all'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>All Presets ({availableThemes.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setFilterMode('light')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                filterMode === 'light'
                  ? 'bg-amber-500 text-white shadow-xs font-black'
                  : 'text-amber-800 hover:bg-amber-100/60 font-semibold'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>☀️ Light Themes ({lightThemesCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setFilterMode('dark')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                filterMode === 'dark'
                  ? 'bg-slate-900 text-white shadow-xs font-black'
                  : 'text-slate-600 hover:bg-slate-200/60 font-semibold'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>🌙 Dark & Cyber ({darkThemesCount})</span>
            </button>
          </div>

          <span className="text-[11px] font-medium text-slate-500 hidden sm:inline pr-2">
            Auto-saved instantly
          </span>
        </div>

        {/* Current Active Theme Highlight */}
        <div className="bg-slate-900 text-white rounded-xl p-3.5 flex items-center justify-between shrink-0 shadow-sm border border-slate-800">
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-xl shadow-md border border-white/20 flex items-center justify-center relative overflow-hidden"
              style={{ backgroundColor: currentTheme.previewColors.sidebar }}
            >
              <div 
                className="w-4 h-4 rounded-full border-2 border-white shadow-lg animate-pulse"
                style={{ backgroundColor: currentTheme.previewColors.accent }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 font-semibold">Active:</span>
                <span className="text-xs font-black text-white">{currentTheme.name}</span>
                <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${
                  currentTheme.themeMode === 'light' 
                    ? 'bg-amber-400/20 text-amber-300 border-amber-400/40' 
                    : 'bg-cyan-400/20 text-cyan-300 border-cyan-400/40'
                }`}>
                  {currentTheme.themeMode === 'light' ? '☀️ LIGHT' : '🌙 DARK'} &bull; {currentTheme.tag || currentTheme.category}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{currentTheme.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-bold text-emerald-400">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Active</span>
          </div>
        </div>

        {/* Theme Grid */}
        <div className="overflow-y-auto space-y-2.5 pr-1 flex-1 custom-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {displayedThemes.map((theme) => {
              const isSelected = theme.id === themeId;
              const isLight = theme.themeMode === 'light';

              return (
                <div
                  key={theme.id}
                  onClick={() => setThemeId(theme.id)}
                  className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between relative group ${
                    isSelected 
                      ? 'border-blue-600 bg-blue-50/50 shadow-md ring-1 ring-blue-600/30' 
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 bg-white'
                  }`}
                >
                  <div>
                    {/* Top Row: Preview Swatch + Name + Badge */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2.5">
                        {/* Mini Theme Color Swatch */}
                        <div className="flex items-center -space-x-1 shadow-xs rounded-lg overflow-hidden border border-slate-300/80 p-0.5 bg-white">
                          <span 
                            className="w-5 h-6 rounded-l-md shadow-inner border-r border-slate-200/60" 
                            style={{ backgroundColor: theme.previewColors.sidebar }}
                            title="Sidebar Color"
                          />
                          <span 
                            className="w-4 h-6 shadow-inner" 
                            style={{ backgroundColor: theme.previewColors.accent }}
                            title="Accent Glow"
                          />
                          <span 
                            className="w-4 h-6 rounded-r-md border-l border-slate-200" 
                            style={{ backgroundColor: theme.previewColors.canvas }}
                            title="Canvas Background"
                          />
                        </div>

                        <div>
                          <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            {theme.name}
                            {isLight ? (
                              <Sun className="w-3 h-3 text-amber-500" />
                            ) : (
                              <Moon className="w-3 h-3 text-slate-500" />
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 font-medium">{theme.category}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {theme.tag && (
                          <span 
                            className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded tracking-wider uppercase border ${
                              isLight ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-100 text-slate-800 border-slate-300'
                            }`}
                          >
                            {theme.tag}
                          </span>
                        )}
                        {isSelected ? (
                          <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xs">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border border-slate-300 group-hover:border-slate-400" />
                        )}
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-500 leading-normal line-clamp-2">
                      {theme.description}
                    </p>
                  </div>

                  {/* Micro Visual Preview Bar */}
                  <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
                    <span className="text-slate-400 font-mono text-[10px]">
                      {isLight ? '☀️ Light Sidebar' : '🌙 Dark Sidebar'}
                    </span>
                    <span 
                      className="font-bold px-2 py-0.5 rounded text-[10px] flex items-center gap-1"
                      style={{ 
                        backgroundColor: `${theme.previewColors.accent}20`,
                        color: theme.previewColors.accent 
                      }}
                    >
                      <Zap className="w-2.5 h-2.5" />
                      Accent
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 shrink-0">
          <span className="text-xs text-slate-500">
            Selected theme applies instantly across all workshop screens.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-colors shadow-xs"
          >
            Apply & Close
          </button>
        </div>
      </div>
    </div>
  );
}
