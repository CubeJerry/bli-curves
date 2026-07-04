# Octet Processor

Browser-only tool for parsing Octet result exports, renaming curves, and exporting Prism-ready XLSX or PZFX files.

Open `index.html` in a browser. The app runs locally and uses:

- `styles.css` for layout and visual styling.
- `app.js` for parsing, naming, preview, XLSX export, and PZFX export.

The rename grid supports Excel-style copy/paste. Vertical pastes stay in the selected column, and Shift-click / Shift-arrow selection is grid-aware.

## GitHub Pages

This repository includes a GitHub Actions workflow at `.github/workflows/pages.yml`.

In the GitHub repository settings, set:

- **Settings > Pages > Build and deployment > Source:** GitHub Actions

The workflow uploads the repository root as the Pages artifact, so `index.html`, `app.js`, and `styles.css` must stay at the repository root.
