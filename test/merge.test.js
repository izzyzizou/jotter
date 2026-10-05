import assert from "node:assert/strict";
import { test } from "node:test";
import { appendNote, lcsPairs, mapCaret, merge3, unionMerge } from "../src/lib/merge.js";

test("edits in different places both survive", () => {
  assert.equal(merge3("a\nb\nc", "a\nB\nc", "a\nb\nc\nd"), "a\nB\nc\nd");
});

test("both devices append at the end", () => {
  assert.equal(merge3("a", "a\nx", "a\ny"), "a\nx\ny");
});

test("the same line edited differently keeps both versions", () => {
  assert.equal(merge3("a\nb\nc", "a\nb1\nc", "a\nb2\nc"), "a\nb1\nb2\nc");
});

test("a delete on one side and an edit elsewhere", () => {
  assert.equal(merge3("a\nb\nc\nd", "a\nc\nd", "a\nb\nc\nD"), "a\nc\nD");
});

test("delete versus modify keeps the modified line", () => {
  assert.equal(merge3("a\nb\nc", "a\nc", "a\nB\nc"), "a\nB\nc");
});

test("identical edits appear once", () => {
  assert.equal(merge3("a\nb", "a\nb\nnew", "a\nb\nnew"), "a\nb\nnew");
});

test("trailing newline is preserved", () => {
  assert.equal(merge3("a\n", "a\nb\n", "z\na\n"), "z\na\nb\n");
});

test("union merge keeps shared lines once", () => {
  assert.equal(unionMerge("x\ncommon\ny", "common\nz"), "x\ncommon\ny\nz");
  assert.equal(unionMerge("one\ntwo", "one\ntwo\nthree"), "one\ntwo\nthree");
});

test("signing in adds the browser note below the account note", () => {
  assert.equal(appendNote("acct idea\n", "\nnew idea"), "acct idea\n\nnew idea");
  assert.equal(appendNote("a\nb\nc", "b"), "a\nb\nc");
  assert.equal(appendNote("", "x"), "x");
  assert.equal(appendNote("x", "  "), "x");
});

test("the caret follows the text around a change", () => {
  assert.equal(mapCaret("hello world", "hello brave world", 3), 3);
  assert.equal(mapCaret("hello world", "hello brave world", 9), 15);
  assert.equal(mapCaret("abc", "xyzabc", 3), 6);
});

test("a large note with many separate edits merges without loss", () => {
  const base = Array.from({ length: 4000 }, (_, i) => `line ${i} ` + "x".repeat(i % 40));
  const local = base.slice();
  const remote = base.slice();
  for (let i = 10; i < 4000; i += 200) local[i] = "LOCAL " + i;
  for (let i = 110; i < 4000; i += 200) remote[i] = "REMOTE " + i;
  local.splice(500, 0, "inserted locally");
  remote.splice(2500, 1);
  const out = merge3(base.join("\n"), local.join("\n"), remote.join("\n")).split("\n");
  for (let i = 10; i < 4000; i += 200) assert.ok(out.includes("LOCAL " + i));
  for (let i = 110; i < 4000; i += 200) assert.ok(out.includes("REMOTE " + i));
  assert.ok(out.includes("inserted locally"));
  assert.ok(!out.includes(base[2500]));
  assert.equal(out.length, 4000);
});

test("LCS pairs are valid and increasing", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let trial = 0; trial < 100; trial++) {
    const n = 1 + Math.floor(rnd() * 2000);
    const a = Array.from({ length: n }, () => "w" + Math.floor(rnd() * (trial % 3 === 0 ? 20 : 100000)));
    const b = a.filter(() => rnd() > 0.05).map((x) => (rnd() < 0.05 ? x + "!" : x));
    const pairs = lcsPairs(a, b);
    pairs.forEach(([i, j], k) => {
      assert.equal(a[i], b[j]);
      if (k) assert.ok(i > pairs[k - 1][0] && j > pairs[k - 1][1]);
    });
    assert.equal(merge3(a.join("\n"), b.join("\n"), a.join("\n")), b.join("\n"));
  }
});
