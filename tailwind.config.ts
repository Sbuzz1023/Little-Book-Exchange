import type { Config } from 'tailwindcss'
import { fontFamily } from 'tailwindcss/defaultTheme'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#fffbf0',
        'bk-orange': '#f97316',
        'bk-orange-dark': '#c2410c',
        'bk-teal': '#0d9488',
        'bk-teal-dark': '#0f766e',
        'bk-yellow': '#fbbf24',
      },
      fontFamily: {
        sans: ['Nunito', ...fontFamily.sans],
        display: ['Pacifico', 'cursive'],
      },
    },
  },
  plugins: [],
}
export default config
