/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        github: {
          bg: '#0d1117',
          border: '#30363d',
          card: '#161b22',
          text: '#c9d1d9',
          primary: '#2f81f7',
          hover: '#8b949e'
        }
      }
    },
  },
  plugins: [],
}