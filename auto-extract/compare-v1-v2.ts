/**
 * Compare v1 vs v2 extraction on the same 3 sessions
 * Run: npx tsx compare-v1-v2.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseTranscript, formatTranscript, extractExperiences, validateExperiences } from './extract.js';

const SESSIONS = [
  {
    name: '数据丢失调查修复',
    file: path.join(process.env.HOME || '', '.openclaw/agents/main/sessions/cdc4289a-2f34-43bb-a110-82a2476470b9.jsonl'),
    v1_file: 'results/extraction-1775798355543.json',
  },
  {
    name: '失败经验高亮功能',
    file: path.join(process.env.HOME || '', '.openclaw/agents/main/sessions/a36e942f-cc30-4b4a-afa3-8853e6e28bba.jsonl'),
    v1_file: 'results/extraction-1775798405619.json',
  },
  {
    name: 'Harvester Docker采集',
    file: path.join(process.env.HOME || '', '.openclaw/agents/harvester/sessions/5858ddd7-5d34-4d1c-8ba1-b785bb95b46f.jsonl'),
    v1_file: 'results/extraction-1775798439514.json',
  },
];

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌ Set OPENAI_API_KEY');
    process.exit(1);
  }

  const report: string[] = ['# v1 vs v2 提取对比报告\n'];
  report.push(`日期: ${new Date().toISOString().split('T')[0]}`);
  report.push(`模型: gpt-4o-mini`);
  report.push(`v1 prompt: extract-prompt-v1.txt`);
  report.push(`v2 prompt: extract-prompt-v2.txt\n`);

  for (const session of SESSIONS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📄 ${session.name}`);
    console.log(`${'='.repeat(60)}`);

    // Load v1 result
    let v1Result: any = null;
    try {
      v1Result = JSON.parse(fs.readFileSync(path.join(__dirname, session.v1_file), 'utf-8'));
    } catch {
      console.log('⚠️ v1 result not found, skipping comparison');
    }

    // Parse and extract with v2
    const content = fs.readFileSync(session.file, 'utf-8');
    const messages = parseTranscript(content);
    const transcript = formatTranscript(messages, 25000);
    
    console.log(`📝 ${messages.length} messages, ${transcript.length} chars`);
    console.log('🔄 Extracting with v2 prompt...');

    const v2Result = await extractExperiences(transcript, {
      apiKey,
      model: 'gpt-4o-mini',
    });

    // Validate v2
    const { valid: v2Valid, rejected: v2Rejected } = validateExperiences(v2Result.experiences);

    // Validate v1 too (retroactively)
    let v1Valid: any[] = [];
    let v1Rejected: any[] = [];
    if (v1Result) {
      const v1Val = validateExperiences(v1Result.experiences);
      v1Valid = v1Val.valid;
      v1Rejected = v1Val.rejected;
    }

    // Print comparison
    console.log(`\n📊 v1: ${v1Result?.experiences?.length || 0} raw → ${v1Valid.length} valid, ${v1Rejected.length} rejected`);
    console.log(`📊 v2: ${v2Result.experiences.length} raw → ${v2Valid.length} valid, ${v2Rejected.length} rejected`);
    console.log(`🪙 v2 tokens: ${v2Result.token_usage?.total_tokens || '?'}`);

    // Report section
    report.push(`\n## ${session.name}\n`);
    report.push(`| 维度 | v1 | v2 |`);
    report.push(`|------|----|----|`);
    report.push(`| 提取数(raw) | ${v1Result?.experiences?.length || 0} | ${v2Result.experiences.length} |`);
    report.push(`| 通过验证 | ${v1Valid.length} | ${v2Valid.length} |`);
    report.push(`| 被拒绝 | ${v1Rejected.length} | ${v2Rejected.length} |`);
    report.push(`| Tokens | ${v1Result?.token_usage?.total_tokens || '?'} | ${v2Result.token_usage?.total_tokens || '?'} |`);
    report.push(`| 耗时(ms) | ${v1Result?.extraction_time_ms || '?'} | ${v2Result.extraction_time_ms} |`);

    // v1 experiences detail
    if (v1Result?.experiences?.length > 0) {
      report.push(`\n### v1 经验`);
      for (const exp of v1Result.experiences) {
        report.push(`- **${exp.what}** (confidence: ${exp.confidence})`);
        report.push(`  - tags: [${exp.tags?.join(', ')}]`);
        report.push(`  - learned: ${exp.learned?.slice(0, 200)}`);
        const isRejected = v1Rejected.find((r: any) => r.experience.what === exp.what);
        if (isRejected) {
          report.push(`  - ❌ v2验证拒绝: ${isRejected.reason}`);
        } else {
          report.push(`  - ✅ v2验证通过`);
        }
      }
    }

    // v2 experiences detail
    if (v2Result.experiences.length > 0) {
      report.push(`\n### v2 经验`);
      for (const exp of v2Result.experiences) {
        const isValid = v2Valid.find(v => v.what === exp.what);
        report.push(`- **${exp.what}** (confidence: ${exp.confidence})`);
        report.push(`  - tags: [${exp.tags.join(', ')}]`);
        report.push(`  - learned: ${exp.learned.slice(0, 200)}`);
        if (isValid) {
          report.push(`  - ✅ 验证通过`);
        } else {
          const rej = v2Rejected.find(r => r.experience.what === exp.what);
          report.push(`  - ❌ 被拒绝: ${rej?.reason || 'unknown'}`);
        }
      }
    } else {
      report.push(`\n### v2 经验`);
      report.push(`- (空数组 — 认为此 session 无值得提取的经验)`);
    }

    // v2 rejections
    if (v2Rejected.length > 0) {
      report.push(`\n### v2 拒绝详情`);
      for (const r of v2Rejected) {
        report.push(`- ❌ "${r.experience.what}" — ${r.reason}`);
      }
    }

    // Save v2 result
    const resultsDir = path.join(__dirname, 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const safeName = session.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-');
    const outputPath = path.join(resultsDir, `v2-${safeName}-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(v2Result, null, 2));
    console.log(`💾 Saved: ${path.basename(outputPath)}`);
  }

  // Write comparison report
  const reportPath = path.join(__dirname, 'results', 'v1-vs-v2-comparison.md');
  fs.writeFileSync(reportPath, report.join('\n'));
  console.log(`\n📝 Report: ${reportPath}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
