const mongoose = require("mongoose");

/**
 * Tracks which fancy sections (marketId_sectionId) have been registered
 * with the third-party result API. Used to prevent duplicate API calls.
 */
const ThirdPartyFancyRegistrySchema = new mongoose.Schema(
  {
    gameId: {
      type: String,
      required: true,
      index: true,
    },

    sectionId: {
      type: String,
      required: true,
      index: true,
    },

    marketId: {
      type: String,
      required: true,
      index: true,
    },

    originalMarketId: {
      type: String,
      required: true,
      index: true,
    },

    eventName: {
      type: String,
      default: null,
    },

    marketName: {
      type: String,
      default: null,
    },

    marketType: {
      type: String,
      default: null,
    },
    // format: "${marketId}_${sectionId}"
    // fancyKey: { type: String, required: true, unique: true, index: true },
    // gameId: { type: String, required: true, index: true },
    // marketId: { type: Number, required: true },
    // sectionId: { type: Number, required: true },
    etid: { type: Number, required: true }, // 1=football, 2=tennis, 4=cricket
    // Fancy section name — shown in admin panel so owner knows which fancy is pending
    comment: { type: String, default: null },
    // Tracks whether the result has been auto-declared (to prevent double declaration)
    resultDeclared: { type: Boolean, default: false },
    // Set to true when 3P returns FANCY_NAME_NOT_FOUND — cron will skip polling this fancy
    registrationFailed: { type: Boolean, default: false },
    // Raw result data returned by the third-party API when result was declared
    resultData: { type: mongoose.Schema.Types.Mixed, default: null },
    // Timestamp when the result was declared by the third-party API
    declaredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "ThirdPartyFancyRegistry",
  ThirdPartyFancyRegistrySchema
);
