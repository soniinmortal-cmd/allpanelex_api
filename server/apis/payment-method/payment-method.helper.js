const paymentMethodModel = require("./payment-method.model");

if (typeof paymentMethodModel.enableCache === "function") {
  paymentMethodModel.enableCache();
}

async function createOrUpdatePaymentMethod(data) {
  if (data._id) {
    return paymentMethodModel.findByIdAndUpdate(data._id, data, {
      new: true,
      upsert: true,
    });
  } else {
    return paymentMethodModel.create(data);
  }
}

async function getAllPaymentMethods(filter = {}) {
  return paymentMethodModel
    .find({ isActive: true, ...filter })
    .sort({ createdAt: -1 });
}

async function getPaymentMethodById(id) {
  return paymentMethodModel.findById(id);
}

async function getPaymentMethodByName(name) {
  return paymentMethodModel.findOne({ name, isActive: true });
}

async function deletePaymentMethod(id) {
  return paymentMethodModel.findByIdAndUpdate(
    id,
    { isActive: false },
    { new: true }
  );
}

module.exports = {
  paymentMethodModel,
  createOrUpdatePaymentMethod,
  getAllPaymentMethods,
  getPaymentMethodById,
  getPaymentMethodByName,
  deletePaymentMethod,
};
