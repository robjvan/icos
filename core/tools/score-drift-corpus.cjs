'use strict';
/*
 * M15e — score the labelled drift corpus with the real embedding model.
 *
 * The embedding path is unavailable under ts-jest here, so the embedding
 * curve is produced by this plain-node script (where RuVector's native
 * binding loads). The lexical curve is produced by
 * `persona-drift-corpus.spec.ts`.
 *
 * Usage (from core/):
 *   RUVECTOR_CACHE_DIR=~/.icos/models node tools/score-drift-corpus.cjs
 */
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const CORPUS = join(
  __dirname,
  '..',
  '..',
  '.reference',
  'notes',
  'm15e-statement-pairs.md',
);

const FLOORS = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5];

function loadCorpus() {
  if (!existsSync(CORPUS)) {
    throw new Error(`corpus not found: ${CORPUS}`);
  }
  const raw = readFileSync(CORPUS, 'utf8').replace(/```[\s\S]*?```/g, '');
  const pairs = [];
  for (const block of raw.split(/^###\s+/m).slice(1)) {
    const label = (block.split('\n')[0] || '').trim();
    if (label !== 'drift' && label !== 'no-drift') continue;
    const old = (/^old:\s*(.+)$/m.exec(block) || [])[1];
    const next = (/^new:\s*(.+)$/m.exec(block) || [])[1];
    if (old && next) pairs.push({ label, old: old.trim(), new: next.trim() });
  }
  return pairs;
}

function cosine(a, b) {
  let dot = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  const m = Math.sqrt(x) * Math.sqrt(y);
  return m === 0 ? 0 : dot / m;
}

function matrix(pairs, floor, score) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const pair of pairs) {
    const flagged = score(pair) >= floor;
    const want = pair.label === 'drift';
    if (want && flagged) tp++;
    else if (!want && flagged) fp++;
    else if (!want && !flagged) tn++;
    else fn++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return { floor, tp, fp, fn, tn, precision, recall, f1 };
}

(async () => {
  const pairs = loadCorpus();
  const { OnnxEmbedder } = require('ruvector');
  const embedder = new OnnxEmbedder();
  await embedder.init();

  const cache = new Map();
  const embed = async (text) => {
    if (!cache.has(text)) {
      cache.set(text, Array.from(await embedder.embedPassage(text)));
    }
    return cache.get(text);
  };
  for (const pair of pairs) {
    await embed(pair.old);
    await embed(pair.new);
  }
  const score = (pair) =>
    Math.min(
      1,
      Math.max(0, 1 - cosine(cache.get(pair.old), cache.get(pair.new))),
    );

  console.log(`embedding (1 - cosine, clamped)  n=${pairs.length}`);
  let best = null;
  for (const floor of FLOORS) {
    const m = matrix(pairs, floor, score);
    if (!best || m.f1 > best.f1) best = m;
    console.log(
      `  floor ${m.floor.toFixed(2)}  P ${m.precision.toFixed(2)}  R ${m.recall.toFixed(2)}  F1 ${m.f1.toFixed(2)}  (tp ${m.tp} fp ${m.fp} fn ${m.fn} tn ${m.tn})`,
    );
  }
  console.log(
    `best by F1: floor ${best.floor.toFixed(2)}  P ${best.precision.toFixed(2)}  R ${best.recall.toFixed(2)}  F1 ${best.f1.toFixed(2)}`,
  );

  console.log('\nper-pair at floor 0.25 (label · signal · verdict):');
  for (const pair of pairs) {
    const s = score(pair);
    console.log(
      `  ${pair.label.padEnd(9)} ${s.toFixed(3)} ${s >= 0.25 ? 'FLAG' : 'ok  '} | ${pair.old} => ${pair.new}`,
    );
  }
})();
