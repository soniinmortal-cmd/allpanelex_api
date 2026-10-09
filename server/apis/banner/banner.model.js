const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const BannerSchema = new mongoose.Schema(
  {
    image_path: { type: String },
    mobile_image_path: { type: String },
    domain: { type: String },
    message: { type: String },
    isActive: { type: Boolean, default: true },
    type: { type: String, enum: ["welcomeBanner", "authBanner"], default: "welcomeBanner" },
    status: { type: String, enum: ["0", "1"], default: "1" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Banner", BannerSchema);
