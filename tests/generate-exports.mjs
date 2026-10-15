/** Synthetic export fixtures; never represent a measured experiment. */
import fs from "node:fs/promises";
import path from "node:path";
import "../core.js";

const core = globalThis.BliCore;
const destination = path.resolve(
  process.argv[2] || "/tmp/bli-export-validation",
);
await fs.mkdir(destination, { recursive: true });

function curve(label, times, data, fit = times.map(() => null)) {
  return { label, times, data, fit };
}

const cases = [
  {
    name: "aligned-normalized",
    normalized: true,
    includeFit: true,
    curves: [
      curve(
        "A1 α & <target>",
        [120, 120.5, 121],
        [0, null, 0.35],
        [0.01, 0.2, 0.34],
      ),
      curve('B1 "quoted"', [120, 120.5, 121], [-0.1, 0, 0.4]),
    ],
  },
  {
    name: "unequal-grids-and-tails",
    normalized: true,
    includeFit: false,
    curves: [
      curve("short", [5, 6], [10, 11]),
      curve("long", [5, 6, 7, 8], [20, null, 22, 23]),
      curve("different", [5, 6.5, 7.5, 9], [30, 31, 32, 33]),
    ],
  },
  {
    name: "source-time",
    normalized: false,
    includeFit: true,
    curves: [
      curve("offset-one", [10.5, 11.5, 12.5], [1, 2, 3], [1.1, 2.1, 3.1]),
      curve("offset-two", [40.5, 41.5, 42.5], [4, 5, 6], [4.1, 5.1, 6.1]),
    ],
  },
  {
    name: "duplicate-and-reset-times",
    normalized: true,
    includeFit: true,
    curves: [
      curve(
        "reset",
        [100, 101, 101, 0, 1],
        [0, 1, 2, 3, 4],
        [0.1, 1.1, 2.1, 3.1, 4.1],
      ),
      curve("different reset", [100, 101, 102, 1, 2], [5, 6, 7, 8, 9]),
    ],
  },
  {
    name: "missing-time-and-response",
    normalized: true,
    includeFit: true,
    curves: [
      curve(
        "missing x",
        [null, 20, 21, null, 22],
        [99, 0, null, 7, null],
        [null, 0.1, 3.1, 7.1, null],
      ),
      curve("all response gaps", [4, 5, 6], [1, null, 2]),
    ],
  },
  {
    name: "precision-and-small-values",
    normalized: false,
    includeFit: true,
    curves: [
      curve(
        "precision",
        [1.23e-13, 0.123456789123, 1.123456789123],
        [1.23e-13, -4.56e-12, 1.234567890123456],
        [1.12e-14, 2.22e-13, 1.234567890123457],
      ),
    ],
  },
  {
    name: "single-response-only",
    normalized: true,
    includeFit: false,
    curves: [curve("single", [70, 71], [0, 0.6], [0.01, 0.59])],
  },
  {
    name: "labels-stay-text",
    normalized: true,
    includeFit: false,
    curves: [
      curve("0012", [4, 5], [0, 1]),
      curve("=1+1", [4, 5], [2, 3]),
      curve("+SUM(A1:A2)", [4, 5], [4, 5]),
    ],
  },
  {
    name: "many-curves",
    normalized: true,
    includeFit: true,
    curves: Array.from({ length: 107 }, (_, i) =>
      curve(
        `Curve ${i + 1}`,
        [10, 11, 12],
        [i, i + 0.1, i + 0.2],
        [i + 0.01, i + 0.11, i + 0.21],
      ),
    ),
  },
];

for (const test of cases) {
  const curves = test.curves.map((item, i) => {
    const firstTime = item.times.find(Number.isFinite);
    return {
      id: `${test.name}-${i}`,
      label: item.label,
      source: `synthetic-${i + 1}.txt`,
      block: {
        rows: item.times.map((time, n) => ({
          time,
          rawTime: time,
          time0: time === null ? null : time - firstTime,
          data: item.data[n],
          fit: item.fit[n],
        })),
        numericData: item.data.filter(Number.isFinite).length,
        numericFit: item.fit.filter(Number.isFinite).length,
      },
    };
  });
  const groups = [
    { id: test.name, title: 'Synthetic / α & <target> "quoted"', curves },
  ];
  const tables = core.prepareTables(groups, {
    normaliseTime: test.normalized,
    includeFit: test.includeFit,
  });
  const workbook = core.buildXlsx(tables);
  test.xlsx = `${test.name}.xlsx`;
  test.pzfx = `${test.name}.pzfx`;
  await fs.writeFile(
    path.join(destination, test.xlsx),
    new Uint8Array(await workbook.arrayBuffer()),
  );
  await fs.writeFile(path.join(destination, test.pzfx), core.buildPzfx(tables));
}
await fs.writeFile(
  path.join(destination, "manifest.json"),
  JSON.stringify({ synthetic: true, cases }, null, 2),
);
console.log(
  `Created ${cases.length} synthetic XLSX/PZFX pairs in ${destination}`,
);
