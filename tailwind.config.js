/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'cps-red': '#e63946', // Lighter red
        'cps-light-red': '#2c0a0e',
        'cps-green': '#2a9d8f',
        'cps-light-green': '#1c3832',
        'cps-yellow': '#e9c46a',
        'cps-light-yellow': '#332d1a',
        'cps-blue': '#457b9d',
        'cps-light-blue': '#1a2832',
        'cps-dark': '#000000',
        'cps-light': '#1a1a1a',
        'cps-orange': '#f97316',
        'cps-dark-orange': '#4f2a09', // Add this line
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
};
