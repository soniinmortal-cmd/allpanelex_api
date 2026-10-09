/**
 * GET /bet/tp-registry?type=fancy|match&gameId=&page=1&limit=10
 * Returns paginated data from ThirdPartyFancyRegistry or ThirdPartyMatchRegistry.
 * Owner only.
 */

const ThirdPartyFancyRegistry = require("../../apis/third-party-result/thirdPartyFancyRegistry.model");
const ThirdPartyMatchRegistry = require("../../apis/third-party-result/thirdPartyMatchRegistry.model");

  const getThirdPartyRegistry = async (req, res, next) => {
  try {
    const { type = "fancy", gameId, status, page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const isFancy = type !== "match";
    const Model = isFancy ? ThirdPartyFancyRegistry : ThirdPartyMatchRegistry;

    // Build filter
    const filter = {};
    if (gameId && gameId.trim().length > 0) {
      filter.gameId = gameId.trim();
    }
    // status: "all" = no filter, "declared" = resultDeclared:true, "pending" = resultDeclared:false, "failed" = registrationFailed:true
    if (status === "declared") {
      filter.resultDeclared = true;
    } else if (status === "pending") {
      filter.resultDeclared = false;
      filter.registrationFailed = { $ne: true };
    } else if (status === "failed") {
      filter.registrationFailed = true;
      filter.resultDeclared = false;
    }

    const [data, total] = await Promise.all([
      Model.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Model.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /bet/tp-registry/stats?gameId=
 * Returns pending + declared + failed counts for both fancy and match registries
 * in a single DB round-trip using $facet aggregation.
 */
const getThirdPartyRegistryStats = async (req, res, next) => {
  try {
    const { gameId } = req.query;
    const gameFilter = gameId && gameId.trim() ? { gameId: gameId.trim() } : {};

    const [fancyStats, matchStats] = await Promise.all([
      ThirdPartyFancyRegistry.aggregate([
        { $match: gameFilter },
        {
          $facet: {
            pending:  [{ $match: { resultDeclared: false, registrationFailed: { $ne: true } } }, { $count: "count" }],
            declared: [{ $match: { resultDeclared: true  } }, { $count: "count" }],
            failed:   [{ $match: { registrationFailed: true, resultDeclared: false } }, { $count: "count" }],
          },
        },
      ]),
      ThirdPartyMatchRegistry.aggregate([
        { $match: gameFilter },
        {
          $facet: {
            pending:  [{ $match: { resultDeclared: false, registrationFailed: { $ne: true } } }, { $count: "count" }],
            declared: [{ $match: { resultDeclared: true  } }, { $count: "count" }],
            failed:   [{ $match: { registrationFailed: true, resultDeclared: false } }, { $count: "count" }],
          },
        },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        fancyPending:  fancyStats[0]?.pending?.[0]?.count  ?? 0,
        fancyDeclared: fancyStats[0]?.declared?.[0]?.count ?? 0,
        fancyFailed:   fancyStats[0]?.failed?.[0]?.count   ?? 0,
        matchPending:  matchStats[0]?.pending?.[0]?.count  ?? 0,
        matchDeclared: matchStats[0]?.declared?.[0]?.count ?? 0,
        matchFailed:   matchStats[0]?.failed?.[0]?.count   ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /bet/tp-registry/retry
 * Retries registration for a failed fancy or match by clearing the failure flags.
 */
const retryThirdPartyRegistration = async (req, res, next) => {
  try {
    const { type, id } = req.body; // id is fancyKey or gameId
    if (!type || !id) {
      return res.status(400).json({ success: false, message: "Type and ID required" });
    }

    const isFancy = type === "fancy";
    const Model = isFancy ? ThirdPartyFancyRegistry : ThirdPartyMatchRegistry;
    const query = isFancy ? { fancyKey: id } : { gameId: id };

    const reg = await Model.findOne(query);
    if (!reg) {
      return res.status(404).json({ success: false, message: "Registry record not found" });
    }

    // Reset failure and declaration status so cron can re-attempt registration/polling
    reg.registrationFailed = false;
    reg.resultDeclared = false;
    reg.resultData = null;
    reg.declaredAt = null;
    await reg.save();

    console.log(`[3P-Result] Manual retry triggered for ${type}: ${id}`);

    return res.status(200).json({
      success: true,
      message: `Retry triggered for ${id}. System will re-attempt registration and polling.`,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getThirdPartyRegistry,
  getThirdPartyRegistryStats,
  retryThirdPartyRegistration,
};
