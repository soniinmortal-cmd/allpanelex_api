const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const paymentMethodSchema = new Schema(
  {
    type: { type: String, enum: ["UPI", "IMPS","CRYPTO"] },
    title: { type: String },
    description: { type: String },
    upiId: {
      type: String,
    },
    bankName: {
      type: String,
    },
    accountHolder: {
      type: String,
    },
    accountNumber: {
      type: String,
    },
    ifscCode: {
      type: String,
    },
    upiLimitPerDay: {
      type: Number,
    },
    minAmount: { type: Number },
    maxAmount: { type: Number },
    instructions: { type: String },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Users" },
    walletAddress: {
      type: String,
    },
    network: {
      type: String,
    },
    image: {
      type: String,
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentMethod", paymentMethodSchema);
