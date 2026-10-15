/* Shared SVG renderer for the on-screen plot and downloadable figures. */
(function (root) {
  "use strict";

  const PALETTE = Object.freeze([
    "#0072B2",
    "#D55E00",
    "#009E73",
    "#CC79A7",
    "#E69F00",
    "#56B4E9",
    "#000000",
    "#999999",
  ]);
  const escapeXml = (value) =>
    String(value ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
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
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const colourForIndex = (index) =>
    PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
  const coordinate = (value) => Number(value.toFixed(3));

  function optionalNumber(value, label) {
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && !value.trim())
    )
      return null;
    if (typeof value !== "number" && typeof value !== "string")
      throw new Error(`${label} must be a number or left blank.`);
    const number = Number(value);
    if (!Number.isFinite(number))
      throw new Error(`${label} must be a finite number.`);
    return number;
  }

  function validateOptions(input = {}) {
    const options = {
      title: "",
      xLabel: "Time (s)",
      yLabel: "Response (nm)",
      width: 900,
      height: 520,
      lineWidth: 2,
      fontSize: 14,
      showFit: false,
      showLegend: true,
      grid: false,
      phaseTime: null,
      ...input,
    };
    for (const [name, minimum, maximum] of [
      ["width", 320, 10000],
      ["height", 240, 10000],
      ["fontSize", 8, 36],
      ["lineWidth", 0.25, 12],
    ]) {
      const number = optionalNumber(options[name], name);
      if (number === null || number < minimum || number > maximum)
        throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
      options[name] = number;
    }
    for (const name of ["xMin", "xMax", "yMin", "yMax", "phaseTime"])
      options[name] = optionalNumber(options[name], name);
    for (const axis of ["x", "y"]) {
      if (
        options[`${axis}Min`] !== null &&
        options[`${axis}Max`] !== null &&
        options[`${axis}Min`] >= options[`${axis}Max`]
      )
        throw new Error(
          `${axis.toUpperCase()} minimum must be smaller than its maximum.`,
        );
    }
    return options;
  }

  function numberLabel(number) {
    if (Object.is(number, -0) || number === 0) return "0";
    const abs = Math.abs(number);
    if (abs >= 100000 || abs < 0.001)
      return number
        .toExponential(3)
        .replace(/\.?0+e/, "e")
        .replace("e+", "e");
    return Number(number.toPrecision(6)).toString();
  }

  function distinctLabels(values) {
    const labels = values.map(numberLabel);
    return new Set(labels).size === new Set(values).size
      ? labels
      : values.map((value) => (Object.is(value, -0) ? "0" : value.toString()));
  }

  function niceTicks(minimum, maximum, target = 5) {
    const span = maximum - minimum;
    if (!(span > 0) || !Number.isFinite(span)) return [];
    const rough = span / Math.max(2, target);
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    if (!magnitude) return [minimum, maximum];
    const residual = rough / magnitude;
    const step =
      (residual <= 1
        ? 1
        : residual <= 2
          ? 2
          : residual <= 2.5
            ? 2.5
            : residual <= 5
              ? 5
              : 10) * magnitude;
    const start = Math.ceil(minimum / step - 1e-10);
    const end = Math.floor(maximum / step + 1e-10);
    const ticks = [];
    for (let i = start, count = 0; i <= end && count < 30; i++, count++) {
      const value = Number((i * step).toPrecision(15));
      if (!ticks.length || ticks[ticks.length - 1] !== value) ticks.push(value);
    }
    return ticks.length > 1 ? ticks : [minimum, maximum];
  }

  function wrapText(value, maxChars) {
    const words = String(value ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const lines = [];
    let line = "";
    for (let word of words) {
      while (word.length > maxChars) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(word.slice(0, maxChars));
        word = word.slice(maxChars);
      }
      if (!word) continue;
      if (line && line.length + word.length + 1 > maxChars) {
        lines.push(line);
        line = word;
      } else line += (line ? " " : "") + word;
    }
    if (line) lines.push(line);
    return lines;
  }

  function axisBounds(dataMin, dataMax, manualMin, manualMax, pad) {
    if (!finite(dataMin) || !finite(dataMax)) {
      dataMin = 0;
      dataMax = 1;
    }
    let span = dataMax - dataMin;
    if (span === 0) span = Math.abs(dataMin) * 0.1 || 1;
    const minimum = manualMin ?? dataMin - span * pad;
    const maximum = manualMax ?? dataMax + span * pad;
    if (minimum < maximum) return [minimum, maximum];
    // A one-sided manual crop can exclude every observation and still be valid.
    if (manualMin !== null && manualMax === null)
      return [minimum, minimum + span];
    if (manualMax !== null && manualMin === null)
      return [maximum - span, maximum];
    return [minimum - span / 2, maximum + span / 2];
  }

  function renderSvg(inputSeries, inputOptions = {}) {
    const options = validateOptions(inputOptions);
    const series = Array.from(inputSeries || []).map((item, index) => ({
      id: item.id ?? String(index),
      name: String(item.name ?? `Curve ${index + 1}`),
      colour: /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(item.colour || "")
        ? item.colour
        : colourForIndex(index),
      points: Array.isArray(item.points) ? item.points : [],
    }));
    let dataXMin = Infinity,
      dataXMax = -Infinity,
      dataYMin = Infinity,
      dataYMax = -Infinity,
      pointCount = 0;
    for (const item of series)
      for (const point of item.points) {
        if (!point || !finite(point.x)) continue;
        for (const value of options.showFit
          ? [point.y, point.fit]
          : [point.y]) {
          if (!finite(value)) continue;
          dataXMin = Math.min(dataXMin, point.x);
          dataXMax = Math.max(dataXMax, point.x);
          dataYMin = Math.min(dataYMin, value);
          dataYMax = Math.max(dataYMax, value);
          pointCount++;
        }
      }
    const [xMin, xMax] = axisBounds(
      dataXMin,
      dataXMax,
      options.xMin,
      options.xMax,
      dataXMin === dataXMax ? 0.5 : 0,
    );
    const [yMin, yMax] = axisBounds(
      dataYMin,
      dataYMax,
      options.yMin,
      options.yMax,
      0.07,
    );
    if (!Number.isFinite(xMax - xMin) || !Number.isFinite(yMax - yMin))
      throw new Error(
        "The plotting range is too large. Set finite, narrower axis limits.",
      );
    const font = options.fontSize;
    const lineHeight = font * 1.35;
    const titleLines = wrapText(
      options.title,
      Math.max(16, Math.floor((options.width - 48) / (font * 0.68))),
    );
    const titleHeight = titleLines.length
      ? titleLines.length * lineHeight + 14
      : 0;
    const yTicks = niceTicks(yMin, yMax);
    const yTickLabels = distinctLabels(yTicks);
    const widestY = Math.max(...yTickLabels.map((label) => label.length), 1);
    const left = Math.max(
      64,
      Math.min(
        options.width * 0.36,
        30 + font * 0.6 * widestY + (options.yLabel ? font * 1.7 : 0),
      ),
    );
    const right = 30;
    const top = 24 + titleHeight;
    const plotWidth = options.width - left - right;
    const xLabelLines = wrapText(
      options.xLabel,
      Math.max(12, Math.floor(plotWidth / (font * 0.6))),
    );
    const plotHeight = Math.max(
      120,
      options.height - top - 36 - xLabelLines.length * lineHeight - 24,
    );
    const plotBottom = top + plotHeight;
    const plotRight = left + plotWidth;
    const legendStart = plotBottom + 36 + xLabelLines.length * lineHeight + 16;
    const legendColumns = Math.max(
      1,
      Math.min(3, Math.floor((options.width - 48) / 230)),
    );
    const legendColumnWidth = (options.width - 48) / legendColumns;
    const legendLabels = series.map((item) =>
      wrapText(
        item.name || "Unnamed curve",
        Math.max(12, Math.floor((legendColumnWidth - 44) / (font * 0.62))),
      ),
    );
    const legendRows = [];
    let legendHeight = 0;
    if (options.showLegend) {
      for (let index = 0; index < series.length; index += legendColumns) {
        const row = { index, y: legendStart + legendHeight };
        const rowLines = Math.max(
          ...legendLabels
            .slice(index, index + legendColumns)
            .map((lines) => lines.length),
          1,
        );
        legendRows.push(row);
        legendHeight += rowLines * lineHeight + 12;
      }
    }
    const hasFits =
      options.showFit &&
      series.some((item) =>
        item.points.some(
          (point) => point && finite(point.x) && finite(point.fit),
        ),
      );
    const height = Math.max(
      options.height,
      legendStart +
        legendHeight +
        (hasFits && options.showLegend ? lineHeight + 14 : 0) +
        12,
    );
    const xMap = (value) => left + ((value - xMin) / (xMax - xMin)) * plotWidth;
    const yMap = (value) => top + ((yMax - value) / (yMax - yMin)) * plotHeight;
    const title = options.title || "BLI sensorgrams";
    const [xMinLabel, xMaxLabel] = distinctLabels([xMin, xMax]);
    const [yMinLabel, yMaxLabel] = distinctLabels([yMin, yMax]);
    const description = `${series.length} selected curve${series.length === 1 ? "" : "s"}. ${options.xLabel || "X"} from ${xMinLabel} to ${xMaxLabel}; ${options.yLabel || "Y"} from ${yMinLabel} to ${yMaxLabel}. ${hasFits ? "Solid lines show imported data; dotted lines show imported fits. " : ""}Missing values break the traces. No smoothing or interpolation is applied.`;
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${coordinate(options.width)}" height="${coordinate(height)}" viewBox="0 0 ${coordinate(options.width)} ${coordinate(height)}" role="img" aria-labelledby="bli-figure-title bli-figure-description">`,
      `<title id="bli-figure-title">${escapeXml(title)}</title><desc id="bli-figure-description">${escapeXml(description)}</desc>`,
      `<rect width="100%" height="100%" fill="#ffffff"/>`,
      `<defs><clipPath id="bli-plot-clip"><rect x="${coordinate(left)}" y="${coordinate(top)}" width="${coordinate(plotWidth)}" height="${coordinate(plotHeight)}"/></clipPath></defs>`,
      `<g font-family="Arial, Helvetica, sans-serif" font-size="${font}" fill="#20272d">`,
    ];
    titleLines.forEach((line, index) =>
      svg.push(
        `<text x="${coordinate(left + plotWidth / 2)}" y="${coordinate(24 + index * lineHeight)}" text-anchor="middle" font-weight="600">${escapeXml(line)}</text>`,
      ),
    );
    const xTicks = niceTicks(
      xMin,
      xMax,
      Math.max(2, Math.min(6, Math.floor(plotWidth / 100))),
    );
    const xTickLabels = distinctLabels(xTicks);
    for (const [index, value] of yTicks.entries()) {
      const y = coordinate(yMap(value));
      if (options.grid)
        svg.push(
          `<path d="M${coordinate(left)} ${y}H${coordinate(plotRight)}" stroke="#e7ebee" stroke-width="1" fill="none"/>`,
        );
      svg.push(
        `<path d="M${coordinate(left - 5)} ${y}H${coordinate(left)}" stroke="#20272d" fill="none"/><text x="${coordinate(left - 10)}" y="${y}" text-anchor="end" dominant-baseline="middle">${escapeXml(yTickLabels[index])}</text>`,
      );
    }
    for (const [index, value] of xTicks.entries()) {
      const x = coordinate(xMap(value));
      if (options.grid)
        svg.push(
          `<path d="M${x} ${coordinate(top)}V${coordinate(plotBottom)}" stroke="#e7ebee" stroke-width="1" fill="none"/>`,
        );
      svg.push(
        `<path d="M${x} ${coordinate(plotBottom)}V${coordinate(plotBottom + 5)}" stroke="#20272d" fill="none"/><text x="${x}" y="${coordinate(plotBottom + 22)}" text-anchor="middle">${escapeXml(xTickLabels[index])}</text>`,
      );
    }
    svg.push(
      `<path d="M${coordinate(left)} ${coordinate(top)}V${coordinate(plotBottom)}H${coordinate(plotRight)}" stroke="#20272d" stroke-width="1.25" fill="none"/>`,
    );
    xLabelLines.forEach((line, index) =>
      svg.push(
        `<text x="${coordinate(left + plotWidth / 2)}" y="${coordinate(plotBottom + 43 + index * lineHeight)}" text-anchor="middle">${escapeXml(line)}</text>`,
      ),
    );
    if (options.yLabel)
      svg.push(
        `<text transform="translate(18 ${coordinate(top + plotHeight / 2)}) rotate(-90)" text-anchor="middle">${escapeXml(options.yLabel)}</text>`,
      );
    svg.push('<g clip-path="url(#bli-plot-clip)">');
    if (
      options.phaseTime !== null &&
      options.phaseTime >= xMin &&
      options.phaseTime <= xMax
    )
      svg.push(
        `<path class="phase-marker" d="M${coordinate(xMap(options.phaseTime))} ${coordinate(top)}V${coordinate(plotBottom)}" stroke="#66717a" stroke-width="1" stroke-dasharray="3 4"><title>Phase boundary at ${escapeXml(numberLabel(options.phaseTime))}</title></path>`,
      );
    for (const item of series) {
      for (const kind of hasFits ? ["y", "fit"] : ["y"]) {
        let path = "",
          segmentLength = 0,
          lastPoint = null;
        const isolated = [];
        const finishSegment = () => {
          if (segmentLength === 1) isolated.push(lastPoint);
          segmentLength = 0;
          lastPoint = null;
        };
        for (const point of item.points) {
          if (!point || !finite(point.x) || !finite(point[kind])) {
            finishSegment();
            continue;
          }
          const xy = [coordinate(xMap(point.x)), coordinate(yMap(point[kind]))];
          // Coordinates outside ordinary IEEE range cannot be represented by SVG.
          if (!xy.every(Number.isFinite)) {
            finishSegment();
            continue;
          }
          path += `${segmentLength ? "L" : "M"}${xy[0]} ${xy[1]}`;
          segmentLength++;
          lastPoint = xy;
        }
        finishSegment();
        if (path)
          svg.push(
            `<path class="trace ${kind === "fit" ? "imported-fit" : "data"}" data-curve-id="${escapeXml(item.id)}" d="${path}" fill="none" stroke="${item.colour}" stroke-width="${options.lineWidth}" stroke-linecap="round" stroke-linejoin="round"${kind === "fit" ? ` stroke-dasharray="0 ${options.lineWidth * 3}"` : ""}><title>${escapeXml(item.name)}${kind === "fit" ? " — imported fit" : ""}</title></path>`,
          );
        for (const [x, y] of isolated)
          svg.push(
            `<circle class="isolated-point" cx="${x}" cy="${y}" r="${Math.max(2, options.lineWidth)}" fill="${item.colour}"><title>${escapeXml(item.name)}${kind === "fit" ? " — imported fit" : ""}</title></circle>`,
          );
      }
    }
    svg.push("</g>");
    if (!pointCount)
      svg.push(
        `<text x="${coordinate(left + plotWidth / 2)}" y="${coordinate(top + plotHeight / 2)}" text-anchor="middle" fill="#66717a">No numeric data to plot</text>`,
      );
    for (const row of legendRows) {
      for (
        let column = 0;
        column < legendColumns && row.index + column < series.length;
        column++
      ) {
        const index = row.index + column;
        const x = 24 + column * legendColumnWidth;
        const y = row.y;
        svg.push(
          `<path d="M${coordinate(x)} ${coordinate(y - font * 0.3)}h24" stroke="${series[index].colour}" stroke-width="${options.lineWidth}" fill="none"/>`,
        );
        legendLabels[index].forEach((line, lineIndex) =>
          svg.push(
            `<text x="${coordinate(x + 34)}" y="${coordinate(y + lineIndex * lineHeight)}">${escapeXml(line)}</text>`,
          ),
        );
      }
    }
    if (hasFits && options.showLegend)
      svg.push(
        `<text x="24" y="${coordinate(legendStart + legendHeight)}" fill="#53616b" font-size="${Math.max(10, font - 1)}">Solid: imported data · Dotted: imported fit</text>`,
      );
    svg.push("</g></svg>");
    return svg.join("");
  }

  root.BliFigure = Object.freeze({
    renderSvg,
    validateOptions,
    colourForIndex,
    palette: PALETTE,
    niceTicks,
    numberLabel,
  });
})(typeof window === "object" ? window : globalThis);
