const Domain = require("./domain.model");


async function createOrUpdateDomain(data) {
  const { _id, ...updateData } = data;
  const filter = _id ? { _id } : { domain: updateData.domain };
  
  return Domain.findOneAndUpdate(filter, updateData, {
    new: true,
    upsert: !_id, // only upsert when creating (no _id)
  });
}

async function getAllDomains() {

  return Domain.find({ isActive: true });
}

async function deleteDomain(domainId) {
  return Domain.findByIdAndDelete(domainId);
}

async function getDomainByDomain(domain) {
  return Domain.findOne({ domain, isActive: true });
}

module.exports = {
  Domain,
  createOrUpdateDomain,
  getAllDomains,
  deleteDomain,
  getDomainByDomain,
};
