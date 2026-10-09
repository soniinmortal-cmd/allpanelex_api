const httpStatus = require("http-status");
const APIResponse = require("../../helpers/APIResponse");
const SectionBetRestriction = require("./sectionBetRestriction.model");
// const User = require("../../models/user.model");

const updateSectionRestriction = async (req, res, next) => {
    try {
        const { gameId, marketId, userIds } = req.body;
        const adminId = req.user._id;

        // Update or Create restriction
        let restriction = await SectionBetRestriction.findOne({
            gameId,
            marketId
        });

        if (restriction) {
            restriction.userIds = userIds;
            restriction.lockedBy = adminId;
            await restriction.save();
        } else {
            restriction = await SectionBetRestriction.create({
                gameId,
                marketId,
                userIds,
                lockedBy: adminId,
            });
        }

        res
            .status(httpStatus.OK)
            .send(new APIResponse(restriction, "Section bet restriction updated successfully", httpStatus.OK));
    } catch (error) {
        next(error);
    }
};

const getSectionRestriction = async (req, res, next) => {
    try {
        const { gameId, marketId } = req.query;

        if (!gameId || !marketId) {
            return res
                .status(httpStatus.BAD_REQUEST)
                .send(new APIResponse({}, "gameId, marketId, and sectionId are required", httpStatus.BAD_REQUEST));
        }

        const restriction = await SectionBetRestriction.findOne({
            gameId,
            marketId,
        });

        res
            .status(httpStatus.OK)
            .send(
                new APIResponse(
                    restriction ? restriction.userIds : [],
                    "Fetched restricted users successfully",
                    httpStatus.OK
                )
            );
    } catch (error) {
        next(error);
    }
};

module.exports = {
    updateSectionRestriction,
    getSectionRestriction,
};
