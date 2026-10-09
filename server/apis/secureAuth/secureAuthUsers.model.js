const mongoose = require("mongoose");

const SecureAuthUserSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: true,
    },

    deviceId: {
      type: String,
      required: true,
      index: true,
    },

    enabled:{
      type:Boolean,
      default:true
    },

    otp: {
      type: String,
      default: null,
    },

    expiresAt: {
      type: Date,
      default: null,
    }
  },
  {
    timestamps: true,
  }
);

/**
 * Prevent duplicate user-device pairs
 */
SecureAuthUserSchema.index(
  {
    userId: 1,
    deviceId: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model(
  "SecureAuthUsers",
  SecureAuthUserSchema
);