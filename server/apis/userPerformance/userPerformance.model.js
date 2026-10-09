const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const ButtonSchema = new Schema(
  {
    value: { type: Number, required: true },
    type: { type: String, enum: ["game", "casino"] },
    label: { type: String, required: true },
  },
  { _id: false }
);

const userPerformanceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    button: { type: [ButtonSchema], default: [] },
    domain: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserPerformance", userPerformanceSchema);
