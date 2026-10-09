const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const bookmakerCommissionSchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        "NONE",
        "ENTRY_WISE",
        "ENTRY_LOOSING",
        "NET_LOOSING",
      ],
      required: true,
    },

    percentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
  },
  { _id: false }
);

const fancyCommissionSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["NONE", "ENTRY_WISE"],
      required: true,
    },

    percentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
  },
  { _id: false }
);

const casinoCommissionSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["NONE", "ENTRY_LOOSING"],
      default: "NONE",
      required: true,
    },

    percentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
  },
  { _id: false }
);

const partnershipSchema = new mongoose.Schema(
  {
    userId: {
      type: ObjectId,
      ref: "Users",
    },

    partnerId: {
      type: ObjectId,
      ref: "Users",
    },

    commissionEnabled: {
      type: Boolean,
      default: true,
    },

    commission: {
      type: Number,
      default: 0,
    },

    downLineCommission: {
      type: Number,
      default: 0,
    },

    fancyCommission: {
      type: [fancyCommissionSchema],
      default: [],
    },

    bookmakerCommission: {
      type: [bookmakerCommissionSchema],
      default: [],
    },

    casinoCommission: {
      type: casinoCommissionSchema,
      default: {
        type: "NONE",
        percentage: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "Partnership",
  partnershipSchema
);