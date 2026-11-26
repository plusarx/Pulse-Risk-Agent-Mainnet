import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#07090d',
        panel: '#0c0e13',
        panel2: '#15171e',
        line: '#21242d',
        muted: '#8a8f9c',
        up: '#00c278',
        down: '#ff5b5b',
        accent: '#f0b90b',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['Menlo', '"SF Mono"', 'Consolas', '"DejaVu Sans Mono"', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
} satisfies Config;
