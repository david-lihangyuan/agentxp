/**
 * cluster.ts — Semantic clustering via cosine similarity on embedding vectors.
 *
 * Uses a simple single-link greedy clustering:
 *   - for each candidate, compare to the centroid of each existing cluster
 *   - if max similarity >= threshold, join that cluster
 *   - else start a new cluster
 *
 * Centroids are recomputed as the running mean of member vectors. Cheap and
 * good enough for a few hundred paragraphs.
 */

export interface Embedded<T> {
  item: T;
  vector: number[];
}

export interface Cluster<T> {
  centroid: number[];
  members: T[];
  vectors: number[][];
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function addInPlace(target: number[], src: number[]): void {
  const n = Math.min(target.length, src.length);
  for (let i = 0; i < n; i++) target[i] += src[i] ?? 0;
}

function scaleInPlace(target: number[], factor: number): void {
  for (let i = 0; i < target.length; i++) target[i] *= factor;
}

function recomputeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) addInPlace(sum, v);
  scaleInPlace(sum, 1 / vectors.length);
  return sum;
}

export function clusterByCosineSimilarity<T>(
  embedded: Embedded<T>[],
  threshold = 0.75,
): Cluster<T>[] {
  const clusters: Cluster<T>[] = [];

  for (const { item, vector } of embedded) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < clusters.length; i++) {
      const score = cosine(clusters[i].centroid, vector);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore >= threshold) {
      const c = clusters[bestIdx];
      c.members.push(item);
      c.vectors.push(vector);
      c.centroid = recomputeCentroid(c.vectors);
    } else {
      clusters.push({
        centroid: [...vector],
        members: [item],
        vectors: [vector],
      });
    }
  }

  return clusters;
}

/**
 * Pick the member whose vector is closest to the centroid — the most
 * "representative" item for the cluster.
 */
export function representativeIndex<T>(cluster: Cluster<T>): number {
  if (cluster.members.length === 0) return -1;
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < cluster.vectors.length; i++) {
    const score = cosine(cluster.centroid, cluster.vectors[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}
