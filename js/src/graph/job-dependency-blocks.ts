import { extractTaskNodeParentId } from "../utils/resource-key.ts";

export const JOB_BLOCK_GAP = 60;

type JobIdentity = {
  readonly id: string;
  readonly name: string;
};

type JobEdge = {
  readonly source: string;
  readonly target: string;
};

type Position = { readonly x: number; readonly y: number };
type Dimension = { readonly width: number; readonly height: number };

const compareJobs = (left: JobIdentity, right: JobIdentity): number =>
  left.name.localeCompare(right.name) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

type OrderedBlock = {
  readonly jobs: readonly JobIdentity[];
  readonly start: JobIdentity;
};

const orderJobBlocks = (
  jobs: readonly JobIdentity[],
  edges: readonly JobEdge[],
): readonly OrderedBlock[] | undefined => {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const adjacency = new Map(jobs.map((job) => [job.id, new Set<string>()]));
  const incoming = new Map(jobs.map((job) => [job.id, 0]));
  const seenPairs = new Set<string>();

  for (const edge of edges) {
    const source = extractTaskNodeParentId(edge.source);
    const target = extractTaskNodeParentId(edge.target);
    if (source === target || !jobsById.has(source) || !jobsById.has(target)) continue;
    const key = `${source}→${target}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
  }

  const remaining = new Set(jobs.map((job) => job.id));
  const components: JobIdentity[][] = [];
  while (remaining.size > 0) {
    const firstId = remaining.values().next().value;
    if (firstId === undefined) break;
    const queue = [firstId];
    const component: JobIdentity[] = [];
    remaining.delete(firstId);
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      if (id === undefined) continue;
      const job = jobsById.get(id);
      if (job !== undefined) component.push(job);
      for (const neighbor of adjacency.get(id) ?? []) {
        if (remaining.delete(neighbor)) queue.push(neighbor);
      }
    }
    components.push(component);
  }

  const ordered: OrderedBlock[] = [];
  for (const component of components) {
    const starts = component
      .filter((job) => (incoming.get(job.id) ?? 0) === 0)
      .toSorted(compareJobs);
    const start = starts[0];
    if (start === undefined) return undefined;
    ordered.push({ jobs: component, start });
  }
  return ordered.toSorted((left, right) => compareJobs(left.start, right.start));
};

/** Return the original-layout top-left corner of the first ordered dependency block. */
export const getFirstJobBlockAnchor = (
  jobs: readonly JobIdentity[],
  edges: readonly JobEdge[],
  positions: ReadonlyMap<string, Position>,
): Position | undefined => {
  const firstBlock = orderJobBlocks(jobs, edges)?.[0];
  if (firstBlock === undefined) return undefined;
  const bounds = firstBlock.jobs.flatMap((job) => {
    const position = positions.get(job.id);
    return position === undefined ? [] : [position];
  });
  if (bounds.length !== firstBlock.jobs.length) return undefined;
  return {
    x: Math.min(...bounds.map((position) => position.x)),
    y: Math.min(...bounds.map((position) => position.y)),
  };
};

/** Translate complete weakly-connected job components into ordered vertical blocks. */
export const stackJobDependencyBlocks = (
  jobs: readonly JobIdentity[],
  edges: readonly JobEdge[],
  positions: ReadonlyMap<string, Position>,
  dimensions: ReadonlyMap<string, Dimension>,
  gap = JOB_BLOCK_GAP,
): ReadonlyMap<string, Position> => {
  const ordered = orderJobBlocks(jobs, edges);
  if (ordered === undefined) return positions;
  const translated = new Map(positions);
  let nextTop = 0;
  for (const { jobs: component } of ordered) {
    const positioned = component.flatMap((job) => {
      const position = positions.get(job.id);
      const dimension = dimensions.get(job.id);
      return position === undefined || dimension === undefined
        ? []
        : [{ job, position, dimension }];
    });
    if (positioned.length !== component.length) return positions;
    const minX = Math.min(...positioned.map(({ position }) => position.x));
    const minY = Math.min(...positioned.map(({ position }) => position.y));
    const maxBottom = Math.max(
      ...positioned.map(({ position, dimension }) => position.y + dimension.height),
    );
    for (const { job, position } of positioned) {
      translated.set(job.id, { x: position.x - minX, y: position.y + nextTop - minY });
    }
    nextTop += maxBottom - minY + gap;
  }
  return translated;
};
