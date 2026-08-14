import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface ThemeConfig {
  id: string;
  name: string;
  category: string;
  themeMode: 'light' | 'dark';
  tag: string;
  description: string;
  sidebarBg: string;
  sidebarBorder: string;
  sidebarText: string;
  sidebarActiveBg: string;
  sidebarActiveText: string;
  sidebarHoverBg: string;
  sidebarTitleText: string;
  sidebarSubText: string;
  sidebarCardBg: string;
  sidebarCardBorder: string;
  sidebarCardTitle: string;
  headerBg: string;
  headerBorder: string;
  mainBg: string;
  accentColor: string;
  accentBg: string;
  accentText: string;
  accentBadge: string;
  isLightSidebar?: boolean;
  isDarkWorkspace?: boolean;
  previewColors: {
    sidebar: string;
    accent: string;
    canvas: string;
    glow?: string;
  };
}

export const THEMES: Record<string, ThemeConfig> = {
  // ==================== LIGHT THEME PRESETS ====================
  nordicSnow: {
    id: 'nordicSnow',
    name: 'Nordic Snow Light',
    category: 'Clean Light',
    themeMode: 'light',
    tag: 'NEW LIGHT',
    description: 'Crisp pure snow white sidebar with high-contrast obsidian text and vibrant cobalt pills',
    sidebarBg: 'bg-white',
    sidebarBorder: 'border-slate-200',
    sidebarText: 'text-slate-600',
    sidebarActiveBg: 'bg-blue-600',
    sidebarActiveText: 'text-white shadow-blue-500/20 shadow-md font-bold',
    sidebarHoverBg: 'hover:bg-slate-100 hover:text-slate-900',
    sidebarTitleText: 'text-slate-900 font-extrabold',
    sidebarSubText: 'text-slate-500 font-medium',
    sidebarCardBg: 'bg-slate-50',
    sidebarCardBorder: 'border-slate-200',
    sidebarCardTitle: 'text-slate-900',
    headerBg: 'bg-white',
    headerBorder: 'border-slate-200',
    mainBg: 'bg-[#f8fafc]',
    accentColor: 'text-blue-600',
    accentBg: 'bg-blue-600 hover:bg-blue-700',
    accentText: 'text-white',
    accentBadge: 'bg-blue-50 text-blue-800 border-blue-200',
    isLightSidebar: true,
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#ffffff',
      accent: '#2563eb',
      canvas: '#f8fafc',
      glow: '#3b82f6',
    },
  },
  alpineMint: {
    id: 'alpineMint',
    name: 'Alpine Mint Light',
    category: 'Nature Light',
    themeMode: 'light',
    tag: 'FRESH LIGHT',
    description: 'Fresh eucalyptus light sidebar with crisp botanical emerald accents and clean contrast',
    sidebarBg: 'bg-[#f4fbf7]',
    sidebarBorder: 'border-emerald-200/80',
    sidebarText: 'text-emerald-900/80',
    sidebarActiveBg: 'bg-emerald-600',
    sidebarActiveText: 'text-white shadow-emerald-500/20 shadow-md font-bold',
    sidebarHoverBg: 'hover:bg-emerald-100/70 hover:text-emerald-950',
    sidebarTitleText: 'text-emerald-950 font-extrabold',
    sidebarSubText: 'text-emerald-700 font-medium',
    sidebarCardBg: 'bg-white',
    sidebarCardBorder: 'border-emerald-200',
    sidebarCardTitle: 'text-emerald-950',
    headerBg: 'bg-white',
    headerBorder: 'border-emerald-100',
    mainBg: 'bg-[#f0fdf4]',
    accentColor: 'text-emerald-600',
    accentBg: 'bg-emerald-600 hover:bg-emerald-700',
    accentText: 'text-white',
    accentBadge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    isLightSidebar: true,
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#f4fbf7',
      accent: '#059669',
      canvas: '#f0fdf4',
      glow: '#10b981',
    },
  },
  royalPorcelain: {
    id: 'royalPorcelain',
    name: 'Royal Porcelain Light',
    category: 'Enterprise Light',
    themeMode: 'light',
    tag: 'PREMIUM LIGHT',
    description: 'Executive porcelain sidebar with rich deep sapphire accents and crisp borders',
    sidebarBg: 'bg-[#f9fafc]',
    sidebarBorder: 'border-blue-100',
    sidebarText: 'text-slate-700',
    sidebarActiveBg: 'bg-gradient-to-r from-blue-700 to-indigo-700',
    sidebarActiveText: 'text-white shadow-indigo-500/20 shadow-md font-bold',
    sidebarHoverBg: 'hover:bg-blue-50 hover:text-blue-900',
    sidebarTitleText: 'text-slate-900 font-extrabold',
    sidebarSubText: 'text-blue-600 font-medium',
    sidebarCardBg: 'bg-white',
    sidebarCardBorder: 'border-blue-200/80',
    sidebarCardTitle: 'text-slate-900',
    headerBg: 'bg-white',
    headerBorder: 'border-slate-200',
    mainBg: 'bg-[#f3f6fa]',
    accentColor: 'text-blue-700',
    accentBg: 'bg-blue-700 hover:bg-blue-800',
    accentText: 'text-white',
    accentBadge: 'bg-blue-50 text-blue-800 border-blue-200',
    isLightSidebar: true,
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#f9fafc',
      accent: '#1d4ed8',
      canvas: '#f3f6fa',
      glow: '#3b82f6',
    },
  },
  sunlightAmber: {
    id: 'sunlightAmber',
    name: 'Sunlight Sand Light',
    category: 'Warm Light',
    themeMode: 'light',
    tag: 'WARM LIGHT',
    description: 'Warm alabaster linen sidebar with energetic golden amber accents and soft cream canvas',
    sidebarBg: 'bg-[#fcfaf7]',
    sidebarBorder: 'border-amber-200/70',
    sidebarText: 'text-stone-700',
    sidebarActiveBg: 'bg-gradient-to-r from-amber-500 to-orange-500',
    sidebarActiveText: 'text-white shadow-amber-500/20 shadow-md font-bold',
    sidebarHoverBg: 'hover:bg-amber-100/60 hover:text-amber-950',
    sidebarTitleText: 'text-stone-900 font-extrabold',
    sidebarSubText: 'text-amber-700 font-medium',
    sidebarCardBg: 'bg-white',
    sidebarCardBorder: 'border-amber-200',
    sidebarCardTitle: 'text-stone-900',
    headerBg: 'bg-white',
    headerBorder: 'border-amber-100',
    mainBg: 'bg-[#faf7f2]',
    accentColor: 'text-amber-600',
    accentBg: 'bg-amber-600 hover:bg-amber-700',
    accentText: 'text-white',
    accentBadge: 'bg-amber-50 text-amber-800 border-amber-200',
    isLightSidebar: true,
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#fcfaf7',
      accent: '#f59e0b',
      canvas: '#faf7f2',
      glow: '#fbbf24',
    },
  },
  lavenderQuartz: {
    id: 'lavenderQuartz',
    name: 'Lilac Quartz Light',
    category: 'Pastel Light',
    themeMode: 'light',
    tag: 'MODERN LIGHT',
    description: 'Clean lavender-tinted light sidebar with vibrant violet-indigo active states',
    sidebarBg: 'bg-[#faf8fe]',
    sidebarBorder: 'border-purple-200/70',
    sidebarText: 'text-purple-900/80',
    sidebarActiveBg: 'bg-gradient-to-r from-purple-600 to-indigo-600',
    sidebarActiveText: 'text-white shadow-purple-500/20 shadow-md font-bold',
    sidebarHoverBg: 'hover:bg-purple-100/60 hover:text-purple-950',
    sidebarTitleText: 'text-purple-950 font-extrabold',
    sidebarSubText: 'text-purple-600 font-medium',
    sidebarCardBg: 'bg-white',
    sidebarCardBorder: 'border-purple-200',
    sidebarCardTitle: 'text-purple-950',
    headerBg: 'bg-white',
    headerBorder: 'border-purple-100',
    mainBg: 'bg-[#f6f2fd]',
    accentColor: 'text-purple-600',
    accentBg: 'bg-purple-600 hover:bg-purple-700',
    accentText: 'text-white',
    accentBadge: 'bg-purple-50 text-purple-800 border-purple-200',
    isLightSidebar: true,
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#faf8fe',
      accent: '#9333ea',
      canvas: '#f6f2fd',
      glow: '#c084fc',
    },
  },
  skylineAzure: {
    id: 'skylineAzure',
    name: 'Skyline Azure Light',
    category: 'Celestial Light',
    themeMode: 'light',
    tag: 'AIR LIGHT',
    description: 'Soft sky-ice light sidebar with high-definition ocean cyan pills and clarity',
    sidebarBg: 'bg-[#f2f8fc]',
    sidebarBorder: 'border-sky-200/70',
    sidebarText: 'text-sky-950/80',
    sidebarActiveBg: 'bg-gradient-to-r from-cyan-600 to-blue-600',
    sidebarActiveText: 'text-white shadow-cyan-500/20 shadow-md font-bold',
    sidebarHoverBg: 'hover:bg-sky-100 hover:text-sky-950',
    sidebarTitleText: 'text-sky-950 font-extrabold',
    sidebarSubText: 'text-sky-600 font-medium',
    sidebarCardBg: 'bg-white',
    sidebarCardBorder: 'border-sky-200',
    sidebarCardTitle: 'text-sky-950',
    headerBg: 'bg-white',
    headerBorder: 'border-sky-100',
    mainBg: 'bg-[#edf6fc]',
    accentColor: 'text-cyan-600',
    accentBg: 'bg-cyan-600 hover:bg-cyan-700',
    accentText: 'text-white',
    accentBadge: 'bg-sky-50 text-sky-800 border-sky-200',
    isLightSidebar: true,
    isDarkWorkspace: false,
    previewColors: {
      sidebar: '#f2f8fc',
      accent: '#0284c7',
      canvas: '#edf6fc',
      glow: '#38bdf8',
    },
  },

  // ==================== NEXT-GEN DARK & CYBER THEMES ====================
  neoCyan: {
    id: 'neoCyan',
    name: 'Cyberpunk Neon',
    category: 'Next-Gen Cyber',
    themeMode: 'dark',
    tag: 'POPULAR',
    description: 'Deep obsidian stealth sidebar with electric cyan & hyper-blue energy pulses',
    sidebarBg: 'bg-[#050b14]',
    sidebarBorder: 'border-cyan-950/80',
    sidebarText: 'text-cyan-100/80',
    sidebarActiveBg: 'bg-gradient-to-r from-cyan-500 to-blue-600',
    sidebarActiveText: 'text-white shadow-cyan-500/30 shadow-lg font-bold',
    sidebarHoverBg: 'hover:bg-cyan-950/40 hover:text-cyan-200',
    sidebarTitleText: 'text-white font-extrabold',
    sidebarSubText: 'text-slate-400',
    sidebarCardBg: 'bg-white/5',
    sidebarCardBorder: 'border-white/10',
    sidebarCardTitle: 'text-white',
    headerBg: 'bg-white',
    headerBorder: 'border-slate-200',
    mainBg: 'bg-[#f0f6fa]',
    accentColor: 'text-cyan-600',
    accentBg: 'bg-cyan-600 hover:bg-cyan-700',
    accentText: 'text-white',
    accentBadge: 'bg-cyan-50 text-cyan-800 border-cyan-200',
    isLightSidebar: false,
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
    themeMode: 'dark',
    tag: 'NEXT-GEN',
    description: 'Deep cosmic teal with iridescent northern lights emerald & electric mint',
    sidebarBg: 'bg-[#031c18]',
    sidebarBorder: 'border-emerald-900/60',
    sidebarText: 'text-emerald-100/80',
    sidebarActiveBg: 'bg-gradient-to-r from-emerald-500 to-teal-600',
    sidebarActiveText: 'text-white shadow-emerald-500/30 shadow-lg font-bold',
    sidebarHoverBg: 'hover:bg-emerald-950/60 hover:text-emerald-100',
    sidebarTitleText: 'text-white font-extrabold',
    sidebarSubText: 'text-emerald-300',
    sidebarCardBg: 'bg-white/5',
    sidebarCardBorder: 'border-white/10',
    sidebarCardTitle: 'text-white',
    headerBg: 'bg-white',
    headerBorder: 'border-emerald-100/80',
    mainBg: 'bg-[#f0f9f6]',
    accentColor: 'text-emerald-600',
    accentBg: 'bg-emerald-600 hover:bg-emerald-700',
    accentText: 'text-white',
    accentBadge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    isLightSidebar: false,
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
    themeMode: 'dark',
    tag: 'HIGH VOLTAGE',
    description: 'Stealth charcoal with high-voltage solar orange & electrical amber arcs',
    sidebarBg: 'bg-[#140c06]',
    sidebarBorder: 'border-orange-950/80',
    sidebarText: 'text-amber-100/80',
    sidebarActiveBg: 'bg-gradient-to-r from-amber-500 to-orange-600',
    sidebarActiveText: 'text-white shadow-orange-500/30 shadow-lg font-bold',
    sidebarHoverBg: 'hover:bg-amber-950/50 hover:text-amber-100',
    sidebarTitleText: 'text-white font-extrabold',
    sidebarSubText: 'text-amber-300',
    sidebarCardBg: 'bg-white/5',
    sidebarCardBorder: 'border-white/10',
    sidebarCardTitle: 'text-white',
    headerBg: 'bg-white',
    headerBorder: 'border-amber-100/80',
    mainBg: 'bg-[#fdfaf5]',
    accentColor: 'text-orange-600',
    accentBg: 'bg-orange-600 hover:bg-orange-700',
    accentText: 'text-white',
    accentBadge: 'bg-orange-50 text-orange-800 border-orange-200',
    isLightSidebar: false,
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
    themeMode: 'dark',
    tag: 'HYPER GLOW',
    description: 'Deep midnight nebula with futuristic violet, indigo & ultraviolet highlights',
    sidebarBg: 'bg-[#0f0a21]',
    sidebarBorder: 'border-purple-950/80',
    sidebarText: 'text-purple-100/80',
    sidebarActiveBg: 'bg-gradient-to-r from-indigo-500 to-purple-600',
    sidebarActiveText: 'text-white shadow-purple-500/30 shadow-lg font-bold',
    sidebarHoverBg: 'hover:bg-purple-950/50 hover:text-purple-100',
    sidebarTitleText: 'text-white font-extrabold',
    sidebarSubText: 'text-purple-300',
    sidebarCardBg: 'bg-white/5',
    sidebarCardBorder: 'border-white/10',
    sidebarCardTitle: 'text-white',
    headerBg: 'bg-white',
    headerBorder: 'border-purple-100/80',
    mainBg: 'bg-[#f8f6fe]',
    accentColor: 'text-indigo-600',
    accentBg: 'bg-indigo-600 hover:bg-indigo-700',
    accentText: 'text-white',
    accentBadge: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    isLightSidebar: false,
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
    themeMode: 'dark',
    tag: 'DYNAMIC',
    description: 'Velvet carbon with radiant laser crimson & high-precision rose optics',
    sidebarBg: 'bg-[#1a040b]',
    sidebarBorder: 'border-rose-950/80',
    sidebarText: 'text-rose-100/80',
    sidebarActiveBg: 'bg-gradient-to-r from-rose-500 to-red-600',
    sidebarActiveText: 'text-white shadow-rose-500/30 shadow-lg font-bold',
    sidebarHoverBg: 'hover:bg-rose-950/50 hover:text-rose-100',
    sidebarTitleText: 'text-white font-extrabold',
    sidebarSubText: 'text-rose-300',
    sidebarCardBg: 'bg-white/5',
    sidebarCardBorder: 'border-white/10',
    sidebarCardTitle: 'text-white',
    headerBg: 'bg-white',
    headerBorder: 'border-rose-100/80',
    mainBg: 'bg-[#fdf5f7]',
    accentColor: 'text-rose-600',
    accentBg: 'bg-rose-600 hover:bg-rose-700',
    accentText: 'text-white',
    accentBadge: 'bg-rose-50 text-rose-800 border-rose-200',
    isLightSidebar: false,
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
    themeMode: 'dark',
    tag: 'OLED DARK',
    description: 'Pure pitch OLED workspace engineered for workshop screens and dim lighting',
    sidebarBg: 'bg-[#030712]',
    sidebarBorder: 'border-slate-800',
    sidebarText: 'text-slate-300',
    sidebarActiveBg: 'bg-gradient-to-r from-blue-600 to-cyan-600',
    sidebarActiveText: 'text-white shadow-blue-500/30 shadow-lg font-bold',
    sidebarHoverBg: 'hover:bg-slate-900 hover:text-white',
    sidebarTitleText: 'text-white font-extrabold',
    sidebarSubText: 'text-slate-400',
    sidebarCardBg: 'bg-slate-900',
    sidebarCardBorder: 'border-slate-800',
    sidebarCardTitle: 'text-white',
    headerBg: 'bg-[#0b1120]',
    headerBorder: 'border-slate-800',
    mainBg: 'bg-[#030712]',
    accentColor: 'text-cyan-400',
    accentBg: 'bg-blue-600 hover:bg-blue-700',
    accentText: 'text-white',
    accentBadge: 'bg-slate-900 text-cyan-300 border-slate-700',
    isLightSidebar: false,
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
    name: 'Silicon Valley Dark',
    category: 'Modern Enterprise',
    themeMode: 'dark',
    tag: 'DARK MINIMAL',
    description: 'Ultra sharp gunmetal slate with crisp cobalt accents and pristine contrast',
    sidebarBg: 'bg-[#0b1324]',
    sidebarBorder: 'border-slate-800',
    sidebarText: 'text-slate-300',
    sidebarActiveBg: 'bg-blue-600',
    sidebarActiveText: 'text-white shadow-blue-600/30 shadow-md font-bold',
    sidebarHoverBg: 'hover:bg-slate-800 hover:text-white',
    sidebarTitleText: 'text-white font-extrabold',
    sidebarSubText: 'text-slate-400',
    sidebarCardBg: 'bg-white/5',
    sidebarCardBorder: 'border-white/10',
    sidebarCardTitle: 'text-white',
    headerBg: 'bg-white',
    headerBorder: 'border-slate-200',
    mainBg: 'bg-[#f4f7fa]',
    accentColor: 'text-blue-600',
    accentBg: 'bg-blue-600 hover:bg-blue-700',
    accentText: 'text-white',
    accentBadge: 'bg-blue-50 text-blue-800 border-blue-200',
    isLightSidebar: false,
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
    themeMode: 'dark',
    tag: 'ADVANCED',
    description: 'Deep carbon emerald grid with quantum green matrix luminescence',
    sidebarBg: 'bg-[#02130e]',
    sidebarBorder: 'border-emerald-950/80',
    sidebarText: 'text-emerald-200/80',
    sidebarActiveBg: 'bg-gradient-to-r from-emerald-500 to-green-600',
    sidebarActiveText: 'text-white shadow-emerald-500/30 shadow-lg font-bold',
    sidebarHoverBg: 'hover:bg-emerald-950/60 hover:text-emerald-100',
    sidebarTitleText: 'text-white font-extrabold',
    sidebarSubText: 'text-emerald-400',
    sidebarCardBg: 'bg-white/5',
    sidebarCardBorder: 'border-white/10',
    sidebarCardTitle: 'text-white',
    headerBg: 'bg-white',
    headerBorder: 'border-emerald-100',
    mainBg: 'bg-[#f2faf6]',
    accentColor: 'text-emerald-600',
    accentBg: 'bg-emerald-600 hover:bg-emerald-700',
    accentText: 'text-white',
    accentBadge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    isLightSidebar: false,
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
      return saved && THEMES[saved] ? saved : 'nordicSnow';
    } catch {
      return 'nordicSnow';
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

  const currentTheme = THEMES[themeId] || THEMES.nordicSnow;

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
