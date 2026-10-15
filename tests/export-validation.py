#!/usr/bin/env python3
"""Validate exported files using readers independent from the browser writer.

Generate the fixtures first with ``node tests/generate-exports.mjs DIRECTORY``.
Then run ``python tests/export-validation.py DIRECTORY [--schema FILE.xsd]``.
The standard-library ZIP/XML checks are mandatory. If installed, openpyxl also
reads every workbook. Official GraphPad XSD validation requires lxml + --schema.
"""

from __future__ import annotations

import argparse
import json
import math
import posixpath
import re
import sys
import warnings
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

SHEET_NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
OFFICE_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def numeric(text: str | None) -> float | None:
    if text is None or text.strip() == "":
        return None
    value = float(text)
    require(math.isfinite(value), f"Nonfinite exported number: {text!r}")
    return value


def same(actual: object, expected: object) -> bool:
    if actual is None or expected is None:
        return actual is expected
    if isinstance(actual, (float, int)) and isinstance(expected, (float, int)):
        # Relative tolerance avoids accepting tiny real values rounded to zero.
        return math.isclose(actual, expected, rel_tol=2e-14, abs_tol=0)
    return actual == expected


def same_array(actual: list, expected: list) -> bool:
    return len(actual) == len(expected) and all(same(a, b) for a, b in zip(actual, expected))


def column_index(cell_reference: str) -> int:
    letters = re.match(r"[A-Z]+", cell_reference)
    require(letters is not None, f"Invalid XLSX cell reference: {cell_reference!r}")
    value = 0
    for character in letters.group():
        value = value * 26 + ord(character) - ord("A") + 1
    return value - 1


def read_xlsx(filename: Path) -> list[dict]:
    tables = []
    with ZipFile(filename) as archive:
        require(len(archive.namelist()) == len(set(archive.namelist())), "Duplicate ZIP member names")
        require(archive.testzip() is None, f"{filename.name}: ZIP CRC failure")
        for entry in archive.namelist():
            if entry.endswith((".xml", ".rels")):
                ET.fromstring(archive.read(entry))
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {item.get("Id"): item.get("Target") for item in relationships.findall("r:Relationship", REL_NS)}
        used_names = set()
        for sheet in workbook.findall("s:sheets/s:sheet", SHEET_NS):
            title = sheet.get("name", "")
            require(bool(title) and len(title) <= 31, f"Invalid sheet name {title!r}")
            require(not re.search(r"[\\/?*\[\]:]", title), f"Forbidden sheet-name character: {title!r}")
            require(title.lower() not in used_names, f"Duplicate sheet name: {title!r}")
            used_names.add(title.lower())
            target = targets[sheet.get(OFFICE_REL)]
            sheet_path = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
            root = ET.fromstring(archive.read(sheet_path))
            rows = []
            for row in root.findall("s:sheetData/s:row", SHEET_NS):
                values = []
                for cell in row.findall("s:c", SHEET_NS):
                    require(cell.find("s:f", SHEET_NS) is None, "Unexpected spreadsheet formula")
                    index = column_index(cell.get("r", ""))
                    while len(values) <= index:
                        values.append(None)
                    if cell.get("t") == "inlineStr":
                        values[index] = "".join(cell.itertext())
                    else:
                        values[index] = numeric(cell.findtext("s:v", namespaces=SHEET_NS))
                rows.append(values)
            require(len(rows) >= 2, f"{title!r}: empty data sheet")
            headers, body = rows[0], rows[1:]
            body = [row + [None] * (len(headers) - len(row)) for row in body]
            tables.append({"title": title, "x_title": headers[0], "x": [row[0] for row in body], "columns": {label: [row[index] for row in body] for index, label in enumerate(headers[1:], 1)}})
            require(len(tables[-1]["columns"]) == len(headers) - 1, "Duplicate column names in validation fixture")

    try:
        import openpyxl
    except ImportError:
        return tables
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        workbook = openpyxl.load_workbook(filename, read_only=True, data_only=False)
    require(len(workbook.worksheets) == len(tables), "openpyxl worksheet count differs")
    for sheet, table in zip(workbook.worksheets, tables):
        values = list(sheet.values)
        require(values[0] == tuple([table["x_title"], *table["columns"]]), "openpyxl headers differ")
        require(len(values) - 1 == len(table["x"]), "openpyxl row count differs")
        for index, row in enumerate(values[1:]):
            expected = [table["x"][index], *(column[index] for column in table["columns"].values())]
            require(same_array(list(row), expected), "openpyxl numeric values differ from source XML")
    workbook.close()
    return tables


def read_pzfx(filename: Path, schema: object | None) -> list[dict]:
    root = ET.parse(filename).getroot()
    require(root.tag == "GraphPadPrismFile", "Wrong PZFX root element")
    require(root.get("PrismXMLVersion") is not None, "Missing Prism XML version")
    if schema is not None:
        from lxml import etree
        schema.assertValid(etree.parse(str(filename)))
    elements = root.findall("Table") + root.findall("HugeTable")
    ids = [table.get("ID") for table in elements]
    references = [ref.get("ID") for ref in root.findall("TableSequence/Ref")]
    require(len(set(ids)) == len(ids), "Duplicate PZFX table IDs")
    require(references == ids, "TableSequence does not match PZFX tables")
    tables = []
    for element in elements:
        require(element.get("TableType") == "XY", "PZFX table must be XY")
        x_columns = element.findall("XColumn")
        require(len(x_columns) == 1, "An XY table must have exactly one X column")
        x = [numeric(value.text) for value in x_columns[0].findall("Subcolumn/d")]
        columns = {}
        for column in element.findall("YColumn"):
            title = column.findtext("Title")
            require(title not in columns, "Duplicate PZFX column name in validation fixture")
            require(len(column.findall("Subcolumn")) == 1, "Unexpected replication or fit subcolumn")
            values = [numeric(value.text) for value in column.findall("Subcolumn/d")]
            require(len(values) == len(x), f"{title!r}: unequal PZFX X/Y array lengths")
            columns[title] = values
        require(0 < len(columns) <= 104, "Compatibility table exceeds 104 Y columns")
        tables.append({"title": element.findtext("Title"), "x_title": x_columns[0].findtext("Title"), "x": x, "columns": columns})
    return tables


def check_source_invariants(tables: list[dict], case: dict) -> None:
    all_columns = {}
    for table in tables:
        for title, values in table["columns"].items():
            require(title not in all_columns, f"Column was duplicated: {title}")
            all_columns[title] = (table, values)
    expected_titles = set()
    for curve in case["curves"]:
        data_title = curve["label"]
        fit_title = f"{curve['label']} — fit"
        expected_titles.add(data_title)
        has_fit = case["includeFit"] and any(value is not None for value in curve["fit"])
        if has_fit:
            expected_titles.add(fit_title)
        require(data_title in all_columns, f"Missing response column: {data_title}")
        table, observed_data = all_columns[data_title]
        if has_fit:
            require(fit_title in all_columns, f"Missing fit column: {fit_title}")
            fit_table, observed_fit = all_columns[fit_title]
            require(fit_table is table, "A curve's data and fit were split across tables")
        else:
            observed_fit = None
        times = curve["times"]
        first = next((time for time in times if time is not None), 0)
        expected_x = [None if time is None else time - first if case["normalized"] else time for time in times]
        found = False
        for start in range(len(table["x"]) - len(times) + 1):
            stop = start + len(times)
            if not same_array(table["x"][start:stop], expected_x):
                continue
            if not same_array(observed_data[start:stop], curve["data"]):
                continue
            if any(value is not None for value in observed_data[:start] + observed_data[stop:]):
                continue
            if observed_fit is not None:
                if not same_array(observed_fit[start:stop], curve["fit"]):
                    continue
                if any(value is not None for value in observed_fit[:start] + observed_fit[stop:]):
                    continue
            found = True
            break
        require(found, f"Source X/Y sequence changed or lost for {curve['label']!r}")
    require(set(all_columns) == expected_titles, f"Unexpected/missing exported columns: {set(all_columns) ^ expected_titles}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--schema", type=Path, help="Optional official GraphPad Prism XML schema (.xsd)")
    arguments = parser.parse_args()
    schema = None
    if arguments.schema:
        from lxml import etree
        try:
            schema = etree.XMLSchema(etree.parse(str(arguments.schema)))
        except etree.XMLSchemaParseError as error:
            raise ValueError(f"Supplied schema cannot compile; no schema validation was performed: {error}") from error
    manifest = json.loads((arguments.directory / "manifest.json").read_text())
    require(manifest.get("synthetic") is True, "Validation fixtures must identify themselves as synthetic")
    for case in manifest["cases"]:
        xlsx = read_xlsx(arguments.directory / case["xlsx"])
        pzfx = read_pzfx(arguments.directory / case["pzfx"], schema)
        check_source_invariants(xlsx, case)
        check_source_invariants(pzfx, case)
        require(len(xlsx) == len(pzfx), "XLSX and PZFX table counts differ")
        for workbook_table, prism_table in zip(xlsx, pzfx):
            require(same_array(workbook_table["x"], prism_table["x"]), "XLSX and PZFX time arrays differ")
            require(workbook_table["columns"] == prism_table["columns"], "XLSX and PZFX response/fit arrays differ")
        print(f"PASS {case['name']}: {len(pzfx)} tables, all source X/Y pairs preserved")
    print(f"Validated {len(manifest['cases'])} synthetic export pairs" + (" against the supplied GraphPad schema." if schema else "."))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, ValueError, KeyError, ET.ParseError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
