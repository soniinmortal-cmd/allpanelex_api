const SportsData = require("./sports-data.model");
async function getSportsData(query) {
  return SportsData.findOne(query);
}
async function getSportsDataById(id) {
  return SportsData.findOne({ mid: id });
}

async function getAllSportsData(filter = { isActive: true }, projection = {}, isPopulate = false) {
  let query = SportsData.find(filter, projection);

  if (isPopulate) {
    query = query.populate({
      path: "userId",
      select: "_id parent name username role"
    }).lean();
  }

  return query.exec();
}

async function updateSportsData(mid, userId, update, options = {}) {
  const result = await SportsData.findOneAndUpdate({ mid, userId }, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });

  if (options.autoSyncExposure) {
    const { syncUserExposureFromSportsData } = require("../../helpers/exposure-sync.helper");
    // Fire and forget, or await? Awaiting for safety as controllers are already async.
    await syncUserExposureFromSportsData(userId).catch(err => 
      console.error(`[SportsData Hook] Failed to sync userId ${userId}:`, err.message)
    );
  }

  return result;
}

async function deleteManySportsData(userId) {
  return SportsData.deleteMany({ userId: userId });
}
module.exports = {
  SportsData,
  getSportsData,
  getSportsDataById,
  updateSportsData,
  getAllSportsData,
  deleteManySportsData,
};
