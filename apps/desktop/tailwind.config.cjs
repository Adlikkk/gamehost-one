module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0E1116",
        surface: "#151A21",
        primary: "#4F7CFF",
        one: "#55D6CF",
        secondary: "#2ED573",
        text: "#E6EAF0",
        muted: "#9AA4B2",
        danger: "#E25555"
      },
      fontFamily: {
        display: ["\"Space Grotesk\"", "system-ui", "sans-serif"],
        body: ["\"Sora\"", "system-ui", "sans-serif"]
      },
      boxShadow: {
        soft: "0 20px 60px rgba(0, 0, 0, 0.35)",
        inset: "inset 0 0 0 1px rgba(255, 255, 255, 0.04)"
      }
    }
  },
  plugins: []
};
