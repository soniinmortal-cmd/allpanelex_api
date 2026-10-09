const mongoose = require("mongoose");

const SecureAuthDeviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      unique: true,
      required: true,
    },

    deviceName: String,

    platform: {
      type: String,
      enum: ["android", "ios", "web"],
    },

    lastSeen: Date,

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports=mongoose.model(
    "SecureAuthDevices",
    SecureAuthDeviceSchema
)