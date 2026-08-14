import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface ThemeConfig {
  id: string;
  name: string;
  category: string;
  tag: string;
  description: string;
  sidebarBg: string;
  sidebarBorder: string;
  sidebarText: string;
  sidebarActiveBg: string;
  sidebarActiveText: string;
  sidebarHoverBg: string;
  headerBg: string;
  headerBorder: string;
  mainBg: string;
  accentColor: string;
  accentBg: string;
  accentText: string;
  accentBadge: string;
  isDarkWorkspace?: boolean;
  previewColors: {
    sidebar: string;
    accent: string;
    canvas: string;
    glow?: string;
  };
}

export const THEMES: Record<string, ThemeConfig> = {
  neoCyan: {
    id: 'neoCyan',
    name: 'Cyberpunk Neon',
    category: 'Next-Gen Cyber',
    tag: 'POPULAR',
    description: 'Deep obsidian stealth sidebar with electric cyan & hyper-blue energy pulses',
    sidebarBg: 'bg-[#050b14]',
    sidebarBorder: 'border-cyan-950/80',
    sidebarText: 'text-cyan-100/80',
    sidebarActiveBg: 'bg-gradient-to-r from-cyan-500 to-blue-600',
    sidebarActiveText: 'text-white shadow-cyan-500/30 shadow-lg',
    sidebarHoverBg: 'hover:bg-cyan-950/40 hover:text-cyan-200',
    headerBg: 'bg-white',
    headerBorder: 'border-slate-200',
    mainBg: 'bg-[#f0f6fa]',
    accentColor: 'text-cyan-600',
    accentBg: 'bg-cyan-600 hover:bg-cyan-700',
    accentText: 'text-white',
    accentBadge: 'bg-cyan-50 text-cyan-800 border-cyan-200',
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#050b14',
      accent: '#06b6d4',
      canvas: '#f0f6fa',
      glow: '#22d3ee',
    },
  },
  aurora: {
    id: 'aurora',
    name: 'Aurora Borealis',
    category: 'Northern Lights',
    tag: 'NEXT-GEN',
    description: 'Deep cosmic teal with iridescent northern lights emerald & electric mint',
    sidebarBg: 'bg-[#031c18]',
    sidebarBorder: 'border-emerald-900/60',
    sidebarText: 'text-emerald-100/80',
    sidebarActiveBg: 'bg-gradient-to-r from-emerald-500 to-teal-600',
    sidebarActiveText: 'text-white shadow-emerald-500/30 shadow-lg',
    sidebarHoverBg: 'hover:bg-emerald-950/60 hover:text-emerald-100',
    headerBg: 'bg-white',
    headerBorder: 'border-emerald-100/80',
    mainBg: 'bg-[#f0f9f6]',
    accentColor: 'text-emerald-600',
    accentBg: 'bg-emerald-600 hover:bg-emerald-700',
    accentText: 'text-white',
    accentBadge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#031c18',
      accent: '#10b981',
      canvas: '#f0f9f6',
      glow: '#34d399',
    },
  },
  solarFlare: {
    id: 'solarFlare',
    name: 'Solar Flare',
    category: 'High Voltage Fusion',
    tag: 'HIGH VOLTAGE',
    description: 'Stealth charcoal with high-voltage solar orange & electrical amber arcs',
    sidebarBg: 'bg-[#140c06]',
    sidebarBorder: 'border-orange-950/80',
    sidebarText: 'text-amber-100/80',
    sidebarActiveBg: 'bg-gradient-to-r from-amber-500 to-orange-600',
    sidebarActiveText: 'text-white shadow-orange-500/30 shadow-lg',
    sidebarHoverBg: 'hover:bg-amber-950/50 hover:text-amber-100',
    headerBg: 'bg-white',
    headerBorder: 'border-amber-100/80',
    mainBg: 'bg-[#fdfaf5]',
    accentColor: 'text-orange-600',
    accentBg: 'bg-orange-600 hover:bg-orange-700',
    accentText: 'text-white',
    accentBadge: 'bg-orange-50 text-orange-800 border-orange-200',
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#140c06',
      accent: '#f97316',
      canvas: '#fdfaf5',
      glow: '#fb923c',
    },
  },
  synthwave: {
    id: 'synthwave',
    name: 'Cosmic Synthwave',
    category: 'Futuristic Hi-Tech',
    tag: 'HYPER GLOW',
    description: 'Deep midnight nebula with futuristic violet, indigo & ultraviolet highlights',
    sidebarBg: 'bg-[#0f0a21]',
    sidebarBorder: 'border-purple-950/80',
    sidebarText: 'text-purple-100/80',
    sidebarActiveBg: 'bg-gradient-to-r from-indigo-500 to-purple-600',
    sidebarActiveText: 'text-white shadow-purple-500/30 shadow-lg',
    sidebarHoverBg: 'hover:bg-purple-950/50 hover:text-purple-100',
    headerBg: 'bg-white',
    headerBorder: 'border-purple-100/80',
    mainBg: 'bg-[#f8f6fe]',
    accentColor: 'text-indigo-600',
    accentBg: 'bg-indigo-600 hover:bg-indigo-700',
    accentText: 'text-white',
    accentBadge: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#0f0a21',
      accent: '#8b5cf6',
      canvas: '#f8f6fe',
      glow: '#a78bfa',
    },
  },
  crimsonMatrix: {
    id: 'crimsonMatrix',
    name: 'Crimson Velocity',
    category: 'Precision Industrial',
    tag: 'DYNAMIC',
    description: 'Velvet carbon with radiant laser crimson & high-precision rose optics',
    sidebarBg: 'bg-[#1a040b]',
    sidebarBorder: 'border-rose-950/80',
    sidebarText: 'text-rose-100/80',
    sidebarActiveBg: 'bg-gradient-to-r from-rose-500 to-red-600',
    sidebarActiveText: 'text-white shadow-rose-500/30 shadow-lg',
    sidebarHoverBg: 'hover:bg-rose-950/50 hover:text-rose-100',
    headerBg: 'bg-white',
    headerBorder: 'border-rose-100/80',
    mainBg: 'bg-[#fdf5f7]',
    accentColor: 'text-rose-600',
    accentBg: 'bg-rose-600 hover:bg-rose-700',
    accentText: 'text-white',
    accentBadge: 'bg-rose-50 text-rose-800 border-rose-200',
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#1a040b',
      accent: '#f43f5e',
      canvas: '#fdf5f7',
      glow: '#fb7185',
    },
  },
  titaniumOled: {
    id: 'titaniumOled',
    name: 'Titanium OLED Dark',
    category: 'Stealth Carbon Matrix',
    tag: 'OLED DARK',
    description: 'Pure pitch OLED workspace engineered for workshop screens and dim lighting',
    sidebarBg: 'bg-[#030712]',
    sidebarBorder: 'border-slate-800',
    sidebarText: 'text-slate-300',
    sidebarActiveBg: 'bg-gradient-to-r from-blue-600 to-cyan-600',
    sidebarActiveText: 'text-white shadow-blue-500/30 shadow-lg',
    sidebarHoverBg: 'hover:bg-slate-900 hover:text-white',
    headerBg: 'bg-[#0b1120]',
    headerBorder: 'border-slate-800',
    mainBg: 'bg-[#030712]',
    accentColor: 'text-cyan-400',
    accentBg: 'bg-blue-600 hover:bg-blue-700',
    accentText: 'text-white',
    accentBadge: 'bg-slate-900 text-cyan-300 border-slate-700',
    isDarkWorkspace: true,
    previewColors: {
      sidebar: '#030712',
      accent: '#38bdf8',
      canvas: '#0b1120',
      glow: '#0ea5e9',
    },
  },
  siliconClean: {
    id: 'siliconClean',
    name: 'Silicon Valley Pro',
    category: 'Modern Enterprise',
    tag: 'CLEAN MINIMAL',
    description: 'Ultra sharp gunmetal slate with crisp cobalt accents and pristine contrast',
    sidebarBg: 'bg-[#0b1324]',
    sidebarBorder: 'border-slate-800',
    sidebarText: 'text-slate-300',
    sidebarActiveBg: 'bg-blue-600',
    sidebarActiveText: 'text-white shadow-blue-600/30 shadow-md',
    sidebarHoverBg: 'hover:bg-slate-800 hover:text-white',
    headerBg: 'bg-white',
    headerBorder: 'border-slate-200',
    mainBg: 'bg-[#f4f7fa]',
    accentColor: 'text-blue-600',
    accentBg: 'bg-blue-600 hover:bg-blue-700',
    accentText: 'text-white',
    accentBadge: 'bg-blue-50 text-blue-800 border-blue-200',
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#0b1324',
      accent: '#2563eb',
      canvas: '#f4f7fa',
      glow: '#60a5fa',
    },
  },
  emeraldMatrix: {
    id: 'emeraldMatrix',
    name: 'Quantum Matrix',
    category: 'Quantum Grid',
    tag: 'ADVANCED',
    description: 'Deep carbon emerald grid with quantum green matrix luminescence',
    sidebarBg: 'bg-[#02130e]',
    sidebarBorder: 'border-emerald-950/80',
    sidebarText: 'text-emerald-200/80',
    sidebarActiveBg: 'bg-gradient-to-r from-emerald-500 to-green-600',
    sidebarActiveText: 'text-white shadow-emerald-500/30 shadow-lg',
    sidebarHoverBg: 'hover:bg-emerald-950/60 hover:text-emerald-100',
    headerBg: 'bg-white',
    headerBorder: 'border-emerald-100',
    mainBg: 'bg-[#f2faf6]',
    accentColor: 'text-emerald-600',
    accentBg: 'bg-emerald-600 hover:bg-emerald-700',
    accentText: 'text-white',
    accentBadge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#02130e',
      accent: '#059669',
      canvas: '#f2faf6',
      glow: '#10b981',
    },
  },
};

interface ThemeContextType {
  currentTheme: ThemeConfig;
  themeId: string;
  setThemeId: (id: string) => void;
  availableThemes: ThemeConfig[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('tr_app_theme');
      return saved && THEMES[saved] ? saved : 'neoCyan';
    } catch {
      return 'neoCyan';
    }
  });

  const setThemeId = (id: string) => {
    if (THEMES[id]) {
      setThemeIdState(id);
      try {
        localStorage.setItem('tr_app_theme', id);
      } catch (err) {
        console.error('Failed to save theme in localStorage:', err);
      }
    }
  };

  const currentTheme = THEMES[themeId] || THEMES.neoCyan;

  useEffect(() => {
    if (currentTheme.isDarkWorkspace) {
      document.documentElement.classList.add('dark-theme');
    } else {
      document.documentElement.classList.remove('dark-theme');
    }
  }, [currentTheme]);

  return (
    <ThemeContext.Provider
      value={{
        currentTheme,
        themeId,
        setThemeId,
        availableThemes: Object.values(THEMES),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
