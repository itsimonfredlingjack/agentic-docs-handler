/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ["'JetBrains Mono'", 'monospace'],
      },
      boxShadow: {
        glass: "var(--glass-shadow)",
        "glass-hover": "var(--glass-shadow-hover)",
      },
      borderRadius: {
        card: "var(--card-radius)",
      },
      backgroundImage: {
        aurora: "var(--accent-gradient)",
      },
    },
  },
  plugins: [],
};
