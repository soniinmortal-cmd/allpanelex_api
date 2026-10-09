const mongoose = require("mongoose");

const pinSchema = new mongoose.Schema(
  {
    pin: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true, 
    collection: "pins",
  }
);

module.exports = mongoose.model("Pin", pinSchema);