const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const AccountStatementSchema = new Schema(
  {
    gmid: { type: Number },
    mid: { type: Number },
    amt: { type: Number },
    rem: { type: String },
    gtype: { type: String },
    edt: { type: String },
    type: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AccountStatement", AccountStatementSchema);
