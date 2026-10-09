const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;
const BlockMarketSchema = new mongoose.Schema(
  {
    gid: Number,
    gname: String,
    gtid: Number,
    gmid: Schema.Types.Mixed,
    etid: Number,
    gtype: String,
    domain: String,
    userId: { type: ObjectId, ref: "Users" },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BlockMarket", BlockMarketSchema);
