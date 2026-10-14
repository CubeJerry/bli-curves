import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({});
vm.runInContext(
  readFileSync(new URL("../figure.js", import.meta.url), "utf8"),
  context,
);
const { renderSvg, niceTicks, numberLabel } = context.BliFigure;
const example = [
  {
    id: "curve-1",
    name: "Example",
    points: [
      { x: 0, y: 0, fit: 0 },
      { x: 1, y: 1, fit: 0.9 },
    ],
  },
];

test("standalone accessible SVG has white background and fits opt in", () => {
  const svg = renderSvg(example);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /role="img" aria-labelledby=/);
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /class="trace data"/);
  assert.doesNotMatch(svg, /class="trace imported-fit"/);
  assert.match(
    renderSvg(example, { showFit: true }),
    /class="trace imported-fit"/,
  );
});

test("imported fits use round dots scaled to line width, while data stays solid", () => {
  for (const lineWidth of [1, 2, 4]) {
    const svg = renderSvg(example, { showFit: true, lineWidth });
    const fit = svg.match(/<path class="trace imported-fit"[^>]+>/)[0];
    const data = svg.match(/<path class="trace data"[^>]+>/)[0];
    assert.ok(fit.includes(`stroke-dasharray="0 ${lineWidth * 3}"`));
    assert.match(fit, /stroke-linecap="round"/);
    assert.doesNotMatch(data, /stroke-dasharray/);
    assert.match(svg, /Dotted: imported fit/);
    assert.match(svg, /dotted lines show imported fits/);
  }
});

test("gaps break traces, preserve point order, and render isolated observations", () => {
  const svg = renderSvg([
    {
      name: "Gaps",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: null },
        { x: 2, y: 2 },
        { x: 1.5, y: 3 },
        null,
        { x: 4, y: 4 },
      ],
    },
  ]);
  const path = svg.match(/class="trace data"[^>]*d="([^"]+)"/)[1];
  assert.equal((path.match(/M/g) || []).length, 3);
  assert.equal((path.match(/L/g) || []).length, 1);
  assert.equal((svg.match(/class="isolated-point"/g) || []).length, 2);
  const segment = path.match(/M([\d.]+) [\d.]+L([\d.]+) [\d.]+/);
  assert.ok(
    Number(segment[1]) > Number(segment[2]),
    "decreasing source X is preserved",
  );
});

test("fits have independent gaps and missing time never creates a zero point", () => {
  const svg = renderSvg(
    [
      {
        name: "Mixed",
        points: [
          { x: 0, y: 1, fit: 1 },
          { x: null, y: 0, fit: 0 },
          { x: 2, y: null, fit: 2 },
          { x: 3, y: 3, fit: null },
        ],
      },
    ],
    { showFit: true },
  );
  const fitPath = svg.match(/class="trace imported-fit"[^>]*d="([^"]+)"/)[1];
  assert.equal((fitPath.match(/M/g) || []).length, 2);
  assert.equal((fitPath.match(/L/g) || []).length, 0);
});

test("manual bounds reject invalid input and clip visible paths", () => {
  assert.throws(
    () => renderSvg(example, { xMin: 10, xMax: 5 }),
    /minimum must be smaller/,
  );
  assert.throws(() => renderSvg(example, { yMin: "bad" }), /finite number/);
  assert.throws(() => renderSvg(example, { xMin: false }), /must be a number/);
  const svg = renderSvg(example, {
    xMin: 0.25,
    xMax: 0.75,
    yMin: -1,
    yMax: 1,
    phaseTime: 0.5,
  });
  assert.match(svg, /clip-path="url\(#bli-plot-clip\)"/);
  assert.match(svg, /class="phase-marker"/);
  assert.match(svg, /Time \(s\) from 0.25 to 0.75/);
});

test("legend expands to retain all names without hidden or truncated entries", () => {
  const many = Array.from({ length: 42 }, (_, i) => ({
    name: `Sample ${i} — a complete label with context`,
    points: [{ x: 0, y: i }],
  }));
  const svg = renderSvg(many, { width: 600, height: 300 });
  assert.ok(Number(svg.match(/height="([\d.]+)"/)[1]) > 900);
  for (let i = 0; i < 42; i++) assert.ok(svg.includes(`Sample ${i}`));
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test("XML labels are escaped and colours cannot inject SVG resources", () => {
  const svg = renderSvg(
    [
      {
        id: '"><script>',
        name: '<image href="external"> & Label',
        colour: "url(https://external/track)",
        points: [{ x: 0, y: 1 }],
      },
    ],
    { title: "<b>Title</b>" },
  );
  assert.doesNotMatch(svg, /<script>|<image |url\(https/);
  assert.match(svg, /&lt;b&gt;Title&lt;\/b&gt;/);
  assert.match(svg, /&lt;image href=&quot;external&quot;&gt; &amp; Label/);
});

test("pasted XML-invalid control characters cannot invalidate SVG figures", () => {
  const svg = renderSvg(
    [
      {
        id: "bad\u0008id",
        name: "VHH\u0000\u0008\u000b\u001f",
        points: [{ x: 0, y: 1 }],
      },
    ],
    {
      title: "EGFR\ufffe\uffff",
      xLabel: "Time\u000c",
      yLabel: "Response\u000e",
    },
  );
  assert.doesNotMatch(
    svg,
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/,
  );
  assert.match(svg, /data-curve-id="badid"/);
  assert.match(svg, />EGFR<\/title>/);
});

test("empty, constant, negative, small and large values produce finite geometry", () => {
  for (const value of [0, -10, 1e-9, 1e12]) {
    const svg = renderSvg([{ points: [{ x: value, y: value }] }]);
    assert.doesNotMatch(svg, /NaN|Infinity/);
    assert.match(svg, /class="isolated-point"/);
  }
  assert.match(renderSvg([]), /No numeric data to plot/);
  assert.equal(numberLabel(-0), "0");
  assert.equal(numberLabel(1e-9), "1e-9");
  assert.ok(niceTicks(-10, -1).every((value) => value >= -10 && value <= -1));
  assert.ok(niceTicks(1e-9, 3e-9).length >= 2);
});

test("nearby large axis values are not rounded to indistinguishable labels", () => {
  const svg = renderSvg(
    [
      {
        points: [
          { x: 1000000, y: 1000000 },
          { x: 1000001, y: 1000001 },
        ],
      },
    ],
    { xMin: 1000000, xMax: 1000001, yMin: 1000000, yMax: 1000001 },
  );
  assert.match(svg, />1000000\.2<\/text>/);
  assert.match(svg, />1000000\.8<\/text>/);
  assert.match(svg, /from 1000000 to 1000001/);
});
