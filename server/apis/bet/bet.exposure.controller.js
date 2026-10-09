const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");

const recalculateUserExposure = async (req, res, next) => {
    try {
        const result = await require('../../helpers/exposure.helper').verifyAndFixUserExposure(req.user._id);
        res.status(httpStatus.OK).json(new APIResponse(result, 'Exposure recalculation completed', httpStatus.OK));
    } catch (e) {
        return next(
            new APIError(
                e.message,
                httpStatus.INTERNAL_SERVER_ERROR,
                true,
                e.stack
            )
        );
    }
};

const applyExposureFix = async (req, res, next) => {
    try {
        const result = await require('../../helpers/exposure.helper').applyExposureFixes(req.user._id);
        res.status(httpStatus.OK).json(new APIResponse(result, 'Exposure fixes applied successfully', httpStatus.OK));
    } catch (e) {
        return next(
            new APIError(
                e.message,
                httpStatus.INTERNAL_SERVER_ERROR,
                true,
                e.stack
            )
        );
    }
};

module.exports = {
  recalculateUserExposure,
  applyExposureFix
};
