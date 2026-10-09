"use strict";

const makeError = ( statusCode, code, message, type = undefined, field = undefined ) => {
    const error = new Error( message );
    error.statusCode = statusCode;
    error.code = code;
    error.type = type;
    error.field = field;
    return error;
}

const ER_UNAUTHORIZED_CLIENT = makeError( 401, "ER_UNAUTHORIZED_CLIENT", "Unauthorized user access to API.", "AUTHORIZATION" );
const ER_API_NOT_FOUND = makeError( 400, "ER_API_NOT_FOUND", "API cannot be found.", "REQUEST_VALIDATION" );
module.exports = {
  SUCCESS_MSG: 'Successfully Data Fetch',
  SUCCESS_DELETE: 'Successfully Delete',
};
