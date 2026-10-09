const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;
const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: ObjectId,
      ref: "Users",
    },
    type: {
      type: String,
      enum: ["deposit", "withdraw", "transfer", "adjustment", "correction", "reconciliation","softapi","commission","casino-commission"],
    },
    amount: { type: Number },
    balanceBefore: { type: Number },
    balanceAfter: { type: Number },
    createdBy: { type: ObjectId, ref: "Users" },
    remarks: { type: String },
    methodId: { type: Schema.Types.ObjectId, ref: "PaymentMethod" },
    utr: { type: String },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: function () {
        return this.methodId ? "pending" : "approved";
      },
    },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "Users" },
    adminRemarks: { type: String },
    transactionId: { type: String },
    
     betIds: [
        {
          type: ObjectId,
          ref: "Bet",
        },
      ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);
