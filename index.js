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

const writeDataAndCommit = async (date, dryRun) => {
  const data = { date };
  if (dryRun) {
    console.log("[dry-run] would write date:", date);
    return;
  }

  await jsonfile.writeFile(path, data);
  try {
    await simpleGit().add([path]).commit(date, { "--date": date });
    console.log("committed", date);
  } catch (err) {
    console.error("git operation failed for date", date, err.message);
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const push = args.includes("--push");

  const dates = generateDates();
  console.log(`Planning ${dates.length} commits from ${dates[0]} to ${dates[dates.length-1]}`);

  for (const date of dates) {
    // write and commit each day; in dry-run just print
    await writeDataAndCommit(date, dryRun);
  }

  if (!dryRun && push) {
    try {
      await simpleGit().push();
      console.log("pushed to remote");
    } catch (err) {
      console.error("push failed:", err.message);
    }
  } else if (!dryRun && !push) {
    console.log("commits created locally. Run with --push to push to remote.");
  }
};

main().catch((e) => console.error(e));