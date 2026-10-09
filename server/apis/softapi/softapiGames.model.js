const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    brandId: String,

    brandTitle: String,

    gameId: {
      type: String,
      index: true,
    },

    gameUid: {
      type: String,
      unique: true,
      index: true,
    },

    gameName: String,

    category: String,

    image: String,

    vendorId: Number,

    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "SoftApiGames",
  schema
);