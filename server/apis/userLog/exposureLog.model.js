const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const ExposureLogSchema = new Schema(
    {
        userId: { type: ObjectId, ref: "Users", required: true },
        betId: { type: ObjectId, ref: "Bet" }, // Optional, as some updates might not be tied to a single bet (e.g. manual fix)
        gameId: { type: String },
        marketId: { type: String }, // Can be Number or String in other models, keeping loose for safety
        oldExp: { type: Number, required: true },
        newExp: { type: Number, required: true },
        diff: { type: Number, required: true },
        action: {
            type: String,
            enum: ["place", "settle", "cancel", "void", "delete", "fix", "upline_update", "correction"],
            required: true
        },
        remark: { type: String }, // "Bet Placement", "Upline Distribution", "Manual Fix"
        createdBy: { type: ObjectId, ref: "Users" } // Admin who did the fix or System
    },
    {
        timestamps: true,
    }
);

ExposureLogSchema.index({ userId: 1, createdAt: -1 });
ExposureLogSchema.index({ betId: 1 });

module.exports = mongoose.model("ExposureLog", ExposureLogSchema);
