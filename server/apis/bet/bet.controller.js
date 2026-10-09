const placementControllers = require("./bet.placement.controller");
const resultControllers = require("./bet.result.controller");
const historyControllers = require("./bet.history.controller");
const exposureControllers = require("./bet.exposure.controller");

module.exports = {
  ...placementControllers,
  ...resultControllers,
  ...historyControllers,
  ...exposureControllers,
};
