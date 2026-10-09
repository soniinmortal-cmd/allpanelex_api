const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;
const CalcTableSchema = new Schema(
  {
    profitLoss: { type: Number },
    lay: { type: Number },
    back: { type: Number },
    run: { type: Number },
  },
  { _id: false }
);
const SdataSchema = new Schema(
  {
    sid: { type: String },
    profit: { type: Number },
    amount: { type: Number },
    subId: { type: String },
    calcTable: { type: [CalcTableSchema] },
  },
  { _id: false }
);

const BetSchema = new Schema(
  {
    mid: { type: Number },
    sdata: { type: [SdataSchema] },
    userId: { type: ObjectId, ref: "Users" },
  },
  { timestamps: true }
);

BetSchema.index({ userId: 1 });
BetSchema.index({ mid: 1, userId: 1 });

module.exports = mongoose.model("SportsData", BetSchema);
