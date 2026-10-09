const httpStatus = require("http-status");
const { updatePrivilege, getPrivilege } = require("./privileges.helper");

const updatePrivileges = async (req, res, next) => {
  try {
    const { privileges, role } = req.body;
    const response = await updatePrivilege(privileges, role);
    res.status(httpStatus.OK).send(response);
  } catch (err) {
    next(err);
  }
};

const getPrivileges = async (req, res, next) => {
  try {
    const { role } = req.params;
    const response = await getPrivilege(role);
    res.status(httpStatus.OK).send(response);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  updatePrivileges,
  getPrivileges,
};
