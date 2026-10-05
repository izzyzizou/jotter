// Line-based text merging for syncing one note between devices.
// Every function here is pure, so it can be tested on its own.

const DP_CELLS = 1_500_000; // largest stretch solved exactly (about 3 MB)

// Longest common subsequence of two line arrays, patience style: common
// ends are trimmed, small stretches are solved exactly, and large ones are
// split at lines that appear once on each side.
// Returns matched index pairs [i, j], increasing in both i and j.
export function lcsPairs(a, b) {
  const out = [];
  matchRange(a, 0, a.length, b, 0, b.length, out, 0);
  return out;
}

function matchRange(a, a0, a1, b, b0, b1, out, depth) {
  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) {
    out.push([a0, b0]);
    a0++;
    b0++;
  }
  let tail = 0;
  while (a1 > a0 && b1 > b0 && a[a1 - 1] === b[b1 - 1]) {
    a1--;
    b1--;
    tail++;
  }
  const n = a1 - a0;
  const m = b1 - b0;
  if (n > 0 && m > 0) {
    if (n * m <= DP_CELLS) exactLcs(a, a0, a1, b, b0, b1, out);
    else if (depth < 48) {
      const anchors = uniqueAnchors(a, a0, a1, b, b0, b1);
      let pa = a0;
      let pb = b0;
      for (const [i, j] of anchors) {
        matchRange(a, pa, i, b, pb, j, out, depth + 1);
        out.push([i, j]);
        pa = i + 1;
        pb = j + 1;
      }
      if (anchors.length) matchRange(a, pa, a1, b, pb, b1, out, depth + 1);
      // No anchors in a huge stretch: it stays unmatched, and a merge then
      // keeps both versions of it rather than guessing.
    }
  }
  for (let k = 0; k < tail; k++) out.push([a1 + k, b1 + k]);
}

function exactLcs(a, a0, a1, b, b0, b1, out) {
  const n = a1 - a0;
  const m = b1 - b0;
  // Intern lines as integers so the inner loop compares numbers.
  const ids = new Map();
  const intern = (s) => {
    let id = ids.get(s);
    if (id === undefined) {
      id = ids.size;
      ids.set(s, id);
    }
    return id;
  };
  const A = new Int32Array(n);
  const B = new Int32Array(m);
  for (let i = 0; i < n; i++) A[i] = intern(a[a0 + i]);
  for (let j = 0; j < m; j++) B[j] = intern(b[b0 + j]);
  const W = m + 1;
  const dp = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    const row = i * W;
    const next = (i + 1) * W;
    for (let j = m - 1; j >= 0; j--) {
      if (A[i] === B[j]) dp[row + j] = dp[next + j + 1] + 1;
      else {
        const down = dp[next + j];
        const right = dp[row + j + 1];
        dp[row + j] = down >= right ? down : right;
      }
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push([a0 + i, b0 + j]);
      i++;
      j++;
    } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
    else j++;
  }
}

// Lines that occur exactly once on each side, paired up, reduced to the
// longest run that is increasing on both sides.
function uniqueAnchors(a, a0, a1, b, b0, b1) {
  const seen = new Map(); // line -> [countA, indexA, countB, indexB]
  for (let i = a0; i < a1; i++) {
    const e = seen.get(a[i]);
    if (e) e[0]++;
    else seen.set(a[i], [1, i, 0, -1]);
  }
  for (let j = b0; j < b1; j++) {
    const e = seen.get(b[j]);
    if (e) {
      e[2]++;
      e[3] = j;
    }
  }
  const cands = [];
  for (let i = a0; i < a1; i++) {
    const e = seen.get(a[i]);
    if (e[0] === 1 && e[2] === 1) cands.push([i, e[3]]);
  }
  // Longest increasing subsequence on the b index (patience sorting).
  const tails = [];
  const prev = new Int32Array(cands.length);
  for (let c = 0; c < cands.length; c++) {
    const j = cands[c][1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cands[tails[mid]][1] < j) lo = mid + 1;
      else hi = mid;
    }
    prev[c] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = c;
  }
  const result = [];
  for (let c = tails.length ? tails[tails.length - 1] : -1; c >= 0; c = prev[c]) result.push(cands[c]);
  return result.reverse();
}

function sameLines(x, y) {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

// Three-way merge: changes made on either side since `base` are kept.
// Where both sides changed the same stretch differently, both versions
// are kept (local first), so nothing typed on either device is lost.
export function merge3(base, local, remote) {
  if (local === remote) return local;
  if (local === base) return remote;
  if (remote === base) return local;
  const B = base.split("\n");
  const L = local.split("\n");
  const R = remote.split("\n");
  const toL = new Int32Array(B.length).fill(-1);
  const toR = new Int32Array(B.length).fill(-1);
  for (const [i, j] of lcsPairs(B, L)) toL[i] = j;
  for (const [i, k] of lcsPairs(B, R)) toR[i] = k;

  const out = [];
  let i = 0;
  let j = 0;
  let k = 0;
  for (;;) {
    // Next base line that both sides kept: a stable point.
    let t = i;
    while (t < B.length && !(toL[t] >= 0 && toR[t] >= 0)) t++;
    const lEnd = t < B.length ? toL[t] : L.length;
    const rEnd = t < B.length ? toR[t] : R.length;
    const b = B.slice(i, t);
    const l = L.slice(j, lEnd);
    const r = R.slice(k, rEnd);
    const lChanged = !sameLines(l, b);
    const rChanged = !sameLines(r, b);
    if (lChanged && rChanged) {
      if (sameLines(l, r)) out.push(...l);
      else out.push(...l, ...r);
    } else if (lChanged) out.push(...l);
    else if (rChanged) out.push(...r);
    else out.push(...b);
    if (t >= B.length) break;
    out.push(B[t]);
    i = t + 1;
    j = lEnd + 1;
    k = rEnd + 1;
  }
  return out.join("\n");
}

// Merge two versions with no known common ancestor: lines both share
// appear once, everything else from either side is kept.
export function unionMerge(local, remote) {
  if (local === remote) return local;
  if (!local.trim()) return remote;
  if (!remote.trim()) return local;
  if (local.includes(remote)) return local;
  if (remote.includes(local)) return remote;
  const L = local.split("\n");
  const R = remote.split("\n");
  const common = lcsPairs(L, R)
    .map(([i]) => L[i])
    .join("\n");
  return merge3(common, local, remote);
}

// Signing in from this browser's note: the browser note is added below
// what is already in the account, unless one already contains the other.
export function appendNote(accountText, browserText) {
  const a = accountText;
  const b = browserText;
  if (!b.trim()) return a;
  if (!a.trim()) return b;
  if (a.includes(b.trim())) return a;
  if (b.includes(a.trim())) return b;
  return a.replace(/\s+$/, "") + "\n\n" + b.replace(/^\s+/, "");
}

// Where a caret at `pos` in `before` should land in `after`.
export function mapCaret(before, after, pos) {
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before.charCodeAt(p) === after.charCodeAt(p)) p++;
  if (pos <= p) return pos;
  let s = 0;
  while (
    s < before.length - p &&
    s < after.length - p &&
    before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)
  )
    s++;
  if (pos >= before.length - s) return pos + (after.length - before.length);
  return Math.min(pos, after.length);
}
