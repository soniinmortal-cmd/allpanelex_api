const mongoose = require("mongoose");

const GoogleAuthenticatorUserSchema =
  new mongoose.Schema(
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Users",
        required: true,
      },

      secret: {
        type: String,
        required: true,
      },

      enabled: {
        type: Boolean,
        default: false,
      }
    },
    {
      timestamps: true,
    }
  );

GoogleAuthenticatorUserSchema.index(
  {
    userId: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model(
  "GoogleAuthenticatorUsers",
  GoogleAuthenticatorUserSchema
);