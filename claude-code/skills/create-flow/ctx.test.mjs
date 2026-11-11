import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CTX = path.join(import.meta.dirname, 'ctx.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-test-'));

const turn = (input_tokens) => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens } } });

// Writes a transcript and runs the hook on it; returns the warning text, or '' when silent.
function ctx(sid, lines) {
  const tp = path.join(dir, `${sid}.jsonl`);
  fs.writeFileSync(tp, lines.join('\n') + '\n');
  const r = spawnSync(process.execPath, [CTX], { input: JSON.stringify({ transcript_path: tp, session_id: sid }), encoding: 'utf8' });
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
}
const sid = () => `test-${process.pid}-${Math.random().toString(36).slice(2)}`;

// ctx.mjs keeps a per-session band marker in the temp dir; remove the ones these tests made.
after(() => {
  for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(`create-flow-ctx-test-${process.pid}-`)) fs.rmSync(path.join(os.tmpdir(), f));
});

test('silent below the threshold', () => {
  assert.equal(ctx(sid(), [turn(149_999)]), '');
});

test('warns once per band past the threshold', () => {
  const s = sid();
  assert.match(ctx(s, [turn(150_000)]), /\[ctx\].*150,000 tokens/);
  assert.equal(ctx(s, [turn(170_000)]), '', 'same band');
  assert.match(ctx(s, [turn(175_000)]), /175,000/);
});

test('warns again after dropping below the threshold (e.g. /compact)', () => {
  const s = sid();
  assert.match(ctx(s, [turn(200_000)]), /200,000/);
  assert.equal(ctx(s, [turn(40_000)]), '');
  assert.match(ctx(s, [turn(150_000)]), /150,000/);
});

test('reads the newest assistant turn and skips broken lines', () => {
  const lines = [turn(160_000), '{"type":"user"}', 'not json', turn(10_000), '{broken'];
  assert.equal(ctx(sid(), lines), '');
});

test('silent without a transcript or with bad input', () => {
  const r = spawnSync(process.execPath, [CTX], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.stdout, '');
  const missing = spawnSync(process.execPath, [CTX], {
    input: JSON.stringify({ transcript_path: path.join(dir, 'nope.jsonl'), session_id: sid() }),
    encoding: 'utf8',
  });
  assert.equal(missing.stdout, '');
});
