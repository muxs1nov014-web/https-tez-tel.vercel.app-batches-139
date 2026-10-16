// Same CSS variables as the Tailwind palette (src/index.css), so charts follow the light/dark theme.
const v = (name: string) => `rgb(var(--c-${name}))`;

export const chartColors = {
  primary: v('primary-500'),
  primaryLight: v('primary-300'),
  success: v('success-500'),
  danger: v('danger-500'),
  warning: v('warning-500'),
  muted: v('slate-400'),
  grid: v('slate-200'),
  axis: v('slate-500'),
};
