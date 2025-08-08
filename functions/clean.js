const _ = require("lodash");
const Lambda = require("./lib/lambda");
const log = require("@dazn/lambda-powertools-logger");

let functions = [];

module.exports.handler = async () => {
  await clean();

  log.debug("all done");
};

const clean = async () => {
  if (functions.length === 0) {
    functions = await Lambda.listFunctions();
  }

  // clone the functions that are left to do so that as we iterate with it we
  // can remove cleaned functions from 'functions'
  const toClean = functions.map((x) => x);
  log.debug(`${toClean.length} functions to clean...`, {
    functions: toClean,
    count: toClean.length,
  });

  const batchSize = parseInt(process.env.BATCH_SIZE || "10");
  const delayMs = parseInt(process.env.BATCH_DELAY_MS || "1");

  // Process functions in batches to control rate limiting
  for (let i = 0; i < toClean.length; i += batchSize) {
    const batch = toClean.slice(i, i + batchSize);
    log.debug(
      `processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(toClean.length / batchSize)}`,
      {
        batchSize: batch.length,
      },
    );

    // Process batch sequentially
    for (const func of batch) {
      try {
        await cleanFunc(func);
        functions = functions.filter((item) => item !== func);
        log.debug(`cleaned function: ${func}`);
      } catch (error) {
        log.error(`failed to clean function: ${func}`, {
          error: error.message,
        });
      }
    }

    // Add delay between batches if not the last batch
    if (i + batchSize < toClean.length) {
      log.debug(`waiting ${delayMs}ms before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
};

const cleanFunc = async (funcArn) => {
  log.debug("cleaning...", { function: funcArn });

  const aliasedVersions = await Lambda.listAliasedVersions(funcArn);
  let versions = await Lambda.listVersions(funcArn);
  // 242, 241, 240, ...
  versions = _.orderBy(versions, (v) => parseInt(v), "desc");

  const versionsToKeep = parseInt(process.env.VERSIONS_TO_KEEP || "3");

  // drop the most recent N versions
  log.debug(`keeping the most recent ${versionsToKeep} versions`);
  versions = _.drop(versions, versionsToKeep);

  for (const version of versions) {
    if (!aliasedVersions.includes(version)) {
      await Lambda.deleteVersion(funcArn, version);
    }
  }
};
