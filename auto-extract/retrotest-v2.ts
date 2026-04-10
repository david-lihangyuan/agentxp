/**
 * Retrotest: Run v2 validation on the 3 existing extraction results
 */
import { validateExperiences } from './extract';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const resultsDir = join(__dirname, '..', 'results');
const files = readdirSync(resultsDir).filter(f => f.startsWith('extraction-'));

for (const file of files) {
  const data = JSON.parse(readFileSync(join(resultsDir, file), 'utf-8'));
  console.log(`\n=== ${file} ===`);
  console.log(`Summary: ${data.transcript_summary}`);
  console.log(`Original experiences: ${data.experiences.length}`);
  
  const { valid, rejected } = validateExperiences(data.experiences);
  console.log(`v2 valid: ${valid.length}, rejected: ${rejected.length}`);
  
  for (const r of rejected) {
    console.log(`  ❌ "${r.experience.what}" — ${r.reason}`);
  }
  for (const v of valid) {
    console.log(`  ✅ "${v.what}" (conf: ${v.confidence}, tags: ${v.tags.join(', ')})`);
  }
}
