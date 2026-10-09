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

const SettingsSchema = new Schema(
  {
    category: { type: String, required: true },
    values: [ButtonSchema],
    domain: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", SettingsSchema);
