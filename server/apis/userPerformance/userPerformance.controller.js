const httpStatus = require("http-status");
const {
  getUserPerformance,
  updateUserPerformance,
} = require("./userPerformance.helper");

const getPerformance = async (req, res, next) => {
  try {
    const type = req.params.type;
    const response = await getUserPerformance(req.user._id, type, req?.domainConfig?.domain);
    res.status(httpStatus.OK).send(response);
  } catch (err) {
    next(err);
  }
};

const updatePerformance = async (req, res, next) => {
  try {
    const { button } = req.body;
    const response = await updateUserPerformance(req.user._id, button);
    res.status(httpStatus.OK).send(response);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPerformance,
  updatePerformance,
};
