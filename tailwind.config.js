/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3B82F6',
        'button-hover': '#2563EB',
        'background-light': '#F9FAFB',
        'text-primary': '#000000',
        'text-secondary': '#374151',
        highlight: '#3B82F6',
      },
    },
  },
  plugins: [],
} 