const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const Privileges = require("./privileges.model");

const updatePrivilege = async (privileges, role) => {
  if (!role) {
    throw new APIError("Role is required", httpStatus.BAD_REQUEST);
  }
  
  const existing = await Privileges.findOne({ role });

  let result;
  if (existing) {
    existing.privileges = privileges;
    result = await existing.save();
  } else {
    const newPrivileges = new Privileges({
      role,
      privileges,
    });
    result = await newPrivileges.save();
  }

  return new APIResponse(
    result,
    existing
      ? `Privileges updated for role ${role} `
      : `Privileges created for role ${role}`,
    httpStatus.OK
  );
};

const getPrivilege = async (role) => {
  if (!role) {
    throw new APIError("Role is required", httpStatus.BAD_REQUEST);
  }
  const privileges = await Privileges.findOne({ role });
  if (!privileges) {
    return new APIResponse(
      { role, privileges: {} },
      `No privileges found, returning empty.`,
      httpStatus.OK
    );
  }

  return new APIResponse(
    { role, privileges },
    `Privileges fetched for role ${role}`,
    httpStatus.OK
  );
};

module.exports = {
  updatePrivilege,
  getPrivilege,
};
