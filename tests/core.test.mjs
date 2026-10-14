import test from "node:test";
import assert from "node:assert/strict";
import "../core.js";

const core = globalThis.BliCore;
const parsed = (text, options) =>
  core.parseResultFile("sample_A01.txt", text, options);
const curve = (id, times, data = times, fit = []) => ({
  id,
  label: id,
  source: "source.txt",
  block: {
    rows: times.map((time, index) => ({
      time,
      rawTime: time,
      data: data[index] ?? null,
      fit: fit[index] ?? null,
    })),
  },
});
const tables = (curves, options) =>
  core.prepareTables([{ id: "g", title: "Test", curves }], options);
const sourcePairs = (table, column) =>
  table.xValues
    .map((x, i) => [x, column.values[i]])
    .filter(([, y]) => y !== null);

test("TSV with BOM, metadata, CRLF, repeated blocks and optional fits", () => {
  const file = parsed(
    "\uFEFFConc\t12\t\tConc\t6\r\nTime1\tData1\tFit1\tTime2\tData2\r\n10\t0.1\t0.11\t20\t0.2\r\n11\t0.3\t0.31\t21\t0.4\r\n",
  );
  assert.equal(file.delimiter, "\t");
  assert.equal(file.well, "A1");
  assert.equal(file.blocks.length, 2);
  assert.equal(file.blocks[0].concentration, "12");
  assert.equal(file.blocks[1].concentration, "6");
  assert.equal(file.blocks[1].numericFit, 0);
  assert.deepEqual(core.toPoints(file.blocks[0]), [
    { x: 0, y: 0.1, fit: 0.11 },
    { x: 1, y: 0.3, fit: 0.31 },
  ]);
});

test("Time/Data works without a fit; mismatched column suffixes never attach", () => {
  assert.equal(parsed("Time,Data\n0,.1\n1,.2").blocks[0].numericData, 2);
  const mismatch = parsed("Time1,Data2,Fit3\n0,.1,.2");
  assert.equal(mismatch.blocks.length, 0);
  assert.match(mismatch.warnings.join(" "), /different number/);
  const wrongFit = parsed("Time1,Data1,Fit2\n0,.1,.2");
  assert.equal(wrongFit.blocks[0].rows[0].fit, null);
  assert.match(wrongFit.warnings.join(" "), /does not match/);
  assert.deepEqual(
    parsed("Time,Data,Fit,Time,Data,Fit\n0,.1,.1,0,.2,.2").blocks.map(
      (b) => b.fitName,
    ),
    ["Fit1", "Fit2"],
  );
});

test("CSV quoting and line endings are parsed without splitting quoted fields", () => {
  assert.deepEqual(
    core.parseDelimited('"A, B","quoted ""name"""\r\n1,2', ","),
    [
      ["A, B", 'quoted "name"'],
      ["1", "2"],
    ],
  );
  assert.deepEqual(core.parseDelimited('"a\nb",c\r1,2', ","), [
    ["a\nb", "c"],
    ["1", "2"],
  ]);
  assert.throws(() => core.parseDelimited('"unfinished', ","), /closing quote/);
  assert.equal(parsed("Time (s),Data (nm)\n0,1").blocks.length, 1);
});

test("decimal commas are never stripped or silently treated as thousands", () => {
  const comma = parsed("Time;Data;Fit\n0;0,125;0,2\n1;1,234;0,4");
  assert.equal(comma.decimalSeparator, ",");
  assert.equal(comma.blocks[0].rows[0].data, 0.125);
  assert.equal(comma.blocks[0].rows[1].data, 1.234);
  const ambiguous = parsed("Time;Data\n0;1,234");
  assert.equal(ambiguous.blocks[0].rows[0].data, null);
  assert.match(ambiguous.warnings.join(" "), /ambiguous/);
  assert.equal(
    parsed("Time;Data\n0;1,234", { decimalSeparator: "," }).blocks[0].rows[0]
      .data,
    1.234,
  );
  assert.equal(parsed("Time\tData\n0\t1.234,56").blocks[0].rows[0].data, null);
});

test("extra delimited fields cannot shift numeric values silently", () => {
  const file = parsed("Time,Data\n0,0.25\n1,0,25\n2,0.5");
  assert.deepEqual(core.toPoints(file.blocks[0])[1], {
    x: null,
    y: null,
    fit: null,
  });
  assert.match(file.warnings.join(" "), /more fields than the header/);
  assert.match(
    parsed('Time,Data\n0,"oops').warnings.join(" "),
    /closing quote/,
  );
});

test("malformed, missing, and tiny values remain explicit gaps without rounding", () => {
  const file = parsed(
    "Time,Data,Fit\n100,1e-14,\n101,,1e-13\n,,\n103,oops,\n,0.5,\n",
  );
  assert.equal(file.blocks[0].rows.length, 5);
  assert.equal(file.blocks[0].rows[0].data, 1e-14);
  assert.deepEqual(core.toPoints(file.blocks[0])[2], {
    x: null,
    y: null,
    fit: null,
  });
  assert.deepEqual(core.toPoints(file.blocks[0])[4], {
    x: null,
    y: 0.5,
    fit: null,
  });
  assert.match(file.warnings.join(" "), /no valid time/);
  assert.match(file.warnings.join(" "), /oops/);
  assert.equal(parsed("Time,Data\n0,NaN\n1,Infinity").blocks[0].numericData, 0);
});

test("well inference requires one unambiguous complete well token", () => {
  for (const [name, well] of [
    ["Result_A12.txt", "A12"],
    ["A01.csv", "A1"],
    ["foo-H12.tsv", "H12"],
    ["batch10.txt", ""],
    ["C123.txt", ""],
    ["A1_B2.txt", ""],
  ]) {
    assert.equal(core.inferWell(name), well, name);
  }
});

test("aligned exact time grids share rows with no data transformations", () => {
  const [table] = tables(
    [
      curve("A", [100, 101], [0.1, 0.2], [0.12, 0.21]),
      curve("B", [200, 201], [0.3, 0.4]),
    ],
    { includeFit: true },
  );
  assert.deepEqual(table.xValues, [0, 1]);
  assert.equal(table.gridCount, 1);
  assert.equal(table.yColumns.length, 3);
  assert.deepEqual(
    table.yColumns.map((c) => c.kind),
    ["data", "fit", "data"],
  );
  assert.deepEqual(table.yColumns[1].values, [0.12, 0.21]);
  assert.equal(table.yColumns[0].title, "A");
  assert.equal(table.yColumns[1].title, "A — fit");
});

test("different times and shorter first curve never inherit the first X column", () => {
  const [table] = tables([
    curve("A", [0, 1], [10, 11]),
    curve("B", [0, 2, 4], [20, 22, 24]),
  ]);
  assert.equal(table.gridCount, 2);
  assert.deepEqual(table.xValues, [0, 1, 0, 2, 4]);
  assert.deepEqual(sourcePairs(table, table.yColumns[0]), [
    [0, 10],
    [1, 11],
  ]);
  assert.deepEqual(sourcePairs(table, table.yColumns[1]), [
    [0, 20],
    [2, 22],
    [4, 24],
  ]);
  const [tails] = tables([curve("A", [0, 1]), curve("B", [0, 1, 2])]);
  assert.equal(tails.gridCount, 2);
  assert.deepEqual(sourcePairs(tails, tails.yColumns[1]), [
    [0, 0],
    [1, 1],
    [2, 2],
  ]);
});

test("source-time, repeated/reset times and missing X preserve ordered source pairs", () => {
  const values = [3, 4, 5, 6, 7],
    times = [100, 100, 99, null, 101];
  const [table] = tables(
    [curve("A", times, values), curve("B", [102, 103], [8, 9])],
    { normaliseTime: false },
  );
  assert.deepEqual(
    sourcePairs(table, table.yColumns[0]),
    times.map((x, i) => [x, values[i]]),
  );
  assert.deepEqual(sourcePairs(table, table.yColumns[1]), [
    [102, 8],
    [103, 9],
  ]);
  assert.equal(table.normaliseTime, false);
  assert.match(
    parsed("Time,Data\n100,1\n99,2").warnings.join(" "),
    /decreases/,
  );
});

test("time equality is exact, not tolerance based", () => {
  const [table] = tables([curve("A", [0, 1]), curve("B", [0, 1.000000001])]);
  assert.equal(table.gridCount, 2);
  assert.equal(table.xValues[3], 1.000000001);
});

test("large runs split at whole curve boundaries below the Prism dataset limit", () => {
  const curves = Array.from({ length: 107 }, (_, i) =>
    curve(`Curve${i}`, [0, 1], [i, i + 1], [i + 0.1, i + 1.1]),
  );
  const output = tables(curves, { includeFit: true });
  assert.deepEqual(
    output.map((table) => table.yColumns.length),
    [104, 104, 6],
  );
  assert.equal(
    new Set(
      output.flatMap((table) =>
        table.yColumns.filter((c) => c.kind === "data").map((c) => c.curveId),
      ),
    ).size,
    107,
  );
  assert.match(output[0].title, /part 1/);
  output.forEach((table) => assert.match(table.notices.join(" "), /104 Y/));
});

test("different-grid table growth fails before dense allocation; aligned runs stay usable", () => {
  const times = Array.from({ length: 3000 }, (_, i) => i);
  const aligned = Array.from({ length: 100 }, (_, i) =>
    curve(`Aligned ${i}`, times),
  );
  const [table] = tables(aligned);
  assert.equal(table.gridCount, 1);
  assert.equal(table.xValues.length, 3000);
  assert.equal(table.yColumns.length, 100);
  const staggered = Array.from({ length: 100 }, (_, i) =>
    curve(
      `Offset ${i}`,
      times.map((t) => t * (i + 1)),
    ),
  );
  assert.throws(
    () => tables(staggered),
    /Test:.*2,000,000-cell.*Select fewer curves.*separate antigen/,
  );
});

test("normalization overflow fails explicitly instead of becoming missing X", () => {
  const input = curve("Extreme timestamps", [-1e308, 1e308], [1, 2]);
  assert.throws(() => tables([input]), /normalization exceeds/);
  assert.deepEqual(
    tables([input], { normaliseTime: false })[0].xValues,
    [-1e308, 1e308],
  );
});

test("XML escapes text, preserves numeric precision and emits explicit missing values", () => {
  const input = tables([curve('0012<&"\u0001', [0, 1], [1e-14, null])]);
  const xml = core.buildPzfx(input);
  assert.match(xml, /0012&lt;&amp;&quot;/);
  assert.match(xml, /<d>1e-14<\/d>/);
  assert.match(xml, /<d><\/d>/);
  assert.ok(!xml.includes("\u0001"));
  assert.throws(() => core.buildPzfx([]), /No curves/);
});

test("XLSX is a ZIP with text labels and formula-looking strings stored as text", async () => {
  const blob = core.buildXlsx([
    {
      name: "Safe",
      rows: [
        ["0012", "=SUM(A1:A2)", "<tag>"],
        [0, 1e-14, null],
      ],
    },
  ]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 3, 4]);
  const content = new TextDecoder().decode(bytes);
  assert.match(content, /t="inlineStr"><is><t xml:space="preserve">0012/);
  assert.match(
    content,
    /t="inlineStr"><is><t xml:space="preserve">=SUM\(A1:A2\)/,
  );
  assert.match(content, /<v>1e-14<\/v>/);
  assert.equal(
    blob.type,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
});

test("sheet names are legal, unique without case collisions, and bounded", () => {
  const used = new Set();
  assert.equal(core.cleanSheetName("A/B", used), "A-B");
  assert.equal(core.cleanSheetName("a:b", used), "a-b_2");
  assert.equal(core.cleanSheetName("'History'", used), "History data");
  assert.equal(core.cleanSheetName("x".repeat(50), used).length, 31);
  assert.equal(core.cleanSheetName("x".repeat(50), used).length, 31);
});
