import jsonfile from "jsonfile";
import moment from "moment";
import simpleGit from "simple-git";
import fs from "fs";

const path = "./data.json";

// Generate an array of dates from one year ago +1 day up to today inclusive
const generateDates = () => {
  const start = moment().subtract(1, "y").add(1, "d").startOf("day");
  const end = moment().startOf("day");
  const dates = [];
  let cursor = start.clone();
  while (cursor.isSameOrBefore(end)) {
    dates.push(cursor.clone().format());
    cursor.add(1, "d");
  }
  return dates;
};

// Decide commit counts per day trying to match a target total contributions.
// Approach:
// 1) Pick ~5% zero-days up-front.
// 2) Distribute the `target` number of commits across the remaining days using weighted random
//    (weights based on weekday/weekend and introduced streaks). This guarantees the exact total
//    and keeps zero-days close to the requested percentage.
const decideCounts = (dates, target = null, maxPerDay = 13, zeroPct = 0.05) => {
  const days = dates.length;
  // base probabilities
  const base = new Array(days).fill(0).map((_, i) => {
    const weekday = moment(dates[i]).isoWeekday(); // 1-7 (Mon-Sun)
    const weight = weekday <= 5 ? (0.95 + Math.random() * 0.5) : (0.5 + Math.random() * 0.5);
    return weight;
  });

  // introduce streaks
  const numStreaks = Math.max(3, Math.floor(days / 90));
  for (let s = 0; s < numStreaks; s++) {
    const start = Math.floor(Math.random() * days);
    const len = 3 + Math.floor(Math.random() * 10);
    const boost = 0.5 + Math.random();
    for (let k = 0; k < len; k++) {
      const idx = start + k;
      if (idx >= 0 && idx < days) base[idx] += boost * (1 - k / len);
    }
  }

  // pick zero-day indices
  const zeroTarget = Math.round(days * zeroPct);
  const zeroIndicesSet = new Set();
  while (zeroIndicesSet.size < zeroTarget) {
    const idx = Math.floor(Math.random() * days);
    zeroIndicesSet.add(idx);
  }

  const nonZeroIndices = [];
  for (let i = 0; i < days; i++) if (!zeroIndicesSet.has(i)) nonZeroIndices.push(i);

  // Safety: if target not provided, set a default proportional to base weights
  if (!target) target = Math.round(nonZeroIndices.length * 1.5);

  // Prepare weights for non-zero indices
  const weights = nonZeroIndices.map((i) => base[i]);

  // Initialize counts to zero
  const counts = new Array(days).fill(0);

  // Distribute `target` commits across non-zero days by weighted random selection.
  // This ensures we hit the exact target and respect maxPerDay where possible.
  let distributed = 0;
  // Copy weights so we can zero-out exhausted indices
  const w = weights.slice();
  while (distributed < target) {
    // if all weights are zero (all days at max), break
    if (w.every((val) => val === 0)) break;
    const pos = weightedRandomIndex(w);
    const idx = nonZeroIndices[pos];
    if (counts[idx] < maxPerDay) {
      counts[idx]++;
      distributed++;
    } else {
      // mark this weight as exhausted
      w[pos] = 0;
    }
  }

  // If we couldn't distribute all commits (because of caps), fall back to greedy fill
  if (distributed < target) {
    for (const idx of nonZeroIndices) {
      while (counts[idx] < maxPerDay && distributed < target) {
        counts[idx]++;
        distributed++;
      }
      if (distributed >= target) break;
    }
  }

  // Ensure zero indices are exactly zero and return
  for (const zi of zeroIndicesSet) counts[zi] = 0;
  return counts;
};

// pick an index from weights array
const weightedRandomIndex = (weights) => {
  const total = weights.reduce((a, b) => a + b, 0);
  const r = Math.random() * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r <= acc) return i;
  }
  return weights.length - 1;
};

const writeDataAndCommit = async (date, count, dryRun) => {
  // create `count` commits on the given date by repeatedly writing the file and committing
  if (dryRun) {
    console.log(`[dry-run] ${date} -> ${count} commits`);
    return;
  }

  for (let i = 0; i < count; i++) {
    const data = { date };
    await jsonfile.writeFile(path, data);
    try {
      // attach an index to the commit message to keep them unique
      await simpleGit().add([path]).commit(`${date} ${i + 1}/${count}`, { "--date": date });
    } catch (err) {
      console.error("git operation failed for date", date, err.message);
      return;
    }
  }
};

const summarize = (counts) => {
  const totalDays = counts.length;
  const totalCommits = counts.reduce((a, b) => a + b, 0);
  const zeros = counts.filter((c) => c === 0).length;
  const max = Math.max(...counts);
  const histogram = {};
  for (const c of counts) histogram[c] = (histogram[c] || 0) + 1;
  console.log(`Days: ${totalDays}, Commits total: ${totalCommits}, Zero-days: ${zeros} (${((zeros/totalDays)*100).toFixed(2)}%), Max in a day: ${max}`);
  console.log("Histogram (commits => days):", histogram);
};

const main = async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const push = args.includes("--push");

  // parse --target or --target=NUM
  let target = null;
  const targetArg = args.find((a) => a.startsWith("--target"));
  if (targetArg) {
    if (targetArg.includes("=")) {
      const v = targetArg.split("=")[1];
      target = parseInt(v, 10) || null;
    } else {
      const idx = args.indexOf("--target");
      if (idx !== -1 && args[idx + 1]) target = parseInt(args[idx + 1], 10) || null;
    }
  }

  // parse --max-per-day=NUM optionally
  let maxPerDay = 13;
  const maxArg = args.find((a) => a.startsWith("--max-per-day"));
  if (maxArg) {
    if (maxArg.includes("=")) {
      const v = maxArg.split("=")[1];
      maxPerDay = Math.max(1, parseInt(v, 10) || 13);
    } else {
      const idx = args.indexOf("--max-per-day");
      if (idx !== -1 && args[idx + 1]) maxPerDay = Math.max(1, parseInt(args[idx + 1], 10) || 13);
    }
  }

  const dates = generateDates();
  const counts = decideCounts(dates, target, maxPerDay);
  summarize(counts);

  if (dryRun) {
    // show first 10 days as sample
    console.log("Sample (first 10 days):");
    for (let i = 0; i < Math.min(10, dates.length); i++) console.log(dates[i], '->', counts[i]);
    return;
  }

  console.log(`Creating commits locally for ${dates.length} days...`);
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const count = counts[i];
    if (count === 0) continue;
    await writeDataAndCommit(date, count, dryRun);
  }

  if (push) {
    try {
      await simpleGit().push();
      console.log("pushed to remote");
    } catch (err) {
      console.error("push failed:", err.message);
    }
  } else {
    console.log("commits created locally. Run with --push to push to remote.");
  }
};

main().catch((e) => console.error(e));