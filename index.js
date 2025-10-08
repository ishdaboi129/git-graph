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

// Decide commit counts per day: 5% zeros, most days 1-4, occasional spikes up to 13
const decideCounts = (dates) => {
  const counts = [];
  for (const d of dates) {
    const r = Math.random();
    if (r < 0.05) {
      counts.push(0); // 5% no commit days
      continue;
    }

    // base distribution skewed towards small numbers
    const spike = Math.random() < 0.03; // 3% chance of spike
    if (spike) {
      // spikes: 6-13
      counts.push(6 + Math.floor(Math.random() * 8));
    } else {
      // typical day: weighted towards 1-3, sometimes 4-5
      const q = Math.random();
      if (q < 0.6) counts.push(1 + Math.floor(Math.random() * 2)); // 1-2
      else if (q < 0.9) counts.push(3 + Math.floor(Math.random() * 2)); // 3-4
      else counts.push(5 + Math.floor(Math.random() * 1)); // 5
    }
  }
  return counts;
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

  const dates = generateDates();
  const counts = decideCounts(dates);
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