# Process Octet Files

A standalone browser-based tool for converting Octet/BLI result exports into Prism-friendly Excel workbooks and directly into .pzfx files.

The app is designed for fast day-to-day processing of Octet-style `.txt`, `.csv`, and `.tsv` result files without needing R, command-line scripts, folder structures, or software installation.

## Features

- Runs entirely in the browser from a single `.html` file.
- Drag-and-drop multiple result files at once.
- Automatically detects repeated `Time / Data / Fit` blocks.
- Removes the metadata/header rows above the actual curve data.
- Normalises time to zero for each parsed curve.
- Exports clean `.xlsx` files ready for downstream use in GraphPad Prism.
- Includes a plotted preview for sanity-checking parsed curves before export.
- Includes an editable 96-well reference plate for manual assay-layout reference.
- Supports Excel-style pasting into naming boxes.
- Supports bulk copying names back out of the naming table.

## Input files

The app expects Octet/BLI result exports containing repeated column groups such as:

```text
Time1    Data1    Fit1    Time2    Data2    Fit2    Time3    Data3    Fit3
```

Rows above this header, such as concentration, start/stop times, `Kobs`, `Koff`, or other metadata, are ignored in the final exported data.

Supported input formats:

```text
.txt
.csv
.tsv
```

Tab-delimited Octet exports are supported.

## Modes

### 1. Dilution series mode

Use this when each file represents a different concentration or dilution point, and matching fit numbers across files belong to the same dilution series.

For example:

```text
A1Results.txt Fit1
B1Results.txt Fit1
C1Results.txt Fit1
```

are treated as the same curve group/sheet.

The exported `.xlsx` workbook contains one sheet per fit group:

```text
Fit1
Fit2
Fit3
...
```

or the custom names entered by the user.

Each sheet uses a shared `Time` column followed by the parsed `Data` and `Fit` columns for each dilution point.

Example output layout:

```text
Time    Data - 200nM    Fit - 200nM    Data - 100nM    Fit - 100nM
0.0     ...             ...            ...             ...
0.2     ...             ...            ...             ...
```

#### Dilution labels

Dilution labels can be entered manually, for example:

```text
200, 100, 50, 25, 12.5
```

With unit:

```text
nM
```

These are assigned by plate row:

```text
A = 200nM
B = 100nM
C = 50nM
D = 25nM
E = 12.5nM
```

If dilution labels are not provided, the app falls back to well/file-derived labels.

### 2. Single binding curves mode

Use this when each detected fit is an independent curve rather than part of a dilution series.

For example:

```text
A1Results.txt Fit1
A1Results.txt Fit2
B1Results.txt Fit1
B1Results.txt Fit2
```

are treated as separate curves.

The exported `.xlsx` workbook contains one sheet with all curves together.

The export uses a single shared `Time` column:

```text
Time    Data - Curve 1    Fit - Curve 1    Data - Curve 2    Fit - Curve 2
0.0     ...               ...              ...               ...
0.2     ...               ...              ...               ...
```

This is intended for easy copying into Prism when displaying multiple single binding curves together.

## Renaming curves

After files are loaded, the app displays a naming table.

Names are blank by default so the user can enter only the labels they want.

Naming features:

- Press `Enter` to move to the next name box.
- Press `Shift + Enter` to move to the previous name box.
- Paste a column, row, or block from Excel/Sheets into a name box to fill names downward.
- Shift-click name boxes to select a range.
- Press `Ctrl+C` / `Cmd+C` to copy selected names as newline-separated text.
- Press `Ctrl+A` / `Cmd+A` while focused in a name box to select all name boxes in the current table.
- Press `Shift + Arrow Up/Down` to extend the selected range.

This makes it easier to reuse names from existing assay templates or master sheets.

## 96-well reference plate

The app includes an editable 96-well plate reference.

This is intentionally manual. The app does not try to infer complex assay layouts automatically because multi-antigen or non-standard plate designs can make automatic mapping unreliable.

You can:

- Paste an 8 × 12 block from Excel/Sheets.
- Click and type directly into wells.
- Use it as a visual reference while naming curves.

## Plot preview

The app includes a simple plotted preview for checking that parsing worked as expected.

In dilution series mode:

- Select a fit group to preview.
- All curves within that fit group are plotted together.

In single binding curve mode:

- All parsed curves are plotted together.

Data traces and fit traces are displayed separately so obvious parsing issues can be spotted before export.

The plot preview is intended for checking, not for publication-quality plotting.

## Export

Both modes export `.xlsx` files.

The app runs locally in the browser. Input files are processed client-side.

