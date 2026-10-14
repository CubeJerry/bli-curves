/* Pure Octet parsing and export functions. No network, DOM, or build step. */
(() => {
  "use strict";

  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const numeric = (value) => (finite(value) ? value : null);
  const safeBaseName = (name) => String(name).replace(/\.[^.]+$/, "");

  function inferWell(name) {
    // Only complete, separated well tokens: "batch10" must never become H1.
    const matches = [
      ...safeBaseName(name).matchAll(
        /(?:^|[^a-z0-9])([A-H])0?([1-9]|1[0-2])(?=$|[^a-z0-9])/gi,
      ),
    ];
    return matches.length === 1
      ? matches[0][1].toUpperCase() + Number(matches[0][2])
      : "";
  }

  function parseDelimited(text, delimiter = "\t") {
    const rows = [];
    let row = [],
      field = "",
      quoted = false;
    text = String(text)
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"' && field.trim() === "") {
        field = "";
        quoted = true;
      } else if (ch === delimiter) {
        row.push(field.trim());
        field = "";
      } else if (ch === "\n") {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = "";
      } else field += ch;
    }
    if (quoted)
      throw new Error(
        "An opening quote has no closing quote. Check the delimited file.",
      );
    row.push(field.trim());
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows;
  }

  function columnHeader(value) {
    const match = String(value || "")
      .trim()
      .match(
        /^(Time|Data|Fit)\s*(\d*)(?:\s*\((?:s|sec|secs|second|seconds|nm)\))?$/i,
      );
    return match ? { kind: match[1].toLowerCase(), suffix: match[2] } : null;
  }

  function headerScore(row) {
    let score = 0;
    row.forEach((value, index) => {
      const current = columnHeader(value),
        next = columnHeader(row[index + 1]);
      if (current) score++;
      if (current?.kind === "time" && next?.kind === "data") score += 100;
    });
    return score;
  }

  function metadata(rows, block, key) {
    const re = new RegExp("^" + key + "\\d*$", "i");
    for (const row of rows) {
      if (
        re.test(row[block.tIdx] || "") &&
        String(row[block.tIdx + 1] || "").trim()
      )
        return row[block.tIdx + 1];
      if (re.test(row[0] || "")) {
        const value = row[block.blockNumber] || row[block.dIdx];
        if (value !== undefined && String(value).trim()) return value;
      }
    }
    return "";
  }

  function decimalConvention(rows, indices, preference) {
    if (preference === "." || preference === ",") return preference;
    let commaEvidence = false,
      dotEvidence = false;
    for (const row of rows)
      for (const index of indices) {
        const value = String(row[index] || "").trim();
        if (/^[+-]?(?:\d+\.\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))
          dotEvidence = true;
        const m = value.match(/^[+-]?(\d*),(\d+)(?:e[+-]?\d+)?$/i);
        if (
          m &&
          (!m[1] || /^0+$/.test(m[1]) || m[2].length !== 3 || /e/i.test(value))
        )
          commaEvidence = true;
      }
    if (commaEvidence && !dotEvidence) return ",";
    return ".";
  }

  function parseNumber(value, decimalSeparator) {
    const text = String(value ?? "").trim();
    if (!text || /^(?:nan|n\/a|na|#n\/a)$/i.test(text)) return { value: null };
    const pattern =
      decimalSeparator === ","
        ? /^[+-]?(?:\d+(?:,\d*)?|,\d+)(?:e[+-]?\d+)?$/i
        : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
    if (!pattern.test(text)) return { value: null, invalid: text };
    const number = Number(
      decimalSeparator === "," ? text.replace(",", ".") : text,
    );
    return Number.isFinite(number)
      ? { value: number }
      : { value: null, invalid: text };
  }

  function parseResultFile(name, text, options = {}) {
    const result = {
      name: String(name),
      well: inferWell(name),
      delimiter: "\t",
      blocks: [],
      warnings: [],
    };
    if (String(text).includes("\0")) {
      result.warnings.push(
        `${name}: this text contains null bytes; decode UTF-16 before parsing, or export UTF-8 text.`,
      );
      return result;
    }
    const candidates = [];
    for (const delimiter of ["\t", ",", ";"]) {
      try {
        const rows = parseDelimited(text, delimiter);
        let index = -1,
          score = 0;
        rows.forEach((row, i) => {
          const value = headerScore(row);
          if (value > score) {
            index = i;
            score = value;
          }
        });
        candidates.push({ delimiter, rows, index, score });
      } catch (error) {
        candidates.push({ delimiter, rows: [], index: -1, score: -1, error });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    result.delimiter = best.delimiter;
    if (best.score < 100) {
      result.warnings.push(
        `${name}: no adjacent Time / Data columns were found. Fit columns are optional.`,
      );
      const parseError = candidates.find((candidate) => candidate.error)?.error;
      if (parseError) result.warnings.push(`${name}: ${parseError.message}`);
      return result;
    }
    result.headerIndex = best.index;
    const header = best.rows[best.index],
      body = best.rows.slice(best.index + 1);
    const extraFieldRows = new Set(
      body
        .map((row, index) =>
          row.slice(header.length).some((value) => value !== "") ? index : -1,
        )
        .filter((index) => index >= 0),
    );
    if (extraFieldRows.size)
      result.warnings.push(
        `${name}: ${extraFieldRows.size} row(s) have more fields than the header and were left blank. Check the delimiter or quote decimal-comma values in CSV.`,
      );
    const indices = header
      .map((value, index) => (columnHeader(value) ? index : -1))
      .filter((index) => index >= 0);
    result.decimalSeparator = decimalConvention(
      body,
      indices,
      options.decimalSeparator,
    );
    let invalidCount = 0,
      missingTimeCount = 0,
      omittedEmptyBlocks = 0;
    const invalidExamples = [];
    for (let index = 0; index < header.length; index++) {
      const timeHeader = columnHeader(header[index]);
      if (timeHeader?.kind !== "time") continue;
      const dataHeader = columnHeader(header[index + 1]),
        fitHeader = columnHeader(header[index + 2]);
      if (
        dataHeader?.kind !== "data" ||
        dataHeader.suffix !== timeHeader.suffix
      ) {
        result.warnings.push(
          `${name}: skipped ${header[index]} because its immediately following Data column is missing or has a different number.`,
        );
        continue;
      }
      const hasFit =
        fitHeader?.kind === "fit" && fitHeader.suffix === timeHeader.suffix;
      if (fitHeader?.kind === "fit" && !hasFit)
        result.warnings.push(
          `${name}: ignored ${header[index + 2]} because its number does not match ${header[index]}.`,
        );
      const number = Number(timeHeader.suffix) || result.blocks.length + 1;
      const block = {
        blockNumber: number,
        fitName: `Fit${number}`,
        fitHeader: hasFit ? header[index + 2] : "",
        timeName: header[index],
        dataName: header[index + 1],
        tIdx: index,
        dIdx: index + 1,
        fIdx: hasFit ? index + 2 : null,
        rows: [],
        concentration: "",
        start: "",
        stop: "",
        numericData: 0,
        numericFit: 0,
        rowCount: 0,
      };
      for (const [property, key] of [
        ["concentration", "Conc"],
        ["start", "Start"],
        ["stop", "Stop"],
      ]) {
        block[property] = metadata(best.rows.slice(0, best.index), block, key);
      }
      const parsedRows = body.map((line, rowIndex) => {
        if (extraFieldRows.has(rowIndex))
          return { time: null, rawTime: null, data: null, fit: null };
        const values = [
          line[index],
          line[index + 1],
          hasFit ? line[index + 2] : "",
        ].map((value) => {
          const parsed = parseNumber(value, result.decimalSeparator);
          if (parsed.invalid) {
            invalidCount++;
            if (invalidExamples.length < 4)
              invalidExamples.push(
                `row ${best.index + rowIndex + 2}: “${parsed.invalid}”`,
              );
          }
          return parsed.value;
        });
        return {
          time: values[0],
          rawTime: values[0],
          data: values[1],
          fit: values[2],
        };
      });
      // Retain internal blank rows as plot gaps, but not blank padding after a block.
      while (
        parsedRows.length &&
        Object.values(parsedRows[parsedRows.length - 1]).every(
          (value) => value === null,
        )
      )
        parsedRows.pop();
      let offset = parsedRows.find((row) => finite(row.time))?.time ?? 0;
      for (const row of parsedRows) {
        row.time0 = row.time === null ? null : row.time - offset;
        if (finite(row.data)) block.numericData++;
        if (finite(row.fit)) block.numericFit++;
        if (row.time === null && (finite(row.data) || finite(row.fit)))
          missingTimeCount++;
      }
      block.rows = parsedRows;
      block.rowCount = parsedRows.length;
      const times = parsedRows.map((row) => row.time).filter(finite);
      if (times.some((time, i) => i > 0 && time < times[i - 1]))
        result.warnings.push(
          `${name}: ${block.timeName} decreases within the trace. Source row order is preserved; no sorting or interpolation is applied.`,
        );
      if (!block.numericData && !block.numericFit) omittedEmptyBlocks++;
      result.blocks.push(block);
    }
    if (invalidCount)
      result.warnings.push(
        `${name}: ${invalidCount} nonnumeric or ambiguous value(s) left blank (${invalidExamples.join("; ")}). Decimal convention: ${result.decimalSeparator === "," ? "comma" : "point"}. Thousands separators are never removed.`,
      );
    if (missingTimeCount)
      result.warnings.push(
        `${name}: ${missingTimeCount} value(s) have no valid time. They remain in exported tables with a blank X and cannot be plotted.`,
      );
    if (omittedEmptyBlocks)
      result.warnings.push(
        `${name}: ${omittedEmptyBlocks} block(s) contain no numeric response values.`,
      );
    if (!result.blocks.length)
      result.warnings.push(
        `${name}: no matching Time / Data blocks were detected.`,
      );
    return result;
  }

  function toPoints(block, normaliseTime = true) {
    const offset =
      block.rows.find((row) => finite(row.rawTime ?? row.time))?.rawTime ??
      block.rows.find((row) => finite(row.time))?.time ??
      0;
    return block.rows.map((row) => {
      const time = numeric(row.rawTime ?? row.time);
      const x = time === null ? null : normaliseTime ? time - offset : time;
      if (x !== null && !finite(x))
        throw new Error(
          "Time normalization exceeds the numeric range. Use original time or check the source timestamps.",
        );
      return { x, y: numeric(row.data), fit: numeric(row.fit) };
    });
  }

  function prepareTables(groups, options = {}) {
    const { normaliseTime = true, includeFit = false } = options;
    const tables = [];
    for (const group of groups) {
      const parts = [];
      let part = [],
        count = 0;
      for (const curve of group.curves) {
        const points = toPoints(curve.block, normaliseTime);
        const hasFit = includeFit && points.some((point) => finite(point.fit));
        const columns = hasFit ? 2 : 1;
        if (count + columns > 104) {
          parts.push(part);
          part = [];
          count = 0;
        }
        part.push({ curve, points, hasFit });
        count += columns;
      }
      if (part.length) parts.push(part);
      parts.forEach((curves, partIndex) => {
        const grids = new Map();
        for (const item of curves) {
          item.key = JSON.stringify(item.points.map((point) => point.x));
          if (!grids.has(item.key))
            grids.set(item.key, {
              values: item.points.map((point) => point.x),
              offset: 0,
            });
        }
        const rowCount = [...grids.values()].reduce(
          (sum, grid) => sum + grid.values.length,
          0,
        );
        const columnCount =
          1 + curves.reduce((sum, item) => sum + (item.hasFit ? 2 : 1), 0);
        // A staggered table can grow quadratically with different time grids.
        // Bound dense browser arrays before allocation; never truncate observations.
        if (rowCount * columnCount > 2000000)
          throw new Error(
            `${group.title}: this table would exceed the 2,000,000-cell browser memory limit. Select fewer curves or assign separate antigen / plot groups.`,
          );
        if (rowCount + 1 > 1048576)
          throw new Error(
            `${group.title}: this table exceeds Excel's 1,048,576-row limit. Select fewer curves per group.`,
          );
        const xValues = [];
        for (const grid of grids.values()) {
          grid.offset = xValues.length;
          for (const value of grid.values) xValues.push(value);
        }
        const yColumns = [];
        for (const item of curves) {
          for (const kind of item.hasFit ? ["data", "fit"] : ["data"]) {
            const values = new Array(xValues.length).fill(null),
              start = grids.get(item.key).offset;
            item.points.forEach((point, index) => {
              values[start + index] = kind === "fit" ? point.fit : point.y;
            });
            yColumns.push({
              title:
                kind === "fit" ? `${item.curve.label} — fit` : item.curve.label,
              values,
              kind,
              curveId: item.curve.id,
            });
          }
        }
        const notices = [];
        if (grids.size > 1)
          notices.push(
            `${grids.size} different time grids are staggered with blank cells. Every original X/Y pair is preserved; no interpolation is applied.`,
          );
        if (parts.length > 1)
          notices.push(
            `Split into ${parts.length} parts to keep each Prism table within 104 Y columns.`,
          );
        const title =
          String(group.title || "Binding curves") +
          (parts.length > 1 ? ` — part ${partIndex + 1}` : "");
        tables.push({
          id: `Table${tables.length + 1}`,
          groupId: group.id,
          title,
          xTitle: "Time (s)",
          xValues,
          yColumns,
          gridCount: grids.size,
          notices,
          curves: curves.map((item) => item.curve),
          normaliseTime,
        });
      });
    }
    return tables;
  }

  function tableRows(table) {
    return [
      [
        table.xTitle || "Time (s)",
        ...table.yColumns.map((column) => column.title),
      ],
      ...table.xValues.map((x, index) => [
        x,
        ...table.yColumns.map((column) => column.values[index] ?? null),
      ]),
    ];
  }

  function cleanSheetName(name, used = new Set()) {
    let base =
      String(name || "Sheet")
        .replace(/[\\/?*\[\]:\x00-\x1f]/g, "-")
        .replace(/^'+|'+$/g, "")
        .trim() || "Sheet";
    base = base.slice(0, 31);
    if (base.toLowerCase() === "history") base = "History data";
    let candidate = base,
      suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      const end = `_${suffix++}`;
      candidate = base.slice(0, 31 - end.length) + end;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function safeFilename(name) {
    return (
      String(name || "bli-curves")
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
        .replace(/[. ]+$/g, "")
        .slice(0, 120) || "bli-curves"
    );
  }

  function xmlEscape(value) {
    return String(value ?? "")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "")
      .replace(
        /[&<>"']/g,
        (ch) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&apos;",
          })[ch],
      );
  }

  function buildPzfx(tables) {
    if (!tables.length) throw new Error("No curves are selected for export.");
    const subcolumn = (values) =>
      `<Subcolumn>${values.map((value) => `<d>${finite(value) ? value : ""}</d>`).join("")}</Subcolumn>`;
    const content = tables
      .map(
        (table, index) =>
          `<Table ID="Table${index + 1}" XFormat="numbers" YFormat="replicates" Replicates="1" TableType="XY" EVFormat="AsteriskAfterNumber"><Title>${xmlEscape(table.title)}</Title><XColumn Width="83" Subcolumns="1" Decimals="10"><Title>${xmlEscape(table.xTitle)}</Title>${subcolumn(table.xValues)}</XColumn>${table.yColumns.map((column) => `<YColumn Width="117" Decimals="10"><Title>${xmlEscape(column.title)}</Title>${subcolumn(column.values)}</YColumn>`).join("")}</Table>`,
      )
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<GraphPadPrismFile PrismXMLVersion="5.00"><Created><OriginalVersion CreatedByProgram="BLI Curves" CreatedByVersion="2.0" DateTime="${new Date().toISOString()}"/></Created><TableSequence Selected="1">${tables.map((_, index) => `<Ref ID="Table${index + 1}"${index === 0 ? ' Selected="1"' : ""}/>`).join("")}</TableSequence>${content}</GraphPadPrismFile>\n`;
  }

  function columnName(index) {
    let name = "";
    for (index++; index > 0; index = Math.floor((index - 1) / 26))
      name = String.fromCharCode(65 + ((index - 1) % 26)) + name;
    return name;
  }

  function sheetXml(rows) {
    const content = rows
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map((value, c) => {
              const ref = `${columnName(c)}${r + 1}`;
              if (value === null || value === undefined || value === "")
                return `<c r="${ref}"/>`;
              if (finite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
              // Never interpret text labels as formulas or numeric values (e.g. "0012").
              return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
            })
            .join("")}</row>`,
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${content}</sheetData></worksheet>`;
  }

  function buildXlsx(tables) {
    if (!tables.length) throw new Error("No curves are selected for export.");
    const used = new Set();
    const sheets = tables.map((table) => ({
      name: cleanSheetName(table.title ?? table.name, used),
      rows: table.rows || tableRows(table),
    }));
    const files = [
      {
        name: "[Content_Types].xml",
        data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
      },
      {
        name: "_rels/.rels",
        data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      },
      {
        name: "xl/workbook.xml",
        data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
      },
      ...sheets.map((sheet, i) => ({
        name: `xl/worksheets/sheet${i + 1}.xml`,
        data: sheetXml(sheet.rows),
      })),
    ];
    return new Blob([zipFiles(files)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  const encoder = new TextEncoder();
  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let k = 0; k < 8; k++)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  function crc32(bytes) {
    let value = -1;
    for (const byte of bytes)
      value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
    return (value ^ -1) >>> 0;
  }
  function concat(parts) {
    const output = new Uint8Array(
      parts.reduce((sum, part) => sum + part.length, 0),
    );
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }
  function zipFiles(files) {
    const parts = [],
      central = [];
    let offset = 0;
    const write16 = (array, value) =>
      array.push(value & 255, (value >>> 8) & 255);
    const write32 = (array, value) => {
      write16(array, value);
      write16(array, value >>> 16);
    };
    for (const file of files) {
      const name = encoder.encode(file.name),
        bytes = encoder.encode(file.data),
        crc = crc32(bytes),
        local = [],
        entry = [];
      if (bytes.length + offset > 0xffffffff)
        throw new Error(
          "This workbook exceeds the ZIP size limit. Export fewer curves.",
        );
      write32(local, 0x04034b50);
      [20, 0x800, 0, 0, 33].forEach((value) => write16(local, value));
      [crc, bytes.length, bytes.length].forEach((value) =>
        write32(local, value),
      );
      write16(local, name.length);
      write16(local, 0);
      parts.push(new Uint8Array(local), name, bytes);
      write32(entry, 0x02014b50);
      [20, 20, 0x800, 0, 0, 33].forEach((value) => write16(entry, value));
      [crc, bytes.length, bytes.length].forEach((value) =>
        write32(entry, value),
      );
      [name.length, 0, 0, 0, 0].forEach((value) => write16(entry, value));
      write32(entry, 0);
      write32(entry, offset);
      central.push(new Uint8Array(entry), name);
      offset += local.length + name.length + bytes.length;
    }
    const directory = concat(central),
      end = [];
    write32(end, 0x06054b50);
    [0, 0, files.length, files.length].forEach((value) => write16(end, value));
    write32(end, directory.length);
    write32(end, offset);
    write16(end, 0);
    return concat([...parts, directory, new Uint8Array(end)]);
  }

  globalThis.BliCore = Object.freeze({
    parseResultFile,
    parseDelimited,
    inferWell,
    toPoints,
    prepareTables,
    tableRows,
    buildXlsx,
    buildPzfx,
    cleanSheetName,
    safeFilename,
    xmlEscape,
  });
})();
