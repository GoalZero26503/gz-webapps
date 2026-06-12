import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'gz-green': {
          DEFAULT: '#bfd22b',
          dim: 'rgba(191, 210, 43, 0.15)',
          muted: '#8a9a1f',
          glow: 'rgba(191, 210, 43, 0.25)',
        },
        surface: {
          root: '#0e0f11',
          primary: '#141518',
          card: '#1a1c20',
          'card-hover': '#1f2126',
          elevated: '#222428',
          input: 'rgba(255, 255, 255, 0.04)',
        },
        accent: {
          cyan: '#00e5ff',
          'cyan-dim': 'rgba(0, 229, 255, 0.12)',
          blue: '#1c9ad6',
          'blue-dim': 'rgba(28, 154, 214, 0.12)',
          orange: '#ff9531',
          'orange-dim': 'rgba(255, 149, 49, 0.12)',
          red: '#ff531d',
          'red-dim': 'rgba(255, 83, 29, 0.10)',
          yellow: '#ffcd1d',
          'yellow-dim': 'rgba(255, 205, 29, 0.10)',
        },
        text: {
          primary: 'rgba(255, 255, 255, 0.92)',
          secondary: 'rgba(255, 255, 255, 0.55)',
          tertiary: 'rgba(255, 255, 255, 0.30)',
          inverse: '#0e0f11',
        },
      },
      fontFamily: {
        sans: ['DM Sans', ...defaultTheme.fontFamily.sans],
        mono: ['JetBrains Mono', ...defaultTheme.fontFamily.mono],
      },
    },
  },
} satisfies Config;
