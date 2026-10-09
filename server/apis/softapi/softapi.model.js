const mongoose = require("mongoose");

const SoftApiTransactionSchema = new mongoose.Schema(
  {
    game_uid: {
      type: String,
      required: true,
    },

    game_round: {
      type: String,
      required: true
    },

    member_account: {
      type: String,
      required: true,
    },

    serial_number: {
      type: String,
      default: null,
    },

    bet_amount: {
      type: Number,
      default: 0,
    },

    win_amount: {
      type: Number,
      default: 0,
    },

    credit_amount: {
      type: Number,
      default: 0,
    },

    processed: {
      type: Boolean,
      default: false,
    },

    rawPayload: {
      type: Object,
    },
  },
  {
    timestamps: true,
  }
);

SoftApiTransactionSchema.index(
  { serial_number: 1 },
  {
    unique: true,
    partialFilterExpression: {
      serial_number: { $type: "string" },
    },
  }
);

module.exports = mongoose.model(
  "SoftApiTransaction",
  SoftApiTransactionSchema
);