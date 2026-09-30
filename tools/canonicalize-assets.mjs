import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const numberPattern = "[-+]?(?:\\d*\\.\\d+|\\d+\\.?)(?:[eE][-+]?\\d+)?";
const tokenPattern = new RegExp(`[a-zA-Z]|${numberPattern}`, "g");
const arity = { M: 2, L: 2, H: 1, V: 1, C: 6 };

function round(value) {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function isCommand(token) {
  return /^[a-zA-Z]$/.test(token);
}

export function parsePath(data) {
  const tokens = data.match(tokenPattern) ?? [];
  const residue = data.replace(tokenPattern, "").replace(/[\s,]/g, "");
  if (residue.length > 0 || tokens.length === 0) {
    throw new Error(`Unsupported SVG path syntax: ${residue || "empty path"}`);
  }

  const commands = [];
  let index = 0;
  let active = null;
  let current = { x: 0, y: 0 };
  let subpathStart = { x: 0, y: 0 };

  const takeNumbers = (count) => {
    if (index + count > tokens.length || tokens.slice(index, index + count).some(isCommand)) {
      throw new Error(`Command ${active} is missing coordinates`);
    }
    const values = tokens.slice(index, index + count).map(Number);
    index += count;
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Command ${active} contains a non-finite coordinate`);
    }
    return values;
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      active = tokens[index++];
    } else if (active === null) {
      throw new Error("SVG path must begin with a command");
    }

    const upper = active.toUpperCase();
    const relative = active !== upper;
    if (upper === "Z") {
      commands.push({ type: "Z" });
      current = { ...subpathStart };
      active = null;
      continue;
    }
    if (!(upper in arity)) {
      throw new Error(`Unsupported SVG command ${active}`);
    }

    let firstMove = upper === "M";
    while (index < tokens.length && !isCommand(tokens[index])) {
      const values = takeNumbers(arity[upper]);
      if (upper === "M" || upper === "L") {
        const point = {
          x: values[0] + (relative ? current.x : 0),
          y: values[1] + (relative ? current.y : 0),
        };
        const type = firstMove ? "M" : "L";
        commands.push({ type, values: [round(point.x), round(point.y)] });
        current = point;
        if (firstMove) subpathStart = { ...point };
        firstMove = false;
      } else if (upper === "H") {
        current = { x: values[0] + (relative ? current.x : 0), y: current.y };
        commands.push({ type: "L", values: [round(current.x), round(current.y)] });
      } else if (upper === "V") {
        current = { x: current.x, y: values[0] + (relative ? current.y : 0) };
        commands.push({ type: "L", values: [round(current.x), round(current.y)] });
      } else if (upper === "C") {
        const base = relative ? current : { x: 0, y: 0 };
        const points = [
          values[0] + base.x,
          values[1] + base.y,
          values[2] + base.x,
          values[3] + base.y,
          values[4] + base.x,
          values[5] + base.y,
        ].map(round);
        commands.push({ type: "C", values: points });
        current = { x: points[4], y: points[5] };
      }
    }

    if (upper === "M") active = relative ? "l" : "L";
  }

  return commands;
}

export function splitSubpaths(commands) {
  const subpaths = [];
  let current = null;
  for (const command of commands) {
    if (command.type === "M") {
      current = [];
      subpaths.push(current);
    }
    if (current === null) throw new Error("Canonical path must begin with M");
    current.push(command);
  }
  return subpaths;
}

function cubicAt(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return mt ** 3 * p0 + 3 * mt ** 2 * t * p1 + 3 * mt * t ** 2 * p2 + t ** 3 * p3;
}

function cubicExtrema(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 3 * p0 - 6 * p1 + 3 * p2;
  const c = -3 * p0 + 3 * p1;
  const qa = 3 * a;
  const qb = 2 * b;
  const roots = [];
  if (Math.abs(qa) < 1e-12) {
    if (Math.abs(qb) >= 1e-12) roots.push(-c / qb);
  } else {
    const discriminant = qb * qb - 4 * qa * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      roots.push((-qb + root) / (2 * qa), (-qb - root) / (2 * qa));
    }
  }
  return roots.filter((value) => value > 0 && value < 1);
}

export function boundsForCommands(commands) {
  let current = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  const xs = [];
  const ys = [];
  const include = (x, y) => {
    xs.push(x);
    ys.push(y);
  };

  for (const command of commands) {
    if (command.type === "M" || command.type === "L") {
      current = { x: command.values[0], y: command.values[1] };
      if (command.type === "M") start = { ...current };
      include(current.x, current.y);
    } else if (command.type === "C") {
      const [x1, y1, x2, y2, x3, y3] = command.values;
      const origin = { ...current };
      include(origin.x, origin.y);
      include(x3, y3);
      for (const t of cubicExtrema(origin.x, x1, x2, x3)) {
        include(cubicAt(origin.x, x1, x2, x3, t), cubicAt(origin.y, y1, y2, y3, t));
      }
      for (const t of cubicExtrema(origin.y, y1, y2, y3)) {
        include(cubicAt(origin.x, x1, x2, x3, t), cubicAt(origin.y, y1, y2, y3, t));
      }
      current = { x: x3, y: y3 };
    } else if (command.type === "Z") {
      include(start.x, start.y);
      current = { ...start };
    }
  }

  if (xs.length === 0) throw new Error("Cannot calculate bounds for an empty path");
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    minX: round(minX),
    minY: round(minY),
    maxX: round(maxX),
    maxY: round(maxY),
    width: round(maxX - minX),
    height: round(maxY - minY),
  };
}

const KAPPA = 0.5522847498307936;

function attribute(tag, name) {
  const value = tag.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1];
  return value === undefined ? undefined : value;
}

function numberAttribute(tag, name, fallback) {
  const raw = attribute(tag, name);
  if (raw === undefined) {
    if (fallback === undefined) throw new Error(`<rect> is missing ${name}`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`<rect> ${name} must be a finite number`);
  return value;
}

// Rounded rectangle as one clockwise closed contour of lines and quarter-arc
// cubics. Zero-length edges are omitted, so rx = width / 2 yields a stadium.
export function roundedRectCommands(x, y, width, height, rx, ry = rx) {
  const radiusX = Math.max(0, Math.min(rx, width / 2));
  const radiusY = Math.max(0, Math.min(ry, height / 2));
  const kx = radiusX * KAPPA;
  const ky = radiusY * KAPPA;
  const right = x + width;
  const bottom = y + height;
  const commands = [{ type: "M", values: [x + radiusX, y] }];
  const line = (px, py) => {
    const [cx, cy] = commands[commands.length - 1].values.slice(-2);
    if (Math.abs(px - cx) > 1e-9 || Math.abs(py - cy) > 1e-9) commands.push({ type: "L", values: [px, py] });
  };
  const arc = (values) => {
    if (radiusX > 0 && radiusY > 0) commands.push({ type: "C", values });
  };
  line(right - radiusX, y);
  arc([right - radiusX + kx, y, right, y + radiusY - ky, right, y + radiusY]);
  line(right, bottom - radiusY);
  arc([right, bottom - radiusY + ky, right - radiusX + kx, bottom, right - radiusX, bottom]);
  line(x + radiusX, bottom);
  arc([x + radiusX - kx, bottom, x, bottom - radiusY + ky, x, bottom - radiusY]);
  line(x, y + radiusY);
  arc([x, y + radiusY - ky, x + radiusX - kx, y, x + radiusX, y]);
  commands.push({ type: "Z" });
  return commands.map((command) => command.type === "Z" ? command : { type: command.type, values: command.values.map(round) });
}

// Reverses the direction of one closed contour of M/L/C commands.
export function reverseContour(commands) {
  const points = [];
  const segments = [];
  let current = null;
  for (const command of commands) {
    if (command.type === "M") {
      current = command.values;
      points.push(current);
    } else if (command.type === "L") {
      segments.push({ type: "L", from: current, to: command.values });
      current = command.values;
    } else if (command.type === "C") {
      segments.push({ type: "C", from: current, controls: command.values.slice(0, 4), to: command.values.slice(4) });
      current = command.values.slice(4);
    }
  }
  const start = points[0];
  const reversed = [{ type: "M", values: [...start] }];
  for (const segment of [...segments].reverse()) {
    if (segment.type === "L") reversed.push({ type: "L", values: [...segment.from] });
    else reversed.push({ type: "C", values: [segment.controls[2], segment.controls[3], segment.controls[0], segment.controls[1], ...segment.from] });
  }
  const last = reversed[reversed.length - 1].values.slice(-2);
  if (reversed.length > 1 && last[0] === start[0] && last[1] === start[1] && reversed[reversed.length - 1].type === "L") reversed.pop();
  reversed.push({ type: "Z" });
  return reversed;
}

// Converts a <rect> to canonical commands. A filled rect is one contour; a
// stroked, unfilled rect is the ring between its outer and inner offsets, with
// the inner contour reversed so nonzero filling leaves the hole open.
export function rectCommands(tag) {
  const x = numberAttribute(tag, "x", 0);
  const y = numberAttribute(tag, "y", 0);
  const width = numberAttribute(tag, "width");
  const height = numberAttribute(tag, "height");
  const rx = numberAttribute(tag, "rx", Number(attribute(tag, "ry") ?? 0));
  const ry = numberAttribute(tag, "ry", rx);
  const fill = attribute(tag, "fill");
  const stroke = attribute(tag, "stroke");
  if (stroke !== undefined && stroke !== "none" && (fill === undefined || fill === "none")) {
    const half = numberAttribute(tag, "stroke-width", 1) / 2;
    const outer = roundedRectCommands(x - half, y - half, width + half * 2, height + half * 2, rx + half, ry + half);
    const inner = roundedRectCommands(x + half, y + half, width - half * 2, height - half * 2, Math.max(0, rx - half), Math.max(0, ry - half));
    return [...outer, ...reverseContour(inner)];
  }
  return roundedRectCommands(x, y, width, height, rx, ry);
}

function extractSvg(source) {
  const viewBox = source.match(/viewBox="([^"]+)"/)?.[1]?.trim().split(/\s+/).map(Number);
  const width = Number(source.match(/<svg[^>]*\bwidth="([^"]+)"/)?.[1]);
  const height = Number(source.match(/<svg[^>]*\bheight="([^"]+)"/)?.[1]);
  const elements = [...source.matchAll(/<(path|rect)\b[^>]*>/g)].map((match) => match[0]);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    throw new Error("SVG is missing a valid viewBox");
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || elements.length === 0) {
    throw new Error("SVG is missing dimensions or path data");
  }
  const shapeSource = elements.map((tag) => tag.startsWith("<path") ? attribute(tag, "d") ?? "" : tag).join("\n");
  const commands = elements.flatMap((tag) => {
    if (tag.startsWith("<rect")) return rectCommands(tag);
    const data = attribute(tag, "d");
    if (!data) throw new Error("SVG <path> is missing d");
    return parsePath(data);
  });
  return { width, height, viewBox, shapeSource, commands };
}

export const DEFAULT_ASSET_SPECS = [
  {
    id: "addy-a",
    file: "shared/assets/addy-a.svg",
    subpathIds: ["letter-a-outer", "letter-a-counter"],
  },
  {
    id: "addy-spinner",
    file: "shared/assets/addy-spinner.svg",
    subpathIds: ["bar-inner-right", "bar-inner-left", "bar-left", "bar-right"],
  },
  {
    id: "addy-wordmark",
    file: "shared/assets/addy-wordmark.svg",
    subpathIds: [
      "letter-a-outer",
      "letter-a-counter",
      "letter-d1-outer",
      "letter-d1-counter",
      "letter-d2-outer",
      "letter-d2-counter",
      "letter-y",
    ],
  },
  {
    id: "addy-logo-ticks",
    file: "shared/assets/addy-logo-ticks.svg",
    subpathIds: ["pill-outer", "pill-inner", "tick-1", "tick-2", "tick-3", "tick-4"],
  },
  {
    id: "addy-logo-wordmark",
    file: "shared/assets/addy-logo-wordmark.svg",
    subpathIds: [
      "pill-outer",
      "pill-inner",
      "letter-a-outer",
      "letter-a-counter",
      "letter-d1-outer",
      "letter-d1-counter",
      "letter-d2-outer",
      "letter-d2-counter",
      "letter-y",
    ],
  },
];

export async function createManifest(repositoryRoot, specs = DEFAULT_ASSET_SPECS) {
  const assets = {};
  for (const spec of specs) {
    const source = await readFile(path.join(repositoryRoot, spec.file), "utf8");
    const svg = extractSvg(source);
    const commands = svg.commands;
    const subpaths = splitSubpaths(commands).map((subpath, index) => ({
      id: spec.subpathIds[index] ?? `subpath-${index}`,
      index,
      bounds: boundsForCommands(subpath),
      commands: subpath,
    }));
    assets[spec.id] = {
      file: spec.file,
      width: svg.width,
      height: svg.height,
      viewBox: svg.viewBox,
      pathSha256: createHash("sha256").update(svg.shapeSource).digest("hex"),
      bounds: boundsForCommands(commands),
      commands,
      subpaths,
    };
  }
  return {
    schemaVersion: 1,
    generatedBy: "tools/canonicalize-assets.mjs",
    sourceShape: {
      assetId: "addy-spinner",
      shapeId: "bar-left",
      subpathIndex: 2,
    },
    targetShape: {
      assetId: "addy-a",
      shapeIds: ["letter-a-outer", "letter-a-counter"],
    },
    assets,
  };
}

export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function runCanonicalizeAssets({ repositoryRoot, output = "shared/assets/manifest.json", check = false, specs = DEFAULT_ASSET_SPECS } = {}) {
  const root = repositoryRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outputPath = path.resolve(root, output);
  const serialized = serializeManifest(await createManifest(root, specs));
  if (check) {
    const existing = await readFile(outputPath, "utf8").catch(() => "");
    if (existing !== serialized) {
      throw new Error(`${output} is stale; run npm run assets:generate`);
    }
    return { changed: false, output: outputPath };
  }
  await writeFile(outputPath, serialized);
  return { changed: true, output: outputPath };
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDir, "..");
  await runCanonicalizeAssets({ repositoryRoot, check: process.argv.includes("--check") });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
