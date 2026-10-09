const AccountStatement = require("./account-statement.model");
async function getAccountStatement(query) {
  return AccountStatement.findOne(query);
}
async function getAccountStatementById(id) {
  return AccountStatement.findOne({ mid: id });
}

async function getAllAccountStatement(
  filter = { isActive: true },
  projection = {}
) {
  return AccountStatement.find(filter, projection);
}
async function updateAccountStatement(mid, update) {
  return AccountStatement.findOneAndUpdate({ mid }, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });
}
module.exports = {
  AccountStatement,
  getAccountStatement,
  getAccountStatementById,
  updateAccountStatement,
  getAllAccountStatement,
};
