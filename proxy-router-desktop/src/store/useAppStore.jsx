/**
 * useAppStore – lightweight global state via React context + useReducer.
 */

import { createContext, useContext, useReducer } from 'react';

// ── Initial State ──────────────────────────────────────────────────────────────
const initialState = {
  /** Whether the proxy routing is currently active */
  isActive: false,

  /** Current detected public IP address */
  publicIp: null,

  /** Whether IP whitelisting is in progress */
  isWhitelisting: false,

  /** Last whitelisting result: 'success' | 'error' | null */
  whitelistStatus: null,

  /** Preset AI & Neural Services */
  presetSites: [
    // Google AI Ecosystem
    {
      id: 'gemini',
      label: 'Google Gemini',
      category: 'Google AI',
      desc: 'Gemini Web Client & App',
      host: 'gemini.google.com',
      hosts: ['gemini.google.com', '*.googleusercontent.com'],
      enabled: true,
    },
    {
      id: 'aistudio',
      label: 'Google AI Studio & API',
      category: 'Google AI',
      desc: 'Developer Studio & Generative Language API',
      host: 'aistudio.google.com',
      hosts: [
        'aistudio.google.com',
        '*.generativelanguage.googleapis.com',
        'ai.google.dev',
        'alkalimakersuite-pa.clients6.google.com',
        'makersuite.google.com',
      ],
      enabled: true,
    },
    {
      id: 'antigravity',
      label: 'Antigravity & DeepMind',
      category: 'Google AI',
      desc: 'Antigravity IDE & DeepMind Research APIs',
      host: '*.antigravity.google',
      hosts: [
        '*.antigravity.google',
        '*.deepmind.google',
        'deepmind.google',
        '*.deepmind.com',
      ],
      enabled: true,
    },
    {
      id: 'stitch',
      label: 'Google Stitch',
      category: 'Google AI',
      desc: 'Google Stitch AI Workspace',
      host: 'stitch.withgoogle.com',
      hosts: ['stitch.withgoogle.com', '*.stitch.withgoogle.com'],
      enabled: true,
    },

    // OpenAI Ecosystem
    {
      id: 'chatgpt',
      label: 'ChatGPT Web',
      category: 'OpenAI',
      desc: 'ChatGPT UI, Auth & CDN assets',
      host: 'chatgpt.com',
      hosts: [
        'chatgpt.com',
        'chat.openai.com',
        '*.oaistatic.com',
        '*.oaiusercontent.com',
      ],
      enabled: true,
    },
    {
      id: 'openai_api',
      label: 'OpenAI API & Platform',
      category: 'OpenAI',
      desc: 'OpenAI Developers Platform & Inference APIs',
      host: 'api.openai.com',
      hosts: [
        'api.openai.com',
        'platform.openai.com',
        '*.openai.com',
      ],
      enabled: true,
    },

    // Anthropic Ecosystem
    {
      id: 'claude_web',
      label: 'Claude Web',
      category: 'Anthropic',
      desc: 'Claude AI Assistant Web Interface',
      host: 'claude.ai',
      hosts: ['claude.ai', '*.claude.ai'],
      enabled: true,
    },
    {
      id: 'anthropic_api',
      label: 'Anthropic Claude API',
      category: 'Anthropic',
      desc: 'Anthropic Claude Models API Endpoint',
      host: 'api.anthropic.com',
      hosts: ['api.anthropic.com', '*.anthropic.com'],
      enabled: true,
    },


    // Neural Platforms & Aggregators
    {
      id: 'openrouter',
      label: 'OpenRouter',
      category: 'Inference',
      desc: 'Universal AI Model Routing API',
      host: 'openrouter.ai',
      hosts: ['openrouter.ai', '*.openrouter.ai'],
      enabled: false,
    },
    {
      id: 'groq',
      label: 'Groq Cloud LPU',
      category: 'Inference',
      desc: 'Ultra-fast LPU Inference Engine API',
      host: 'groq.com',
      hosts: ['groq.com', 'api.groq.com', '*.groq.com'],
      enabled: false,
    },
    {
      id: 'perplexity',
      label: 'Perplexity AI',
      category: 'Inference',
      desc: 'Perplexity Search & Neural Citations',
      host: 'perplexity.ai',
      hosts: ['perplexity.ai', '*.perplexity.ai'],
      enabled: false,
    },
    {
      id: 'huggingface',
      label: 'Hugging Face',
      category: 'Inference',
      desc: 'Hugging Face Hub & Serverless Inference',
      host: 'huggingface.co',
      hosts: ['huggingface.co', '*.huggingface.co', 'api-inference.huggingface.co'],
      enabled: false,
    },
    {
      id: 'midjourney',
      label: 'Midjourney',
      category: 'Generative',
      desc: 'Midjourney Web App & Generation',
      host: 'midjourney.com',
      hosts: ['midjourney.com', '*.midjourney.com'],
      enabled: false,
    },
  ],

  /** User-added custom domains */
  customDomains: [],

  /** Routed Desktop Applications (.exe) — starts empty per user request */
  routedApps: [],

  /** Automatically route running processes when detected */
  autoRouteDetected: false,

  /** Terminal & Dev tools proxy status */
  terminalProxyActive: false,

  /** Server configuration */
  serverConfig: {
    apiUrl:    'http://your-server-ip:1135',
    authToken: '',
  },

  /** Activity log entries */
  log: [],
};

// ── Reducer ────────────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {
    case 'SET_ACTIVE':
      return { ...state, isActive: action.payload };

    case 'SET_PUBLIC_IP':
      return { ...state, publicIp: action.payload };

    case 'SET_WHITELISTING':
      return { ...state, isWhitelisting: action.payload };

    case 'SET_WHITELIST_STATUS':
      return { ...state, whitelistStatus: action.payload };

    case 'TOGGLE_PRESET_SITE': {
      const presetSites = state.presetSites.map(s =>
        s.id === action.payload ? { ...s, enabled: !s.enabled } : s
      );
      return { ...state, presetSites };
    }

    case 'RESTORE_PRESET_SITE': {
      const presetSites = state.presetSites.map(s =>
        s.id === action.payload ? { ...s, enabled: true } : s
      );
      return { ...state, presetSites };
    }

    case 'SET_ALL_PRESETS': {
      const enabled = Boolean(action.payload);
      const presetSites = state.presetSites.map(s => ({ ...s, enabled }));
      return { ...state, presetSites };
    }

    case 'ADD_CUSTOM_DOMAIN': {
      const domain = action.payload.trim().toLowerCase();
      if (!domain || state.customDomains.includes(domain)) return state;
      return { ...state, customDomains: [...state.customDomains, domain] };
    }

    case 'REMOVE_CUSTOM_DOMAIN':
      return {
        ...state,
        customDomains: state.customDomains.filter(d => d !== action.payload),
      };

    case 'ADD_ROUTED_APP': {
      const app = action.payload;
      if (!app || !app.path) return state;
      const exists = state.routedApps.some(a => a.path.toLowerCase() === app.path.toLowerCase());
      if (exists) return state;
      return { ...state, routedApps: [...state.routedApps, app] };
    }

    case 'REMOVE_ROUTED_APP':
      return {
        ...state,
        routedApps: state.routedApps.filter(a => a.id !== action.payload),
      };

    case 'SET_TERMINAL_PROXY':
      return { ...state, terminalProxyActive: action.payload };

    case 'SET_AUTO_ROUTE_DETECTED':
      return { ...state, autoRouteDetected: action.payload };

    case 'UPDATE_ROUTED_APP_STATUS': {
      const { id, isRunning, isRouted, pid } = action.payload;
      const routedApps = state.routedApps.map(a =>
        a.id === id ? { ...a, isRunning, isRouted, pid } : a
      );
      return { ...state, routedApps };
    }

    case 'UPDATE_SERVER_CONFIG':
      return {
        ...state,
        serverConfig: { ...state.serverConfig, ...action.payload },
      };

    case 'ADD_LOG_ENTRY': {
      const d = new Date();
      const timeStr = `${d.toTimeString().split(' ')[0]}.${String(d.getMilliseconds()).padStart(3, '0')}`;
      const entry = {
        id: Date.now() + Math.random(),
        ts: timeStr,
        category: action.payload.category || 'SYS',
        level: action.payload.level || 'info',
        msg: action.payload.msg || '',
        details: action.payload.details || null,
      };
      return { ...state, log: [entry, ...state.log].slice(0, 200) };
    }

    case 'CLEAR_LOG':
      return { ...state, log: [] };

    default:
      return state;
  }
}

// ── Context ────────────────────────────────────────────────────────────────────
const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppStore() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppStore must be used within AppProvider');
  return ctx;
}
