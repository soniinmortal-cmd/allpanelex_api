const mongoose = require("mongoose");
const userAccessSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    casino: {
      type: Boolean,
      default: true,
    },

    sport: {
      type: Boolean,
      default: true,
    },

    
    commission: {
      type: Boolean,
      default: true,
    },

    interCasino: {
      type: Boolean,
      default: true,
    },
    
    sports_type: {
      type: [
        {
          type: String,
          trim: true,
          lowercase: true,
        },
      ],
      default: [],
    },

    
    
  },
  {
    timestamps: true,
    collection: "user_access",
  }
);

const UserAccess = mongoose.model(
  "UserAccess",
  userAccessSchema
);

module.exports = UserAccess;