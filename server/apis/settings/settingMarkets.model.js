const mongoose = require("mongoose");

const settingMarketSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true
    },

    values: [
      {
        gameId: {
          type: String,
          required: true
        },

        type: {
          type: String,
          required: true
        },

        label: {
          type: String,
          required: true
        },

        value: {
          type: Number,
          default: 0
        },

        domain: {
          type: String,
          default: ""
        }
      }
    ]
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model(
  "setting_markets",
  settingMarketSchema
);