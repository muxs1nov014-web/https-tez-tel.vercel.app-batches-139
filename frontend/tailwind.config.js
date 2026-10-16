const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
/** A colour backed by a CSS variable holding "r g b", so opacity modifiers keep working. */
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const scale = (family) => Object.fromEntries(SHADES.map((shade) => [shade, token(`${family}-${shade}`)]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Theme is driven by the `dark` class on <html> (see src/lib/theme.ts).
  darkMode: 'class',
  theme: {
    extend: {
      // Apple-style palette. Every shade is a CSS variable (src/index.css) with a light and
      // a dark value, so existing classes adapt to the theme without `dark:` variants.
      // Charts read the same variables via src/lib/chartColors.ts.
      colors: {
        canvas: token('canvas'),
        surface: token('surface'),
        slate: scale('slate'),
        primary: scale('primary'),
        success: scale('success'),
        danger: scale('danger'),
        warning: scale('warning'),
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'SF Pro Display',
          'Inter',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 0 0 0.5px rgb(0 0 0 / 0.05), 0 1px 2px rgb(0 0 0 / 0.04), 0 2px 10px rgb(0 0 0 / 0.03)',
        raised: '0 0 0 0.5px rgb(0 0 0 / 0.05), 0 1px 1px rgb(0 0 0 / 0.04), 0 2px 4px rgb(0 0 0 / 0.06)',
        pop: '0 0 0 0.5px rgb(0 0 0 / 0.08), 0 24px 64px rgb(0 0 0 / 0.20), 0 4px 12px rgb(0 0 0 / 0.08)',
        glyph: 'inset 0 0.5px 0 rgb(255 255 255 / 0.35), 0 0.5px 1.5px rgb(0 0 0 / 0.22)',
      },
      // Apple-like motion: quick, decelerating, no bounce.
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'sheet-in': {
          from: { opacity: '0', transform: 'translateY(10px) scale(0.985)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'fade-up': 'fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'sheet-in': 'sheet-in 0.3s cubic-bezier(0.32, 0.72, 0, 1) both',
        'fade-in': 'fade-in 0.2s ease-out both',
        // Route change. Opacity only, and `backwards` fill so nothing stays applied afterwards:
        // a lingering transform would turn the page into the containing block of fixed bars.
        page: 'fade-in 0.28s ease-out backwards',
      },
    },
  },
  plugins: [],
};
