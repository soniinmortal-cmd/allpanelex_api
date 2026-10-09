const httpStatus = require("http-status");
const APIResponse = require("../../helpers/APIResponse");
const Utils = require("../../helpers/utils");

const decrypt = async (req, res, next) => {
  try {
    let encData = Utils.jskDecryptData(req.body.data);
    // console.log(encData, "encData");

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(encData, Utils.messages.SUCCESS_MSG, httpStatus.OK)
      );
  } catch (e) {
    next(e);
  }
};

const encrypt = async (req, res, next) => {
  try {
    let encData = Utils.jskEncryptData(req.body.data);

    // console.log(encData, "encData");

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse({ encData }, Utils.messages.SUCCESS_MSG, httpStatus.OK)
      );
  } catch (e) {
    next(e);
  }
};

module.exports = {
  encrypt,
  decrypt,
};
