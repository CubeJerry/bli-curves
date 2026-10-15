# BLI Curves

A browser-local workspace for Octet result exports: name and organise curves,
make a clean scientific figure, and export the same selected data to GraphPad
Prism or Excel. No account, upload service, runtime dependencies or build step.

## Use

Open [the hosted app](https://cubejerry.github.io/bli-curves/), or download this
repository and open `index.html`. The five app files must stay together:
`index.html`, `styles.css`, `app.js`, `core.js`, and `figure.js`.

1. **Add result files.** Drop TXT, CSV or TSV exports containing `Time / Data`
   blocks, optionally with `Fit` columns. Add more files at any time. An
   identical filename/content pair is skipped; different files with the same
   filename remain separate. UTF-8 and BOM-marked UTF-16 are accepted.
2. **Choose the experiment.** Single binding labels individual curves. Dilution
   mode labels concentrations and enables imported fits by default. Source
   block names are optional subgrouping, not the default plotting layout.
3. **Edit labels like a spreadsheet.** Drag or Shift-click to select a rectangle,
   or click a label-column heading to select the column. Copy, cut and paste
   blocks with Excel; one pasted value fills the selection. Arrow keys and Tab
   navigate; Enter moves down. Double-click or F2 edits text. Use Fill down,
   Fill right, Clear, Undo and Redo in the toolbar (Ctrl/Cmd+D, R, Z and Shift+Z).
   Bulk edits apply only to visible rows.
4. **Choose curves to compare.** Filter and sort by antigen / plot group. The
   default is one plot per group. To compare arbitrary curves, click row
   numbers to toggle them, Shift-click for a range, or select all shown rows,
   then choose **Plot selected rows together**. Selections survive filtering;
   the selected-row count identifies hidden rows. This explicit selection
   overrides the Use checkboxes. Other display choices use included curves:
   all curves together, per plot group, or Plate Column plus group for dilution.
5. **Export.** SVG and PNG save the displayed figure. XLSX and PZFX contain all
   tables in the chosen display layout; CSV saves the displayed table. Selected
   rows therefore produce a comparison export as well as a comparison plot.
   Save a `.bli.json` project to retain source text, labels, selected rows,
   display layout, colours, plate notes and settings. Imported fits are dotted;
   measured curves are solid. The app does not calculate new fits.

`Try example data` adds clearly named synthetic sensorgrams. They demonstrate
the workflow, not instrument validation or experimental results.

## Figure tools

- Editable title and axis labels, colours, line width and font size.
- Automatic or manual axis limits and an optional association/dissociation
  marker at a user-entered time.
- A white background, optional grid, colourblind-aware default palette and
  complete wrapped legend; missing observations break lines.
- Standalone vector SVG with editable text, or PNG at 2×, 3× or 4× scale.
  PNG dimensions are pixel dimensions, not a claim of a particular print DPI.
- A single renderer for the preview and exports. Changing limits only crops
  the figure, never the exported data. Legend space can increase final height.

A 96-well reference remains available in a collapsed panel. In dilution mode,
concentration labels can be assigned by plate row A–H or column 1–12; use decimal
points and comma-separated values. A well must be an unambiguous separated
filename token, such as `run_A1.txt`. Labels remain editable per curve.

## Data integrity

The app preserves original response and imported fit values at JavaScript's
available numeric precision. The default time option subtracts each curve's
first finite time; turn it off to retain source time. It does not perform phase
alignment, smoothing, reference subtraction, baseline correction or fitting.

Both XLSX and PZFX use one common prepared table model. Curves with identical
time vectors share a time column. Different vectors are staggered in separate
row blocks with blank Y cells, preserving each original X/Y association,
including differing lengths, gaps, repeated timestamps and time resets. There
is no interpolation or assumption that matching row numbers mean matching time.

Prism data tables split at 104 Y columns, keeping each response/fit pair
together. The plot selector exposes each resulting part. PZFX exports **XY data
tables**, not a styled Prism graph or kinetic analysis; use SVG/PNG for the
figure. XLSX uses real numeric cells and formula-safe text labels. CSV text
labels starting like spreadsheet formulas are prefixed with an apostrophe.

The parser accepts adjacent, matching `Time1 / Data1 / Fit1`-style blocks and
unnumbered `Time / Data` pairs. Headers may carry common parenthesized units.
Metadata before the header may contain `Conc`, `Start` and `Stop`. Unrecognised
layouts and malformed numeric values produce visible diagnostics. Decimal
commas are accepted only when the detected convention is unambiguous; thousands
separators are not silently removed. Mixed or ambiguous number formats require
correction in the source export. Native Octet FRD files and acquisition folders
are not supported.

See [the scientific contract](docs/SCIENTIFIC_CONTRACT.md) for exact rules and
GraphPad references. No real experimental fixtures were supplied for this
redesign; automated checks use synthetic inputs covering the supported layouts.
Opening a representative export in your installed Prism version remains a
useful compatibility check. Native Prism has not been run in CI.

## Privacy and practical limits

All files are processed in the current browser tab. No data or edits are sent
to a server; no analytics, CDNs, remote fonts or automatic browser storage are
used. A saved project contains the original source data. Closing the tab without
saving loses the workspace; the browser is asked to warn when work is unsaved.

Import is limited to 50 MB per source file and 100 MB per saved project. Tables
have a conservative memory guard to avoid freezing a tab when many distinct
time grids would expand into millions of blank cells. PNG export is limited
to 40 megapixels. If a limit is reached, select fewer curves, separate antigen
plot groups, or use SVG for a large figure. No data are silently dropped to fit.

## Development and verification

The app uses classic standalone scripts so it also works from `file://`:

- `core.js`: pure parsing, numeric validation, table preparation and XLSX/PZFX.
- `figure.js`: shared, deterministic SVG figure renderer.
- `app.js`: workspace state, input handling and downloads.

Node 22+ is needed only for tests. No packages are required for the app or unit
tests. Playwright is a development-only dependency for browser checks.

```sh
npm run check
npm test
node tests/generate-exports.mjs /tmp/bli-exports
python tests/export-validation.py /tmp/bli-exports

# Optional independent XLSX reader and browser regression checks:
python -m pip install openpyxl==3.1.5
npm ci
npx playwright install chromium
npx playwright test
```

The independent Python validator checks every exported source pair, XML/ZIP
structure and cross-format agreement; with openpyxl installed it also reads
workbooks through that separate implementation. Browser checks exercise the
user workflow, downloads, project round trips and mobile layout. CI runs all
three layers. Pages publication stages only the five app files and `.nojekyll`.

Combined Octet CSV exports are accepted directly. A repeated source-label row
above Time/Data/Fit is retained (for example `t1A2`). Each source's successive
curve triplets receive Plate Column numbers starting at 1, so corresponding
columns across sources can be grouped. Original numbered headers and each
triplet's concentration/start/stop values are retained. Plate Column numbering
is the curve order within a source, not an inferred physical well address.
