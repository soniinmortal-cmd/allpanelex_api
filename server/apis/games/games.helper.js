const Game = require("./games.model");
async function getGame(query) {
  return Game.findOne(query);
}
async function getGameById(id) {
  return Game.findById(id);
}

async function getAllGame(filter = { isActive: true }, projection = {}) {
  return Game.find(filter, projection);
}

async function getAllGameLean(filter = { isActive: true }, projection = {}) {
  return Game.find(filter, projection).lean();
}
//without all
// async function getGameByCid(etid, domain, fields = []) {
//   if (fields.length) {
//     return Game.find({ isActive: true, etid: etid, domain }).select(fields.join(" "));
//   }
//   return Game.find({ isActive: true, etid: etid, domain });
// }

async function getGameByCid(etid, domain, fields = []) {

  // ONLY for domain = "all"
  if (domain === "all") {
    const allDomains = await Game.distinct("domain");

    const filter = {
      isActive: true,
      etid: etid,
      domain: { $in: allDomains },
    };

    if (fields.length) {
      return Game.find(filter).select(fields.join(" "));
    }

    return Game.find(filter);
  }

  // OLD LOGIC - exactly same
  if (fields.length) {

    return Game.find({
      isActive: true,
      etid: etid,
      domain
    }).select(fields.join(" "));

  }

  return Game.find({
    isActive: true,
    etid: etid,
    domain
  });
}

async function getGameByCidWithoutIsActive(etid, domain, fields = []) {
  if (fields.length) {
    return Game.find({ etid: etid, domain }).select(fields.join(" "));
  }
  return Game.find({ etid: etid, domain }).lean();
}

async function getGameByGmid(gmid, domain) {
  return Game.find({ isActive: true, gmid, domain });
}
async function updateGame(id, update) {
  return Game.findByIdAndUpdate(id, update, { new: true });
}

async function updateOneGame(query, body) {
  return Game.updateOne(query, { $set: body });
}
async function getGameByGidAndType(gid, type, domain) {
  return Game.find({ isActive: true, gtype: type, domain });
}

module.exports = {
  Game,
  getGame,
  getGameById,
  getAllGame,
  getAllGameLean,
  updateGame,
  getGameByGmid,
  getGameByCid,
  getGameByGidAndType,
  updateOneGame,
  getGameByCidWithoutIsActive
};
