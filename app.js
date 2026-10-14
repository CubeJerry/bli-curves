(() => {
  "use strict";
  const Core = globalThis.BliCore;
  const Figure = globalThis.BliFigure;
  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const state = {
    files: [],
    meta: {},
    seriesNames: {},
    mode: "single",
    fits: { single: false, dilution: true },
    busy: false,
    dirty: false,
    counter: 0,
    tables: [],
    currentTable: "",
    selection: null,
    undo: null,
    urls: [],
  };
  const figureDefaults = {
    figureTitle: "",
    xLabel: "Time (s)",
    yLabel: "Response (nm)",
    figureWidth: "900",
    figureHeight: "520",
    fontSize: "14",
    lineWidth: "2",
    xMin: "",
    xMax: "",
    yMin: "",
    yMax: "",
    phaseTime: "",
    showLegend: true,
    showGrid: false,
    pngScale: "3",
  };
  let lastSvg = "";
  let figureFrame = 0;
  const show = (id, visible) => $(id).classList.toggle("hidden", !visible);
  function message(text, error = false) {
    $("message").textContent = text;
    $("message").classList.toggle("error", error);
    show("message", Boolean(text));
  }
  function changed() {
    state.dirty = true;
    $("saveProjectBtn").disabled = !state.files.length;
  }
  function sourceName(file) {
    return file.well || file.name.replace(/\.[^.]+$/, "");
  }
  function defaultName(file, block) {
    return `${sourceName(file)}${file.blocks.length > 1 ? ` · curve ${block.blockNumber}` : ""}`;
  }
  function allCurves() {
    return state.files
      .flatMap((file) =>
        file.blocks.map((block, index) => {
          const id = `${file.id}:${index}`;
          return {
            id,
            file,
            block,
            groupKey: String(block.blockNumber),
            meta: state.meta[id],
          };
        }),
      )
      .filter((c) => c.block.numericData > 0)
      .sort(
        (a, b) =>
          a.file.name.localeCompare(b.file.name, undefined, {
            numeric: true,
          }) || a.block.blockNumber - b.block.blockNumber,
      );
  }
  function visibleCurves() {
    const query = $("searchInput").value.trim().toLowerCase();
    return allCurves().filter((c) =>
      `${c.file.name} ${c.meta.name} ${c.meta.antigen} ${c.meta.concentration} ${state.seriesNames[c.groupKey]}`
        .toLowerCase()
        .includes(query),
    );
  }
  function initializeFile(name, text) {
    const parsed = Core.parseResultFile(name, text);
    const file = { ...parsed, id: `file${++state.counter}`, text };
    file.blocks.forEach((block, index) => {
      const id = `${file.id}:${index}`;
      state.meta[id] = {
        name: defaultName(file, block),
        antigen: "",
        concentration: block.concentration || "",
        include: true,
        colour: Figure.colourForIndex(Object.keys(state.meta).length),
      };
      state.seriesNames[String(block.blockNumber)] ??=
        `Series ${block.blockNumber}`;
    });
    return file;
  }
  function setBusy(busy) {
    state.busy = busy;
    for (const id of ["pickBtn", "demoBtn", "openProjectBtn", "clearBtn"])
      $(id).disabled = busy;
    $("drop").setAttribute("aria-busy", String(busy));
  }
  async function readText(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encoding =
      bytes[0] === 255 && bytes[1] === 254
        ? "utf-16le"
        : bytes[0] === 254 && bytes[1] === 255
          ? "utf-16be"
          : "utf-8";
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  }
  async function loadFiles(files) {
    if (state.busy) {
      message("An import is in progress. Add the next files when it finishes.");
      return;
    }
    const candidates = Array.from(files || []);
    if (!candidates.length) return;
    setBusy(true);
    message("");
    const errors = [];
    let added = 0,
      duplicates = 0;
    try {
      for (let i = 0; i < candidates.length; i++) {
        const file = candidates[i];
        $("importStatus").textContent =
          `Reading ${i + 1} / ${candidates.length}`;
        if (!/\.(txt|csv|tsv)$/i.test(file.name)) {
          errors.push(`${file.name}: choose a TXT, CSV or TSV result export.`);
          continue;
        }
        if (file.size > 50 * 1024 * 1024) {
          errors.push(`${file.name}: exceeds the 50 MB per-file limit.`);
          continue;
        }
        try {
          const text = await readText(file);
          if (
            state.files.some((f) => f.name === file.name && f.text === text)
          ) {
            duplicates++;
            continue;
          }
          const parsed = initializeFile(file.name, text);
          state.files.push(parsed);
          added++;
        } catch (error) {
          errors.push(`${file.name}: ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (added) changed();
      render();
      message(
        [
          `${added} file${added === 1 ? "" : "s"} added.`,
          duplicates
            ? `${duplicates} identical file${duplicates === 1 ? "" : "s"} skipped.`
            : "",
          ...errors,
        ]
          .filter(Boolean)
          .join(" "),
        errors.length > 0,
      );
    } finally {
      setBusy(false);
      $("importStatus").textContent = "";
      $("fileInput").value = "";
    }
  }
  function renderFiles() {
    $("fileCount").textContent = state.files.length;
    $("fileList").innerHTML = state.files
      .map(
        (f) =>
          `<div class="file-item"><div><strong>${esc(f.name)}</strong><small>${f.well ? esc(f.well) + " · " : ""}${f.blocks.filter((b) => b.numericData > 0).length} curves · ${f.blocks.reduce((n, b) => n + b.numericData, 0).toLocaleString()} observations</small></div><button data-remove="${esc(f.id)}" aria-label="Remove ${esc(f.name)}" title="Remove file">×</button></div>`,
      )
      .join("");
    const warnings = state.files.flatMap((f) => f.warnings);
    const names = new Map();
    for (const f of state.files)
      names.set(f.name, (names.get(f.name) || 0) + 1);
    for (const [name, count] of names)
      if (count > 1)
        warnings.push(
          `${name}: ${count} different files have this name. They are retained as separate sources.`,
        );
    $("issueSummary").textContent =
      `${warnings.length} import note${warnings.length === 1 ? "" : "s"}`;
    $("issuesList").innerHTML = warnings
      .map((w) => `<li>${esc(w)}</li>`)
      .join("");
    show("issuesPanel", warnings.length > 0);
    show("loadedSection", state.files.length > 0 || Boolean(state.undo));
    show("undoBtn", Boolean(state.undo));
  }
  function renderSeriesNames() {
    const keys = [...new Set(allCurves().map((c) => c.groupKey))];
    $("seriesNames").innerHTML = keys
      .map(
        (key) =>
          `<label>Source block ${esc(key)}<input data-series="${esc(key)}" aria-label="Name for series ${esc(key)}" value="${esc(state.seriesNames[key])}"></label>`,
      )
      .join("");
    show("seriesNames", state.mode === "dilution");
    show("dilutionTools", state.mode === "dilution");
  }
  function renderTable() {
    const curves = visibleCurves();
    state.selection = null;
    $("curveCount").textContent =
      `${allCurves().filter((c) => c.meta.include).length} / ${allCurves().length} included`;
    const dilution = state.mode === "dilution";
    const rows = curves
      .map((c, index) => {
        const sourceSub = dilution
          ? `${state.seriesNames[c.groupKey]} · ${c.file.name}`
          : `${c.file.name}${c.file.blocks.length > 1 ? ` · source block ${c.block.blockNumber}` : ""}`;
        const field = dilution ? "concentration" : "name";
        const labelValue = dilution ? c.meta.concentration : c.meta.name;
        const placeholder = dilution
          ? sourceName(c.file)
          : defaultName(c.file, c.block);
        return `<tr data-id="${esc(c.id)}" class="${c.meta.include ? "" : "excluded"}"><td class="use-cell"><input type="checkbox" data-field="include" ${c.meta.include ? "checked" : ""} aria-label="Include ${esc(c.meta.name)}"></td><td class="source-cell"><strong>${esc(sourceName(c.file))}</strong><small title="${esc(sourceSub)}">${esc(sourceSub)}</small></td><td><input class="cell-input" data-field="${field}" data-row="${index}" data-col="0" value="${esc(labelValue)}" placeholder="${esc(placeholder)}" aria-label="${dilution ? "Concentration or label" : "Curve name"} for ${esc(defaultName(c.file, c.block))}"></td><td><input class="cell-input" data-field="antigen" data-row="${index}" data-col="1" value="${esc(c.meta.antigen)}" placeholder="All curves" aria-label="Antigen for ${esc(defaultName(c.file, c.block))}"></td><td class="colour-cell"><input type="color" data-field="colour" value="${esc(c.meta.colour)}" aria-label="Colour for ${esc(defaultName(c.file, c.block))}"></td></tr>`;
      })
      .join("");
    $("curveTable").innerHTML =
      `<caption class="visually-hidden">Select, name and colour curves</caption><thead><tr><th>Use</th><th>Source</th><th>${dilution ? "Concentration / label" : "Curve name"}</th><th>Antigen / plot group</th><th>Colour</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No curves match this filter.</td></tr>'}</tbody>`;
  }
  function groupsForExport() {
    const groups = new Map();
    for (const c of allCurves().filter((c) => c.meta.include)) {
      const antigen = c.meta.antigen.trim();
      const key = JSON.stringify(
        state.mode === "dilution" ? [c.groupKey, antigen] : [antigen],
      );
      const groupName =
        state.seriesNames[c.groupKey]?.trim() || `Series ${c.groupKey}`;
      const title =
        state.mode === "dilution"
          ? [groupName, antigen].filter(Boolean).join(" · ")
          : antigen || "Binding curves";
      if (!groups.has(key)) groups.set(key, { id: key, title, curves: [] });
      const label =
        state.mode === "dilution"
          ? c.meta.concentration.trim() || sourceName(c.file)
          : c.meta.name.trim() || defaultName(c.file, c.block);
      groups.get(key).curves.push({
        id: c.id,
        label,
        block: c.block,
        source: c.file.name,
        colour: c.meta.colour,
      });
    }
    return [...groups.values()];
  }
  function options() {
    return {
      normaliseTime: $("normaliseTime").checked,
      includeFit: state.fits[state.mode],
    };
  }
  function currentTable() {
    return (
      state.tables.find((t) => t.id === state.currentTable) || state.tables[0]
    );
  }
  function updateOutput() {
    const prior = currentTable();
    const priorKey = prior?.groupId;
    try {
      state.tables = Core.prepareTables(groupsForExport(), options());
      const next =
        state.tables.find(
          (t) => t.groupId === priorKey && t.title === prior?.title,
        ) ||
        state.tables.find((t) => t.groupId === priorKey) ||
        state.tables[0];
      state.currentTable = next?.id || "";
      $("plotSelect").innerHTML = state.tables
        .map(
          (t) =>
            `<option value="${esc(t.id)}" ${t.id === state.currentTable ? "selected" : ""}>${esc(t.title)}</option>`,
        )
        .join("");
      const count = allCurves().filter((c) => c.meta.include).length;
      $("exportSummary").textContent =
        `${count} curves · ${state.tables.length} table${state.tables.length === 1 ? "" : "s"} · ${options().normaliseTime ? "time starts at 0 s" : "original time"}${options().includeFit ? " · imported fits included" : ""}`;
      $("curveCount").textContent = `${count} / ${allCurves().length} included`;
      for (const id of ["xlsxBtn", "pzfxBtn", "csvBtn"])
        $(id).disabled = !state.tables.length;
      renderFigure();
      renderData();
    } catch (error) {
      state.tables = [];
      lastSvg = "";
      $("plot").innerHTML = "";
      message(error.message, true);
      for (const id of ["svgBtn", "pngBtn", "xlsxBtn", "pzfxBtn", "csvBtn"])
        $(id).disabled = true;
    }
  }
  function figureSettings() {
    const settings = {};
    for (const id of Object.keys(figureDefaults))
      settings[id] =
        typeof figureDefaults[id] === "boolean" ? $(id).checked : $(id).value;
    return settings;
  }
  function renderFigure() {
    const table = currentTable();
    show("plotEmpty", !table);
    show("figureError", false);
    $("plot").innerHTML = "";
    lastSvg = "";
    $("svgBtn").disabled = $("pngBtn").disabled = !table;
    show("plotNotice", false);
    if (!table) return;
    const opts = figureSettings();
    try {
      for (const id of ["figureWidth", "figureHeight", "fontSize", "lineWidth"])
        if (!$(id).checkValidity())
          throw new Error(
            `Check ${$(id).parentElement.textContent.trim()}: ${$(id).validationMessage}`,
          );
      const tableCurveIds = new Set(table.yColumns.map((c) => c.curveId));
      const series = table.curves
        .filter((c) => tableCurveIds.has(c.id))
        .map((c) => ({
          id: c.id,
          name: c.label,
          colour: c.colour,
          points: Core.toPoints(c.block, options().normaliseTime),
        }));
      lastSvg = Figure.renderSvg(series, {
        title: opts.figureTitle.trim() || table.title,
        xLabel: opts.xLabel,
        yLabel: opts.yLabel,
        width: Number(opts.figureWidth),
        height: Number(opts.figureHeight),
        fontSize: Number(opts.fontSize),
        lineWidth: Number(opts.lineWidth),
        showFit: options().includeFit,
        showLegend: opts.showLegend,
        grid: opts.showGrid,
        xMin: opts.xMin,
        xMax: opts.xMax,
        yMin: opts.yMin,
        yMax: opts.yMax,
        phaseTime: opts.phaseTime,
      });
      $("plot").innerHTML = lastSvg;
      const notices = [...(table.notices || [])];
      if (new Set(series.map((s) => s.name)).size < series.length)
        notices.push(
          "Some curve labels repeat. Use distinct labels if you need to identify them separately in the legend.",
        );
      $("plotNotice").textContent = [...new Set(notices)].join(" ");
      show("plotNotice", notices.length > 0);
    } catch (error) {
      $("figureError").textContent = error.message;
      show("figureError", true);
      $("svgBtn").disabled = $("pngBtn").disabled = true;
    }
  }
  function scheduleOutput() {
    cancelAnimationFrame(figureFrame);
    figureFrame = requestAnimationFrame(updateOutput);
  }
  function renderData() {
    const table = currentTable();
    if (!table) {
      $("dataTable").innerHTML = "";
      $("dataHelp").textContent = "No included data.";
      return;
    }
    const rows = [
      [table.xTitle, ...table.yColumns.slice(0, 11).map((c) => c.title)],
      ...table.xValues
        .slice(0, 8)
        .map((x, i) => [
          x,
          ...table.yColumns.slice(0, 11).map((c) => c.values[i]),
        ]),
    ];
    $("dataHelp").textContent =
      `First ${Math.min(8, rows.length - 1)} of ${table.xValues.length.toLocaleString()} rows. Blank cells are missing observations, not zeros.${table.yColumns.length > 11 ? " Showing the first 12 columns." : ""}`;
    $("dataTable").innerHTML = `<thead><tr>${rows[0]
      .slice(0, 12)
      .map((v) => `<th>${esc(v)}</th>`)
      .join("")}</tr></thead><tbody>${rows
      .slice(1, 9)
      .map(
        (row) =>
          `<tr>${row
            .slice(0, 12)
            .map((v) => `<td>${esc(v)}</td>`)
            .join("")}</tr>`,
      )
      .join("")}</tbody>`;
  }
  function render() {
    renderFiles();
    renderSeriesNames();
    renderTable();
    const hasCurves = allCurves().length > 0;
    show("emptyState", !hasCurves);
    show("workPanels", hasCurves);
    $("saveProjectBtn").disabled = !state.files.length;
    $("includeFit").checked = state.fits[state.mode];
    $("modeHelp").textContent =
      state.mode === "single"
        ? "One row per measured curve. Antigen labels create separate plots and export tables."
        : "Matching source block numbers form a series. Name the series below, then label each concentration.";
    $("fitHelp").textContent =
      state.mode === "single"
        ? "Single binding shows measured data by default. No fitting is performed."
        : "Fits are imported from Octet, not calculated here. Turn them off for measured data only.";
    updateOutput();
  }
  function removeFile(id) {
    if (state.busy) return;
    const index = state.files.findIndex((f) => f.id === id);
    if (index < 0) return;
    state.undo = { file: state.files[index], index };
    state.files.splice(index, 1);
    changed();
    render();
  }
  function clearWorkspace() {
    if (
      state.files.length &&
      !confirm(
        "Clear the workspace? Save a project first if you want to keep your data and labels.",
      )
    )
      return;
    state.files = [];
    state.meta = {};
    state.seriesNames = {};
    state.undo = null;
    state.currentTable = "";
    state.selection = null;
    state.dirty = false;
    $("searchInput").value = "";
    $("fileInput").value = "";
    render();
    message("Workspace cleared.");
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    state.urls.push(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.append(a);
    a.click();
    a.remove();
    $("downloadStatus").innerHTML =
      `Ready: <a href="${url}" download="${esc(name)}">${esc(name)}</a>. Click the filename if the download did not start.`;
    // Keep a short download history alive for Safari, then release the old blobs.
    if (state.urls.length > 8) URL.revokeObjectURL(state.urls.shift());
  }
  async function runExport(kind) {
    try {
      // Flush a pending label/selection update before creating a download.
      cancelAnimationFrame(figureFrame);
      updateOutput();
      if (!state.tables.length)
        throw new Error("Include at least one curve before exporting.");
      const table = currentTable();
      const stem = Core.safeFilename(table.title);
      if (kind === "xlsx")
        download(Core.buildXlsx(state.tables), "bli_curves.xlsx");
      if (kind === "pzfx")
        download(
          new Blob([Core.buildPzfx(state.tables)], { type: "application/xml" }),
          "bli_curves.pzfx",
        );
      if (kind === "svg") {
        if (!lastSvg)
          throw new Error("Correct the figure settings before exporting.");
        download(new Blob([lastSvg], { type: "image/svg+xml" }), `${stem}.svg`);
      }
      if (kind === "png") {
        if (!lastSvg)
          throw new Error("Correct the figure settings before exporting.");
        const svg = lastSvg;
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
        const scale = Number($("pngScale").value);
        const width = Number(doc.documentElement.getAttribute("width")) * scale,
          height = Number(doc.documentElement.getAttribute("height")) * scale;
        if (width * height > 40000000)
          throw new Error(
            "This PNG would exceed 40 megapixels. Reduce the figure dimensions or PNG scale, or export SVG.",
          );
        const url = URL.createObjectURL(
          new Blob([svg], { type: "image/svg+xml" }),
        );
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context)
            throw new Error(
              "PNG export is unavailable in this browser. Use SVG instead.",
            );
          context.fillStyle = "white";
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
          if (!blob)
            throw new Error(
              "The browser could not create the PNG. Try a smaller scale.",
            );
          download(blob, `${stem}.png`);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      if (kind === "csv") {
        const csv = Core.tableRows(table)
          .map((row) =>
            row
              .map((v) => {
                const text = String(v ?? "");
                const s =
                  typeof v === "string" && /^[\s]*[=+@-]/.test(text)
                    ? `'${text}`
                    : text;
                return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
              })
              .join(","),
          )
          .join("\r\n");
        download(
          new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
          `${stem}.csv`,
        );
      }
    } catch (error) {
      message(`${kind.toUpperCase()} export failed: ${error.message}`, true);
    }
  }
  function saveProject() {
    const project = {
      format: "bli-curves",
      version: 1,
      mode: state.mode,
      normaliseTime: $("normaliseTime").checked,
      fits: state.fits,
      seriesNames: state.seriesNames,
      figure: figureSettings(),
      files: state.files.map((f) => ({
        name: f.name,
        text: f.text,
        curves: f.blocks.map((_, i) => state.meta[`${f.id}:${i}`]),
      })),
      plate: Array.from($("plateGrid").querySelectorAll("td")).map(
        (cell) => cell.textContent,
      ),
    };
    download(
      new Blob([JSON.stringify(project)], { type: "application/json" }),
      "bli_curves.bli.json",
    );
    state.dirty = false;
  }
  async function openProject(file) {
    if (!file || state.busy) return;
    if (
      state.dirty &&
      !confirm(
        "Replace this workspace with the saved project? Save the current project first if you need it.",
      )
    )
      return;
    setBusy(true);
    try {
      if (file.size > 100 * 1024 * 1024)
        throw new Error("Project exceeds the 100 MB limit.");
      const p = JSON.parse(await readText(file));
      if (
        p.format !== "bli-curves" ||
        p.version !== 1 ||
        !Array.isArray(p.files) ||
        p.files.length > 2000
      )
        throw new Error("Choose a supported BLI Curves project (.bli.json).");
      if (
        !["single", "dilution"].includes(p.mode) ||
        typeof p.normaliseTime !== "boolean" ||
        !p.fits ||
        typeof p.fits.single !== "boolean" ||
        typeof p.fits.dilution !== "boolean"
      )
        throw new Error("Project settings are invalid.");
      for (const f of p.files)
        if (
          typeof f.name !== "string" ||
          typeof f.text !== "string" ||
          !Array.isArray(f.curves) ||
          f.text.length > 50 * 1024 * 1024
        )
          throw new Error("Project source data are invalid.");
      // Validate and parse into an isolated state before replacing the live workspace.
      const rebuilt = p.files.map((f, index) => ({
        ...Core.parseResultFile(f.name, f.text),
        text: f.text,
        id: `restored${++state.counter}`,
        saved: f.curves,
      }));
      const meta = {};
      const seriesNames = {};
      for (const f of rebuilt)
        f.blocks.forEach((block, i) => {
          const saved = f.saved[i] || {};
          meta[`${f.id}:${i}`] = {
            name:
              typeof saved.name === "string"
                ? saved.name
                : defaultName(f, block),
            antigen: typeof saved.antigen === "string" ? saved.antigen : "",
            concentration:
              typeof saved.concentration === "string"
                ? saved.concentration
                : block.concentration || "",
            include: typeof saved.include === "boolean" ? saved.include : true,
            colour: /^#[a-f0-9]{6}$/i.test(saved.colour)
              ? saved.colour
              : Figure.colourForIndex(Object.keys(meta).length),
          };
          const key = String(block.blockNumber);
          seriesNames[key] =
            typeof p.seriesNames?.[key] === "string"
              ? p.seriesNames[key]
              : `Series ${key}`;
        });
      state.files = rebuilt;
      state.meta = meta;
      state.seriesNames = seriesNames;
      state.mode = p.mode;
      state.fits = { single: p.fits.single, dilution: p.fits.dilution };
      state.undo = null;
      state.currentTable = "";
      state.dirty = false;
      document.querySelector(`input[name="mode"][value="${p.mode}"]`).checked =
        true;
      $("normaliseTime").checked = p.normaliseTime;
      $("searchInput").value = "";
      setFigureSettings(p.figure || {});
      Array.from($("plateGrid").querySelectorAll("td")).forEach(
        (cell, i) =>
          (cell.textContent =
            typeof p.plate?.[i] === "string" ? p.plate[i] : ""),
      );
      render();
      message(`Opened ${file.name}.`);
    } catch (error) {
      message(`Could not open project: ${error.message}`, true);
    } finally {
      setBusy(false);
      $("projectInput").value = "";
    }
  }
  function setFigureSettings(values) {
    for (const [id, fallback] of Object.entries(figureDefaults)) {
      const value = values[id];
      if (typeof fallback === "boolean")
        $(id).checked = typeof value === "boolean" ? value : fallback;
      else $(id).value = typeof value === "string" ? value : fallback;
    }
  }
  function fillConcentrations() {
    const values = $("concentrationValues")
      .value.split(/[,;\t\r\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const byRow = $("concentrationDirection").value === "row";
    if (!values.length || values.length > (byRow ? 8 : 12)) {
      message(
        `Enter 1–${byRow ? 8 : 12} labels in plate ${byRow ? "row" : "column"} order.`,
        true,
      );
      return;
    }
    const unit = $("concentrationUnit").value.trim();
    let count = 0;
    for (const c of allCurves()) {
      const match = c.file.well.match(/^([A-H])(\d{1,2})$/);
      if (!match) continue;
      const index = byRow ? match[1].charCodeAt(0) - 65 : Number(match[2]) - 1;
      if (values[index] === undefined) continue;
      const value = values[index];
      const numeric = /^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?$/i.test(value);
      c.meta.concentration = numeric && unit ? `${value} ${unit}` : value;
      count++;
    }
    changed();
    renderTable();
    updateOutput();
    message(
      `${count} concentration labels applied. Unmatched wells were left unchanged.`,
    );
  }
  function selectedInputs() {
    if (!state.selection) return [];
    const { anchor, focus } = state.selection;
    return Array.from($("curveTable").querySelectorAll(".cell-input")).filter(
      (input) =>
        Number(input.dataset.row) >= Math.min(anchor.row, focus.row) &&
        Number(input.dataset.row) <= Math.max(anchor.row, focus.row) &&
        Number(input.dataset.col) >= Math.min(anchor.col, focus.col) &&
        Number(input.dataset.col) <= Math.max(anchor.col, focus.col),
    );
  }
  const position = (input) => ({
    row: Number(input.dataset.row),
    col: Number(input.dataset.col),
  });
  const cellAt = (row, col) =>
    $("curveTable").querySelector(
      `.cell-input[data-row="${row}"][data-col="${col}"]`,
    );
  function selectCells(anchor, focus = anchor) {
    state.selection = { anchor: position(anchor), focus: position(focus) };
    paintSelection();
  }
  function paintSelection() {
    const selected = new Set(selectedInputs());
    $("curveTable")
      .querySelectorAll(".cell-input")
      .forEach((input) =>
        input.classList.toggle(
          "selected-cell",
          selected.size > 1 && selected.has(input),
        ),
      );
  }
  function commitInput(input) {
    const id = input.closest("tr").dataset.id;
    if (!state.meta[id]) return;
    state.meta[id][input.dataset.field] =
      input.type === "checkbox" ? input.checked : input.value;
    changed();
  }
  function pasteCells(event) {
    const input = event.target;
    if (!input.matches(".cell-input")) return;
    const text = event.clipboardData.getData("text/plain");
    if (!/[\t\r\n]/.test(text) && selectedInputs().length <= 1) return;
    event.preventDefault();
    const rows = text
      .replace(/\r\n?/g, "\n")
      .replace(/\n$/, "")
      .split("\n")
      .map((row) => row.split("\t"));
    if (
      rows.length === 1 &&
      rows[0].length === 1 &&
      selectedInputs().length > 1
    )
      selectedInputs().forEach((cell) => {
        cell.value = rows[0][0];
        commitInput(cell);
      });
    else {
      const start = position(input);
      let clipped = 0,
        last = input;
      rows.forEach((row, r) =>
        row.forEach((value, c) => {
          const cell = cellAt(start.row + r, start.col + c);
          if (cell) {
            cell.value = value;
            commitInput(cell);
            last = cell;
          } else clipped++;
        }),
      );
      selectCells(input, last);
      if (clipped)
        message(
          `${clipped} pasted cell${clipped === 1 ? " was" : "s were"} outside the visible label fields and not applied.`,
        );
    }
    updateOutput();
  }
  function renderPlate() {
    $("plateGrid").innerHTML =
      `<thead><tr><th></th>${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr></thead><tbody>${Array.from({ length: 8 }, (_, r) => `<tr><th>${String.fromCharCode(65 + r)}</th>${Array.from({ length: 12 }, (_, c) => `<td contenteditable="plaintext-only" tabindex="0" data-row="${r}" data-col="${c}" aria-label="Well ${String.fromCharCode(65 + r)}${c + 1}"></td>`).join("")}</tr>`).join("")}</tbody>`;
  }
  function demo() {
    if (state.busy) return;
    const rows = ["A", "B", "C"];
    const files = rows.map((row, i) => {
      const lines = [
        "Synthetic example data, not experimental measurements",
        "Time1\tData1\tFit1\tTime2\tData2\tFit2",
      ];
      for (let t = 0; t <= 300; t += 2) {
        const y =
          (1.2 / (i + 1)) *
          (t < 120
            ? 1 - Math.exp(-t / 25)
            : (1 - Math.exp(-120 / 25)) * Math.exp(-(t - 120) / 160));
        lines.push(
          [
            t,
            y + Math.sin(t * 1.9 + i) * 0.005,
            y,
            t,
            y * 0.64 + Math.sin(t + i) * 0.004,
            y * 0.64,
          ].join("\t"),
        );
      }
      return new File([lines.join("\n")], `Example_${row}1.txt`, {
        type: "text/plain",
      });
    });
    loadFiles(files);
  }
  $("pickBtn").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => loadFiles(e.target.files));
  $("drop").addEventListener("dragover", (e) => {
    e.preventDefault();
    $("drop").classList.add("drag");
  });
  $("drop").addEventListener("dragleave", () =>
    $("drop").classList.remove("drag"),
  );
  $("drop").addEventListener("drop", (e) => {
    e.preventDefault();
    $("drop").classList.remove("drag");
    loadFiles(e.dataTransfer.files);
  });
  // Prevent an accidental drop outside the target from navigating away from unsaved work.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
  $("demoBtn").addEventListener("click", demo);
  $("clearBtn").addEventListener("click", clearWorkspace);
  $("fileList").addEventListener("click", (e) => {
    const button = e.target.closest("[data-remove]");
    if (button) removeFile(button.dataset.remove);
  });
  $("undoBtn").addEventListener("click", () => {
    if (!state.undo || state.busy) return;
    state.files.splice(state.undo.index, 0, state.undo.file);
    state.undo = null;
    changed();
    render();
  });
  document.querySelectorAll('input[name="mode"]').forEach((input) =>
    input.addEventListener("change", () => {
      state.mode = input.value;
      changed();
      render();
    }),
  );
  $("includeFit").addEventListener("change", () => {
    state.fits[state.mode] = $("includeFit").checked;
    changed();
    updateOutput();
  });
  $("normaliseTime").addEventListener("change", () => {
    changed();
    updateOutput();
  });
  $("searchInput").addEventListener("input", renderTable);
  for (const [id, include] of [
    ["selectAllBtn", true],
    ["selectNoneBtn", false],
  ])
    $(id).addEventListener("click", () => {
      visibleCurves().forEach((c) => (c.meta.include = include));
      changed();
      renderTable();
      updateOutput();
    });
  $("resetNamesBtn").addEventListener("click", () => {
    if (
      !confirm(
        "Reset curve and series names? Antigens and concentration labels will be kept.",
      )
    )
      return;
    allCurves().forEach((c) => (c.meta.name = defaultName(c.file, c.block)));
    for (const key of Object.keys(state.seriesNames))
      state.seriesNames[key] = `Series ${key}`;
    changed();
    renderSeriesNames();
    renderTable();
    updateOutput();
  });
  $("seriesNames").addEventListener("input", (e) => {
    if (!e.target.dataset.series) return;
    const key = e.target.dataset.series;
    state.seriesNames[key] = e.target.value;
    // Keep existing inputs mounted when focus moves from a series name to a curve.
    // Rebuilding the table on blur can remove the incoming focus target.
    const curves = new Map(allCurves().map((curve) => [curve.id, curve]));
    for (const row of $("curveTable").querySelectorAll("tbody tr[data-id]")) {
      const curve = curves.get(row.dataset.id);
      if (curve?.groupKey !== key) continue;
      const source = row.querySelector(".source-cell small");
      source.textContent = `${e.target.value} · ${curve.file.name}`;
      source.title = source.textContent;
    }
    changed();
    scheduleOutput();
  });
  $("curveTable").addEventListener("input", (e) => {
    if (!e.target.dataset.field) return;
    commitInput(e.target);
    e.target
      .closest("tr")
      .classList.toggle(
        "excluded",
        !state.meta[e.target.closest("tr").dataset.id].include,
      );
    scheduleOutput();
  });
  $("curveTable").addEventListener("paste", pasteCells);
  $("curveTable").addEventListener("focusin", (e) => {
    if (e.target.matches(".cell-input")) {
      e.target.select();
      if (!state.selection) selectCells(e.target);
    }
  });
  $("curveTable").addEventListener("click", (e) => {
    if (!e.target.matches(".cell-input")) return;
    const anchor = state.selection
      ? cellAt(state.selection.anchor.row, state.selection.anchor.col)
      : null;
    selectCells(e.shiftKey && anchor ? anchor : e.target, e.target);
  });
  $("curveTable").addEventListener("keydown", (e) => {
    if (!e.target.matches(".cell-input")) return;
    const p = position(e.target);
    if (e.key === "Enter") {
      e.preventDefault();
      const next = cellAt(p.row + (e.shiftKey ? -1 : 1), p.col);
      if (next) {
        selectCells(next);
        next.focus();
      }
    }
    if (e.shiftKey && ["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const next = cellAt(p.row + (e.key === "ArrowDown" ? 1 : -1), p.col);
      const anchor = state.selection
        ? cellAt(state.selection.anchor.row, state.selection.anchor.col)
        : e.target;
      if (next) {
        selectCells(anchor, next);
        next.focus();
      }
    }
    if (e.key === "Escape") {
      state.selection = null;
      paintSelection();
    }
  });
  document.addEventListener("copy", (e) => {
    if (
      !document.activeElement?.matches("#curveTable .cell-input") ||
      selectedInputs().length < 2
    )
      return;
    e.preventDefault();
    const cells = selectedInputs();
    const rows = new Map();
    for (const input of cells) {
      const r = input.dataset.row;
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r).push(input.value);
    }
    e.clipboardData.setData(
      "text/plain",
      [...rows.values()].map((row) => row.join("\t")).join("\n"),
    );
  });
  $("applyConcentrationBtn").addEventListener("click", fillConcentrations);
  $("plotSelect").addEventListener("change", () => {
    state.currentTable = $("plotSelect").value;
    renderFigure();
    renderData();
  });
  for (const id of Object.keys(figureDefaults))
    $(id).addEventListener("input", () => {
      changed();
      renderFigure();
    });
  $("resetFigureBtn").addEventListener("click", () => {
    setFigureSettings({});
    changed();
    renderFigure();
  });
  for (const kind of ["svg", "png", "xlsx", "pzfx", "csv"])
    $(`${kind}Btn`).addEventListener("click", () => runExport(kind));
  $("saveProjectBtn").addEventListener("click", saveProject);
  $("openProjectBtn").addEventListener("click", () =>
    $("projectInput").click(),
  );
  $("projectInput").addEventListener("change", (e) =>
    openProject(e.target.files[0]),
  );
  $("plateGrid").addEventListener("input", changed);
  $("plateGrid").addEventListener("paste", (e) => {
    const cell = e.target.closest("td");
    if (!cell) return;
    e.preventDefault();
    const rows = e.clipboardData
      .getData("text/plain")
      .replace(/\r\n?/g, "\n")
      .replace(/\n$/, "")
      .split("\n")
      .map((row) => row.split("\t"));
    let clipped = 0;
    rows.forEach((row, r) =>
      row.forEach((value, c) => {
        const target = $("plateGrid").querySelector(
          `td[data-row="${Number(cell.dataset.row) + r}"][data-col="${Number(cell.dataset.col) + c}"]`,
        );
        if (target) target.textContent = value;
        else clipped++;
      }),
    );
    changed();
    if (clipped) message(`${clipped} cells fell outside the 96-well plate.`);
  });
  $("clearPlateBtn").addEventListener("click", () => {
    if (!confirm("Clear the plate reference?")) return;
    $("plateGrid")
      .querySelectorAll("td")
      .forEach((cell) => (cell.textContent = ""));
    changed();
  });
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty && state.files.length) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () =>
    state.urls.forEach((url) => URL.revokeObjectURL(url)),
  );
  renderPlate();
  render();
})();
