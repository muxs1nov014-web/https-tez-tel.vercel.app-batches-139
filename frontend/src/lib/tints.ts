/**
 * Apple system colours as squircle gradients (lighter top, base colour bottom), used for the
 * sidebar glyphs and stat widgets. They are identical in light and dark mode, like macOS icons.
 */
export const TINTS = {
  blue: 'from-[#4ea6ff] to-[#007aff]',
  green: 'from-[#5fd97f] to-[#30c158]',
  orange: 'from-[#ffb648] to-[#ff9500]',
  pink: 'from-[#ff6d8c] to-[#ff2d55]',
  red: 'from-[#ff6f66] to-[#ff3b30]',
  purple: 'from-[#cb83ff] to-[#af52de]',
  indigo: 'from-[#8381ff] to-[#5856d6]',
  teal: 'from-[#62cfe2] to-[#30b0c7]',
  mint: 'from-[#5fe0d6] to-[#00c3b8]',
  cyan: 'from-[#6fd6ff] to-[#32ade6]',
  brown: 'from-[#c8aa86] to-[#a2845e]',
  gray: 'from-[#a9a9ae] to-[#8e8e93]',
  slate: 'from-[#97a2b6] to-[#66718a]',
  telegram: 'from-[#62c6f4] to-[#229ed9]',
} as const;

export type Tint = keyof typeof TINTS;
