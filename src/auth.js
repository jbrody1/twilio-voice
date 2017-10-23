'use strict';
var env = require('./env');
var utils = require('./utils');
var logger = utils.logger;
var promise = require('promise');
var uuid = require('uuid');

module.exports.getOrCreateUser = function(email, accountSid) {
	return promise.resolve({
		email: email,
		twilio_account_sid: env.twilio_account_sid,
		twilio_auth_token: env.twilio_auth_token,
	});
};

module.exports.hasTwilioAuth = function(user) {
	// does the user have twilio credentials
	return  user &&
		user.twilio_account_sid &&
		user.twilio_auth_token;
};

