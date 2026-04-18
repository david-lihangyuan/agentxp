/**
 * panel.ts — Render the onboarding result as a minimal text panel.
 *
 * Design philosophy (2026-04-17 斯文 feedback):
 *   User wants a SIMPLE feedback — just "what kind of mistake + how many times".
 *   No raw excerpts, no fabricated "lessons", no box-drawing chrome.
 *   The panel is the only user-visible onboarding surface, so it has to land
 *   in one glance.
 */

export interface PanelCluster {
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

export interface PanelInput {
  clusters: PanelCluster[];
  filesScanned: number;
  paragraphsScanned: number;
  candidates: number;
  durationMs: number;
}

function heatIcon(count: number): string {
  if (count >= 5) return '🔴';
  if (count >= 3) return '🟠';
  return '🟡';
}

export function renderPanel(input: PanelInput): string {
  const { clusters, filesScanned, paragraphsScanned, durationMs } = input;
  const count = clusters.length;

  const header = '🦞  AgentXP 已安装  —— 让你的 Agent 不再重复犯错';

  const scanLine =
    `扫描了 ${filesScanned} 个 memory 文件、${paragraphsScanned} 段文本，` +
    `用时 ${(durationMs / 1000).toFixed(2)}s。`;

  if (count === 0) {
    return [
      header,
      '',
      scanLine,
      '',
      '✅ 没有发现反复出现的错误模式。',
      '',
      '随着使用时间变长，如果 Agent 反复踩同一个坑我会识别并提醒。',
    ].join('\n');
  }

  // Minimal panel: category name + count only. No excerpts, no lessons.
  const lines = clusters.map((c, idx) => {
    const rank = String(idx + 1).padStart(2, ' ');
    return `${heatIcon(c.count)} ${rank}. ${c.title}  ·  ${c.count} 次`;
  });

  return [
    header,
    '',
    scanLine,
    '',
    `发现 ${count} 类反复出现的错误模式：`,
    '',
    ...lines,
    '',
    'Agent 启动时我会自动提醒它注意这些坑。',
  ].join('\n');
}
