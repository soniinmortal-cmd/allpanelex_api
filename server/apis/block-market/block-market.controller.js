const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const {
  BlockMarket,
  getBlockMarketByUserId,
  getBlockMarket,
} = require("./block-market.helper");
const { delCache, delCacheByPattern } = require("../../helpers/cache");
const { collectAllIds } = require("../bet/bet.helper");

const create = async (req, res, next) => {
  try {
    const childIds = await collectAllIds(req?.user);
    const matchesData = Array.isArray(req.body) ? req.body : [req.body];

    // Build one bulkWrite upsert operation per (userId × game) combination
    // This replaces nested sequential findOne+save loops (N×M round-trips → 1 round-trip)
    const bulkOps = [];
    for (const userId of childIds) {
      for (const data of matchesData) {
        bulkOps.push({
          updateOne: {
            filter: { gmid: data.gmid, domain: data.domain, userId },
            update: {
              $set: {
                gmid: data.gmid,
                gname: data.gname,
                gid: data.gid,
                gtid: data.gtid,
                etid: data.etid,
                gtype: data.gtype,
                domain: data.domain,
                userId,
                isActive: data.isActive !== undefined ? data.isActive : true,
              },
            },
            upsert: true,
          },
        });
      }
    }

    if (bulkOps.length > 0) {
      await BlockMarket.bulkWrite(bulkOps, { ordered: false });
    }

    // Invalidate caches in parallel
    const gameData = matchesData?.[0];
    const cacheOps = [];
    if (gameData?.domain && gameData?.gid) {
      cacheOps.push(delCacheByPattern(`tablelist:${gameData.gid}-${gameData.domain}-*`));
    } else if (gameData?.domain && gameData?.etid) {
      cacheOps.push(delCacheByPattern(`highlighthomePrivate:${req?.domainConfig?.domain}-${gameData.etid}-*`));
    }
    if (cacheOps.length) await Promise.all(cacheOps);

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          { matched: bulkOps.length, childCount: childIds.length },
          "Bulk create/update complete",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(new APIError(e.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};
const getBlockMarketById = async (req, res, next) => {
  try {
    const userId = req?.user?._id;
    const domain = req.domainConfig.domain;

    const matches = await getBlockMarketByUserId(userId, domain);
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          matches,
          "Block Market under this userId",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(new APIError(err.message, httpStatus.INTERNAL_SERVER_ERROR));
  }
};
module.exports = {
  create,
  getBlockMarketById,
};
