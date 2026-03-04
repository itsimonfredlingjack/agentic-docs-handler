/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        body: ["var(--font-body)"],
        mono: ["var(--font-mono)"],
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
        frost: "var(--bg-gradient)",
      },
    },
  },
  plugins: [],
};
