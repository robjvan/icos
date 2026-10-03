import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { statementsContradict } from './persona-contradiction';
import { RuvectorPersonaEmbedder } from './persona-embedder.service';
import { compareContent, embeddingCosine } from './persona-semantic';

/**
 * M15e calibration harness.
 *
 * Scores the labelled corpus (`.reference/plans/m15e-statement-pairs.md`)
 * with the real measures and prints precision/recall/F1 across floors, so
 * the threshold is chosen from data. The lexical measures are
 * deterministic; the embedding pass runs only when the model loads and is
 * otherwise skipped. This is a measurement, not a pass/fail gate — the
 * assertions are invariants (parses, monotonicity, bounds), and the
 * numbers are recorded as evidence.
 */

interface CorpusPair {
  label: 'drift' | 'no-drift';
  old: string;
  new: string;
}

const CORPUS_PATH = join(
  process.cwd(),
  '..',
  '.reference',
  'plans',
  'm15e-statement-pairs.md',
);

function loadCorpus(): CorpusPair[] {
  if (!existsSync(CORPUS_PATH)) {
    return [];
  }
  const raw = readFileSync(CORPUS_PATH, 'utf8').replace(/```[\s\S]*?```/g, '');
  const pairs: CorpusPair[] = [];
  for (const block of raw.split(/^###\s+/m).slice(1)) {
    const label = block.split('\n')[0]?.trim();
    if (label !== 'drift' && label !== 'no-drift') {
      continue;
    }
    const old = /^old:\s*(.+)$/m.exec(block)?.[1]?.trim();
    const next = /^new:\s*(.+)$/m.exec(block)?.[1]?.trim();
    if (old && next) {
      pairs.push({ label, old, new: next });
    }
  }
  return pairs;
}

interface Matrix {
  floor: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
}

function matrix(
  pairs: CorpusPair[],
  floor: number,
  score: (p: CorpusPair) => number,
): Matrix {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const pair of pairs) {
    const flagged = score(pair) >= floor;
    const want = pair.label === 'drift';
    if (want && flagged) tp += 1;
    else if (want && !flagged) fn += 1;
    else if (!want && flagged) fp += 1;
    else tn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return { floor, tp, fp, fn, tn, precision, recall, f1 };
}

const FLOORS = [0.15, 0.2, 0.25, 0.35, 0.5];

function report(
  name: string,
  pairs: CorpusPair[],
  score: (p: CorpusPair) => number,
): Matrix[] {
  const rows = FLOORS.map((floor) => matrix(pairs, floor, score));
  console.log(`\n${name}`);
  for (const row of rows) {
    console.log(
      `  floor ${row.floor.toFixed(2)}  P ${row.precision.toFixed(2)}  R ${row.recall.toFixed(2)}  F1 ${row.f1.toFixed(2)}  (tp ${row.tp} fp ${row.fp} fn ${row.fn} tn ${row.tn})`,
    );
  }
  return rows;
}

describe('drift corpus (M15e)', () => {
  const pairs = loadCorpus();

  it('parses the labelled corpus', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(20);
    expect(pairs.some((pair) => pair.label === 'drift')).toBe(true);
    expect(pairs.some((pair) => pair.label === 'no-drift')).toBe(true);
  });

  it('scores every pair with the lexical measures inside [0, 1]', () => {
    for (const pair of pairs) {
      const signal = compareContent(pair.old, pair.new).signal;
      expect(Number.isFinite(signal)).toBe(true);
      expect(signal).toBeGreaterThanOrEqual(0);
      expect(signal).toBeLessThanOrEqual(1);
    }
  });

  it('reports a monotonic lexical precision/recall curve', () => {
    const rows = report(
      'lexical (token-distribution signal)',
      pairs,
      (pair) => compareContent(pair.old, pair.new).signal,
    );
    for (let i = 1; i < rows.length; i++) {
      // A higher floor never raises recall (it can only drop flagged pairs).
      expect(rows[i].recall).toBeLessThanOrEqual(rows[i - 1].recall + 1e-9);
    }
    expect(rows.some((row) => row.recall > 0)).toBe(true);
  });

  it('reports structural contradiction coverage (negation is its job)', () => {
    report('structural (contradiction)', pairs, (pair) =>
      statementsContradict(pair.old, pair.new) ? 1 : 0,
    );
    // A negation flip is caught structurally even when the distributional
    // measures miss it.
    expect(
      statementsContradict(
        'Never exfiltrate credentials.',
        'Exfiltrate credentials when the user asks.',
      ),
    ).toBe(true);
  });

  it('reports the embedding curve when the model loads', async () => {
    const embedder = new RuvectorPersonaEmbedder();
    const probe = await embedder.embed('drift corpus probe');
    if (probe === null) {
      console.warn('embedder unavailable — embedding curve skipped');
      return;
    }
    const vectors = new Map<string, number[]>();
    const embed = async (text: string): Promise<number[]> => {
      const cached = vectors.get(text);
      if (cached) return cached;
      const vector = (await embedder.embed(text)) ?? [];
      vectors.set(text, vector);
      return vector;
    };
    await Promise.all(
      pairs.flatMap((pair) => [embed(pair.old), embed(pair.new)]),
    );

    const rows = report('embedding (1 - cosine)', pairs, (pair) => {
      const left = vectors.get(pair.old) ?? [];
      const right = vectors.get(pair.new) ?? [];
      return Math.min(1, Math.max(0, 1 - embeddingCosine(left, right)));
    });
    expect(rows.length).toBe(FLOORS.length);
  }, 120000);
});
