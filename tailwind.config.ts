import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // === Archive palette (mirrors globals.css CSS vars for tailwind ergonomics) ===
        paper:        { DEFAULT: '#F4F1E8', 2: '#EAE6D6', 3: '#DDD7C0' },
        surface:     { DEFAULT: '#FBF9F2', raised: '#FFFFFF', sunken: '#EAE6D6' },
        ink:         { DEFAULT: '#0A0E1A', 2: '#2A2F40', 3: '#5A6075', 4: '#8A8F9F' },
        signal:      { DEFAULT: '#0E5E4A', bright: '#00B07A', wash: '#D4ECDB' },
        ember:       { DEFAULT: '#A8360A', bright: '#C8410C', wash: '#F4D8C7' },
        rule:        { DEFAULT: 'rgba(10, 14, 26, 0.12)', strong: '#0A0E1A', faint: 'rgba(10, 14, 26, 0.06)' },

        // === Dark-mode equivalents (used via .dark class) ===
        // (kept here for completeness, but primary path is CSS vars in globals.css)
        navy: {
          900: '#020617',
          800: '#0F172A',
          700: '#1E293B',
        },
        success: { DEFAULT: '#0E5E4A', bright: '#00B07A' },
        warning: { DEFAULT: '#C8410C' },
        danger:  { DEFAULT: '#A8360A' },
      },
      fontFamily: {
        display: ['Fraunces', 'Iowan Old Style', 'Georgia', 'serif'],
        body:    ['Geist', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        sans:    ['Geist', 'Inter', 'system-ui', 'sans-serif'],
        serif:   ['Fraunces', 'Iowan Old Style', 'Georgia', 'serif'],
      },
      fontSize: {
        // Display (Fraunces) — for editorial headlines
        'display-2xl': ['4.5rem',  { lineHeight: '1.05',  letterSpacing: '-0.035em', fontWeight: '500' }],
        'display-xl':  ['3.5rem',  { lineHeight: '1.05',  letterSpacing: '-0.03em',  fontWeight: '500' }],
        'display-lg':  ['2.75rem', { lineHeight: '1.08',  letterSpacing: '-0.025em', fontWeight: '500' }],
        'display-md':  ['2rem',    { lineHeight: '1.15',  letterSpacing: '-0.02em',  fontWeight: '500' }],
        'display-sm':  ['1.5rem',  { lineHeight: '1.2',   letterSpacing: '-0.015em', fontWeight: '500' }],
        // Body (Geist)
        'body-lg':     ['1.0625rem', { lineHeight: '1.55', letterSpacing: '-0.005em' }],
        'body-md':     ['0.9375rem', { lineHeight: '1.55', letterSpacing: '-0.003em' }],
        'body-sm':     ['0.8125rem', { lineHeight: '1.5',  letterSpacing: '0' }],
        'body-xs':     ['0.75rem',   { lineHeight: '1.4',  letterSpacing: '0' }],
        // Label / mono
        'label-lg':    ['0.8125rem', { lineHeight: '1.3',  letterSpacing: '0.04em',  fontWeight: '600' }],
        'label-md':    ['0.6875rem', { lineHeight: '1.3',  letterSpacing: '0.14em',  fontWeight: '600' }],
        'label-sm':    ['0.625rem',  { lineHeight: '1.2',  letterSpacing: '0.18em',  fontWeight: '600' }],
        'mono-md':     ['0.8125rem', { lineHeight: '1.45' }],
        'mono-sm':     ['0.6875rem', { lineHeight: '1.4'  }],
      },
      borderRadius: {
        none: '0',
        sm:   '2px',
        DEFAULT: '2px',
        md:   '3px',
        lg:   '4px',
        xl:   '6px',
        '2xl': '8px',
        full: '9999px',
      },
      boxShadow: {
        'paper-sm': '0 1px 2px rgba(10, 14, 26, 0.05)',
        'paper-md': '0 2px 8px rgba(10, 14, 26, 0.06), 0 1px 2px rgba(10, 14, 26, 0.04)',
        'paper-lg': '0 12px 32px rgba(10, 14, 26, 0.10), 0 4px 8px rgba(10, 14, 26, 0.05)',
        'press':    '0 1px 0 rgba(10, 14, 26, 0.08)',
        'inset-1':  'inset 0 0 0 1px rgba(10, 14, 26, 0.12)',
      },
      letterSpacing: {
        'mono': '0.04em',
        'label': '0.14em',
        'archive': '0.18em',
      },
      transitionTimingFunction: {
        archive: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        archiveOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'stamp-in': {
          '0%':   { transform: 'rotate(-15deg) scale(1.6)', opacity: '0' },
          '60%':  { transform: 'rotate(-3deg)  scale(0.95)', opacity: '1' },
          '100%': { transform: 'rotate(-1.5deg) scale(1)',   opacity: '0.9' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'scan-line': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.35' },
        },
        'marquee': {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'stamp-in':  'stamp-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-up':   'fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        'scan-line': 'scan-line 2s cubic-bezier(0.2, 0.7, 0.2, 1) infinite',
        'pulse-dot': 'pulse-dot 1.4s ease-in-out infinite',
        'marquee':   'marquee 40s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
