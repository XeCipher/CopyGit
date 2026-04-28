/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sora', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      colors: {
        ink: {
          50:  '#f5f5f0',
          100: '#ededea',
          200: '#d8d8d0',
          300: '#b8b8b0',
          400: '#888890',
          500: '#606068',
          600: '#484850',
          700: '#303038',
          800: '#1e1e28',
          900: '#12121c',
          950: '#0a0a10',
        },
        violet: {
          400: '#a78bf7',
          500: '#8b6ef5',
          600: '#7c6af7',
          700: '#6d59f0',
          800: '#5847d4',
        }
      },
      animation: {
        'fade-in':   'fadeIn 0.35s ease-out both',
        'slide-up':  'slideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-down':'slideDown 0.3s ease-out both',
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%':   { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.5', transform: 'scale(0.8)' },
        }
      },
      boxShadow: {
        'glow':    '0 0 40px rgba(124, 106, 247, 0.15)',
        'glow-lg': '0 0 80px rgba(124, 106, 247, 0.2)',
        'card':    '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
        'card-dark': '0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.4)',
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}