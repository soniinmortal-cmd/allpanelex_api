const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;
const sectionSchema = new mongoose.Schema(
  {
    nat: { type: String },
    sid: { type: Number },
  },
  { _id: false }
);
const BetSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "Users" },
    etid: { type: String },
    subType: { type: String }, //for casino
    subId: { type: Number }, //for casino
    selected: { type: String }, //for casino
    eType: { type: String }, //for casino
    cid: { type: Number },
    cType: { type: String },
    gameId: { type: String },
    marketId: { type: Number },
    thirdPartyMarketId: {
      type: String,
      index: true,
    },
    sectionId: { type: Number },
    uRate: { type: Number },
    oRate: { type: Number },
    amount: { type: Number },
    betType: { type: String, enum: ["back", "lay", "andar", "bahar"] },
    liveBook: {
      type: Map,
      of: [
        new mongoose.Schema(
          {
            liveBook: { type: Number },
            sid: { type: Number },
          },
          { _id: false }
        ),
      ],
      default: {},
    },
    sections: [sectionSchema],
    eventName: { type: String },
    marketName: { type: String },
    sectionName: { type: String },
    cname: { type: String },
    gType: { type: String },
    iscc: { type: Number },
    bhav: { type: Number, default: 0 }, // for casino
    profit: { type: Number, default: 0 },
    prevBal: { type: Number, default: null },
    currBal: { type: Number, default: null },
    size: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["pending", "won", "lost", "cancelled"],
      default: "pending",
    },
    isActive: { type: Boolean, default: true },
    ip: { type: String },
    browserDetails: { type: String },
    domain: { type: String },
    run: { type: Number },
    winner: { type: String },
    isDeleteBetShowUser: { type: Boolean, default: false },
    deleteBetStatus: { type: Boolean, default: false },
    updatedBy: { type: ObjectId, ref: "Users" },
    bRate: { type: Number },
    lRate: { type: Number },
    lsize: { type: Number },
    bsize: { type: Number },
    cresult: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

BetSchema.index({ userId: 1, updatedAt: -1, status: 1 });
BetSchema.index({ userId: 1, status: 1, isActive: 1 }); // Fast user pending lookup
BetSchema.index({ status: 1, isActive: 1 }); // Fast system-wide discrepancy scans
BetSchema.index({ marketId: 1 });
BetSchema.index({ gameId: 1 });
BetSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Bet", BetSchema);
