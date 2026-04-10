/**
 * Run actual LLM extraction on a real transcript and evaluate quality
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseTranscript, formatTranscript, extractExperiences, validateExperiences, classifySession } from './extract.js';

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌ Set OPENAI_API_KEY environment variable');
    process.exit(1);
  }

  const sessionFile = process.argv[2] || path.join(
    process.env.HOME || '',
    '.openclaw/agents/main/sessions/cdc4289a-2f34-43bb-a110-82a2476470b9.jsonl'
  );

  // Detect agent name from path
  const pathMatch = sessionFile.match(/agents\/([^/]+)\/sessions/);
  const agentName = pathMatch?.[1] || undefined;

  console.log(`📄 Session: ${path.basename(sessionFile)}`);
  console.log(`🤖 Agent: ${agentName || 'unknown'}`);
  console.log(`📊 Size: ${fs.statSync(sessionFile).size} bytes`);

  // Step 0: Classify session
  const content = fs.readFileSync(sessionFile, 'utf-8');
  const classification = classifySession(content, agentName);
  console.log(`🏷️ Classification: ${classification.type} (${classification.reason})`);

  if (classification.type !== 'original') {
    console.log(`⏭️ Skipping — ${classification.type} sessions don't contain extractable experiences`);
    process.exit(0);
  }

  // Step 1: Parse
  const messages = parseTranscript(content);
  console.log(`📝 Parsed: ${messages.length} messages`);

  // Step 2: Format
  const transcript = formatTranscript(messages, 25000); // ~6K tokens
  console.log(`📏 Formatted: ${transcript.length} chars`);

  // Step 3: Extract
  console.log('\n🔄 Extracting experiences...');
  const result = await extractExperiences(transcript, {
    apiKey,
    model: 'gpt-4o-mini', // Cost-effective for extraction
  });

  console.log(`\n⏱️ Extraction time: ${result.extraction_time_ms}ms`);
  console.log(`📊 Model: ${result.model}`);
  if (result.token_usage) {
    console.log(`🪙 Tokens: ${result.token_usage.prompt_tokens} prompt + ${result.token_usage.completion_tokens} completion = ${result.token_usage.total_tokens} total`);
  }
  console.log(`📋 Summary: ${result.transcript_summary}`);
  console.log(`\n🎯 Extracted ${result.experiences.length} experiences:`);

  for (const [i, exp] of result.experiences.entries()) {
    console.log(`\n--- Experience ${i + 1} (confidence: ${exp.confidence}) ---`);
    console.log(`  what: ${exp.what}`);
    console.log(`  context: ${exp.context}`);
    console.log(`  tried: ${exp.tried.slice(0, 200)}...`);
    console.log(`  outcome: ${exp.outcome}`);
    console.log(`  outcome_detail: ${exp.outcome_detail.slice(0, 200)}...`);
    console.log(`  learned: ${exp.learned}`);
    console.log(`  tags: [${exp.tags.join(', ')}]`);
  }

  // Step 4: Validate
  const { valid, rejected } = validateExperiences(result.experiences);
  console.log(`\n✅ Valid: ${valid.length}, ❌ Rejected: ${rejected.length}`);
  for (const r of rejected) {
    console.log(`  ❌ "${r.experience.what}" — ${r.reason}`);
  }

  // Step 5: Save results
  const outputPath = path.join(__dirname, '..', 'results', `extraction-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n💾 Results saved to ${outputPath}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
