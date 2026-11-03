const path = require('node:path')

const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [path.join(__dirname, 'src/renderer/**/*.{ts,tsx,html}')],
  theme: {
    extend: {
      colors: {
        accent: v('accent'),
        'accent-2': v('accent-2'),
        'on-accent': v('on-accent'),
        bg: v('bg'),
        surface: v('surface'),
        elevated: v('elevated'),
        line: v('line'),
        fg: v('fg'),
        muted: v('muted')
      },
      fontFamily: {
        sans: ['"Instrument Sans Variable"', 'Segoe UI', 'sans-serif'],
        display: ['"Unbounded Variable"', '"Instrument Sans Variable"', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'Consolas', 'monospace']
      },
      borderRadius: {
        '4xl': '2rem'
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--accent) / 0.35), 0 12px 40px -8px rgb(var(--accent) / 0.45)',
        card: '0 10px 30px -12px rgb(0 0 0 / 0.6)'
      },
      keyframes: {
        'page-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.96) translateY(6px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' }
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' }
        },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--accent) / 0.6)' },
          '100%': { boxShadow: '0 0 0 10px rgb(var(--accent) / 0)' }
        }
      },
      animation: {
        'page-in': 'page-in 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'fade-in': 'fade-in 200ms ease-out both',
        'pop-in': 'pop-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'slide-in-right': 'slide-in-right 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        shimmer: 'shimmer 2.4s linear infinite',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite'
      }
    }
  },
  plugins: []
}
