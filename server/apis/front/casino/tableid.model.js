const mongoose = require("mongoose");

const tableIdSchema = new mongoose.Schema(
  {
    cid: Number,
    gid: Number,

    gmid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    gname: String,
    gtid: Number,
    imgpath: String,
    srno: Number,
    tabno: Number,
    isframe: Number,
    tid: Number,
  },
  {
    timestamps: true,
    collection: "tableid",
  }
);

const TableId =
  mongoose.models.TableId ||
  mongoose.model("TableId", tableIdSchema, "tableid");

module.exports = TableId;