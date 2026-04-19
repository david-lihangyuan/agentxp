/**
 * onboarding.ts — Memory-driven onboarding for AgentXP v3.
 *
 * Core value: "Don't repeat the same mistake twice."
 *
 * Strategy (rewritten to use semantic embeddings):
 *   1. Scan all memory files (MEMORY.md + memory/*.md recursively).
 *   2. Split into paragraphs; keep paragraphs with "error signal" words.
 *   3. Embed each candidate paragraph (local gguf model, no API key required).
 *   4. Cluster by cosine similarity (threshold 0.75).
 *   5. Keep only clusters with >= 2 members — those are *repeated* mistakes.
 *   6. Extract title / pattern / lesson from each cluster.
 *   7. Store each cluster as a reflection (category='mistake') and render a panel.
 *
 * If embeddings are unavailable, fall back to the old keyword-Jaccard
 * clustering so users on minimal hosts still get *something*.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';
import type { Db } from './db.js';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import { getEmbedder, type SimpleEmbedder } from './embedding.js';
import {
  clusterByCosineSimilarity,
  representativeIndex,
  type Cluster,
} from './cluster.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface OnboardingResult {
  skipped: boolean;
  scanned: {
    files: string[];
    totalSize: number;
    durationMs: number;
  };
  candidateCount: number;
  paragraphCount: number;
  patterns: DetectedPattern[];
  fullPanel: string;
  embedderUsed: string | null;
}

export interface DetectedPattern {
  title: string;
  pattern: string;
  lesson: string;
  count: number;
  examples: Array<{
    date: string;
    excerpt: string;
    sourceFile: string;
  }>;
}

interface Paragraph {
  text: string;
  sourceFile: string;
  date: string | null;
}

// ─── Error signal detection ────────────────────────────────────────────────

// Tight error signals — only strong "I made a mistake" words.
// Generic words like 应该/问题/需要/以为 match almost any paragraph and
// were responsible for the noisy first onboarding panel. Do NOT put
// ambient vocabulary here.
const ERROR_SIGNALS = [
  // Chinese — only strong failure/retrospective words
  '失败', '错误', '踩坑', '搞错', '忘了', '没想到',
  '没检查', '没想清楚', '误判', '自嗨', '没对齐',
  '教训', '复盘', '不该', '本应', '后来才', 'bug',
  '崩溃', '超时', '修复', '回滚',
  // English — only strong words
  'failed', 'error', 'mistake', 'forgot', 'assumed',
  'should have', "didn't realize", 'overlooked',
  'lesson learned', 'retrospective', 'rollback', 'hotfix',
];

function hasErrorSignal(text: string): boolean {
  const lowered = text.toLowerCase();
  return ERROR_SIGNALS.some((sig) => lowered.includes(sig.toLowerCase()));
}

// ─── Noise filter (HTML comments, code fences, bare headers, symbol dumps) ─

function isNoise(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  // HTML comments — whole block is a comment.
  if (/^<!--[\s\S]*-->$/.test(trimmed)) return true;

  // Starts with HTML comment and nothing meaningful after it.
  if (/^<!--[\s\S]*?-->\s*$/.test(trimmed)) return true;

  // Pure code fence block.
  if (/^```[\s\S]*```$/.test(trimmed)) return true;

  // Bare markdown header with no body.
  if (/^#+\s.{0,50}$/.test(trimmed) && !trimmed.includes('\n')) return true;

  // Mostly symbols / punctuation — need at least 12 letter-or-number chars.
  // (Chinese counts per-char; 12 survives short reflections but filters symbol dumps.)
  const alphaChars = (trimmed.match(/[\p{Letter}\p{Number}]/gu) || []).length;
  if (alphaChars < 12) return true;

  // Too short to be meaningful (we already gate at 40, but keep for safety).
  if (trimmed.length < 30) return true;

  return false;
}

// ─── Descriptive-content filter (avoid "关于斯文" style noise) ────────────

const DESCRIPTIVE_HEADER_PATTERNS = [
  /^关于/, /^背景/, /^简介/, /^人物设定/, /^他是/, /^她是/,
  /^about\b/i, /^background\b/i, /^bio\b/i, /^profile\b/i,
];

function looksDescriptive(text: string): boolean {
  const firstLine = text.split('\n')[0].trim();
  if (DESCRIPTIVE_HEADER_PATTERNS.some((re) => re.test(firstLine))) return true;
  // Bullet-list profile dumps: lots of "* 名字：" "* 生日：" lines
  const colonBullets = (text.match(/^\s*[-*]\s*\S+[:：]/gm) ?? []).length;
  if (colonBullets >= 3 && text.length < 1500) return true;
  return false;
}

// ─── File discovery ────────────────────────────────────────────────────────

const SKIP_FILENAMES = new Set([
  'INDEX.md', 'README.md', 'TODO.md',
]);

// Directory and filename blacklist — skip anything that's almost certainly
// auto-generated agent output rather than human reflection.
//
// Added 2026-04-17 after a real-workspace onboarding produced 3 "repeated
// error" clusters that were all cron-agent templates (observer reports,
// log distillation, heartbeat pipeline stats). Uses prefix matching so
// `observer-reports/`, `observer-v2/`, `distilled-logs/` all get caught
// without us having to enumerate every naming variant.
const SKIP_DIR_PREFIXES = [
  'observer',       // observer-*/reports (daily agent reports, highly templated)
  'distilled',      // distilled-* log output
  'heartbeat',      // heartbeat-* state/logs
  'reflection',     // agentxp skill reflection dir
  'src-notes',      // source-code study notes (technical)
  'self-study',     // learning notes (technical)
  'archive',
  'drafts',
  'published',
  'logs',           // any logs/ dir
  'ai-daily',       // auto daily feed
  'reading-notes',  // reading notes are technical, not reflection
];
const SKIP_DIR_EXACT = new Set(['node_modules', '.git', '.openclaw']);

// File name substring blacklist.
const SKIP_FILENAME_SUBSTRINGS = [
  '-distilled',     // 2026-04-13-distilled.md
  '.distilled.',
  'observer-',
  'heartbeat-chain',
  'heartbeat-tasks',
  'heartbeat-state',
];

function isBlacklistedDir(name: string): boolean {
  const lower = name.toLowerCase();
  if (SKIP_DIR_EXACT.has(lower)) return true;
  return SKIP_DIR_PREFIXES.some((p) => lower.startsWith(p));
}

function isBlacklistedFile(filePath: string): boolean {
  const name = basename(filePath);
  if (SKIP_FILENAMES.has(name)) return true;
  const lower = name.toLowerCase();
  for (const sub of SKIP_FILENAME_SUBSTRINGS) {
    if (lower.includes(sub)) return true;
  }
  return false;
}

function discoverMemoryFiles(workspaceDir: string): string[] {
  const files: string[] = [];

  const tryAdd = (path: string) => {
    try {
      if (statSync(path).isFile()) files.push(path);
    } catch { /* skip */ }
  };

  tryAdd(join(workspaceDir, 'MEMORY.md'));

  const memDir = join(workspaceDir, 'memory');
  try {
    if (statSync(memDir).isDirectory()) {
      scanDir(memDir, files, 2);
    }
  } catch { /* no memory dir */ }

  return files.filter((f) => !isBlacklistedFile(f));
}

function scanDir(dir: string, files: string[], maxDepth: number): void {
  if (maxDepth <= 0) return;
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isFile() && entry.endsWith('.md')) {
        files.push(full);
      } else if (stat.isDirectory()) {
        // Skip blacklisted directories at any depth
        if (isBlacklistedDir(entry)) continue;
        scanDir(full, files, maxDepth - 1);
      }
    } catch { /* skip */ }
  }
}

// ─── Paragraph extraction ──────────────────────────────────────────────────

function extractDateFromFile(filePath: string, content: string): string | null {
  const m1 = filePath.match(/(\d{4}-\d{2}-\d{2})/);
  if (m1) return m1[1];
  const m2 = content.slice(0, 500).match(/(\d{4}-\d{2}-\d{2})/);
  if (m2) return m2[1];
  return null;
}

function splitParagraphs(content: string): string[] {
  // Split on blank lines; merge very short adjacent lines into same paragraph.
  const blocks = content.split(/\n\s*\n+/);
  const out: string[] = [];
  for (const raw of blocks) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out.push(trimmed);
  }
  return out;
}

/**
 * Detect in-file templated paragraphs.
 *
 * Heuristic: if a file has ≥3 paragraphs that share the same first ~6
 * characters (e.g. "观察范", "覆盖范", "4-13 "), those paragraphs are almost
 * certainly a daily-log or cron-report template and should not be treated
 * as distinct reflections.
 *
 * Why 6 and not 12: real templates often start with a Chinese label
 * ("覆盖范围：") followed by a date that changes per entry. A 12-char
 * window includes the variable date and misses the template; 6 captures
 * just the label. We also strip leading markdown noise (# > - * numbers)
 * so a bullet list of reports still groups correctly.
 */
function detectTemplatePrefixes(paragraphs: string[]): Set<string> {
  const prefixes = new Map<string, number>();
  for (const p of paragraphs) {
    const firstLine = p.split('\n')[0]
      .replace(/^[#>\-*\s0-9.)]+/, '') // strip bullet/heading/number chrome
      .trim();
    if (firstLine.length < 4) continue;
    const prefix = firstLine.slice(0, 6);
    prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
  }
  const templateSet = new Set<string>();
  for (const [prefix, count] of prefixes) {
    if (count >= 3) templateSet.add(prefix);
  }
  return templateSet;
}

function scanAllMemoryFiles(files: string[]): {
  paragraphs: Paragraph[];
  totalSize: number;
  paragraphCount: number;
  droppedTemplates: number;
} {
  const paragraphs: Paragraph[] = [];
  let totalSize = 0;
  let droppedTemplates = 0;

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    totalSize += content.length;
    const date = extractDateFromFile(filePath, content);

    const rawParas = splitParagraphs(content);
    const templates = detectTemplatePrefixes(rawParas);

    for (const para of rawParas) {
      if (para.length < 40) continue;      // too short to be meaningful
      if (para.length > 2000) continue;    // probably a giant block/code fence
      if (isNoise(para)) continue;         // HTML comments, code fences, symbol dumps

      // Drop in-file templated paragraphs (cron reports, daily log headers).
      const firstLine = para.split('\n')[0]
        .replace(/^[#>\-*\s0-9.)]+/, '')
        .trim();
      const prefix = firstLine.slice(0, 6);
      if (templates.has(prefix)) {
        droppedTemplates++;
        continue;
      }

      paragraphs.push({ text: para, sourceFile: filePath, date });
    }
  }

  return { paragraphs, totalSize, paragraphCount: paragraphs.length, droppedTemplates };
}

// ─── Title / pattern / lesson extraction ───────────────────────────────────

const STOP_WORDS = new Set([
  '这个', '一个', '可以', '就是', '但是', '所以', '因为', '需要', '时候',
  '什么', '这样', '那样', '如果', '虽然', '然后', '就算', '只是',
  'the', 'this', 'that', 'with', 'from', 'have', 'been', 'will', 'were',
  'would', 'could', 'should', 'which', 'when', 'where', 'what', 'them',
]);

function topKeywords(texts: string[], k: number): string[] {
  const freq = new Map<string, number>();
  for (const text of texts) {
    const zh = text.match(/[\u4e00-\u9fa5]{2,6}/g) ?? [];
    const en = (text.match(/\b[a-zA-Z]{3,12}\b/g) ?? []).map((w) => w.toLowerCase());
    const all = [...zh, ...en];
    for (const w of new Set(all)) {
      if (STOP_WORDS.has(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .filter(([, n]) => n >= Math.max(2, Math.ceil(texts.length / 3)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([w]) => w);
}

// Category name = top keywords joined by ·
// We deliberately do NOT use the representative paragraph's first line as
// title — that produced snippets like "1. **恢复**：读 memory/h…" which are
// raw content, not category labels. Top keywords across the cluster give
// a cleaner "what kind of mistake is this" label.
function extractTitle(cluster: Cluster<Paragraph>): string {
  const kws = topKeywords(cluster.members.map((m) => m.text), 3);
  if (kws.length >= 2) {
    return kws.slice(0, 3).join(' · ');
  }
  if (kws.length === 1) {
    return kws[0];
  }
  // Fallback — rep's first line, short-slice. Only hit when keywords are
  // too sparse (tiny cluster, all stop words). Still better than raw dump.
  const rep = cluster.members[representativeIndex(cluster)];
  const firstLine = rep.text.split('\n')
    .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
    .find((l) => l.length >= 10 && !l.startsWith('<!--') && !l.startsWith('```')) ?? '';
  return firstLine.slice(0, 16) || '未分类模式';
}

function extractPattern(cluster: Cluster<Paragraph>): string {
  const members = [...cluster.members].sort((a, b) => a.text.length - b.text.length);
  const shortest = members[0];
  const first = shortest.text.split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ').trim();
  return first.length > 160 ? first.slice(0, 160) + '…' : first;
}

const LESSON_PATTERNS = [
  /(?:教训|领悟|学到|经验)[^。\n]*[。\n]?/,
  /(?:以后|下次|未来|应该|需要|必须|记得|注意)[^。\n]{4,80}[。\n]?/,
  /(?:不能|不要|避免|防止)[^。\n]{2,60}[。\n]?/,
  /(?:lesson|learned|should|must|avoid|prevent|next time)[^.\n]{4,120}[.\n]?/i,
];

function extractLesson(cluster: Cluster<Paragraph>): string {
  for (const member of cluster.members) {
    for (const re of LESSON_PATTERNS) {
      const m = member.text.match(re);
      if (m) {
        return m[0].replace(/^[#>\-*\s]+/, '').trim().slice(0, 140);
      }
    }
  }
  return '注意这个模式，下次先停一下';
}

// ─── Excerpt builder for examples ──────────────────────────────────────────

function makeExcerpt(text: string): string {
  // First meaningful line, strip markdown decoration
  const firstLine = text.split('\n')
    .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
    .find((l) => l.length > 0) ?? text.slice(0, 100);
  return firstLine.length > 100 ? firstLine.slice(0, 100) + '…' : firstLine;
}

// ─── Fallback clustering (keyword Jaccard) ─────────────────────────────────

function fallbackCluster(paragraphs: Paragraph[]): Cluster<Paragraph>[] {
  const keywordsFor = (p: Paragraph) => {
    const zh = p.text.match(/[\u4e00-\u9fa5]{2,6}/g) ?? [];
    const en = (p.text.match(/\b[a-zA-Z]{3,12}\b/g) ?? []).map((w) => w.toLowerCase());
    return new Set([...zh, ...en].filter((w) => !STOP_WORDS.has(w)));
  };
  const withKw = paragraphs.map((p) => ({ p, kw: keywordsFor(p) }));
  const clusters: Cluster<Paragraph>[] = [];

  for (const { p, kw } of withKw) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < clusters.length; i++) {
      const sample = clusters[i].members[0];
      const sampleKw = keywordsFor(sample);
      const inter = [...kw].filter((w) => sampleKw.has(w)).length;
      const union = new Set([...kw, ...sampleKw]).size || 1;
      const score = inter / union;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0 && bestScore >= 0.3) {
      clusters[best].members.push(p);
      clusters[best].vectors.push([]);
    } else {
      clusters.push({ centroid: [], members: [p], vectors: [[]] });
    }
  }
  return clusters;
}

// ─── Main pipeline ─────────────────────────────────────────────────────────

async function detectRepeatedMistakes(
  paragraphs: Paragraph[],
  embedder: SimpleEmbedder | null,
  log: (msg: string) => void,
): Promise<{ patterns: DetectedPattern[]; candidateCount: number; used: string | null }> {
  // 1. Filter: keep paragraphs with error signals and not pure descriptive.
  const signalMatched = paragraphs.filter(
    (p) => hasErrorSignal(p.text) && !looksDescriptive(p.text),
  );

  // 2. Dedup by normalized text content (whitespace-collapsed).
  // Same sentence quoted twice in a day log should not count as two occurrences.
  const seen = new Set<string>();
  const candidates: Paragraph[] = [];
  for (const p of signalMatched) {
    const norm = p.text.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (seen.has(norm)) continue;
    seen.add(norm);
    candidates.push(p);
  }

  log(`[onboarding] ${signalMatched.length} paragraphs with error signals → ${candidates.length} after dedup (from ${paragraphs.length} total)`);

  if (candidates.length < 3) {
    return { patterns: [], candidateCount: candidates.length, used: embedder?.id ?? null };
  }

  // 2. Embed candidates.
  let clusters: Cluster<Paragraph>[];
  let used: string | null = null;

  if (embedder) {
    log(`[onboarding] embedding ${candidates.length} candidates with ${embedder.id} (${embedder.model})`);
    try {
      // Batch in small chunks to avoid memory pressure on local model.
      const BATCH = 16;
      const vectors: number[][] = [];
      for (let i = 0; i < candidates.length; i += BATCH) {
        const slice = candidates.slice(i, i + BATCH).map((p) => p.text);
        const batchVecs = await embedder.embedBatch(slice);
        vectors.push(...batchVecs);
      }
      const embedded = candidates.map((p, i) => ({ item: p, vector: vectors[i] }));
      // Threshold 0.85 — anything lower lumps unrelated material into
      // mega-clusters (observed: 996 items into one bucket at 0.75).
      clusters = clusterByCosineSimilarity(embedded, 0.85);
      used = embedder.id;
      log(`[onboarding] embedding clustering produced ${clusters.length} raw clusters`);
    } catch (err) {
      log(`[onboarding] embedding failed: ${err} — falling back to keyword clustering`);
      clusters = fallbackCluster(candidates);
    }
  } else {
    log('[onboarding] no embedder available — using keyword fallback');
    clusters = fallbackCluster(candidates);
  }

  // 3. Keep only repeated clusters (>= MIN_CLUSTER_SIZE, <= MAX_CLUSTER_SIZE).
  // MIN = 3: "2 times" is often coincidence; real repeated mistakes repeat
  //         at least 3 times (matches v2 architecture spec).
  // MAX = 80: mega-clusters indicate the similarity threshold collapsed
  //         unrelated material — reject them so we don't surface noise.
  const MIN_CLUSTER_SIZE = 3;
  const MAX_CLUSTER_SIZE = 80;
  const megaClusters = clusters.filter((c) => c.members.length > MAX_CLUSTER_SIZE);
  if (megaClusters.length > 0) {
    log(`[onboarding] WARNING: produced ${megaClusters.length} mega-cluster(s) (>${MAX_CLUSTER_SIZE} members). Threshold may be too loose — rejecting.`);
  }
  const repeated = clusters
    .filter((c) => c.members.length >= MIN_CLUSTER_SIZE && c.members.length <= MAX_CLUSTER_SIZE)
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, 10); // Top 10 categories only — panel stays compact.

  log(`[onboarding] ${repeated.length} repeated-mistake clusters (${MIN_CLUSTER_SIZE}-${MAX_CLUSTER_SIZE} members, top 10)`);

  // 4. Build DetectedPattern for each cluster.
  const patterns: DetectedPattern[] = repeated.map((cluster) => {
    const title = extractTitle(cluster);
    const pattern = extractPattern(cluster);
    const lesson = extractLesson(cluster);

    const examples = cluster.members.slice(0, 5).map((m) => ({
      date: m.date ?? 'unknown',
      excerpt: makeExcerpt(m.text),
      sourceFile: m.sourceFile,
    }));

    return {
      title,
      pattern,
      lesson,
      count: cluster.members.length,
      examples,
    };
  });

  return { patterns, candidateCount: candidates.length, used };
}

// ─── DB storage ────────────────────────────────────────────────────────────

function storePatterns(db: Db, patterns: DetectedPattern[]): void {
  const now = Date.now();
  for (const pattern of patterns) {
    try {
      (db.insertReflection as any).run(
        'onboarding',                              // session_id
        pattern.examples[0]?.sourceFile ?? null,   // source_file
        'mistake',                                 // category
        pattern.title,                             // title
        pattern.examples.map((e) => `[${e.date}] ${e.excerpt}`).join('\n'), // tried
        null,                                      // expected
        'failed',                                  // outcome
        pattern.lesson,                            // learned
        pattern.pattern,                           // why_wrong
        JSON.stringify(['repeated-mistake', `count-${pattern.count}`]), // tags
        0.8,                                       // quality_score
        0,                                         // published
        null,                                      // relay_event_id
        'private',                                 // visibility
        now,                                       // created_at
        now,                                       // updated_at
      );
    } catch {
      // skip on insert error
    }
  }
}

// ─── Panel rendering (delegated to panel.ts) ───────────────────────────────

import { renderPanel } from './panel.js';

// ─── Public entry point ────────────────────────────────────────────────────

export async function runOnboarding(
  db: Db,
  workspaceDir: string,
  api: OpenClawPluginApi,
): Promise<OnboardingResult> {
  const startTime = Date.now();
  const log = (msg: string) => {
    try { api.logger?.info?.(msg); } catch { /* ignore */ }
    // Always echo to console for visibility during development.
     
    console.log(msg);
  };

  // Guard: already done.
  const stateRow = db.getPluginState.get('onboarding_done') as { value?: string } | undefined;
  if (stateRow?.value === 'true') {
    return {
      skipped: true,
      scanned: { files: [], totalSize: 0, durationMs: 0 },
      candidateCount: 0,
      paragraphCount: 0,
      patterns: [],
      fullPanel: 'Onboarding already completed.',
      embedderUsed: null,
    };
  }

  // Discover files.
  const files = discoverMemoryFiles(workspaceDir);
  log(`[onboarding] discovered ${files.length} memory files under ${workspaceDir}`);

  if (files.length === 0) {
    (db.setPluginState as any).run('onboarding_done', 'true', Date.now());
    (db.setPluginState as any).run('install_date', String(Date.now()), Date.now());
    const emptyResult: OnboardingResult = {
      skipped: false,
      scanned: { files: [], totalSize: 0, durationMs: Date.now() - startTime },
      candidateCount: 0,
      paragraphCount: 0,
      patterns: [],
      fullPanel: renderPanel({
        clusters: [],
        filesScanned: 0,
        paragraphsScanned: 0,
        candidates: 0,
        durationMs: Date.now() - startTime,
      }),
      embedderUsed: null,
    };
    return emptyResult;
  }

  // Scan paragraphs.
  const { paragraphs, totalSize, paragraphCount, droppedTemplates } = scanAllMemoryFiles(files);
  log(`[onboarding] scanned ${paragraphCount} paragraphs (dropped ${droppedTemplates} template lines), ${(totalSize / 1024).toFixed(1)} KB`);

  // Get embedder (may return null if no provider works).
  let embedder: SimpleEmbedder | null = null;
  try {
    embedder = await getEmbedder(api);
    if (embedder) {
      log(`[onboarding] embedder ready: ${embedder.id} / ${embedder.model}`);
    } else {
      log('[onboarding] no embedder available — will use keyword fallback');
    }
  } catch (err) {
    log(`[onboarding] embedder init failed: ${err}`);
  }

  // Detect repeated mistake patterns.
  const { patterns, candidateCount, used } = await detectRepeatedMistakes(
    paragraphs, embedder, log,
  );

  // Persist clusters as reflections.
  storePatterns(db, patterns);

  // Mark onboarding done.
  (db.setPluginState as any).run('onboarding_done', 'true', Date.now());
  (db.setPluginState as any).run('install_date', String(Date.now()), Date.now());

  const durationMs = Date.now() - startTime;

  const panel = renderPanel({
    clusters: patterns.map((p) => ({
      title: p.title,
      pattern: p.pattern,
      lesson: p.lesson,
      count: p.count,
      examples: p.examples,
    })),
    filesScanned: files.length,
    paragraphsScanned: paragraphCount,
    candidates: candidateCount,
    durationMs,
  });

  log(`[onboarding] done in ${durationMs}ms — ${patterns.length} patterns stored`);
  // Emit full panel to console so we can see it during dev.
  // eslint-disable-next-line no-console
  console.log('\n' + panel + '\n');

  return {
    skipped: false,
    scanned: { files, totalSize, durationMs },
    candidateCount,
    paragraphCount,
    patterns,
    fullPanel: panel,
    embedderUsed: used,
  };
}
