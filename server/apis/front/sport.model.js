const mongoose = require("mongoose");

const sportSchema = new mongoose.Schema(
  {
    eid: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    ename: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Sport", sportSchema);