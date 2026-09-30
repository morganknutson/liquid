import type { FillRule, PathCommand, Point, Transform } from "./types.js";

export interface Segment {
  readonly a: Point;
  readonly b: Point;
}

export interface PreparedPath {
  readonly segments: readonly Segment[];
}

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distanceToSegment(point: Point, segment: Segment): number {
  const vx = segment.b.x - segment.a.x;
  const vy = segment.b.y - segment.a.y;
  const wx = point.x - segment.a.x;
  const wy = point.y - segment.a.y;
  const length = vx * vx + vy * vy;
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / length));
  return Math.sqrt(dist2(point, { x: segment.a.x + vx * t, y: segment.a.y + vy * t }));
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}

export function flattenPath(commands: readonly PathCommand[], cubicSteps = 32): Segment[] {
  const segments: Segment[] = [];
  let current: Point | null = null;
  let start: Point | null = null;
  for (const command of commands) {
    if (command.type === "M") {
      current = { x: command.values[0], y: command.values[1] };
      start = current;
    } else if (command.type === "L") {
      if (!current) throw new Error("Path command L appears before M");
      const next = { x: command.values[0], y: command.values[1] };
      segments.push({ a: current, b: next });
      current = next;
    } else if (command.type === "C") {
      if (!current) throw new Error("Path command C appears before M");
      const [x1, y1, x2, y2, x3, y3] = command.values;
      let previous = current;
      for (let step = 1; step <= cubicSteps; step += 1) {
        const next = cubicPoint(current, { x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }, step / cubicSteps);
        segments.push({ a: previous, b: next });
        previous = next;
      }
      current = { x: x3, y: y3 };
    } else if (command.type === "Z" && current && start) {
      segments.push({ a: current, b: start });
      current = start;
    }
  }
  return segments;
}

function transformPoint(point: Point, transform: Transform): Point {
  return {
    x: point.x * transform.scaleX + transform.translateX,
    y: point.y * transform.scaleY + transform.translateY,
  };
}

export function transformPath(commands: readonly PathCommand[], transform: Transform): PathCommand[] {
  return commands.map((command) => {
    if (command.type === "Z") return command;
    if (command.type === "M" || command.type === "L") {
      const point = transformPoint({ x: command.values[0], y: command.values[1] }, transform);
      return { type: command.type, values: [point.x, point.y] };
    }
    const x1 = command.values[0]!;
    const y1 = command.values[1]!;
    const x2 = command.values[2]!;
    const y2 = command.values[3]!;
    const x = command.values[4]!;
    const y = command.values[5]!;
    const c1 = transformPoint({ x: x1, y: y1 }, transform);
    const c2 = transformPoint({ x: x2, y: y2 }, transform);
    const end = transformPoint({ x, y }, transform);
    return { type: "C", values: [c1.x, c1.y, c2.x, c2.y, end.x, end.y] };
  });
}

export function preparePath(commands: readonly PathCommand[], cubicSteps = 32): PreparedPath {
  return { segments: flattenPath(commands, cubicSteps) };
}

function windingForPoint(point: Point, segments: readonly Segment[]): number {
  let winding = 0;
  for (const segment of segments) {
    if (segment.a.y <= point.y) {
      if (segment.b.y > point.y && isLeft(segment.a, segment.b, point) > 0) winding += 1;
    } else if (segment.b.y <= point.y && isLeft(segment.a, segment.b, point) < 0) {
      winding -= 1;
    }
  }
  return winding;
}

function crossingCount(point: Point, segments: readonly Segment[]): number {
  let count = 0;
  for (const segment of segments) {
    const crosses = (segment.a.y > point.y) !== (segment.b.y > point.y);
    if (!crosses) continue;
    const x = segment.a.x + ((point.y - segment.a.y) * (segment.b.x - segment.a.x)) / (segment.b.y - segment.a.y);
    if (x > point.x) count += 1;
  }
  return count;
}

function isLeft(a: Point, b: Point, point: Point): number {
  return (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
}

export function signedDistanceToPreparedPath(point: Point, path: PreparedPath, fillRule: FillRule): number {
  const { segments } = path;
  if (segments.length === 0) return Number.POSITIVE_INFINITY;
  let distance = Number.POSITIVE_INFINITY;
  for (const segment of segments) distance = Math.min(distance, distanceToSegment(point, segment));
  const inside = fillRule === "evenodd"
    ? crossingCount(point, segments) % 2 === 1
    : windingForPoint(point, segments) !== 0;
  return inside ? -distance : distance;
}

export function signedDistanceToPath(point: Point, commands: readonly PathCommand[], fillRule: FillRule, cubicSteps = 32): number {
  return signedDistanceToPreparedPath(point, preparePath(commands, cubicSteps), fillRule);
}

export interface RasterMapping {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * Signed distance from every pixel center to a prepared path, where pixel (x, y)
 * samples scene point ((x + 0.5 - offsetX) / scale, (y + 0.5 - offsetY) / scale).
 *
 * Pixels within a small seed band of a segment get exact distances. Two raster
 * sweeps then propagate each pixel's nearest segment to its neighbours and
 * re-measure the exact distance to every candidate, so distances everywhere are
 * exact point-to-segment distances to the propagated nearest segment. The sign
 * comes from one scanline winding pass using the same crossing rules as
 * signedDistanceToPreparedPath. Cost is linear in pixels plus seeded segment
 * area instead of pixels times segments.
 */
const RASTER_STEP_PIXELS = 6_000;

// Nearest-segment indices are scratch state; reuse one buffer instead of
// allocating a raster-sized array per call. A raster in progress owns it until
// it finishes, so concurrent resumable rasters get their own buffer.
let sharedNearest: Int32Array | null = null;
let sharedNearestInUse = false;

function nearestScratch(count: number): Int32Array {
  if (!sharedNearestInUse) {
    if (!sharedNearest || sharedNearest.length < count) sharedNearest = new Int32Array(count);
    sharedNearestInUse = true;
    return sharedNearest.subarray(0, count).fill(-1);
  }
  return new Int32Array(count).fill(-1);
}

function releaseNearestScratch(buffer: Int32Array): void {
  if (sharedNearest && buffer.buffer === sharedNearest.buffer) sharedNearestInUse = false;
}

export function signedDistanceRaster(path: PreparedPath, fillRule: FillRule, mapping: RasterMapping): Float32Array {
  const steps = signedDistanceRasterSteps(path, fillRule, mapping);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * Resumable form of signedDistanceRaster. Each `next()` does a bounded slice of
 * work (a batch of segments or rows) so callers can spread a large raster across
 * frames; the final `next()` returns the finished raster.
 */
export function* signedDistanceRasterSteps(path: PreparedPath, fillRule: FillRule, mapping: RasterMapping): Generator<void, Float32Array, void> {
  const { width, height, scale, offsetX, offsetY } = mapping;
  const count = width * height;
  const distances = new Float32Array(count).fill(Number.POSITIVE_INFINITY);
  const nearest = nearestScratch(count);
  const inverseScale = 1 / scale;
  const segments = path.segments;
  const segmentCount = segments.length;
  // Yield roughly every RASTER_STEP_PIXELS units of work so resumable callers
  // get slices of similar cost at any raster size.
  const rowsPerStep = Math.max(1, Math.floor(RASTER_STEP_PIXELS / Math.max(1, width)));
  let seededPixels = 0;
  // Per segment: start x, start y, delta x, delta y, squared length.
  const geometry = new Float64Array(segmentCount * 5);
  segments.forEach(({ a, b }, index) => {
    geometry[index * 5] = a.x;
    geometry[index * 5 + 1] = a.y;
    geometry[index * 5 + 2] = b.x - a.x;
    geometry[index * 5 + 3] = b.y - a.y;
    geometry[index * 5 + 4] = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  });
  const sceneX = new Float64Array(width);
  for (let x = 0; x < width; x += 1) sceneX[x] = (x + 0.5 - offsetX) * inverseScale;
  const sceneY = new Float64Array(height);
  for (let y = 0; y < height; y += 1) sceneY[y] = (y + 0.5 - offsetY) * inverseScale;

  const measure = (index: number, px: number, py: number, segmentIndex: number): void => {
    const base = segmentIndex * 5;
    const wx = px - geometry[base]!;
    const wy = py - geometry[base + 1]!;
    const vx = geometry[base + 2]!;
    const vy = geometry[base + 3]!;
    const length = geometry[base + 4]!;
    let t = length === 0 ? 0 : (wx * vx + wy * vy) / length;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = wx - vx * t;
    const dy = wy - vy * t;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < distances[index]!) {
      distances[index] = distance;
      nearest[index] = segmentIndex;
    }
  };

  const seed = 1.5 * inverseScale;
  const toPixel = (value: number, offset: number) => value * scale + offset - 0.5;
  let seeded = false;
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const { a, b } = segments[segmentIndex]!;
    const x0 = Math.max(0, Math.floor(toPixel(Math.min(a.x, b.x) - seed, offsetX)));
    const x1 = Math.min(width - 1, Math.ceil(toPixel(Math.max(a.x, b.x) + seed, offsetX)));
    const y0 = Math.max(0, Math.floor(toPixel(Math.min(a.y, b.y) - seed, offsetY)));
    const y1 = Math.min(height - 1, Math.ceil(toPixel(Math.max(a.y, b.y) + seed, offsetY)));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        measure(y * width + x, sceneX[x]!, sceneY[y]!, segmentIndex);
        seeded = true;
      }
    }
    if (x0 <= x1 && y0 <= y1) seededPixels += (x1 - x0 + 1) * (y1 - y0 + 1);
    if (seededPixels >= RASTER_STEP_PIXELS) {
      seededPixels = 0;
      yield;
    }
  }
  if (!seeded && segmentCount > 0) {
    // The path lies entirely off the raster: seed the border from every segment.
    const seedPixel = (x: number, y: number) => {
      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) measure(y * width + x, sceneX[x]!, sceneY[y]!, segmentIndex);
    };
    for (let x = 0; x < width; x += 1) {
      seedPixel(x, 0);
      seedPixel(x, height - 1);
    }
    for (let y = 1; y < height - 1; y += 1) {
      seedPixel(0, y);
      seedPixel(width - 1, y);
    }
  }

  const propagate = (index: number, px: number, py: number, neighbour: number): void => {
    const candidate = nearest[neighbour]!;
    if (candidate >= 0 && candidate !== nearest[index]) measure(index, px, py, candidate);
  };
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const py = sceneY[y]!;
    for (let x = 0; x < width; x += 1) {
      const index = row + x;
      const px = sceneX[x]!;
      if (x > 0) propagate(index, px, py, index - 1);
      if (y > 0) {
        if (x > 0) propagate(index, px, py, index - width - 1);
        propagate(index, px, py, index - width);
        if (x < width - 1) propagate(index, px, py, index - width + 1);
      }
    }
    for (let x = width - 2; x >= 0; x -= 1) propagate(row + x, sceneX[x]!, py, row + x + 1);
    if (y % rowsPerStep === rowsPerStep - 1) yield;
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * width;
    const py = sceneY[y]!;
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = row + x;
      const px = sceneX[x]!;
      if (x < width - 1) propagate(index, px, py, index + 1);
      if (y < height - 1) {
        if (x < width - 1) propagate(index, px, py, index + width + 1);
        propagate(index, px, py, index + width);
        if (x > 0) propagate(index, px, py, index + width - 1);
      }
    }
    for (let x = 1; x < width; x += 1) propagate(row + x, sceneX[x]!, py, row + x - 1);
    if (y % rowsPerStep === 0) yield;
  }

  const crossingX: number[] = [];
  const crossingDirection: number[] = [];
  const order: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const py = (y + 0.5 - offsetY) * inverseScale;
    crossingX.length = 0;
    crossingDirection.length = 0;
    for (const { a, b } of path.segments) {
      const direction = a.y <= py && b.y > py ? 1 : b.y <= py && a.y > py ? -1 : 0;
      if (direction === 0) continue;
      crossingX.push(a.x + ((py - a.y) * (b.x - a.x)) / (b.y - a.y));
      crossingDirection.push(direction);
    }
    if (crossingX.length === 0) continue;
    order.length = 0;
    for (let index = 0; index < crossingX.length; index += 1) order.push(index);
    order.sort((left, right) => crossingX[left]! - crossingX[right]!);
    let winding = 0;
    let crossings = crossingX.length;
    for (const direction of crossingDirection) winding += direction;
    let next = 0;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const px = (x + 0.5 - offsetX) * inverseScale;
      while (next < order.length && crossingX[order[next]!]! <= px) {
        winding -= crossingDirection[order[next]!]!;
        crossings -= 1;
        next += 1;
      }
      const inside = fillRule === "evenodd" ? crossings % 2 === 1 : winding !== 0;
      if (inside) distances[row + x] = -distances[row + x]!;
    }
    if (y % (rowsPerStep * 2) === rowsPerStep * 2 - 1) yield;
  }
  releaseNearestScratch(nearest);
  return distances;
}
