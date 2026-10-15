# Data and figure contract

BLI Curves arranges exported Octet response measurements for inspection,
plotting, and transfer to Excel or GraphPad Prism. It does not estimate binding
kinetics or determine whether a sample binds.

## Accepted input

- Delimited text: tab, comma, or semicolon. Quoted cells and a UTF-8 byte-order
  mark are supported. The browser import layer can decode supported UTF-16
  text before passing it to the parser.
- A header contains adjacent `Time` and `Data` columns, optionally followed by
  `Fit`. Repeated blocks may use matching suffixes, such as
  `Time1, Data1, Fit1, Time2, Data2, Fit2`.
- Header matching ignores case and spaces before the numeric suffix. Common
  parenthesized unit labels are accepted. Columns must still be adjacent and
  suffixes must match. A mismatched block generates a warning.
- Metadata before the header can supply `Conc`, `Start`, and `Stop` labels.
  These labels do not cause phase segmentation or a unit conversion.
- Numeric values can use scientific notation. Decimal commas are accepted
  when the detected convention is unambiguous; thousands separators are
  never silently stripped. Invalid or ambiguous tokens remain blank and
  generate a visible warning with source-row examples.
- These are supported export layouts, not a claim that every Octet software
  version or every instrument-native file format is supported.

## Values, time, and grouping

1. Source responses and imported fit values are retained as finite JavaScript
   numbers. Zero and negative values are real values, never missing-data
   sentinels. Output uses the available numeric precision without deliberate
   rounding or downsampling.
2. Original time remains available. “Start each curve at zero” subtracts that
   curve's first finite source time from its finite times. It does not change
   responses, align biological phases, or shift curves to a fitted onset.
3. A value without a valid source time remains in the export with a blank X;
   it is not assigned another curve's time and cannot appear on a numeric
   time plot. Invalid inputs are reported so that the source can be checked.
4. Source row order, internal blank rows, repeated timestamps, and time resets
   are preserved. Wholly blank padding after a block may be trimmed. Missing
   values are not imputed and are not converted to zero.
5. Antigen names, curve names, series names, and concentration labels organize
   the data. They do not average curves, combine replicates, or change numbers.
   A concentration label alone does not establish its physical unit or accuracy.
6. Single-curve mode defaults to measured responses. Imported fits can be
   included deliberately; an absent fit never produces a fabricated fit.

## Common export model

XLSX and PZFX use the same prepared tables. A shared X column is used directly
only when the complete selected time vectors match exactly, including their
lengths and missing values. Otherwise, each distinct grid occupies its own
contiguous block of rows and unrelated Y columns remain blank in those rows.
This staggered layout preserves every source X/Y association without sorting,
interpolation, averaging, or matching values by row number across different
grids. It also retains related curves within one table when possible.

This approach follows GraphPad's documented method for
[XY datasets with different X values](https://www.graphpad.com/guides/prism/latest/user-guide/xy_table.htm).
Each Prism table has one X column. To retain older `Table` compatibility,
exports split at 104 Y columns, always keeping a curve's response and imported
fit together. Both formats receive matching parts. Excel worksheet names are
sanitized and deduplicated; descriptive labels remain text, not formulas.
The browser rejects a prepared table above 2,000,000 cells, including blank
padding, before allocating its dense export arrays. It asks for fewer selected
curves rather than truncating data. This matters when many distinct time grids
would produce a large staggered table.

The PZFX file contains XY data tables. It does not contain a Prism kinetic
analysis, an encoded publication graph, or an analysis result. GraphPad
[documents separately](https://www.graphpad.com/support/faq/prism-integrated-saves-prism-files-instruments/)
that complete graph and analysis configuration requires a Prism-authored
project/template. The app's exported figure is its own rendered figure.
The root element retains the existing namespace-free PZFX form. GraphPad's
[native Prism 7 example](https://www.graphpad.com/support/faq/what-to-do-when-prism-wont-open-a-prism-file/)
uses this same form; the presence of a namespace in some newer schema/examples
does not establish that older namespace-free files are invalid.

## Plot boundaries

The plot uses each curve's own selected time values. Imported fits are
distinguished from measured responses. Data gaps break a trace rather than
inventing measured values. Axis labels and figure styling do not rescale the
source data. The conventional `Time (s)` and `Response (nm)` labels must match
the user's actual export; editing a label is not a unit conversion.

No baseline subtraction, reference subtraction, drift correction, smoothing,
outlier exclusion, association/dissociation boundary inference, kinetic model
selection, or estimation of *k*on, *k*off, or *K*D occurs. Any such processing
already present in an Octet export remains the responsibility of its source
analysis. Curves should not be described as raw instrument data merely because
this tool has not further corrected them.

## Independent export checks

Run:

```sh
node tests/generate-exports.mjs /tmp/bli-export-validation
python tests/export-validation.py /tmp/bli-export-validation
```

The generator declares all data synthetic. The Python validator independently
reads ZIP and XML content and compares exported sequences against fixed source
arrays. It also opens every workbook through `openpyxl` when that package is
installed. Checks cover time offsets, differing grids and lengths, gaps, missing
X values, zero and negative values, duplicate/reset times, very small values,
Unicode/XML text, response-only exports, and a 214-column export split into
three compatible parts. Source ordering, optional fit columns, column counts,
and XLSX/PZFX agreement are checked.

`--schema FILE.xsd` optionally enables `lxml` schema validation. GraphPad's
[published Prism 6–8 schema bundle](https://www.graphpad.com/support/faq/prism-xml-style-sheet-and-schema-that-define-the-pzfx-format/)
contains an ambiguous wildcard content model in type `d` that current `lxml`
rejects before it can validate a document. A failure to compile that supplied
schema is not reported as a passing schema check. The automated tests do not
substitute for opening a representative experimental export in the user's
installed Prism version; Prism desktop has not been executed in this environment.
