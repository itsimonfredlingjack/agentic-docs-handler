/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontSize: {
        'xs-ui': ['10px', { lineHeight: '1.4' }],
        'sm-ui': ['12px', { lineHeight: '1.5' }],
        'base-ui': ['13px', { lineHeight: '1.5' }],
        'lg-ui': ['16px', { lineHeight: '1.3' }],
        'xl-ui': ['22px', { lineHeight: '1.2' }],
      },
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
