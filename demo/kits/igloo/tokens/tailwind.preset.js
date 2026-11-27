// Tailwind preset extracted by DEA. Use: presets: [require('./tailwind.preset.js')] (or import it in tailwind.config.js)
// It points at the CSS variables in tokens.css, so import tokens.css once in your app.
/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      "colors": {
        "background": "var(--color-background)",
        "neutral-1": "var(--color-neutral-1)"
      },
      "fontFamily": {},
      "fontSize": {},
      "transitionDuration": {
        "5000ms": "var(--duration-5000ms)"
      },
      "transitionTimingFunction": {}
    },
  },
};
