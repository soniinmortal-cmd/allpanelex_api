const mongoose = require("mongoose");

const gameSchema = new mongoose.Schema(
  {
    game_status: {
      type: String,
      default: null,
    },

    game_image: {
      type: String,
      default: null,
    },

    game_name: {
      type: String,
      default: null,
    },

    game_slot_status: {
      type: Boolean,
      default: null,
    },

    game_category: {
      type: String,
      default: null,
    },

    game_provider: {
      type: String,
      default: null,
    },

    game_identifier: {
      type: String,
      default: null,
    },

    trending_status: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "gameSchemas",
  }
);

module.exports = mongoose.model("GameSchema", gameSchema);