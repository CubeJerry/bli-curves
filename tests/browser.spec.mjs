import { test, expect } from "@playwright/test";
import { inflateRawSync } from "node:zlib";

// CI serves the unbundled application with: python3 -m http.server 8000.
const APP_URL = process.env.BLI_TEST_URL || "http://127.0.0.1:8000/";
const resultFile = (
  name = "Extra_D1.txt",
  values = "10\t0\n11\t0.5\n12\t1",
) => ({
  name,
  mimeType: "text/plain",
  buffer: Buffer.from(`Time1\tData1\n${values}\n`),
});
const names = (page) => page.locator('#curveTable [data-field="name"]');
const antigens = (page) => page.locator('#curveTable [data-field="antigen"]');
const included = (page) => page.locator('#curveTable [data-field="include"]');

async function loadDemo(page) {
  await page.locator("#demoBtn").click();
  await expect(page.locator("#curveCount")).toHaveText("6 / 6 included");
  await expect(page.locator("#drop")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#plot svg")).toHaveCount(1);
}

async function downloadFrom(page, selector) {
  const event = page.waitForEvent("download");
  await page.locator(selector).click();
  const download = await event;
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { name: download.suggestedFilename(), buffer: Buffer.concat(chunks) };
}

async function paste(locator, text) {
  await locator.focus();
  await locator.evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  }, text);
}

// Read the standard ZIP local records independently of the application's writer.
function zipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (
    offset + 30 <= buffer.length &&
    buffer.readUInt32LE(offset) === 0x04034b50
  ) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameSize = buffer.readUInt16LE(offset + 26);
    const extraSize = buffer.readUInt16LE(offset + 28);
    expect(
      flags & 8,
      "ZIP entry must declare its size in its local record",
    ).toBe(0);
    const name = buffer
      .subarray(offset + 30, offset + 30 + nameSize)
      .toString();
    const dataStart = offset + 30 + nameSize + extraSize;
    const compressed = buffer.subarray(dataStart, dataStart + size);
    expect([0, 8]).toContain(method);
    entries.set(
      name,
      (method === 8 ? inflateRawSync(compressed) : compressed).toString(),
    );
    offset = dataStart + size;
  }
  expect(entries.size).toBeGreaterThan(3);
  return entries;
}

async function inspectXml(page, source) {
  return page.evaluate((text) => {
    const document = new DOMParser().parseFromString(text, "application/xml");
    return {
      invalid: Boolean(document.querySelector("parsererror")),
      tables: [...document.querySelectorAll("Table")].map((table) => ({
        title: table.querySelector("Title")?.textContent,
        columns: [...table.querySelectorAll("YColumn")].map((column) => ({
          title: column.querySelector("Title")?.textContent,
          values: [...column.querySelectorAll("d")].map(
            (value) => value.textContent,
          ),
        })),
      })),
      rows: [...document.querySelectorAll("sheetData row")].map((row) =>
        [...row.querySelectorAll("c")].map(
          (cell) => cell.querySelector("v,t")?.textContent ?? "",
        ),
      ),
      traces: document.querySelectorAll("path.trace.data").length,
      fits: document.querySelectorAll("path.trace.imported-fit").length,
    };
  }, source);
}

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(APP_URL);
});

test("demo loads without runtime errors, single mode hides fits, and edits survive mode changes", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await loadDemo(page);
  await expect(page.locator("#includeFit")).not.toBeChecked();
  await expect(page.locator("#plot .trace.data")).toHaveCount(6);
  await expect(page.locator("#plot .trace.imported-fit")).toHaveCount(0);
  await expect(page.locator("#curveTable th")).toHaveText([
    "Use",
    "Source",
    "Curve name",
    "Antigen / plot group",
    "Colour",
  ]);
  await names(page).first().fill("VHH-3117");
  await antigens(page).first().fill("EGFR");
  await page.locator('input[name="mode"][value="dilution"]').check();
  await expect(page.locator("#includeFit")).toBeChecked();
  await page.locator("#includeFit").uncheck();
  await page.locator('input[name="mode"][value="single"]').check();
  await expect(names(page).first()).toHaveValue("VHH-3117");
  await expect(antigens(page).first()).toHaveValue("EGFR");
  await expect(page.locator("#includeFit")).not.toBeChecked();
  await page.locator('input[name="mode"][value="dilution"]').check();
  await expect(page.locator("#includeFit")).not.toBeChecked();
  expect(errors).toEqual([]);
  const screenshot = testInfo.outputPath("desktop-workspace.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("Desktop workspace", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("adding files preserves edits, skips exact duplicates and retains distinct same-name files", async ({
  page,
}) => {
  await loadDemo(page);
  await names(page).first().fill("Keep this label");
  await page.locator("#fileInput").setInputFiles(resultFile());
  await expect(page.locator("#curveCount")).toHaveText("7 / 7 included");
  await expect(names(page).first()).toHaveValue("Keep this label");
  await page.locator("#fileInput").setInputFiles(resultFile());
  await expect(page.locator("#message")).toContainText(
    "1 identical file skipped",
  );
  await expect(page.locator("#curveCount")).toHaveText("7 / 7 included");
  await expect(page.locator("#fileCount")).toHaveText("4");
  await page
    .locator("#fileInput")
    .setInputFiles(resultFile("Extra_D1.txt", "10\t0\n11\t9.5\n12\t10"));
  await expect(page.locator("#curveCount")).toHaveText("8 / 8 included");
  await expect(page.locator("#issuesList")).toContainText(
    "2 different files have this name",
  );
  await expect(names(page).first()).toHaveValue("Keep this label");
  await page.locator("#fileInput").setInputFiles({
    name: "unsupported.frd",
    mimeType: "text/plain",
    buffer: Buffer.from("raw acquisition"),
  });
  await expect(page.locator("#message")).toContainText(
    "choose a TXT, CSV or TSV",
  );
  await expect(page.locator("#curveCount")).toHaveText("8 / 8 included");
});

test("antigen groups, filtered inclusion and exported tables stay in agreement", async ({
  page,
}) => {
  await loadDemo(page);
  await antigens(page).nth(0).fill("EGFR");
  await antigens(page).nth(1).fill("TNF");
  await expect(page.locator("#plotSelect option")).toHaveCount(3);
  await page.locator("#plotSelect").selectOption({ label: "EGFR" });
  await expect(page.locator("#plot .trace.data")).toHaveCount(1);
  const pzfx = await downloadFrom(page, "#pzfxBtn");
  const data = await inspectXml(page, pzfx.buffer.toString());
  expect(data.invalid).toBe(false);
  expect(data.tables.map((table) => table.title).sort()).toEqual([
    "Binding curves",
    "EGFR",
    "TNF",
  ]);
  expect(
    data.tables.reduce((count, table) => count + table.columns.length, 0),
  ).toBe(6);
  await page.locator("#searchInput").fill("EGFR");
  await expect(page.locator("#curveTable tbody tr")).toHaveCount(1);
  await page.locator("#selectNoneBtn").click();
  await expect(page.locator("#curveCount")).toHaveText("5 / 6 included");
  await expect(page.locator("#plotSelect option")).toHaveCount(2);
  await page.locator("#selectAllBtn").click();
  await expect(page.locator("#curveCount")).toHaveText("6 / 6 included");
  await expect(page.locator("#plotSelect option")).toHaveCount(3);
});

test("file removal is reversible and preserves its curve labels", async ({
  page,
}) => {
  await loadDemo(page);
  await names(page).first().fill("Retain after undo");
  await page
    .getByRole("button", { name: "Remove Example_A1.txt", exact: true })
    .click();
  await expect(page.locator("#curveCount")).toHaveText("4 / 4 included");
  await page.locator("#undoBtn").click();
  await expect(page.locator("#curveCount")).toHaveText("6 / 6 included");
  await expect(names(page).first()).toHaveValue("Retain after undo");
});

test("undo remains available after removing the last file", async ({
  page,
}) => {
  await page.locator("#fileInput").setInputFiles(resultFile("Only_A1.txt"));
  await expect(page.locator("#curveCount")).toHaveText("1 / 1 included");
  await page
    .getByRole("button", { name: "Remove Only_A1.txt", exact: true })
    .click();
  await expect(page.locator("#emptyState")).toBeVisible();
  await expect(page.locator("#undoBtn")).toBeVisible();
  await page.locator("#undoBtn").click();
  await expect(page.locator("#curveCount")).toHaveText("1 / 1 included");
});

test("rectangular Excel paste fills names and antigens and Enter navigates down", async ({
  page,
}) => {
  await loadDemo(page);
  await paste(names(page).first(), "VHH-1\tEGFR\nVHH-2\tTNF\nVHH-3\tEGFR");
  await expect(names(page).nth(0)).toHaveValue("VHH-1");
  await expect(names(page).nth(1)).toHaveValue("VHH-2");
  await expect(names(page).nth(2)).toHaveValue("VHH-3");
  await expect(antigens(page).nth(0)).toHaveValue("EGFR");
  await expect(antigens(page).nth(1)).toHaveValue("TNF");
  await expect(antigens(page).nth(2)).toHaveValue("EGFR");
  await names(page).first().focus();
  await names(page).first().press("Enter");
  await expect(names(page).nth(1)).toBeFocused();
  await expect(page.locator("#plotSelect option")).toHaveCount(3);
});

test("project save and reopen restore source data, names, selection, mode, figure and plate", async ({
  page,
}) => {
  await loadDemo(page);
  await names(page).first().fill("Saved VHH");
  await antigens(page).first().fill("Saved antigen");
  await included(page).last().uncheck();
  await page.locator(".plate-panel summary").click();
  await page.locator("#plateGrid td").first().fill("VHH plate reference");
  await page.locator('input[name="mode"][value="dilution"]').check();
  await page.locator("#seriesNames input").first().fill("Saved series");
  await page
    .locator('#curveTable [data-field="concentration"]')
    .first()
    .fill("200 nM");
  await page.locator(".figure-options summary").click();
  await page.locator("#figureTitle").fill("Saved figure");
  await page.locator("#showGrid").check();
  const saved = await downloadFrom(page, "#saveProjectBtn");
  expect(saved.name).toBe("bli_curves.bli.json");
  expect(JSON.parse(saved.buffer.toString()).files).toHaveLength(3);
  await page.locator("#clearBtn").click();
  await expect(page.locator("#emptyState")).toBeVisible();
  await page.locator("#projectInput").setInputFiles({
    name: saved.name,
    mimeType: "application/json",
    buffer: saved.buffer,
  });
  await expect(page.locator("#message")).toContainText(`Opened ${saved.name}`);
  await expect(page.locator("#curveCount")).toHaveText("5 / 6 included");
  await expect(
    page.locator('input[name="mode"][value="dilution"]'),
  ).toBeChecked();
  await expect(page.locator("#seriesNames input").first()).toHaveValue(
    "Saved series",
  );
  await expect(
    page.locator('#curveTable [data-field="concentration"]').first(),
  ).toHaveValue("200 nM");
  await expect(page.locator("#figureTitle")).toHaveValue("Saved figure");
  await expect(page.locator("#showGrid")).toBeChecked();
  await expect(page.locator("#plateGrid td").first()).toHaveText(
    "VHH plate reference",
  );
  await page.locator('input[name="mode"][value="single"]').check();
  await expect(names(page).first()).toHaveValue("Saved VHH");
  await expect(antigens(page).first()).toHaveValue("Saved antigen");
  await expect(included(page).last()).not.toBeChecked();
});

test("invalid project input preserves the existing workspace", async ({
  page,
}) => {
  await loadDemo(page);
  await names(page).first().fill("Keep this work");
  await page.locator("#projectInput").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"another-app"}'),
  });
  await expect(page.locator("#message")).toContainText(
    "Could not open project",
  );
  await expect(page.locator("#curveCount")).toHaveText("6 / 6 included");
  await expect(names(page).first()).toHaveValue("Keep this work");
});

test("PZFX and XLSX downloads contain measured values without fit columns in single mode", async ({
  page,
}) => {
  await page
    .locator("#fileInput")
    .setInputFiles(resultFile("Measured_A1.txt", "10\t0\n11\t0.5\n12\t1"));
  await expect(page.locator("#curveCount")).toHaveText("1 / 1 included");
  await names(page).first().fill("Measured sample");
  const pzfx = await downloadFrom(page, "#pzfxBtn");
  expect(pzfx.name).toBe("bli_curves.pzfx");
  const prism = await inspectXml(page, pzfx.buffer.toString());
  expect(prism.invalid).toBe(false);
  expect(prism.tables).toHaveLength(1);
  expect(prism.tables[0].columns).toHaveLength(1);
  expect(prism.tables[0].columns[0]).toEqual({
    title: "Measured sample",
    values: ["0", "0.5", "1"],
  });
  const xlsx = await downloadFrom(page, "#xlsxBtn");
  expect(xlsx.name).toBe("bli_curves.xlsx");
  expect(xlsx.buffer.readUInt32LE()).toBe(0x04034b50);
  const entries = zipEntries(xlsx.buffer);
  expect(entries.has("xl/workbook.xml")).toBe(true);
  const sheet = await inspectXml(page, entries.get("xl/worksheets/sheet1.xml"));
  expect(sheet.invalid).toBe(false);
  expect(sheet.rows).toEqual([
    ["Time (s)", "Measured sample"],
    ["0", "0"],
    ["1", "0.5"],
    ["2", "1"],
  ]);
});

test("SVG and PNG downloads contain the plotted curves and actual raster dimensions", async ({
  page,
}) => {
  await loadDemo(page);
  const svg = await downloadFrom(page, "#svgBtn");
  expect(svg.name).toMatch(/\.svg$/);
  const vector = await inspectXml(page, svg.buffer.toString());
  expect(vector.invalid).toBe(false);
  expect(vector.traces).toBe(6);
  expect(vector.fits).toBe(0);
  const png = await downloadFrom(page, "#pngBtn");
  expect(png.name).toMatch(/\.png$/);
  expect([...png.buffer.subarray(0, 8)]).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  expect(png.buffer.readUInt32BE(16)).toBe(2700);
  expect(png.buffer.readUInt32BE(20)).toBeGreaterThanOrEqual(1560);
  const colours = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let coloured = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) -
          Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) >
        70
      )
        coloured++;
    }
    return coloured;
  }, png.buffer.toString("base64"));
  expect(colours).toBeGreaterThan(1000);
});

test("invalid figure bounds disable figure downloads while data export remains usable", async ({
  page,
}) => {
  await loadDemo(page);
  await page.locator(".figure-options summary").click();
  await page.locator("#xMin").fill("300");
  await page.locator("#xMax").fill("100");
  await expect(page.locator("#figureError")).toContainText(
    "minimum must be smaller",
  );
  await expect(page.locator("#svgBtn")).toBeDisabled();
  await expect(page.locator("#pngBtn")).toBeDisabled();
  await expect(page.locator("#xlsxBtn")).toBeEnabled();
  await expect(page.locator("#pzfxBtn")).toBeEnabled();
  const pzfx = await downloadFrom(page, "#pzfxBtn");
  expect(
    (await inspectXml(page, pzfx.buffer.toString())).tables[0].columns,
  ).toHaveLength(6);
  await page.locator("#resetFigureBtn").click();
  await expect(page.locator("#figureError")).toBeHidden();
  await expect(page.locator("#svgBtn")).toBeEnabled();
  await expect(page.locator("#plot .trace.data")).toHaveCount(6);
});

test("mobile layout contains overflow in scrollable tables and keeps figure actions usable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadDemo(page);
  await page.locator(".plate-panel summary").click();
  await expect(page.locator("#plateGrid")).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    table: document.querySelector("#plateGrid").scrollWidth,
    container: document.querySelector("#plateGrid").parentElement.clientWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.table).toBeGreaterThan(dimensions.container);
  await page.locator("#svgBtn").scrollIntoViewIfNeeded();
  await expect(page.locator("#svgBtn")).toBeVisible();
  await expect(page.locator("#svgBtn")).toBeEnabled();
  const screenshot = testInfo.outputPath("mobile-workspace.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("Mobile workspace", {
    path: screenshot,
    contentType: "image/png",
  });
  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});

test("opening index.html directly works offline without a development server", async ({
  page,
}) => {
  const externalRequests = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  await page.goto(new URL("../index.html", import.meta.url).href);
  await loadDemo(page);
  await expect(page.locator("#plot .trace.data")).toHaveCount(6);
  const pzfx = await downloadFrom(page, "#pzfxBtn");
  expect(
    (await inspectXml(page, pzfx.buffer.toString())).tables[0].columns,
  ).toHaveLength(6);
  expect(externalRequests).toEqual([]);
});

test("UTF-16 import preserves source time when normalization is disabled", async ({
  page,
}) => {
  const text = "Time1\tData1\r\n10\t0\r\n11\t0.5\r\n12\t1\r\n";
  await page
    .locator("#fileInput")
    .setInputFiles({
      name: "UTF16_A1.txt",
      mimeType: "text/plain",
      buffer: Buffer.concat([
        Buffer.from([255, 254]),
        Buffer.from(text, "utf16le"),
      ]),
    });
  await expect(page.locator("#curveCount")).toHaveText("1 / 1 included");
  await page.locator("#normaliseTime").uncheck();
  const pzfx = await downloadFrom(page, "#pzfxBtn");
  const times = await page.evaluate(
    (text) =>
      [
        ...new DOMParser()
          .parseFromString(text, "application/xml")
          .querySelectorAll("XColumn d"),
      ].map((d) => d.textContent),
    pzfx.buffer.toString(),
  );
  expect(times).toEqual(["10", "11", "12"]);
});

test("dilution concentration labels follow the selected plate axis", async ({
  page,
}) => {
  await page
    .locator("#fileInput")
    .setInputFiles([
      resultFile("Test_A1.txt"),
      resultFile("Test_A2.txt"),
      resultFile("Test_B1.txt"),
      resultFile("Unassigned.txt"),
    ]);
  await expect(page.locator("#curveCount")).toHaveText("4 / 4 included");
  await page.locator('input[name="mode"][value="dilution"]').check();
  await page.locator("#dilutionTools summary").click();
  await page.locator("#concentrationValues").fill("200, 100");
  await page.locator("#applyConcentrationBtn").click();
  expect(
    await page
      .locator('#curveTable [data-field="concentration"]')
      .evaluateAll((inputs) => inputs.map((input) => input.value)),
  ).toEqual(["200 nM", "200 nM", "100 nM", ""]);
  await page.locator("#concentrationDirection").selectOption("column");
  await page.locator("#concentrationValues").fill("40, 20");
  await page.locator("#applyConcentrationBtn").click();
  expect(
    await page
      .locator('#curveTable [data-field="concentration"]')
      .evaluateAll((inputs) => inputs.map((input) => input.value)),
  ).toEqual(["40 nM", "20 nM", "40 nM", ""]);
});
