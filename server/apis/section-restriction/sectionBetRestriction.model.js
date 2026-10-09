const mongoose = require("mongoose");
const { Schema } = mongoose;

const sectionBetRestrictionSchema = new Schema(
    {
        gameId: {
            type: String,
            required: true,
        },
        marketId: {
            type: String,
            required: true,
        },
        sectionId: {
            type: String,
        },
        userIds: [
            {
                type: Schema.Types.ObjectId,
                ref: "User",
            },
        ],
        lockedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Create compound index for fast querying by game/market/section
sectionBetRestrictionSchema.index({ gameId: 1, marketId: 1 }, { unique: true });

const SectionBetRestriction = mongoose.model("SectionBetRestriction", sectionBetRestrictionSchema);

module.exports = SectionBetRestriction;
