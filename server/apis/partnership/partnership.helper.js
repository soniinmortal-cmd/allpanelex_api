const partnershipModel = require("./partnership.model");

const APIError = require("../../helpers/APIError");
const httpStatus = require("http-status");
const mongoose = require("mongoose");

const savaPartnerShip = async (body) => {
  await partnershipModel.create(body);
};

const updatePartnershipByUserAndPartner = async (
  userId,
  partnerId,
  updateBody
) => {
  if (!userId || !partnerId)
    throw new Error("userId and partnerId are required");

  const updatedPartnership = await partnershipModel.findOneAndUpdate(
    { userId, partnerId }, // match both userId and partnership _id
    { $set: updateBody },
    { new: true } // return the updated document
  );

  if (!updatedPartnership) {
    throw new Error("Partnership not found");
  }

  return updatedPartnership;
};

const findPartnershipByUserAndPartner = async (userId, partnerId) => {
  if (!userId || !partnerId)
    throw new Error("userId and partnerId are required");

  const partnership = await partnershipModel.findOne({ userId, partnerId });

  if (!partnership) {
    throw new Error("Partnership not found");
  }

  return partnership;
};
module.exports = {
  savaPartnerShip,
  updatePartnershipByUserAndPartner,
  findPartnershipByUserAndPartner,
};
