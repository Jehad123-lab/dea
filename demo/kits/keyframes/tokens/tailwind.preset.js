// Tailwind preset extracted by DEA. Use: presets: [require('./tailwind.preset.js')] (or import it in tailwind.config.js)
// It points at the CSS variables in tokens.css, so import tokens.css once in your app.
/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      "colors": {
        "background": "var(--color-background)",
        "text": "var(--color-text)",
        "neutral-1": "var(--color-neutral-1)",
        "neutral-2": "var(--color-neutral-2)"
      },
      "fontFamily": {
        "primary": "var(--font-primary)"
      },
      "fontSize": {
        "13": "var(--text-13)"
      },
      "transitionDuration": {},
      "transitionTimingFunction": {}
    },
  },
};
