const mongoose = require("mongoose");

const UserLockHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: true,
      index: true,
    },

    username: {
      type: String,
      required: true,
    },

    doneByUsername: {
      type: String,
    },

    lockType: {
      type: String,
      enum: ["userLock", "betLock"],
      required: true,
    },

    oldStatus: {
      type: Boolean,
      required: true,
    },

    newStatus: {
      type: Boolean,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "UserLockHistory",
  UserLockHistorySchema
);