# Redesign decisions

Three independent reviews examined workflow, scientific fidelity, and software
reliability, then challenged one another's proposals before implementation.

| Decision | Reason |
| --- | --- |
| Keep a static, browser-local app | Parsing files and drawing curves do not need an account, server, framework, or upload. |
| Use a continuous workspace | Users need to move between naming, selection and the figure without a wizard hiding their work. |
| Show one editable row per curve | The previous nested antigen inputs made rectangular Excel paste and individual exclusion difficult. |
| Separate source identity from imported fits | A source block is a curve even when there is no fitted response. Single binding defaults to measured data. |
| Use the same selected groups for preview and exports | The previous preview could show curves together that the export split by antigen. |
| Stagger unequal time grids in a semantic XY table | Borrowing one curve's X values corrupts other curves. Splitting every unequal grid into a different table is safe but makes dilution comparison awkward. Staggering preserves original pairs and comparisons without interpolation. |
| Preserve gaps and source row order | Removing missing points draws continuity that the source data do not support. Sorting repeated or reset times also changes the observation sequence. |
| Offer SVG and PNG directly | A publication-style quick figure should not require opening Prism. SVG keeps editable text and geometry; PNG makes presentations and notebooks easy. |
| Keep fitting out of the redesign | Imported fits are already available. New kinetic estimates would require a different scientific validation task. |
| Keep plate reference collapsed and optional | Useful for naming, but it should not push the graph out of view or silently assign concentrations. |
| Test independent readers and real browser downloads | Unit tests alone cannot show that the user receives a valid workbook, XML data table, or rendered PNG. |

## Regressions repaired

The original single-binding XLSX export always took X from the first curve.
PZFX likewise selected an X value by row without requiring matching time grids.
The old decimal parser removed commas, potentially changing `0,25` to `25`.
Time/Data pairs required a Fit column, malformed numbered triplets could be
attached, mode changes erased edits, and adding files replaced the workspace.
Warnings were collected but not displayed. Embedded unused Prism templates
also accounted for much of the old script and were removed.

## Verification boundary

Synthetic supported Octet layouts, pure data/figure regressions, independent
XLSX/PZFX round trips, and automated Chromium workflow/download checks are in
CI. The app has not been exercised against every Octet version or launched
inside desktop Prism. Those limits are explicit rather than implied by a
successful XML parse. See the scientific contract for details.
