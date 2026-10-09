const BlockMarket = require("./block-market.model");
async function getBlockMarket(query) {
  return BlockMarket.findOne(query);
}
async function getBlockMarketById(id) {
  return BlockMarket.findById(id);
}

async function getAllBlockMarket(filter = { isActive: true }, projection = {}) {
  return BlockMarket.find(filter, projection);
}
async function getBlockMarketByCid(etid, domain) {
  return BlockMarket.find({ isActive: true, etid: etid, domain });
}
async function getBlockMarketByUserId(userId, domain) {
  return BlockMarket.find({ isActive: true, userId, domain });
}
async function updateBlockMarket(id, update) {
  return BlockMarket.findByIdAndUpdate(id, update, { new: true });
}

async function getBlockMarketByGidAndType(gid, type, domain) {
  return BlockMarket.find({ isActive: true, gtype: type, domain });
}
module.exports = {
  BlockMarket,
  getBlockMarket,
  getBlockMarketById,
  getAllBlockMarket,
  updateBlockMarket,
  getBlockMarketByUserId,
  getBlockMarketByCid,
  getBlockMarketByGidAndType,
};
