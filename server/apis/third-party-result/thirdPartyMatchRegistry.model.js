const mongoose = require("mongoose");

/**
 * Tracks which matches (gameId) have been registered with the
 * third-party result API for match odds result declaration.
//  */

const ThirdPartyMatchRegistrySchema = new mongoose.Schema(
  {
    gameId: {
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

    etid: {
      type: Number,
      required: true,
    },

    resultDeclared: {
      type: Boolean,
      default: false,
    },

    registrationFailed: {
      type: Boolean,
      default: false,
    },

    resultData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    declaredAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

ThirdPartyMatchRegistrySchema.index(
  {
    gameId: 1,
    marketId: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model(
  "ThirdPartyMatchRegistry",
  ThirdPartyMatchRegistrySchema
);
// const ThirdPartyMatchRegistrySchema = new mongoose.Schema(
//   {
//     gameId: { type: String, required: true, unique: true, index: true },
//     etid: { type: Number, required: true }, // 1=football, 2=tennis, 4=cricket
//     name: { type: String, default: null }, // Match name from 3P
//     runners: { type: [mongoose.Schema.Types.Mixed], default: [] }, // Runners list
//     // Tracks whether the result has been auto-declared (to prevent double declaration)
//     resultDeclared: { type: Boolean, default: false },
//     // Set to true when 3P returns an error during registration
//     registrationFailed: { type: Boolean, default: false },
//     // Raw result data returned by the third-party API when result was declared
//     resultData: { type: mongoose.Schema.Types.Mixed, default: null },
//     // Timestamp when the result was declared by the third-party API
//     declaredAt: { type: Date, default: null },
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model(
//   "ThirdPartyMatchRegistry",
//   ThirdPartyMatchRegistrySchema
// );
